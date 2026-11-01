import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	putUpload,
	redactUrl,
	detectContentType
} from '../plugins/stackportfolio/scripts/put-upload.mjs';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '../plugins/stackportfolio/scripts/put-upload.mjs');
const FIXTURE_PNG = join(__dirname, 'image-fixtures/screenshots/screenshot.png');
const FIXTURE_BYTES = readFileSync(FIXTURE_PNG);

describe('put-upload', () => {
	it('redactUrl truncates query strings and preserves pathname', () => {
		const sensitiveUrl =
			'https://stackportfol.io/api/v1/uploads/token-abc-123?sig=secretHmac12345&exp=99999999';
		const redacted = redactUrl(sensitiveUrl);
		assert.strictEqual(redacted, 'https://stackportfol.io/api/v1/uploads/token-abc-123?[query truncated]');
		assert.ok(!redacted.includes('secretHmac12345'));

		const plainUrl = 'https://stackportfol.io/api/v1/uploads/token-abc-123';
		assert.strictEqual(redactUrl(plainUrl), 'https://stackportfol.io/api/v1/uploads/token-abc-123');
	});

	it('detectContentType detects correct mime type from sniffing and extensions', () => {
		assert.strictEqual(detectContentType(FIXTURE_BYTES, FIXTURE_PNG), 'image/png');
		assert.strictEqual(detectContentType(Buffer.alloc(0), 'photo.jpg'), 'image/jpeg');
		assert.strictEqual(detectContentType(Buffer.alloc(0), 'image.webp'), 'image/webp');
	});

	it('checks PUT method, body bytes, and Content-Type against local HTTP server', async () => {
		let receivedMethod = null;
		let receivedHeaders = null;
		let receivedBody = Buffer.alloc(0);

		const server = http.createServer((req, res) => {
			receivedMethod = req.method;
			receivedHeaders = req.headers;
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				receivedBody = Buffer.concat(chunks);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true, mediaId: 'test-media-id-123' }));
			});
		});

		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		const secretQuery = 'sig=super_confidential_hmac_secret_456';
		const targetUrl = `http://127.0.0.1:${port}/api/v1/uploads/upload-token-abc?${secretQuery}`;

		try {
			const result = await putUpload(targetUrl, FIXTURE_PNG);

			// Assertions on server receipt
			assert.strictEqual(receivedMethod, 'PUT');
			assert.strictEqual(receivedHeaders['content-type'], 'image/png');
			assert.strictEqual(receivedHeaders['content-length'], String(FIXTURE_BYTES.length));
			assert.deepStrictEqual(receivedBody, FIXTURE_BYTES);

			// Assertions on client result
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.status, 200);
			assert.strictEqual(result.contentType, 'image/png');
			assert.strictEqual(result.size, FIXTURE_BYTES.length);
			assert.strictEqual(result.response.mediaId, 'test-media-id-123');

			// Assert target URL query string is redacted
			assert.ok(!result.target.includes('super_confidential_hmac_secret_456'));
			assert.ok(result.target.endsWith('?[query truncated]'));
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('executes PUT upload via curl fallback and verifies method and payload', async () => {
		let receivedMethod = null;
		let receivedHeaders = null;
		let receivedBody = Buffer.alloc(0);

		const server = http.createServer((req, res) => {
			receivedMethod = req.method;
			receivedHeaders = req.headers;
			const chunks = [];
			req.on('data', (c) => chunks.push(c));
			req.on('end', () => {
				receivedBody = Buffer.concat(chunks);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ ok: true, via: 'curl' }));
			});
		});

		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		const targetUrl = `http://127.0.0.1:${port}/api/v1/uploads/curl-token?token=secret123`;

		try {
			const result = await putUpload(targetUrl, FIXTURE_PNG, { forceCurl: true });

			assert.strictEqual(receivedMethod, 'PUT');
			assert.strictEqual(receivedHeaders['content-type'], 'image/png');
			assert.deepStrictEqual(receivedBody, FIXTURE_BYTES);
			assert.strictEqual(result.ok, true);
			assert.strictEqual(result.status, 200);
			assert.ok(!result.target.includes('secret123'));
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('exits with non-zero code when server returns a 4xx error (CLI invocation)', async () => {
		const server = http.createServer((req, res) => {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					error: { code: 'validation_failed', message: 'Corrupted image bytes' }
				})
			);
		});

		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		const secretQuery = 'secret_param=hidden_key_999';
		const targetUrl = `http://127.0.0.1:${port}/api/v1/uploads/test-token?${secretQuery}`;

		try {
			let failed = false;
			try {
				await execFileAsync(process.execPath, [SCRIPT_PATH, targetUrl, FIXTURE_PNG]);
			} catch (err) {
				failed = true;
				assert.strictEqual(err.code, 1);
				// Ensure redacted query string was never printed in error or stdout/stderr
				const combined = (err.stdout || '') + (err.stderr || '');
				assert.ok(!combined.includes('hidden_key_999'));
				assert.ok(combined.includes('[query truncated]'));
			}
			assert.ok(failed, 'CLI execution must fail with non-zero exit code on 400 response');
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('exits with non-zero code when server returns a 5xx error (CLI invocation)', async () => {
		const server = http.createServer((req, res) => {
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('Internal Storage Failure');
		});

		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = server.address().port;
		const targetUrl = `http://127.0.0.1:${port}/api/v1/uploads/token-500?query=sensitivetoken`;

		try {
			let failed = false;
			try {
				await execFileAsync(process.execPath, [SCRIPT_PATH, targetUrl, FIXTURE_PNG]);
			} catch (err) {
				failed = true;
				assert.strictEqual(err.code, 1);
				const combined = (err.stdout || '') + (err.stderr || '');
				assert.ok(!combined.includes('sensitivetoken'));
			}
			assert.ok(failed, 'CLI execution must fail with non-zero exit code on 500 response');
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});

	it('exits with non-zero code on missing file argument', async () => {
		let failed = false;
		try {
			await execFileAsync(process.execPath, [
				SCRIPT_PATH,
				'http://localhost:1234/upload',
				'nonexistent-file.png'
			]);
		} catch (err) {
			failed = true;
			assert.strictEqual(err.code, 1);
		}
		assert.ok(failed, 'CLI execution must fail with non-zero code on missing file');
	});
});
