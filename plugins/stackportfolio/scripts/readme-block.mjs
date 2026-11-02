#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors src/lib/server/cards/snippets.ts:5-6
// STACK_CARD_MARKER_START and STACK_CARD_MARKER_END markers.
export const STACK_CARD_MARKER_START = '<!-- stackportfolio:stack-card -->';
export const STACK_CARD_MARKER_END = '<!-- /stackportfolio:stack-card -->';

// Mirrors src/lib/server/github/readme-badge.ts:107-144
// CommonMark fenced code block line scanner.
export function scanFenceLines(lines) {
	let inFence = false;
	let fenceChar = '';
	let fenceLength = 0;
	const mask = new Array(lines.length);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inFence) {
			const openMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/);
			if (openMatch) {
				const char = openMatch[1][0];
				const info = openMatch[2];
				if (char === '~' || !info.includes('`')) {
					inFence = true;
					fenceChar = char;
					fenceLength = openMatch[1].length;
					mask[i] = true;
					continue;
				}
			}
			mask[i] = false;
		} else {
			mask[i] = true;
			const closeMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/);
			if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLength) {
				inFence = false;
				fenceChar = '';
				fenceLength = 0;
			}
		}
	}

	return mask;
}

// Mirrors src/lib/server/github/readme-badge.ts:148-152
// Replaces fenced code lines with spaces preserving line alignment.
export function maskFencedCodeBlocks(normalized) {
	const lines = normalized.split('\n');
	const mask = scanFenceLines(lines);
	return lines.map((line, idx) => (mask[idx] ? ' '.repeat(line.length) : line)).join('\n');
}

// Mirrors src/lib/server/github/readme-badge.ts:158-172
// Detects badge or image embeds immediately following heading.
function isBadgeLine(line) {
	const trimmed = line.trim();
	if (!trimmed) return false;

	const patterns = [
		/^\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/,
		/^!\[[^\]]*\]\([^)]+\)/,
		/^<p\b[^>]*>[\s\S]*<\/p>$/i,
		/^<a\b[^>]*>[\s\S]*<img\b[\s\S]*<\/a>$/i,
		/^<img\b[^>]*\/?>/i
	];

	return patterns.some((p) => p.test(trimmed));
}

function findBadgeRange(lines) {
	let scanIdx = 0;
	while (scanIdx < lines.length && lines[scanIdx].trim() === '') {
		scanIdx++;
	}

	if (scanIdx >= lines.length || !isBadgeLine(lines[scanIdx])) {
		return null;
	}

	const first = scanIdx;
	let last = scanIdx;
	while (scanIdx < lines.length && isBadgeLine(lines[scanIdx])) {
		last = scanIdx;
		scanIdx++;
	}

	return { first, last };
}

// Mirrors src/lib/server/github/readme-badge.ts:177-194
// Sanitises heading and description strings.
function sanitizeHeading(value) {
	return (value || 'Project')
		.replace(/[\r\n]+/g, ' ')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/[<>[\]]/g, '')
		.trim();
}

function sanitizeDescription(value) {
	if (!value) return '';
	return value
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<!--/g, '')
		.replace(/-->/g, '')
		.replace(/[<>]/g, '')
		.trim();
}

// Mirrors src/lib/server/github/readme-badge.ts:199-221
// Creates starter README content when file does not exist.
function createStarterReadme(options, cleanMarker, eol, hasBom) {
	const repoName = sanitizeHeading(options?.repositoryName || 'Project');
	const desc = sanitizeDescription(options?.repositoryDescription);
	const starterLines = [`# ${repoName}`, ''];
	if (desc) {
		starterLines.push(desc, '');
	}
	starterLines.push(cleanMarker, '');
	const joined = starterLines.join(eol);
	const final = hasBom ? `\uFEFF${joined}` : joined;
	return {
		content: final,
		changed: true,
		status: 'created_readme',
		eol,
		hasBom
	};
}

// Mirrors src/lib/server/github/readme-badge.ts:226-258
// Safely repairs an unclosed marker without truncating document.
function repairUnclosedMarker(normalized, masked, cleanMarker, eol, hasBom) {
	const lines = normalized.split('\n');
	const maskedLines = masked.split('\n');
	const markerLineIdx = maskedLines.findIndex((l) => l.includes(STACK_CARD_MARKER_START));

	let endSwallowedIdx = markerLineIdx + 1;
	while (
		endSwallowedIdx < lines.length &&
		(lines[endSwallowedIdx].trim() === '' ||
			/stackportfol\.io|stack-card|badge\.svg|stack\.svg/i.test(lines[endSwallowedIdx]))
	) {
		endSwallowedIdx++;
	}

	const beforeLines = lines.slice(0, markerLineIdx);
	const afterLines = lines.slice(endSwallowedIdx);
	const updated = [...beforeLines, cleanMarker, ...afterLines].join('\n');
	const formatted = eol === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated;

	return {
		content: hasBom ? `\uFEFF${formatted}` : formatted,
		changed: true,
		status: 'updated_existing_marker',
		repairedUnclosedMarker: true,
		eol,
		hasBom
	};
}

// Mirrors src/lib/server/github/readme-badge.ts:263-317
// Updates existing marker in-place and removes duplicate marker blocks.
function updateExistingMarkers(
	normalized,
	masked,
	cleanMarker,
	startIndex,
	eol,
	hasBom,
	originalContent
) {
	const endIndex = masked.indexOf(STACK_CARD_MARKER_END, startIndex);
	if (endIndex === -1) {
		return repairUnclosedMarker(normalized, masked, cleanMarker, eol, hasBom);
	}

	const beforeFirst = normalized.slice(0, startIndex);
	const afterFirst = normalized.slice(endIndex + STACK_CARD_MARKER_END.length);
	const maskedAfterFirst = masked.slice(endIndex + STACK_CARD_MARKER_END.length);

	const duplicateRegex =
		/<!-- stackportfolio:stack-card -->[\s\S]*?<!-- \/stackportfolio:stack-card -->/g;
	const matches = [...maskedAfterFirst.matchAll(duplicateRegex)];
	const duplicateMarkersRemoved = matches.length;

	let remainingCleaned = '';
	let cursor = 0;
	for (const match of matches) {
		const matchStart = match.index;
		const matchEnd = matchStart + match[0].length;
		remainingCleaned += afterFirst.slice(cursor, matchStart);
		cursor = matchEnd;
	}
	remainingCleaned += afterFirst.slice(cursor);

	const updated = `${beforeFirst}${cleanMarker}${remainingCleaned}`;

	if (updated === normalized && duplicateMarkersRemoved === 0) {
		return {
			content: originalContent,
			changed: false,
			status: 'already_up_to_date',
			duplicateMarkersRemoved: 0,
			eol,
			hasBom
		};
	}

	const formatted = eol === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated;
	return {
		content: hasBom ? `\uFEFF${formatted}` : formatted,
		changed: true,
		status: 'updated_existing_marker',
		duplicateMarkersRemoved,
		eol,
		hasBom
	};
}

// Mirrors src/lib/server/github/readme-badge.ts:333-372
// Inserts marker directly after H1 heading or after contiguous badges.
function insertAfterH1(body, maskedBody, cleanMarker) {
	const h1Regex = /^(?:#\s+[^\n]+|[^\n]+\n={3,}\s*|<h1\b[^>]*>[\s\S]*?<\/h1>)/m;
	const h1Match = maskedBody.match(h1Regex);

	if (!h1Match || h1Match.index === undefined) {
		const cleanBody = body.replace(/^\n+/, '');
		return {
			insertedBody: cleanBody ? `${cleanMarker}\n\n${cleanBody}` : `${cleanMarker}\n`,
			status: 'inserted_top'
		};
	}

	const h1End = h1Match.index + h1Match[0].length;
	const beforeH1 = body.slice(0, h1End).trimEnd();
	const afterH1 = body.slice(h1End);
	const afterH1Lines = afterH1.split('\n');

	const badgeRange = findBadgeRange(afterH1Lines);
	if (badgeRange) {
		const badgeBlock = afterH1Lines.slice(badgeRange.first, badgeRange.last + 1).join('\n');
		const remaining = afterH1Lines
			.slice(badgeRange.last + 1)
			.join('\n')
			.replace(/^\n+/, '');
		return {
			insertedBody: `${beforeH1}\n\n${badgeBlock}\n\n${cleanMarker}${remaining ? `\n\n${remaining}` : '\n'}`,
			status: 'inserted_after_title'
		};
	}

	const remaining = afterH1.replace(/^\n+/, '');
	return {
		insertedBody: `${beforeH1}\n\n${cleanMarker}${remaining ? `\n\n${remaining}` : '\n'}`,
		status: 'inserted_after_title'
	};
}

// Mirrors src/lib/server/github/readme-badge.ts:377-393
// Inserts fresh marker based on configured placement.
function insertFreshMarker(body, maskedBody, cleanMarker, placement) {
	if (placement === 'top') {
		const cleanBody = body.replace(/^\n+/, '');
		return {
			insertedBody: cleanBody ? `${cleanMarker}\n\n${cleanBody}` : `${cleanMarker}\n`,
			status: 'inserted_top'
		};
	}

	if (placement === 'bottom') {
		const cleanBody = body.replace(/\n+$/, '');
		return {
			insertedBody: cleanBody ? `${cleanBody}\n\n${cleanMarker}\n` : `${cleanMarker}\n`,
			status: 'inserted_bottom'
		};
	}

	return insertAfterH1(body, maskedBody, cleanMarker);
}

// Ensures marker wrapper comments surround content.
export function normalizeMarkerBlock(markerBlock) {
	const trimmed = (markerBlock || '').trim();
	if (
		trimmed.startsWith(STACK_CARD_MARKER_START) &&
		trimmed.endsWith(STACK_CARD_MARKER_END)
	) {
		return trimmed;
	}
	return `${STACK_CARD_MARKER_START}\n${trimmed}\n${STACK_CARD_MARKER_END}`;
}

// Mirrors src/lib/server/github/readme-badge.ts:395-448
// Main injection / update routine.
export function injectOrUpdateReadmeBadge(content, markerBlock, options = {}) {
	const hasBom = content !== null && content.startsWith('\uFEFF');
	const rawWithoutBom = content !== null ? (hasBom ? content.slice(1) : content) : null;
	const crlfCount = rawWithoutBom ? (rawWithoutBom.match(/\r\n/g) || []).length : 0;
	const lfCount = rawWithoutBom
		? (rawWithoutBom.replace(/\r\n/g, '').match(/\n/g) || []).length
		: 0;
	const eol = crlfCount > lfCount ? '\r\n' : '\n';
	const placement = options.placement ?? 'after-title';
	const cleanMarker = normalizeMarkerBlock(markerBlock).replace(/\r\n/g, '\n');

	if (rawWithoutBom === null) {
		return createStarterReadme(options, cleanMarker, eol, hasBom);
	}

	const normalized = rawWithoutBom.replace(/\r\n/g, '\n');
	const masked = maskFencedCodeBlocks(normalized);
	const startIndex = masked.indexOf(STACK_CARD_MARKER_START);

	if (startIndex !== -1) {
		return updateExistingMarkers(
			normalized,
			masked,
			cleanMarker,
			startIndex,
			eol,
			hasBom,
			content
		);
	}

	let frontmatter = '';
	let body = normalized;
	let maskedBody = masked;
	const frontmatterMatch = normalized.match(/^(---\n[\s\S]*?\n---\n?)/);
	if (frontmatterMatch) {
		frontmatter = frontmatterMatch[1];
		body = normalized.slice(frontmatter.length);
		maskedBody = masked.slice(frontmatter.length);
	}

	const { insertedBody, status } = insertFreshMarker(body, maskedBody, cleanMarker, placement);
	const fullResult = `${frontmatter}${insertedBody}`;

	if (fullResult === normalized) {
		return {
			content,
			changed: false,
			status: 'already_up_to_date',
			eol,
			hasBom
		};
	}

	const formatted = eol === '\r\n' ? fullResult.replace(/\n/g, '\r\n') : fullResult;
	return {
		content: hasBom ? `\uFEFF${formatted}` : formatted,
		changed: true,
		status,
		eol,
		hasBom
	};
}

/**
 * Applies a Stackportfolio badge block to the specified README file.
 * Returns { action: 'inserted' | 'updated' | 'unchanged', path: string }.
 */
export function applyReadmeBlock(readmePath, blockContent, options = {}) {
	const resolvedPath = resolve(readmePath);
	const exists = existsSync(resolvedPath);

	if (!exists) {
		if (!options.create) {
			throw new Error(`File not found: '${readmePath}'. Use --create to create a new README.`);
		}
		const defaultRepoName = basename(resolve(resolvedPath, '..')) || 'Project';
		const result = injectOrUpdateReadmeBadge(null, blockContent, {
			repositoryName: options.repositoryName || defaultRepoName,
			...options
		});
		writeFileSync(resolvedPath, result.content, 'utf8');
		return {
			action: 'inserted',
			path: resolvedPath
		};
	}

	const currentContent = readFileSync(resolvedPath, 'utf8');
	const result = injectOrUpdateReadmeBadge(currentContent, blockContent, options);

	if (!result.changed) {
		return {
			action: 'unchanged',
			path: resolvedPath
		};
	}

	writeFileSync(resolvedPath, result.content, 'utf8');
	const action = result.status === 'updated_existing_marker' ? 'updated' : 'inserted';

	return {
		action,
		path: resolvedPath
	};
}

// CLI execution helper
export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(metaUrl) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

export function parseCliArgs(argv) {
	let readmePath = null;
	let blockFile = null;
	let blockText = null;
	let create = false;
	let placement = 'after-title';
	let help = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			help = true;
		} else if (arg === '--create' || arg === '-c') {
			create = true;
		} else if (arg === '--block-file' || arg === '-b') {
			blockFile = argv[++i];
		} else if (arg.startsWith('--block-file=')) {
			blockFile = arg.slice(13);
		} else if (arg === '--block') {
			blockText = argv[++i];
		} else if (arg.startsWith('--block=')) {
			blockText = arg.slice(8);
		} else if (arg === '--placement') {
			placement = argv[++i];
		} else if (arg.startsWith('--placement=')) {
			placement = arg.slice(12);
		} else if (!arg.startsWith('-') && !readmePath) {
			readmePath = arg;
		}
	}

	return { readmePath, blockFile, blockText, create, placement, help };
}

export function runCli(argv = process.argv.slice(2)) {
	const parsed = parseCliArgs(argv);

	if (parsed.help) {
		console.log(
			'Usage: node readme-block.mjs <readme-path> [--block-file <file> | --block <text>] [--create] [--placement after-title|top|bottom]'
		);
		return 0;
	}

	const targetPath = parsed.readmePath || 'README.md';

	let blockContent = parsed.blockText;
	if (blockContent === null || blockContent === undefined) {
		if (parsed.blockFile && parsed.blockFile !== '-') {
			const resolvedBlockFile = resolve(parsed.blockFile);
			if (!existsSync(resolvedBlockFile)) {
				console.error(
					JSON.stringify(
						{
							ok: false,
							error: `Block file not found: '${parsed.blockFile}'`
						},
						null,
						2
					)
				);
				return 1;
			}
			blockContent = readFileSync(resolvedBlockFile, 'utf8');
		} else {
			// Read from stdin
			try {
				blockContent = readFileSync(0, 'utf8');
			} catch (err) {
				console.error(
					JSON.stringify(
						{
							ok: false,
							error: `Failed to read block from stdin: ${err.message}`
						},
						null,
						2
					)
				);
				return 1;
			}
		}
	}

	if (!blockContent || !blockContent.trim()) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					error: 'Empty block content provided'
				},
				null,
				2
			)
		);
		return 1;
	}

	try {
		const result = applyReadmeBlock(targetPath, blockContent, {
			create: parsed.create,
			placement: parsed.placement
		});

		process.stdout.write(JSON.stringify(result, null, 2) + '\n');
		return 0;
	} catch (err) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					error: err.message
				},
				null,
				2
			)
		);
		return 1;
	}
}

if (isMainModule(import.meta.url)) {
	const exitCode = runCli();
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}
