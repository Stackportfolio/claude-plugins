#!/usr/bin/env node
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sniffImageType } from './find-images.mjs';

const execFileAsync = promisify(execFile);

/**
 * Redacts query strings from URLs for secure logging.
 * Protects HMAC signatures and single-use upload capability tokens from transcripts.
 */
export function redactUrl(rawUrl) {
	if (!rawUrl || typeof rawUrl !== 'string') return '';
	try {
		const u = new URL(rawUrl);
		if (u.search) {
			return `${u.origin}${u.pathname}?[query truncated]`;
		}
		return `${u.origin}${u.pathname}`;
	} catch {
		const qIdx = rawUrl.indexOf('?');
		if (qIdx !== -1) {
			return `${rawUrl.slice(0, qIdx)}?[query truncated]`;
		}
		return rawUrl;
	}
}

/**
 * Determines appropriate Content-Type for an image file.
 * Prioritises magic bytes sniffing, falling back to extension.
 */
export function detectContentType(bytes, filePath) {
	const sniffed = sniffImageType(bytes.subarray(0, 64));
	if (sniffed) return sniffed;

	const lower = filePath.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';

	return 'application/octet-stream';
}

/**
 * Performs PUT upload of a file to a signed capability URL using Node fetch.
 * Falls back to curl -T if fetch is unavailable or specifically requested.
 */
export async function putUpload(targetUrl, filePath, options = {}) {
	const resolvedFile = resolve(filePath);
	if (!existsSync(resolvedFile) || !statSync(resolvedFile).isFile()) {
		throw new Error(`File not found: ${filePath}`);
	}

	const fileBytes = readFileSync(resolvedFile);
	const contentType = options.contentType || detectContentType(fileBytes, resolvedFile);
	const redactedTarget = redactUrl(targetUrl);

	// Fallback to curl if fetch is unavailable or explicitly forced
	if (typeof fetch !== 'function' || options.forceCurl) {
		return putUploadCurl(targetUrl, resolvedFile, contentType, fileBytes.byteLength, redactedTarget);
	}

	try {
		const response = await fetch(targetUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': contentType,
				'Content-Length': String(fileBytes.byteLength)
			},
			body: fileBytes
		});

		const text = await response.text();
		let responseBody = text;
		try {
			responseBody = JSON.parse(text);
		} catch {
			// Keep as raw text if not JSON
		}

		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				target: redactedTarget,
				file: filePath,
				contentType,
				size: fileBytes.byteLength,
				error: responseBody || `HTTP ${response.status}`
			};
		}

		return {
			ok: true,
			status: response.status,
			target: redactedTarget,
			file: filePath,
			contentType,
			size: fileBytes.byteLength,
			response: responseBody
		};
	} catch (err) {
		// If fetch failed due to environment, attempt curl fallback
		if (!options.noCurlFallback) {
			try {
				return putUploadCurl(targetUrl, resolvedFile, contentType, fileBytes.byteLength, redactedTarget);
			} catch (curlErr) {
				return {
					ok: false,
					status: 0,
					target: redactedTarget,
					file: filePath,
					error: `Fetch error (${err.message}) and curl fallback failed (${curlErr.message})`
				};
			}
		}

		return {
			ok: false,
			status: 0,
			target: redactedTarget,
			file: filePath,
			error: err.message
		};
	}
}

/**
 * Executes PUT upload using curl -T asynchronously.
 */
async function putUploadCurl(targetUrl, resolvedFile, contentType, size, redactedTarget) {
	try {
		// -s: silent, -S: show error, -X PUT: PUT method, -T: upload file, -w: format status code
		const { stdout } = await execFileAsync('curl', [
			'-s',
			'-S',
			'-X',
			'PUT',
			'-T',
			resolvedFile,
			'-H',
			`Content-Type: ${contentType}`,
			'-w',
			'\n%{http_code}',
			targetUrl
		]);

		const lines = stdout.trim().split('\n');
		const statusCodeStr = lines[lines.length - 1].trim();
		const statusCode = parseInt(statusCodeStr, 10) || 0;
		const bodyText = lines.slice(0, lines.length - 1).join('\n').trim();

		let responseBody = bodyText;
		try {
			responseBody = JSON.parse(bodyText);
		} catch {
			// keep text
		}

		const isOk = statusCode >= 200 && statusCode < 300;
		return {
			ok: isOk,
			status: statusCode,
			target: redactedTarget,
			file: resolvedFile,
			contentType,
			size,
			response: isOk ? responseBody : undefined,
			error: !isOk ? responseBody || `HTTP ${statusCode}` : undefined
		};
	} catch (err) {
		return {
			ok: false,
			status: 0,
			target: redactedTarget,
			file: resolvedFile,
			contentType,
			size,
			error: `curl execution failed: ${err.message}`
		};
	}
}

export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(metaUrl) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

export async function runCli(argv = process.argv.slice(2)) {
	if (argv.length < 2) {
		console.error('Usage: put-upload.mjs <signed-upload-url> <image-file> [--content-type <type>]');
		process.exit(1);
	}

	const targetUrl = argv[0];
	const filePath = argv[1];

	let explicitContentType = null;
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--content-type' && argv[i + 1]) {
			explicitContentType = argv[i + 1];
			i++;
		}
	}

	try {
		const result = await putUpload(targetUrl, filePath, {
			contentType: explicitContentType
		});

		process.stdout.write(JSON.stringify(result, null, 2) + '\n');
		if (!result.ok) {
			process.exit(1);
		}
	} catch (err) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					target: redactUrl(targetUrl),
					error: err.message
				},
				null,
				2
			)
		);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
