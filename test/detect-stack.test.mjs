import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { detectStack } from '../plugins/stackportfolio/skills/add-project/scripts/detect-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SCRIPT_PATH = resolve(
	__dirname,
	'../plugins/stackportfolio/skills/add-project/scripts/detect-stack.mjs'
);

describe('detect-stack', () => {
	it('matches all golden-stack fixtures', () => {
		const fixtureDirs = readdirSync(FIXTURES_DIR).filter((f) =>
			statSync(join(FIXTURES_DIR, f)).isDirectory()
		);

		assert.ok(fixtureDirs.length >= 7, 'Expected at least 7 ecosystem fixtures');

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

	it('deduplicates multiple evidences for the same technology prioritizing manifests', () => {
		const fixturePath = join(FIXTURES_DIR, 'docker-infra');
		const stack = detectStack(fixturePath);

		const nodeEntries = stack.filter((s) => s.name === 'Node.js');
		assert.strictEqual(nodeEntries.length, 1);
		// Dockerfile has higher priority than GitHub Actions CI
		assert.strictEqual(nodeEntries[0].evidence, 'Dockerfile:1');
	});
});
