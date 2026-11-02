import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
	getGitContributors,
	isBot,
	parseMailmap
} from '../plugins/stackportfolio/scripts/git-contributors.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGIN_ROOT = resolve(__dirname, '../plugins/stackportfolio');
const SCRIPT_PATH = resolve(PLUGIN_ROOT, 'scripts/git-contributors.mjs');

describe('git-contributors', () => {
	it('groups authors by identity with .mailmap, filters bots, and maps technology evidence', async () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-fixture-'));
		try {
			// Initialize git repo
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.name', 'Repo Creator'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.email', 'creator@example.com'], { cwd: tempRepo });

			// Human 1: Alice commit 1 with corp email (Node + Express + TypeScript)
			mkdirSync(join(tempRepo, 'src'), { recursive: true });
			writeFileSync(
				join(tempRepo, 'package.json'),
				JSON.stringify({
					name: 'fixture-project',
					dependencies: {
						express: '^4.18.2'
					}
				})
			);
			writeFileSync(join(tempRepo, 'src/index.ts'), 'console.log("hello world");\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'feat: initial server setup', '--author', 'Alice Developer <alice@corp.com>'],
				{
					cwd: tempRepo,
					env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-10T10:00:00Z', GIT_AUTHOR_DATE: '2026-01-10T10:00:00Z' }
				}
			);

			// Human 1: Alice commit 2 with personal home email
			writeFileSync(join(tempRepo, 'src/utils.ts'), 'export const sum = (a: number, b: number) => a + b;\n');
			execFileSync('git', ['add', 'src/utils.ts'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'feat: add utility methods', '--author', 'Alice Developer <alice@home.net>'],
				{
					cwd: tempRepo,
					env: { ...process.env, GIT_COMMITTER_DATE: '2026-02-15T12:00:00Z', GIT_AUTHOR_DATE: '2026-02-15T12:00:00Z' }
				}
			);

			// .mailmap mapping Alice's personal email to her canonical corp email
			writeFileSync(
				join(tempRepo, '.mailmap'),
				'Alice Developer <alice@corp.com> <alice@home.net>\n'
			);
			execFileSync('git', ['add', '.mailmap'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'chore: add mailmap', '--author', 'Alice Developer <alice@corp.com>'],
				{ cwd: tempRepo }
			);

			// Human 2: Bob commit (Docker + Python)
			writeFileSync(join(tempRepo, 'Dockerfile'), 'FROM python:3.11-slim\nWORKDIR /app\n');
			writeFileSync(join(tempRepo, 'main.py'), 'print("Hello from Python")\n');
			execFileSync('git', ['add', 'Dockerfile', 'main.py'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'feat: add python runner and Dockerfile', '--author', 'Bob Builder <bob@example.com>'],
				{
					cwd: tempRepo,
					env: { ...process.env, GIT_COMMITTER_DATE: '2026-03-20T14:00:00Z', GIT_AUTHOR_DATE: '2026-03-20T14:00:00Z' }
				}
			);

			// Bot 1: Dependabot commit
			writeFileSync(
				join(tempRepo, 'package.json'),
				JSON.stringify({
					name: 'fixture-project',
					dependencies: {
						express: '^4.19.0'
					}
				})
			);
			execFileSync('git', ['add', 'package.json'], { cwd: tempRepo });
			execFileSync(
				'git',
				[
					'commit',
					'-m',
					'chore(deps): bump express from 4.18.2 to 4.19.0',
					'--author',
					'dependabot[bot] <dependabot[bot]@users.noreply.github.com>'
				],
				{ cwd: tempRepo }
			);

			// Bot 2: GitHub Actions / generic [bot] commit
			mkdirSync(join(tempRepo, '.github/workflows'), { recursive: true });
			writeFileSync(
				join(tempRepo, '.github/workflows/ci.yml'),
				'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n'
			);
			execFileSync('git', ['add', '.github/workflows/ci.yml'], { cwd: tempRepo });
			execFileSync(
				'git',
				[
					'commit',
					'-m',
					'ci: automated workflow setup',
					'--author',
					'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>'
				],
				{ cwd: tempRepo }
			);

			// Run getGitContributors
			const contributors = await getGitContributors(tempRepo);

			// Assert bot filtering: dependabot and [bot] filtered, only 2 human contributors remain
			assert.strictEqual(
				contributors.length,
				2,
				`Expected exactly 2 human contributors after bot filtering, got ${contributors.length}`
			);

			// Find Alice and Bob
			const alice = contributors.find((c) => c.name === 'Alice Developer');
			const bob = contributors.find((c) => c.name === 'Bob Builder');

			assert.ok(alice, 'Expected Alice Developer in contributors');
			assert.ok(bob, 'Expected Bob Builder in contributors');

			// Assert identity grouping for Alice (corp + home emails merged via .mailmap)
			assert.strictEqual(alice.commits, 3, 'Alice should have 3 commits (including mailmap commit)');
			assert.strictEqual(alice.email, 'alice@corp.com');
			assert.ok(alice.emails.includes('alice@corp.com'));
			assert.ok(alice.emails.includes('alice@home.net'));
			assert.strictEqual(alice.emails.length, 2);

			// Assert Bob's commits
			assert.strictEqual(bob.commits, 1);
			assert.strictEqual(bob.email, 'bob@example.com');
			assert.deepStrictEqual(bob.emails, ['bob@example.com']);

			// Assert technology evidence for Alice
			const aliceTechNames = alice.technologies.map((t) => t.name);
			assert.ok(aliceTechNames.includes('Express'), 'Alice should have Express evidenced');
			assert.ok(aliceTechNames.includes('Node.js'), 'Alice should have Node.js evidenced');
			assert.ok(aliceTechNames.includes('TypeScript'), 'Alice should have TypeScript evidenced');

			const tsTech = alice.technologies.find((t) => t.name === 'TypeScript');
			assert.ok(tsTech.evidence.includes('src/index.ts'));
			assert.ok(tsTech.evidence.includes('src/utils.ts'));

			// Assert technology evidence for Bob
			const bobTechNames = bob.technologies.map((t) => t.name);
			assert.ok(bobTechNames.includes('Docker'), 'Bob should have Docker evidenced');
			assert.ok(bobTechNames.includes('Python'), 'Bob should have Python evidenced');
			assert.strictEqual(
				bobTechNames.includes('Express'),
				false,
				'Bob should not have Express since Bob never touched package.json'
			);

			const dockerTech = bob.technologies.find((t) => t.name === 'Docker');
			assert.ok(dockerTech.evidence.includes('Dockerfile'));
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('merges multiple emails for the same author when name and email local part match', async () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-localpart-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.name', 'Repo Creator'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.email', 'creator@example.com'], { cwd: tempRepo });

			writeFileSync(join(tempRepo, 'file1.txt'), 'content 1\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'commit 1', '--author', 'Carol Danvers <carol.danvers@company.com>'],
				{ cwd: tempRepo }
			);

			writeFileSync(join(tempRepo, 'file2.txt'), 'content 2\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'commit 2', '--author', 'Carol Danvers <carol.danvers@gmail.com>'],
				{ cwd: tempRepo }
			);

			const contributors = await getGitContributors(tempRepo);
			assert.strictEqual(contributors.length, 1);
			assert.strictEqual(contributors[0].name, 'Carol Danvers');
			assert.strictEqual(contributors[0].commits, 2);
			assert.strictEqual(contributors[0].emails.length, 2);
			assert.ok(contributors[0].emails.includes('carol.danvers@company.com'));
			assert.ok(contributors[0].emails.includes('carol.danvers@gmail.com'));
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('does not merge different authors who share a common name but distinct local parts without mailmap', async () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-distinct-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.name', 'Repo Creator'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.email', 'creator@example.com'], { cwd: tempRepo });

			writeFileSync(join(tempRepo, 'file1.txt'), 'content 1\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'commit 1', '--author', 'David Smith <dave@corp.com>'],
				{ cwd: tempRepo }
			);

			writeFileSync(join(tempRepo, 'file2.txt'), 'content 2\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync(
				'git',
				['commit', '-m', 'commit 2', '--author', 'David Smith <jsmith@other.com>'],
				{ cwd: tempRepo }
			);

			const contributors = await getGitContributors(tempRepo);
			assert.strictEqual(contributors.length, 2);
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('isBot correctly categorizes bot accounts vs human noreply addresses', () => {
		// Bot instances
		assert.strictEqual(isBot({ name: 'dependabot[bot]', email: 'dependabot[bot]@users.noreply.github.com' }), true);
		assert.strictEqual(isBot({ name: 'renovate[bot]', email: 'renovate@whitesourcesoftware.com' }), true);
		assert.strictEqual(isBot({ name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' }), true);
		assert.strictEqual(isBot({ name: 'Snyk Bot', email: 'snyk-bot@snyk.io' }), true);
		assert.strictEqual(isBot({ name: 'Custom Tool [bot]', email: 'tool@example.com' }), true);
		assert.strictEqual(isBot({ name: 'Automated Committer', email: 'actions@github.com' }), true);
		assert.strictEqual(isBot({ name: 'CI Service', email: 'noreply@github.com' }), true);

		// Human instances
		assert.strictEqual(isBot({ name: 'Stephen Dawson', email: '57060620+stephendawsondev@users.noreply.github.com' }), false);
		assert.strictEqual(isBot({ name: 'Alice Smith', email: 'alice@company.com' }), false);
		assert.strictEqual(isBot({ name: 'Bob Jones', email: 'bob@example.org' }), false);
	});

	it('parseMailmap correctly parses various git .mailmap syntax patterns', () => {
		const sampleMailmap = `
# Comment line
Proper Name <proper@email.xx> <commit@email.xx>
Proper Name <proper@email.xx> Commit Name <commit@email.xx>
<proper@email.xx> <commit@email.xx>
Proper Name <commit@email.xx>
`;
		const rules = parseMailmap(sampleMailmap);
		assert.strictEqual(rules.length, 4);

		assert.strictEqual(rules[0].properName, 'Proper Name');
		assert.strictEqual(rules[0].properEmail, 'proper@email.xx');
		assert.strictEqual(rules[0].commitEmail, 'commit@email.xx');

		assert.strictEqual(rules[1].properName, 'Proper Name');
		assert.strictEqual(rules[1].commitName, 'Commit Name');
		assert.strictEqual(rules[1].commitEmail, 'commit@email.xx');

		assert.strictEqual(rules[2].properName, null);
		assert.strictEqual(rules[2].properEmail, 'proper@email.xx');
		assert.strictEqual(rules[2].commitEmail, 'commit@email.xx');

		assert.strictEqual(rules[3].properName, 'Proper Name');
		assert.strictEqual(rules[3].properEmail, null);
		assert.strictEqual(rules[3].commitEmail, 'commit@email.xx');
	});

	it('returns an empty array cleanly for a fresh git repo without commits', async () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-empty-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			const contributors = await getGitContributors(tempRepo);
			assert.deepStrictEqual(contributors, []);
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('runs cleanly as CLI script with JSON output', () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-cli-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.name', 'CLI Test'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.email', 'cli@example.com'], { cwd: tempRepo });

			writeFileSync(join(tempRepo, 'app.go'), 'package main\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync('git', ['commit', '-m', 'feat: go app', '--author', 'Gopher <go@example.com>'], { cwd: tempRepo });

			const stdout = execFileSync('node', [SCRIPT_PATH, tempRepo], {
				encoding: 'utf8'
			});

			const parsed = JSON.parse(stdout);
			assert.ok(Array.isArray(parsed));
			assert.strictEqual(parsed.length, 1);
			assert.strictEqual(parsed[0].name, 'Gopher');
			assert.strictEqual(parsed[0].email, 'go@example.com');
			assert.strictEqual(parsed[0].commits, 1);
			assert.ok(parsed[0].technologies.some((t) => t.name === 'Go'));
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('spawns through relative path and plugin root paths', () => {
		const tempRepo = mkdtempSync(join(tmpdir(), 'git-contrib-path-'));
		try {
			execFileSync('git', ['init', '-b', 'main'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.name', 'CLI Test'], { cwd: tempRepo });
			execFileSync('git', ['config', 'user.email', 'cli@example.com'], { cwd: tempRepo });

			writeFileSync(join(tempRepo, 'README.md'), '# Title\n');
			execFileSync('git', ['add', '.'], { cwd: tempRepo });
			execFileSync('git', ['commit', '-m', 'docs: init', '--author', 'Doc Writer <writer@example.com>'], { cwd: tempRepo });

			// Relative path invocation
			const relScript = relative(REPO_ROOT, SCRIPT_PATH);
			const stdout = execFileSync('node', [relScript, tempRepo], {
				cwd: REPO_ROOT,
				encoding: 'utf8'
			});

			const parsed = JSON.parse(stdout);
			assert.strictEqual(parsed.length, 1);
			assert.strictEqual(parsed[0].name, 'Doc Writer');
		} finally {
			rmSync(tempRepo, { recursive: true, force: true });
		}
	});

	it('exits with code 1 when given a non-existent directory', () => {
		assert.throws(
			() => {
				execFileSync('node', [SCRIPT_PATH, '/non/existent/path/for/test'], {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			},
			(err) => {
				return err.status === 1;
			}
		);
	});
});
