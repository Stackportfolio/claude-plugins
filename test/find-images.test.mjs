import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	findImages,
	sniffImageType,
	validateImageFile,
	MAX_IMAGE_BYTES
} from '../plugins/stackportfolio/scripts/find-images.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_WITH_IMAGES = join(__dirname, 'image-fixtures');
const SCRIPT_PATH = resolve(__dirname, '../plugins/stackportfolio/scripts/find-images.mjs');

describe('find-images', () => {
	it('sniffImageType accurately identifies magic bytes for all supported formats', () => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
		const webp = Buffer.from([
			0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
		]);
		const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

		assert.strictEqual(sniffImageType(png), 'image/png');
		assert.strictEqual(sniffImageType(jpeg), 'image/jpeg');
		assert.strictEqual(sniffImageType(webp), 'image/webp');
		assert.strictEqual(sniffImageType(gif), 'image/gif');

		// Refuses unsupported formats and text
		assert.strictEqual(sniffImageType(Buffer.from('<svg xmlns="..."></svg>')), undefined);
		assert.strictEqual(sniffImageType(Buffer.from('plain text file')), undefined);
		assert.strictEqual(sniffImageType(Buffer.alloc(0)), undefined);
	});

	it('detects valid PNG, JPEG, and WebP candidates in fixture repository', () => {
		const result = findImages(REPO_WITH_IMAGES);
		assert.ok(result);
		assert.strictEqual(result.repo, REPO_WITH_IMAGES);

		const validPaths = result.valid.map((c) => c.path);
		assert.ok(validPaths.includes('screenshots/screenshot.png'));
		assert.ok(validPaths.includes('docs/diagram.jpeg'));
		assert.ok(validPaths.includes('assets/preview.webp'));

		const pngCandidate = result.valid.find((c) => c.path === 'screenshots/screenshot.png');
		assert.strictEqual(pngCandidate.contentType, 'image/png');
		assert.strictEqual(pngCandidate.valid, true);
		assert.strictEqual(pngCandidate.reason, null);

		const jpegCandidate = result.valid.find((c) => c.path === 'docs/diagram.jpeg');
		assert.strictEqual(jpegCandidate.contentType, 'image/jpeg');
		assert.strictEqual(jpegCandidate.valid, true);

		const webpCandidate = result.valid.find((c) => c.path === 'assets/preview.webp');
		assert.strictEqual(webpCandidate.contentType, 'image/webp');
		assert.strictEqual(webpCandidate.valid, true);
	});

	it('refuses oversize file with clear reason exceeding 5 MiB ceiling', () => {
		const result = findImages(REPO_WITH_IMAGES);
		const oversize = result.rejected.find((c) => c.path === 'docs/oversize.png');
		assert.ok(oversize, 'oversize.png must be present in rejected candidates');
		assert.strictEqual(oversize.valid, false);
		assert.ok(oversize.size > MAX_IMAGE_BYTES);
		assert.ok(oversize.reason.includes('exceeds server maximum of 5 MiB'));
	});

	it('refuses GIF candidate per server rule citing API operation constraints', () => {
		const result = findImages(REPO_WITH_IMAGES);
		const gif = result.rejected.find((c) => c.path === 'assets/animation.gif');
		assert.ok(gif, 'animation.gif must be present in rejected candidates');
		assert.strictEqual(gif.contentType, 'image/gif');
		assert.strictEqual(gif.valid, false);
		assert.ok(gif.reason.includes('GIF format is not supported for signed upload'));
		assert.ok(gif.reason.includes('src/lib/server/api/operations/project-media.ts:191'));
	});

	it('extracts README image references including line numbers', () => {
		const result = findImages(REPO_WITH_IMAGES);
		const screenshotCandidate = result.candidates.find(
			(c) => c.path === 'screenshots/screenshot.png'
		);
		assert.ok(screenshotCandidate.sources.includes('screenshots'));
		assert.ok(screenshotCandidate.sources.some((s) => s.startsWith('README.md:')));
	});

	it('detects missing files referenced in README and marks them invalid', () => {
		const result = findImages(REPO_WITH_IMAGES);
		const missing = result.rejected.find((c) => c.path === 'docs/missing-chart.png');
		assert.ok(missing, 'docs/missing-chart.png must be recorded as rejected candidate');
		assert.strictEqual(missing.valid, false);
		assert.strictEqual(missing.size, null);
		assert.strictEqual(missing.contentType, null);
		assert.ok(missing.reason.includes('does not exist on disk'));
	});

	it('refuses zero-byte empty files', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'img-test-'));
		try {
			const emptyFile = join(tempDir, 'empty.png');
			writeFileSync(emptyFile, Buffer.alloc(0));
			const res = validateImageFile(emptyFile);
			assert.strictEqual(res.valid, false);
			assert.strictEqual(res.size, 0);
			assert.ok(res.reason.includes('empty'));
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('runs cleanly as CLI script emitting JSON stdout', () => {
		const stdout = execFileSync(process.execPath, [SCRIPT_PATH, REPO_WITH_IMAGES], {
			encoding: 'utf8'
		});
		const parsed = JSON.parse(stdout);
		assert.strictEqual(parsed.repo, REPO_WITH_IMAGES);
		assert.strictEqual(parsed.valid.length, 3);
		assert.strictEqual(parsed.rejected.length, 3);
	});
});
