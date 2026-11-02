import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	existsSync,
	statSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
	injectOrUpdateReadmeBadge,
	applyReadmeBlock,
	scanFenceLines,
	maskFencedCodeBlocks,
	normalizeMarkerBlock,
	STACK_CARD_MARKER_START,
	STACK_CARD_MARKER_END
} from '../plugins/stackportfolio/scripts/readme-block.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(
	__dirname,
	'../plugins/stackportfolio/scripts/readme-block.mjs'
);

const SAMPLE_MARKER = `${STACK_CARD_MARKER_START}\n[![Stack](https://stackportfol.io/card/p/123/stack.svg)](https://stackportfol.io/projects/123)\n${STACK_CARD_MARKER_END}`;
const UPDATED_MARKER = `${STACK_CARD_MARKER_START}\n[![Updated Stack](https://stackportfol.io/card/p/123/stack.svg?v=2)](https://stackportfol.io/projects/123)\n${STACK_CARD_MARKER_END}`;

describe('readme-block', () => {
	let tempDir;

	before(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'readme-block-test-'));
	});

	after(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe('insert', () => {
		it('inserts after an ATX H1 title by default', () => {
			const original = `# My Project\n\nSome introductory text.`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(
				result.content,
				`# My Project\n\n${SAMPLE_MARKER}\n\nSome introductory text.`
			);
		});

		it('inserts after a Setext H1 heading', () => {
			const original = `My Project\n==========\n\nIntroduction paragraph.`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(
				result.content,
				`My Project\n==========\n\n${SAMPLE_MARKER}\n\nIntroduction paragraph.`
			);
		});

		it('inserts after an HTML <h1> heading', () => {
			const original = `<h1>My Project</h1>\n\nIntroduction paragraph.`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(
				result.content,
				`<h1>My Project</h1>\n\n${SAMPLE_MARKER}\n\nIntroduction paragraph.`
			);
		});

		it('preserves YAML frontmatter and inserts after H1 in body', () => {
			const original = `---\ntitle: Documentation\nlayout: page\n---\n# Guide\n\nBody content.`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			assert.ok(result.content.startsWith('---\ntitle: Documentation\nlayout: page\n---\n'));
			assert.ok(result.content.includes(`# Guide\n\n${SAMPLE_MARKER}\n\nBody content.`));
		});

		it('inserts below contiguous shields.io badges under H1', () => {
			const original = [
				'# Cool App',
				'',
				'[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://ci.example.com)',
				'[![License](https://img.shields.io/badge/license-MIT-blue)](https://license.example.com)',
				'',
				'Cool App does amazing things.'
			].join('\n');

			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			const expected = [
				'# Cool App',
				'',
				'[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://ci.example.com)',
				'[![License](https://img.shields.io/badge/license-MIT-blue)](https://license.example.com)',
				'',
				SAMPLE_MARKER,
				'',
				'Cool App does amazing things.'
			].join('\n');

			assert.strictEqual(result.content, expected);
		});

		it('inserts at top when no H1 heading exists', () => {
			const original = `Paragraph without headings.\nMore text.`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER, { placement: 'after-title' });

			assert.strictEqual(result.status, 'inserted_top');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(
				result.content,
				`${SAMPLE_MARKER}\n\nParagraph without headings.\nMore text.`
			);
		});

		it('supports top placement explicitly', () => {
			const original = `---\nlayout: home\n---\n# Title\n\nContent`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER, { placement: 'top' });

			assert.strictEqual(result.status, 'inserted_top');
			assert.ok(result.content.startsWith(`---\nlayout: home\n---\n${SAMPLE_MARKER}\n\n# Title`));
		});

		it('supports bottom placement explicitly', () => {
			const original = `# Title\n\nContent`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER, { placement: 'bottom' });

			assert.strictEqual(result.status, 'inserted_bottom');
			assert.strictEqual(result.content, `# Title\n\nContent\n\n${SAMPLE_MARKER}\n`);
		});

		it('creates a starter README with --create / create: true when file is missing', () => {
			const missingPath = join(tempDir, 'starter-readme.md');
			const result = applyReadmeBlock(missingPath, SAMPLE_MARKER, {
				create: true,
				repositoryName: 'Starter Project'
			});

			assert.strictEqual(result.action, 'inserted');
			assert.strictEqual(result.path, resolve(missingPath));
			const createdContent = readFileSync(missingPath, 'utf8');
			assert.strictEqual(createdContent, `# Starter Project\n\n${SAMPLE_MARKER}\n`);
		});

		it('throws when file is missing and create: false', () => {
			const nonExistent = join(tempDir, 'does-not-exist.md');
			assert.throws(
				() => {
					applyReadmeBlock(nonExistent, SAMPLE_MARKER, { create: false });
				},
				/File not found/
			);
		});

		it('normalizes unwrapped block content automatically', () => {
			const unwrapped = '[![Stack](https://stackportfol.io/card.svg)](https://stackportfol.io)';
			const normalized = normalizeMarkerBlock(unwrapped);
			assert.strictEqual(
				normalized,
				`${STACK_CARD_MARKER_START}\n${unwrapped}\n${STACK_CARD_MARKER_END}`
			);
		});
	});

	describe('update', () => {
		it('updates an existing marker block in place', () => {
			const original = `# Project\n\n${STACK_CARD_MARKER_START}\nold card\n${STACK_CARD_MARKER_END}\n\nFooter content`;
			const result = injectOrUpdateReadmeBadge(original, UPDATED_MARKER);

			assert.strictEqual(result.status, 'updated_existing_marker');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(result.content, `# Project\n\n${UPDATED_MARKER}\n\nFooter content`);
		});

		it('safely repairs an unclosed marker tag without swallowing remainder of file', () => {
			const original = [
				'# Project',
				STACK_CARD_MARKER_START,
				'[![Old](https://stackportfol.io/card/p/old/stack.svg)](https://stackportfol.io/projects/old)',
				'',
				'## Real Content',
				'This section must not be deleted by the parser.',
				'It holds important installation steps.'
			].join('\n');

			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'updated_existing_marker');
			assert.strictEqual(result.repairedUnclosedMarker, true);
			assert.ok(result.content.includes('## Real Content'));
			assert.ok(result.content.includes('This section must not be deleted by the parser.'));
			assert.ok(result.content.includes(SAMPLE_MARKER));
		});
	});

	describe('no-op (byte-identical, mtime unchanged)', () => {
		it('returns unchanged and leaves file untouched including mtime when identical', async () => {
			const filePath = join(tempDir, 'noop-readme.md');
			const content = `# Noop Test\n\n${SAMPLE_MARKER}\n\nBody text.\n`;
			writeFileSync(filePath, content, 'utf8');

			const beforeStat = statSync(filePath);
			// Wait 50ms so that if the file were rewritten, mtime would differ
			await new Promise((resolve) => setTimeout(resolve, 50));

			const result = applyReadmeBlock(filePath, SAMPLE_MARKER);

			assert.strictEqual(result.action, 'unchanged');
			assert.strictEqual(result.path, resolve(filePath));

			const afterStat = statSync(filePath);
			const afterContent = readFileSync(filePath, 'utf8');

			// Byte-for-byte identical
			assert.strictEqual(afterContent, content);
			// mtime completely unchanged
			assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs);
			assert.strictEqual(afterStat.ctimeMs, beforeStat.ctimeMs);
		});

		it('returns already_up_to_date on identical raw content', () => {
			const original = `# Project\n\n${SAMPLE_MARKER}\n\nFooter`;
			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'already_up_to_date');
			assert.strictEqual(result.changed, false);
			assert.strictEqual(result.content, original);
		});
	});

	describe('CRLF', () => {
		it('preserves CRLF line endings on insert and update', () => {
			const crlfOriginal = '# Title\r\n\r\nParagraph text.\r\n';
			const result = injectOrUpdateReadmeBadge(crlfOriginal, SAMPLE_MARKER);

			assert.strictEqual(result.eol, '\r\n');
			assert.strictEqual(result.changed, true);
			assert.ok(result.content.includes('\r\n'));
			assert.ok(result.content.includes('\r\n\r\n'));
			assert.ok(!result.content.match(/[^\r]\n/));
		});

		it('returns original bytes exactly on up-to-date CRLF README', () => {
			const crlfMarker = SAMPLE_MARKER.replace(/\n/g, '\r\n');
			const original = `\uFEFF# Project Title\r\n\r\n${crlfMarker}\r\n\r\nSection body.\r\n`;

			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.changed, false);
			assert.strictEqual(result.status, 'already_up_to_date');
			assert.strictEqual(result.hasBom, true);
			assert.strictEqual(result.eol, '\r\n');
			assert.strictEqual(result.content, original);
			assert.ok(result.content.startsWith('\uFEFF'));
		});

		it('preserves UTF-8 BOM on insert and update', () => {
			const bomOriginal = `\uFEFF# Title\n\nParagraph text.\n`;
			const result = injectOrUpdateReadmeBadge(bomOriginal, SAMPLE_MARKER);

			assert.strictEqual(result.hasBom, true);
			assert.ok(result.content.startsWith('\uFEFF'));
		});
	});

	describe('markers in a fenced code block ignored', () => {
		it('ignores markers inside fenced code blocks and inserts outside fence', () => {
			const original = [
				'```markdown',
				STACK_CARD_MARKER_START,
				'example badge snippet inside documentation',
				STACK_CARD_MARKER_END,
				'```',
				'',
				'# Real Project Title',
				'',
				'Description paragraph.',
				'',
				STACK_CARD_MARKER_START,
				'old real card',
				STACK_CARD_MARKER_END
			].join('\n');

			const result = injectOrUpdateReadmeBadge(original, UPDATED_MARKER);

			assert.strictEqual(result.status, 'updated_existing_marker');
			assert.strictEqual(result.changed, true);
			assert.strictEqual(result.duplicateMarkersRemoved, 0);

			// Marker inside code fence remains completely untouched
			assert.ok(
				result.content.includes(
					`\`\`\`markdown\n${STACK_CARD_MARKER_START}\nexample badge snippet inside documentation\n${STACK_CARD_MARKER_END}\n\`\`\``
				)
			);
			// Real marker outside fence is updated
			assert.ok(result.content.includes(UPDATED_MARKER));
			assert.ok(!result.content.includes('old real card'));
		});

		it('does not treat script comments inside code blocks as H1 headings', () => {
			const original = [
				'~~~bash',
				'# setup environment and start',
				'npm install',
				'~~~',
				'',
				'# Actual Title',
				'',
				'Body content.'
			].join('\n');

			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'inserted_after_title');
			assert.ok(
				result.content.includes('~~~bash\n# setup environment and start\nnpm install\n~~~')
			);
			assert.ok(
				result.content.includes(`# Actual Title\n\n${SAMPLE_MARKER}\n\nBody content.`)
			);
		});

		it('handles length-matched and indented code fences', () => {
			const lines = ['  ````markdown', '  ```', '  still inside fence', '  ````', 'outside fence'];
			const mask = scanFenceLines(lines);

			assert.strictEqual(mask[0], true);
			assert.strictEqual(mask[1], true);
			assert.strictEqual(mask[2], true);
			assert.strictEqual(mask[3], true);
			assert.strictEqual(mask[4], false);

			const masked = maskFencedCodeBlocks(lines.join('\n'));
			assert.ok(masked.endsWith('outside fence'));
			assert.ok(masked.startsWith('              '));
		});
	});

	describe('duplicate blocks', () => {
		it('collapses duplicate marker blocks into the first one', () => {
			const original = [
				'# Project',
				STACK_CARD_MARKER_START,
				'first block',
				STACK_CARD_MARKER_END,
				'Middle content',
				STACK_CARD_MARKER_START,
				'second duplicate',
				STACK_CARD_MARKER_END,
				'Ending'
			].join('\n');

			const result = injectOrUpdateReadmeBadge(original, SAMPLE_MARKER);

			assert.strictEqual(result.status, 'updated_existing_marker');
			assert.strictEqual(result.duplicateMarkersRemoved, 1);
			assert.ok(result.content.includes(SAMPLE_MARKER));
			assert.ok(!result.content.includes('second duplicate'));
			assert.ok(result.content.includes('Middle content'));
			assert.ok(result.content.includes('Ending'));
		});
	});

	describe('CLI execution', () => {
		it('runs as CLI with --block and outputs JSON summary', () => {
			const filePath = join(tempDir, 'cli-readme.md');
			writeFileSync(filePath, '# CLI App\n\nDescription text.\n', 'utf8');

			const stdout = execFileSync(
				'node',
				[SCRIPT_PATH, filePath, '--block', SAMPLE_MARKER],
				{ encoding: 'utf8' }
			);

			const parsed = JSON.parse(stdout.trim());
			assert.strictEqual(parsed.action, 'inserted');
			assert.strictEqual(parsed.path, resolve(filePath));

			const updated = readFileSync(filePath, 'utf8');
			assert.ok(updated.includes(SAMPLE_MARKER));
		});

		it('runs as CLI with --block-file', () => {
			const filePath = join(tempDir, 'cli-file-readme.md');
			const blockFilePath = join(tempDir, 'block.md');
			writeFileSync(filePath, '# Block File App\n\nDescription.\n', 'utf8');
			writeFileSync(blockFilePath, SAMPLE_MARKER, 'utf8');

			const stdout = execFileSync(
				'node',
				[SCRIPT_PATH, filePath, '--block-file', blockFilePath],
				{ encoding: 'utf8' }
			);

			const parsed = JSON.parse(stdout.trim());
			assert.strictEqual(parsed.action, 'inserted');
			assert.strictEqual(parsed.path, resolve(filePath));
		});

		it('runs as CLI reading block from stdin pipe', () => {
			const filePath = join(tempDir, 'cli-stdin-readme.md');
			writeFileSync(filePath, '# Stdin App\n\nIntro.\n', 'utf8');

			const stdout = execFileSync(
				'node',
				[SCRIPT_PATH, filePath],
				{ input: SAMPLE_MARKER, encoding: 'utf8' }
			);

			const parsed = JSON.parse(stdout.trim());
			assert.strictEqual(parsed.action, 'inserted');

			// Re-running identical block from stdin reports unchanged and exits 0
			const noopStdout = execFileSync(
				'node',
				[SCRIPT_PATH, filePath],
				{ input: SAMPLE_MARKER, encoding: 'utf8' }
			);
			const noopParsed = JSON.parse(noopStdout.trim());
			assert.strictEqual(noopParsed.action, 'unchanged');
		});

		it('exits with code 1 and error JSON when target file does not exist without --create', () => {
			const nonExistent = join(tempDir, 'missing-target.md');
			let thrown = null;

			try {
				execFileSync(
					'node',
					[SCRIPT_PATH, nonExistent, '--block', SAMPLE_MARKER],
					{ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
				);
			} catch (err) {
				thrown = err;
			}

			assert.ok(thrown);
			assert.strictEqual(thrown.status, 1);
			const errorJson = JSON.parse(thrown.stderr.toString().trim());
			assert.strictEqual(errorJson.ok, false);
			assert.ok(errorJson.error.includes('File not found'));
		});

		it('creates file when --create flag is passed to CLI', () => {
			const createdPath = join(tempDir, 'cli-created.md');
			const stdout = execFileSync(
				'node',
				[SCRIPT_PATH, createdPath, '--create', '--block', SAMPLE_MARKER],
				{ encoding: 'utf8' }
			);

			const parsed = JSON.parse(stdout.trim());
			assert.strictEqual(parsed.action, 'inserted');
			assert.ok(existsSync(createdPath));
		});
	});
});
