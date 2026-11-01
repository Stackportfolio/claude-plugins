import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
	readFileSync,
	readdirSync,
	statSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	mkdtempSync,
	symlinkSync
} from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
	getRepoFacts,
	normaliseOriginUrl,
	cleanMarkdownText
} from '../plugins/stackportfolio/scripts/repo-facts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const PLUGIN_ROOT = resolve(__dirname, '../plugins/stackportfolio');
const SCRIPT_PATH = resolve(PLUGIN_ROOT, 'scripts/repo-facts.mjs');

describe('repo-facts', () => {
	it('matches all golden-facts fixtures', () => {
		const fixtureDirs = readdirSync(FIXTURES_DIR).filter((f) =>
			statSync(join(FIXTURES_DIR, f)).isDirectory()
		);

		assert.ok(fixtureDirs.length >= 8, 'Expected at least 8 ecosystem fixtures');

		for (const fixture of fixtureDirs) {
			const fixturePath = join(FIXTURES_DIR, fixture);
			const goldenPath = join(fixturePath, 'golden-facts.json');

			const expected = JSON.parse(readFileSync(goldenPath, 'utf8'));
			const actual = getRepoFacts(fixturePath);

			assert.deepStrictEqual(
				actual,
				expected,
				`getRepoFacts fixture '${fixture}' did not match golden-facts.json`
			);
		}
	});

	it('normalises diverse git origin URL formats', () => {
		assert.strictEqual(
			normaliseOriginUrl('git@github.com:Stackportfolio/claude-plugins.git'),
			'https://github.com/Stackportfolio/claude-plugins'
		);
		assert.strictEqual(
			normaliseOriginUrl('ssh://git@github.com/Stackportfolio/claude-plugins.git'),
			'https://github.com/Stackportfolio/claude-plugins'
		);
		assert.strictEqual(
			normaliseOriginUrl('https://github.com/Stackportfolio/claude-plugins.git'),
			'https://github.com/Stackportfolio/claude-plugins'
		);
		assert.strictEqual(
			normaliseOriginUrl('https://github.com/Stackportfolio/claude-plugins/'),
			'https://github.com/Stackportfolio/claude-plugins'
		);
		assert.strictEqual(
			normaliseOriginUrl('git://github.com/Stackportfolio/claude-plugins.git'),
			'https://github.com/Stackportfolio/claude-plugins'
		);
		assert.strictEqual(
			normaliseOriginUrl('git@gitlab.com:org/subgroup/repo.git'),
			'https://gitlab.com/org/subgroup/repo'
		);
	});

	it('extracts origin from git config directory without child processes', () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-origin-test-'));
		try {
			mkdirSync(join(tempRepo, '.git'));
			writeFileSync(
				join(tempRepo, '.git/config'),
				'[remote "origin"]\n\turl = git@github.com:Stackportfolio/temp-repo.git\n'
			);
			writeFileSync(
				join(tempRepo, 'README.md'),
				'# Temp Repo\n\nA temporary repository for git origin verification.\n'
			);

			const facts = getRepoFacts(tempRepo);
			assert.strictEqual(facts.name, 'temp-repo');
			assert.strictEqual(facts.origin, 'https://github.com/Stackportfolio/temp-repo');
			assert.strictEqual(facts.originUrl, 'https://github.com/Stackportfolio/temp-repo');
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('extracts git origin from current repository worktree using pure fs', () => {
		const facts = getRepoFacts(REPO_ROOT);
		assert.strictEqual(facts.origin, 'https://github.com/Stackportfolio/claude-plugins');
		assert.strictEqual(facts.originUrl, 'https://github.com/Stackportfolio/claude-plugins');
	});

	it('has zero node:child_process imports in repo-facts.mjs', () => {
		const code = readFileSync(SCRIPT_PATH, 'utf8');
		assert.strictEqual(
			/child_process/.test(code),
			false,
			'repo-facts.mjs must not import or use child_process'
		);
	});

	it('extracts first paragraph from README, skipping titles, badges, and html comments', () => {
		const facts = getRepoFacts(join(FIXTURES_DIR, 'node-sveltekit'));
		assert.strictEqual(
			facts.description,
			'A showcase SvelteKit project with PostgreSQL and Tailwind CSS.'
		);
	});

	it('strips all HTML tags and headings from centred-HTML README descriptions', () => {
		// Test single-block centered-HTML format (as found in clauditor)
		const clauditorStyleReadme = [
			'<p align="center">',
			'  <h1 align="center">clauditor</h1>',
			'  <p align="center">',
			'    <strong>Bank a handoff while the cache is warm. Never interrupt the user.</strong>',
			'  </p>',
			'  <p align="center">',
			'    <a href="https://example.com/license"><img src="https://example.com/license.svg" alt="License"></a>',
			'  </p>',
			'</p>'
		].join('\n');

		const cleaned = cleanMarkdownText(clauditorStyleReadme);
		assert.strictEqual(
			cleaned,
			'Bank a handoff while the cache is warm. Never interrupt the user.'
		);
	});

	it('identifies deployed URL hints from CNAME and package.json homepage and vercel config', () => {
		const sveltekitFacts = getRepoFacts(join(FIXTURES_DIR, 'node-sveltekit'));
		assert.strictEqual(
			sveltekitFacts.deployedUrl,
			'https://sveltekit.fixture.example.com'
		);

		const nextFacts = getRepoFacts(join(FIXTURES_DIR, 'fullstack-next'));
		assert.strictEqual(
			nextFacts.deployedUrl,
			'https://next-fullstack.vercel.app'
		);
		assert.strictEqual(nextFacts.deployedUrlHints.length, 2);
	});

	it('runs cleanly as CLI script with JSON output', () => {
		const fixturePath = join(FIXTURES_DIR, 'python-fastapi');
		const stdout = execFileSync('node', [SCRIPT_PATH, fixturePath], {
			encoding: 'utf8'
		});

		const parsed = JSON.parse(stdout);
		assert.strictEqual(parsed.name, 'python-fastapi-service');
		assert.strictEqual(parsed.origin, null);
		assert.strictEqual(
			parsed.description,
			'Modern async REST API for processing background jobs.'
		);
	});

	it('spawns through each documented invocation path and asserts valid JSON', () => {
		const fixturePath = join(FIXTURES_DIR, 'python-fastapi');

		// Path 1: Absolute path simulating ${CLAUDE_PLUGIN_ROOT}/scripts/repo-facts.mjs
		const pluginRootScript = join(PLUGIN_ROOT, 'scripts/repo-facts.mjs');
		const out1 = execFileSync('node', [pluginRootScript, fixturePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed1 = JSON.parse(out1);
		assert.strictEqual(parsed1.name, 'python-fastapi-service');

		// Path 2: Relative path invocation
		const relScript = relative(REPO_ROOT, pluginRootScript);
		const out2 = execFileSync('node', [relScript, fixturePath], {
			encoding: 'utf8',
			cwd: REPO_ROOT
		});
		const parsed2 = JSON.parse(out2);
		assert.deepStrictEqual(parsed1, parsed2);
	});

	it('spawns through a symlinked directory and asserts non-empty valid JSON', () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'facts-sym-'));
		try {
			const symlinkedPluginRoot = join(tempDir, 'plugin-symlink');
			symlinkSync(PLUGIN_ROOT, symlinkedPluginRoot, 'dir');

			const symlinkedScript = join(symlinkedPluginRoot, 'scripts/repo-facts.mjs');
			const fixturePath = join(FIXTURES_DIR, 'python-fastapi');

			const stdout = execFileSync('node', [symlinkedScript, fixturePath], {
				encoding: 'utf8',
				cwd: tempDir
			});

			assert.ok(stdout.trim().length > 0, 'Stdout should not be empty when run through symlink');
			const parsed = JSON.parse(stdout);
			assert.strictEqual(parsed.name, 'python-fastapi-service');
			assert.strictEqual(parsed.description, 'Modern async REST API for processing background jobs.');
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
