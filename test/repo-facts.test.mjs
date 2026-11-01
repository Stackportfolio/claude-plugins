import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
	getRepoFacts,
	normaliseOriginUrl
} from '../plugins/stackportfolio/skills/add-project/scripts/repo-facts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(__dirname, 'fixtures');
const SCRIPT_PATH = resolve(
	__dirname,
	'../plugins/stackportfolio/skills/add-project/scripts/repo-facts.mjs'
);

describe('repo-facts', () => {
	it('matches all golden-facts fixtures', () => {
		const fixtureDirs = readdirSync(FIXTURES_DIR).filter((f) =>
			statSync(join(FIXTURES_DIR, f)).isDirectory()
		);

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

	it('extracts origin from git config directory', () => {
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

	it('extracts git origin from current repository worktree', () => {
		const facts = getRepoFacts(REPO_ROOT);
		assert.strictEqual(facts.origin, 'https://github.com/Stackportfolio/claude-plugins');
		assert.strictEqual(facts.originUrl, 'https://github.com/Stackportfolio/claude-plugins');
	});

	it('extracts first paragraph from README, skipping titles, badges, and html comments', () => {
		const facts = getRepoFacts(join(FIXTURES_DIR, 'node-sveltekit'));
		assert.strictEqual(
			facts.description,
			'A showcase SvelteKit project with PostgreSQL and Tailwind CSS.'
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
});
