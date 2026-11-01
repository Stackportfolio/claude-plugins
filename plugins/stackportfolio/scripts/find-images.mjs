#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Validation rules derived directly from Stackportfolio app codebase:
 *
 * 1. Maximum file size: 5 MiB (5,242,880 bytes)
 *    - src/lib/schemas/media.ts:39 (`export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;`)
 *    - src/lib/server/storage/validation.ts:73 (`if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: MEDIA_TOO_LARGE };`)
 *    - src/lib/server/api/operations/project-media.ts:248 (`maxBytes: MAX_IMAGE_BYTES`)
 *
 * 2. Allowed upload content types: image/png, image/jpeg, image/webp
 *    - src/lib/server/api/operations/project-media.ts:191 (`const ALLOWED_UPLOAD_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);`)
 *    - src/lib/server/api/operations/project-media.ts:230-238 (throws validationFailed if contentType is not image/png, image/jpeg, or image/webp)
 *    - src/routes/api/v1/uploads/[token]/+server.ts:54-64 (`Unsupported image type. Only PNG, JPEG, and WebP are allowed.`)
 *
 * 3. Sniffing magic bytes (identifies type from leading bytes, never trusting extension or label):
 *    - src/lib/server/storage/validation.ts:40-55 (`sniffImageType`):
 *      PNG:  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
 *      JPEG: [0xff, 0xd8, 0xff]
 *      GIF:  [0x47, 0x49, 0x46, 0x38]
 *      WebP: RIFF [0x52, 0x49, 0x46, 0x46] and WEBP [0x57, 0x42, 0x45, 0x50] at offset 8
 *
 * 4. GIF rule:
 *    - src/lib/server/api/operations/project-media.ts:191, 230-238 (create_project_media_upload rejects image/gif)
 *    - src/routes/api/v1/uploads/[token]/+server.ts:57-64 (signed capability PUT upload rejects image/gif)
 *    - src/lib/server/storage/optimise.ts:125-131 (animated/multi-page images rejected with "Animated or multi-page images are not supported")
 *    - Signed capability upload requires PNG, JPEG, or WebP; GIF is refused with an explicit reason.
 *
 * 5. Empty / missing files:
 *    - src/lib/server/storage/validation.ts:72 (`if (file.size === 0) return { ok: false, reason: MEDIA_NO_FILE };`)
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB (5,242,880 bytes)
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|webp|gif|svg|bmp|tiff?|avif|ico)$/i;

/**
 * Normalises file paths to forward slashes for cross-platform consistency.
 */
function normPath(p) {
	return p.replace(/\\/g, '/');
}

/**
 * Identify format from the file's leading bytes (magic numbers).
 * Mirrored from src/lib/server/storage/validation.ts:40-55.
 */
export function sniffImageType(bytes) {
	if (!bytes || bytes.length < 3) return undefined;

	// PNG: 89 50 4E 47 0D 0A 1A 0A (validation.ts:41)
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png';
	}

	// JPEG: FF D8 FF (validation.ts:42)
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}

	// GIF: GIF8 (47 49 46 38) (validation.ts:43)
	if (
		bytes.length >= 4 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38
	) {
		return 'image/gif';
	}

	// WebP: RIFF .... WEBP (validation.ts:48-51, accepting standard WEBP and validation.ts transposition)
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		((bytes[9] === 0x45 && bytes[10] === 0x42) || (bytes[9] === 0x42 && bytes[10] === 0x45)) &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}

	return undefined;
}

/**
 * Validates an image file's type and size against server constraints.
 * Refuses with reason; never resizes.
 */
export function validateImageFile(filePath) {
	if (!existsSync(filePath)) {
		return {
			valid: false,
			size: null,
			contentType: null,
			reason: 'Referenced image file does not exist on disk.'
		};
	}

	let stat;
	try {
		stat = statSync(filePath);
	} catch (err) {
		return {
			valid: false,
			size: null,
			contentType: null,
			reason: `Cannot access file: ${err.message}`
		};
	}

	if (!stat.isFile()) {
		return {
			valid: false,
			size: null,
			contentType: null,
			reason: 'Target is not a regular file.'
		};
	}

	// Zero-byte check (src/lib/server/storage/validation.ts:72)
	if (stat.size === 0) {
		return {
			valid: false,
			size: 0,
			contentType: null,
			reason: 'File is empty (0 bytes).'
		};
	}

	// Read leading bytes for sniffing (at most 64 bytes needed for magic bytes)
	let leadingBytes;
	try {
		const fd = readFileSync(filePath);
		leadingBytes = fd.subarray(0, Math.min(fd.length, 64));
	} catch (err) {
		return {
			valid: false,
			size: stat.size,
			contentType: null,
			reason: `Failed to read file: ${err.message}`
		};
	}

	const sniffed = sniffImageType(leadingBytes);

	// Size limit check (src/lib/schemas/media.ts:39, src/lib/server/storage/validation.ts:73)
	if (stat.size > MAX_IMAGE_BYTES) {
		return {
			valid: false,
			size: stat.size,
			contentType: sniffed || null,
			reason: `File size (${stat.size} bytes) exceeds server maximum of 5 MiB (5,242,880 bytes).`
		};
	}

	// GIF check (src/lib/server/api/operations/project-media.ts:191, src/routes/api/v1/uploads/[token]/+server.ts:57-64)
	if (sniffed === 'image/gif') {
		return {
			valid: false,
			size: stat.size,
			contentType: 'image/gif',
			reason:
				'GIF format is not supported for signed upload; server accepts only PNG, JPEG, and WebP (src/lib/server/api/operations/project-media.ts:191).'
		};
	}

	// Unsupported type check (src/lib/server/storage/validation.ts:40-55, src/lib/server/api/operations/project-media.ts:191)
	if (!sniffed || !ALLOWED_IMAGE_TYPES.has(sniffed)) {
		return {
			valid: false,
			size: stat.size,
			contentType: sniffed || null,
			reason:
				'Unsupported image format. Server accepts only PNG, JPEG, and WebP (src/lib/server/api/operations/project-media.ts:191).'
		};
	}

	return {
		valid: true,
		size: stat.size,
		contentType: sniffed,
		reason: null
	};
}

/**
 * Recursively scans a directory for image files.
 */
function scanDirImages(baseDir, currentDir, outFiles) {
	if (!existsSync(currentDir)) return;
	let entries;
	try {
		entries = readdirSync(currentDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue; // ignore hidden
		const fullPath = join(currentDir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.git') continue;
			scanDirImages(baseDir, fullPath, outFiles);
		} else if (entry.isFile()) {
			const isCandidateDir =
				normPath(currentDir).includes('/screenshots') ||
				normPath(currentDir).endsWith('/screenshots') ||
				IMAGE_EXTENSION_REGEX.test(entry.name);
			if (isCandidateDir) {
				outFiles.push(fullPath);
			}
		}
	}
}

/**
 * Extracts local image references from a README string.
 * Supports Markdown images ![alt](path), HTML <img src="path">, and reference-style definitions [id]: path.
 */
export function extractReadmeImageRefs(readmeContent, readmeDir, repoDir) {
	const refs = [];
	const lines = readmeContent.split('\n');

	// Reference definitions map: [id]: url
	const refDefs = new Map();
	const refDefRegex = /^\s*\[([^\]]+)\]:\s*([^\s]+)/;
	for (let i = 0; i < lines.length; i++) {
		const match = refDefRegex.exec(lines[i]);
		if (match) {
			refDefs.set(match[1].toLowerCase(), { url: match[2], line: i + 1 });
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		// 1. Markdown images: ![alt](url "title")
		const mdImgRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
		let mdMatch;
		while ((mdMatch = mdImgRegex.exec(line)) !== null) {
			const rawSrc = mdMatch[2].trim();
			refs.push({ rawSrc, lineNum });
		}

		// 2. HTML <img> tags: <img src="url">
		const htmlImgRegex = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
		let htmlMatch;
		while ((htmlMatch = htmlImgRegex.exec(line)) !== null) {
			const rawSrc = htmlMatch[1].trim();
			refs.push({ rawSrc, lineNum });
		}

		// 3. Markdown reference style: ![alt][id] or ![id]
		const mdRefRegex = /!\[([^\]]*)\](?:\[([^\]]*)\])?/g;
		let refMatch;
		while ((refMatch = mdRefRegex.exec(line)) !== null) {
			// Skip if it was already matched as inline ![alt](...)
			if (line.slice(refMatch.index).startsWith('![' + refMatch[1] + '](')) continue;
			const targetId = (refMatch[2] || refMatch[1]).trim().toLowerCase();
			if (targetId && refDefs.has(targetId)) {
				const def = refDefs.get(targetId);
				refs.push({ rawSrc: def.url, lineNum });
			}
		}
	}

	// Filter and resolve references
	const resolvedRefs = [];
	for (const ref of refs) {
		let clean = ref.rawSrc;
		// Skip remote URLs or data URIs
		if (/^(https?:|data:|mailto:|\/\/)/i.test(clean)) continue;

		// Strip query parameters and hash fragments (e.g. foo.png?raw=true#heading)
		clean = clean.split('#')[0].split('?')[0].trim();
		if (!clean) continue;

		try {
			clean = decodeURIComponent(clean);
		} catch {
			// keep as is if decoding fails
		}

		// Resolve relative to README directory
		const fullPath = resolve(readmeDir, clean);
		const relToRepo = normPath(relative(repoDir, fullPath));

		resolvedRefs.push({
			rawSrc: ref.rawSrc,
			fullPath,
			relPath: relToRepo,
			lineNum: ref.lineNum
		});
	}

	return resolvedRefs;
}

/**
 * Finds candidate screenshots and images in a repository.
 *
 * Scans:
 * - screenshots/ directory
 * - docs/ directory
 * - assets/ directory
 * - README image references
 *
 * Validates type and size against server constraints (refuses with reason, never resizes).
 */
export function findImages(repoPath = '.') {
	const resolvedRepo = resolve(repoPath || '.');
	if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
		throw new Error(`Directory not found: ${resolvedRepo}`);
	}

	const candidatesMap = new Map();

	function recordCandidate(relPath, fullPath, source, lineNum = null) {
		const normalisedRel = normPath(relPath);
		// Avoid indexing parent traversal outside repo root
		if (normalisedRel.startsWith('..')) return;

		const sourceTag = lineNum !== null ? `${source}:${lineNum}` : source;

		if (candidatesMap.has(normalisedRel)) {
			const existing = candidatesMap.get(normalisedRel);
			if (!existing.sources.includes(sourceTag)) {
				existing.sources.push(sourceTag);
			}
			return;
		}

		const validation = validateImageFile(fullPath);
		const candidate = {
			path: normalisedRel,
			filename: basename(normalisedRel),
			source: sourceTag,
			sources: [sourceTag],
			contentType: validation.contentType,
			size: validation.size,
			valid: validation.valid,
			reason: validation.reason
		};

		candidatesMap.set(normalisedRel, candidate);
	}

	// 1. Scan candidate folders: screenshots/, docs/, assets/
	const candidateFolders = ['screenshots', 'docs', 'assets'];
	for (const folder of candidateFolders) {
		const dirPath = join(resolvedRepo, folder);
		if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
			const files = [];
			scanDirImages(resolvedRepo, dirPath, files);
			for (const f of files) {
				const rel = relative(resolvedRepo, f);
				recordCandidate(rel, f, folder);
			}
		}
	}

	// 2. Scan README image refs
	const readmeNames = ['README.md', 'README', 'readme.md', 'Readme.md', 'README.markdown'];
	const seenInodes = new Set();
	for (const name of readmeNames) {
		const readmePath = join(resolvedRepo, name);
		if (existsSync(readmePath)) {
			let stat;
			try {
				stat = statSync(readmePath);
			} catch {
				continue;
			}
			if (!stat.isFile()) continue;

			// Deduplicate identical files across case-insensitive filesystems
			const fileKey = `${stat.dev}:${stat.ino}`;
			if (seenInodes.has(fileKey)) continue;
			seenInodes.add(fileKey);

			let content = '';
			try {
				content = readFileSync(readmePath, 'utf8');
			} catch {
				continue;
			}
			const refs = extractReadmeImageRefs(content, resolvedRepo, resolvedRepo);
			for (const ref of refs) {
				recordCandidate(ref.relPath, ref.fullPath, name, ref.lineNum);
			}
		}
	}

	const candidates = Array.from(candidatesMap.values());
	const valid = candidates.filter((c) => c.valid);
	const rejected = candidates.filter((c) => !c.valid);

	return {
		repo: resolvedRepo,
		candidates,
		valid,
		rejected
	};
}

export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(metaUrl) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

export function runCli(argv = process.argv.slice(2)) {
	const repo = argv[0] || '.';
	try {
		const result = findImages(repo);
		process.stdout.write(JSON.stringify(result, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
