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
import { detectStack } from '../plugins/stackportfolio/scripts/detect-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const PLUGIN_ROOT = resolve(__dirname, '../plugins/stackportfolio');
const SCRIPT_PATH = resolve(PLUGIN_ROOT, 'scripts/detect-stack.mjs');

describe('detect-stack', () => {
	it('matches all golden-stack fixtures', () => {
		const fixtureDirs = readdirSync(FIXTURES_DIR).filter((f) =>
			statSync(join(FIXTURES_DIR, f)).isDirectory()
		);

		assert.ok(fixtureDirs.length >= 8, 'Expected at least 8 ecosystem fixtures');

		for (const fixture of fixtureDirs) {
			const fixturePath = join(FIXTURES_DIR, fixture);
			const goldenPath = join(fixturePath, 'golden-stack.json');

			const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
			const actual = detectStack(fixturePath);

			assert.deepStrictEqual(
				actual,
				expected,
				`detectStack fixture '${fixture}' did not match golden-stack.json`
			);
		}
	});

	it('drops dev noise by default but includes when includeDev is true', () => {
		const fixturePath = join(FIXTURES_DIR, 'node-sveltekit');

		const defaultStack = detectStack(fixturePath);
		assert.strictEqual(
			defaultStack.some((d) => d.name === 'ESLint' || d.name === 'Prettier'),
			false,
			'ESLint and Prettier should be dropped by default as dev noise'
		);

		const allStack = detectStack(fixturePath, { includeDev: true });
		assert.strictEqual(
			allStack.some((d) => d.name === 'ESLint'),
			true,
			'ESLint should be included when includeDev is true'
		);
		assert.strictEqual(
			allStack.some((d) => d.name === 'Prettier'),
			true,
			'Prettier should be included when includeDev is true'
		);
		assert.strictEqual(
			allStack.some((d) => d.name.includes('plugin')),
			false,
			'Plugins should always be dropped as noise'
		);
	});

	it('detects Vite and Webpack in dependencies and devDependencies as build frameworks', () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'vite-webpack-test-'));
		try {
			writeFileSync(
				join(tempRepo, 'package.json'),
				JSON.stringify({
					name: 'test-vite-app',
					version: '1.0.0',
					devDependencies: {
						vite: '^5.0.0',
						webpack: '^5.89.0'
					}
				})
			);

			const stack = detectStack(tempRepo);
			const names = stack.map((s) => s.name);
			assert.ok(names.includes('Vite'), 'Expected Vite in detected stack');
			assert.ok(names.includes('Webpack'), 'Expected Webpack in detected stack');
			assert.ok(names.includes('Node.js'), 'Expected Node.js in detected stack');

			const viteEntry = stack.find((s) => s.name === 'Vite');
			assert.strictEqual(viteEntry.kind, 'framework');
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('runs cleanly as CLI script with JSON output', () => {
		const fixturePath = join(FIXTURES_DIR, 'go-gin');
		const stdout = execFileSync('node', [SCRIPT_PATH, fixturePath], {
			encoding: 'utf8'
		});

		const parsed = JSON.parse(stdout);
		assert.ok(Array.isArray(parsed));
		assert.strictEqual(parsed.length, 3);
		assert.deepStrictEqual(parsed.map((p) => p.name), ['Gin', 'Go', 'PostgreSQL']);
	});

	it('runs CLI script with --all-deps flag', () => {
		const fixturePath = join(FIXTURES_DIR, 'node-sveltekit');
		const stdout = execFileSync('node', [SCRIPT_PATH, fixturePath, '--all-deps'], {
			encoding: 'utf8'
		});

		const parsed = JSON.parse(stdout);
		assert.ok(parsed.some((p) => p.name === 'ESLint'));
	});

	it('spawns through each documented invocation path and asserts valid JSON', () => {
		const fixturePath = join(FIXTURES_DIR, 'node-sveltekit');

		// Path 1: Absolute path simulating ${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs
		const pluginRootScript = join(PLUGIN_ROOT, 'scripts/detect-stack.mjs');
		const out1 = execFileSync('node', [pluginRootScript, fixturePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed1 = JSON.parse(out1);
		assert.ok(Array.isArray(parsed1) && parsed1.length > 0, 'Expected non-empty array from plugin root path');

		// Path 2: Relative path invocation
		const relScript = relative(REPO_ROOT, pluginRootScript);
		const out2 = execFileSync('node', [relScript, fixturePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed2 = JSON.parse(out2);
		assert.deepStrictEqual(parsed1, parsed2, 'Relative invocation should match absolute invocation');
	});

	it('spawns through a symlinked directory and asserts non-empty valid JSON', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'detect-sym-'));
		try {
			const symlinkedPluginRoot = join(tempDir, 'plugin-symlink');
			symlinkSync(PLUGIN_ROOT, symlinkedPluginRoot, 'dir');

			const symlinkedScript = join(symlinkedPluginRoot, 'scripts/detect-stack.mjs');
			const fixturePath = join(FIXTURES_DIR, 'go-gin');

			const stdout = execFileSync('node', [symlinkedScript, fixturePath], {
				encoding: 'utf8',
				cwd: tempDir
			});

			assert.ok(stdout.trim().length > 0, 'Stdout should not be empty when run through symlink');
			const parsed = JSON.parse(stdout);
			assert.ok(Array.isArray(parsed) && parsed.length === 3);
			assert.deepStrictEqual(parsed.map((p) => p.name), ['Gin', 'Go', 'PostgreSQL']);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('deduplicates multiple evidences for the same technology prioritizing manifests', () => {
		const fixturePath = join(FIXTURES_DIR, 'docker-infra');
		const stack = detectStack(fixturePath);

		const nodeEntries = stack.filter((s) => s.name === 'Node.js');
		assert.strictEqual(nodeEntries.length, 1);
		// Dockerfile has higher priority than GitHub Actions CI
		assert.strictEqual(nodeEntries[0].evidence, 'Dockerfile:1');
	});
});
