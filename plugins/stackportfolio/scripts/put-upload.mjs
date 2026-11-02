#!/usr/bin/env node
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sniffImageType } from './find-images.mjs';

const execFileAsync = promisify(execFile);

/**
 * Redacts upload capability tokens and query strings from URLs for secure logging.
 * Protects HMAC signatures and single-use upload capability tokens from transcripts.
 */
export function redactUrl(rawUrl) {
	if (!rawUrl || typeof rawUrl !== 'string') return '';
	try {
		const u = new URL(rawUrl);
		let pathname = u.pathname;
		if (pathname.startsWith('/api/v1/uploads/')) {
			const parts = pathname.split('/');
			if (parts.length > 4 && parts[4]) {
				parts[4] = '[token truncated]';
				pathname = parts.join('/');
			}
		}
		const search = u.search ? '?[query truncated]' : '';
		return `${u.origin}${pathname}${search}`;
	} catch {
		let redacted = rawUrl;
		const qIdx = redacted.indexOf('?');
		if (qIdx !== -1) {
			redacted = `${redacted.slice(0, qIdx)}?[query truncated]`;
		}
		redacted = redacted.replace(/(\/api\/v1\/uploads\/)[^/?#]+/, '$1[token truncated]');
		return redacted;
	}
}

/**
 * Sanitizes an error message or string by stripping the full target URL,
 * the upload token from /api/v1/uploads/<token>, and query string parameters.
 */
export function sanitizeErrorMessage(errMsg, targetUrl, redactedTarget) {
	if (!errMsg || typeof errMsg !== 'string') return errMsg;
	let sanitized = errMsg;
	if (targetUrl) {
		sanitized = sanitized.replaceAll(targetUrl, redactedTarget || redactUrl(targetUrl));
	}
	try {
		const u = new URL(targetUrl);
		if (u.pathname.startsWith('/api/v1/uploads/')) {
			const parts = u.pathname.split('/');
			if (parts.length > 4 && parts[4]) {
				sanitized = sanitized.replaceAll(parts[4], '[token truncated]');
			}
		}
		if (u.search && u.search.length > 1) {
			sanitized = sanitized.replaceAll(u.search.slice(1), '[query truncated]');
		}
	} catch {
		const match = targetUrl?.match(/\/api\/v1\/uploads\/([^/?#]+)/);
		if (match && match[1]) {
			sanitized = sanitized.replaceAll(match[1], '[token truncated]');
		}
	}
	return sanitized;
}

function sanitizeError(errObj, targetUrl, redactedTarget) {
	if (typeof errObj === 'string') {
		return sanitizeErrorMessage(errObj, targetUrl, redactedTarget);
	}
	if (errObj && typeof errObj === 'object') {
		try {
			const jsonStr = JSON.stringify(errObj);
			const sanitized = sanitizeErrorMessage(jsonStr, targetUrl, redactedTarget);
			return JSON.parse(sanitized);
		} catch {
			return errObj;
		}
	}
	return errObj;
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
		return await putUploadCurl(targetUrl, resolvedFile, contentType, fileBytes.byteLength, redactedTarget);
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
				error: sanitizeError(responseBody, targetUrl, redactedTarget) || `HTTP ${response.status}`
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
				return await putUploadCurl(targetUrl, resolvedFile, contentType, fileBytes.byteLength, redactedTarget);
			} catch (curlErr) {
				const safeFetchErr = sanitizeErrorMessage(err.message, targetUrl, redactedTarget);
				const safeCurlErr = sanitizeErrorMessage(curlErr.message, targetUrl, redactedTarget);
				return {
					ok: false,
					status: 0,
					target: redactedTarget,
					file: filePath,
					error: `Fetch error (${safeFetchErr}) and curl fallback failed (${safeCurlErr})`
				};
			}
		}

		const safeErr = sanitizeErrorMessage(err.message, targetUrl, redactedTarget);
		return {
			ok: false,
			status: 0,
			target: redactedTarget,
			file: filePath,
			error: safeErr
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
			error: !isOk ? sanitizeError(responseBody, targetUrl, redactedTarget) || `HTTP ${statusCode}` : undefined
		};
	} catch (err) {
		const safeErr = sanitizeErrorMessage(err.message, targetUrl, redactedTarget);
		return {
			ok: false,
			status: 0,
			target: redactedTarget,
			file: resolvedFile,
			contentType,
			size,
			error: `curl execution failed: ${safeErr}`
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
		const redacted = redactUrl(targetUrl);
		const safeErr = sanitizeErrorMessage(err.message, targetUrl, redacted);
		console.error(
			JSON.stringify(
				{
					ok: false,
					target: redacted,
					error: safeErr
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
