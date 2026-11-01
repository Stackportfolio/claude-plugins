import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
	readFileSync,
	readdirSync,
	statSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { diffStack } from '../plugins/stackportfolio/scripts/diff-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const DIFF_FIXTURES_DIR = join(__dirname, 'diff-fixtures');
const PLUGIN_ROOT = resolve(__dirname, '../plugins/stackportfolio');
const SCRIPT_PATH = resolve(PLUGIN_ROOT, 'scripts/diff-stack.mjs');

describe('diff-stack', () => {
	it('matches sveltekit-migrate fixture (local dir vs remote JSON)', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'sveltekit-migrate');
		const localDir = join(FIXTURES_DIR, 'node-sveltekit');
		const remotePath = join(fixturePath, 'remote.json');
		const goldenPath = join(fixturePath, 'golden-diff.json');

		const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
		const actual = diffStack(localDir, remotePath);

		assert.deepStrictEqual(actual, expected);
	});

	it('matches python-migration fixture with version updates and replacements', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'python-migration');
		const localPath = join(fixturePath, 'local.json');
		const remotePath = join(fixturePath, 'remote.json');
		const goldenPath = join(fixturePath, 'golden-diff.json');

		const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
		const actual = diffStack(localPath, remotePath);

		assert.deepStrictEqual(actual, expected);
	});

	it('matches in-sync-gin fixture with zero diffs', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'in-sync-gin');
		const localDir = join(FIXTURES_DIR, 'go-gin');
		const remotePath = join(fixturePath, 'remote.json');
		const goldenPath = join(fixturePath, 'golden-diff.json');

		const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
		const actual = diffStack(localDir, remotePath);

		assert.deepStrictEqual(actual, expected);
		assert.strictEqual(actual.add.length, 0);
		assert.strictEqual(actual.remove.length, 0);
		assert.strictEqual(actual.version.length, 0);
		assert.strictEqual(actual.former.length, 0);
		assert.strictEqual(actual.unchanged.length, 3);
	});

	it('ignores already-former technologies from removals', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'already-former');
		const localPath = join(fixturePath, 'local.json');
		const remotePath = join(fixturePath, 'remote.json');
		const goldenPath = join(fixturePath, 'golden-diff.json');

		const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
		const actual = diffStack(localPath, remotePath);

		assert.deepStrictEqual(actual, expected);
		assert.strictEqual(actual.remove.some((r) => r.name === 'jQuery'), false);
	});

	it('performs case-insensitive technology matching', () => {
		const local = [{ name: 'PostgreSQL', evidence: 'package.json:1' }];
		const remote = {
			data: [{ id: 'uuid-1', name: 'postgresql', version: null, former: false }]
		};

		const result = diffStack(local, remote);
		assert.strictEqual(result.add.length, 0);
		assert.strictEqual(result.remove.length, 0);
		assert.strictEqual(result.unchanged.length, 1);
		assert.strictEqual(result.unchanged[0].name, 'postgresql');
	});

	it('handles empty remote as all additions', () => {
		const local = [
			{ name: 'TypeScript', evidence: 'package.json:1', kind: 'runtime' },
			{ name: 'Svelte', evidence: 'package.json:2', kind: 'framework' }
		];
		const remote = [];

		const result = diffStack(local, remote);
		assert.strictEqual(result.add.length, 2);
		assert.strictEqual(result.remove.length, 0);
		assert.strictEqual(result.unchanged.length, 0);
		assert.deepStrictEqual(result.proposedTechnologies, ['Svelte', 'TypeScript']);
	});

	it('handles empty local as all removals and former proposals', () => {
		const local = [];
		const remote = [
			{ id: 'u-1', name: 'Webpack', version: null, former: false },
			{ id: 'u-2', name: 'Express', version: '4.18', former: false }
		];

		const result = diffStack(local, remote);
		assert.strictEqual(result.add.length, 0);
		assert.strictEqual(result.remove.length, 2);
		assert.strictEqual(result.former.length, 2);
		assert.strictEqual(result.proposedTechnologies.length, 0);
	});

	it('runs cleanly as CLI script with file arguments', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'in-sync-gin');
		const localDir = join(FIXTURES_DIR, 'go-gin');
		const remotePath = join(fixturePath, 'remote.json');

		const stdout = execFileSync('node', [SCRIPT_PATH, localDir, remotePath], {
			encoding: 'utf8'
		});

		const parsed = JSON.parse(stdout);
		assert.ok(parsed && typeof parsed === 'object');
		assert.strictEqual(parsed.add.length, 0);
		assert.strictEqual(parsed.unchanged.length, 3);
	});

	it('runs cleanly as CLI script with stdin pipe', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'sveltekit-migrate');
		const localDir = join(FIXTURES_DIR, 'node-sveltekit');
		const remoteContent = readFileSync(join(fixturePath, 'remote.json'), 'utf8');

		const stdout = execFileSync('node', [SCRIPT_PATH, localDir], {
			input: remoteContent,
			encoding: 'utf8'
		});

		const parsed = JSON.parse(stdout);
		assert.ok(parsed && typeof parsed === 'object');
		assert.strictEqual(parsed.add.length, 3);
		assert.strictEqual(parsed.remove.length, 1);
		assert.strictEqual(parsed.remove[0].name, 'Webpack');
	});

	it('runs cleanly as CLI script with --local and --remote flags', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'python-migration');
		const localPath = join(fixturePath, 'local.json');
		const remotePath = join(fixturePath, 'remote.json');

		const stdout = execFileSync(
			'node',
			[SCRIPT_PATH, '--local', localPath, '--remote', remotePath],
			{ encoding: 'utf8' }
		);

		const parsed = JSON.parse(stdout);
		assert.strictEqual(parsed.add.length, 1);
		assert.strictEqual(parsed.version.length, 2);
	});

	it('spawns through each documented invocation path and asserts valid JSON', () => {
		const fixturePath = join(DIFF_FIXTURES_DIR, 'in-sync-gin');
		const localDir = join(FIXTURES_DIR, 'go-gin');
		const remotePath = join(fixturePath, 'remote.json');

		// Path 1: Absolute path simulating ${CLAUDE_PLUGIN_ROOT}/scripts/diff-stack.mjs
		const pluginRootScript = join(PLUGIN_ROOT, 'scripts/diff-stack.mjs');
		const out1 = execFileSync('node', [pluginRootScript, localDir, remotePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed1 = JSON.parse(out1);
		assert.ok(parsed1 && parsed1.unchanged.length === 3);

		// Path 2: Relative path invocation
		const relScript = relative(REPO_ROOT, pluginRootScript);
		const out2 = execFileSync('node', [relScript, localDir, remotePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed2 = JSON.parse(out2);
		assert.deepStrictEqual(parsed1, parsed2);
	});

	it('spawns through a symlinked directory and asserts non-empty valid JSON', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'diff-sym-'));
		try {
			const symlinkedPluginRoot = join(tempDir, 'plugin-symlink');
			symlinkSync(PLUGIN_ROOT, symlinkedPluginRoot, 'dir');

			const symlinkedScript = join(symlinkedPluginRoot, 'scripts/diff-stack.mjs');
			const fixturePath = join(DIFF_FIXTURES_DIR, 'in-sync-gin');
			const localDir = join(FIXTURES_DIR, 'go-gin');
			const remotePath = join(fixturePath, 'remote.json');

			const stdout = execFileSync('node', [symlinkedScript, localDir, remotePath], {
				encoding: 'utf8',
				cwd: tempDir
			});

			const parsed = JSON.parse(stdout);
			assert.strictEqual(parsed.unchanged.length, 3);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
