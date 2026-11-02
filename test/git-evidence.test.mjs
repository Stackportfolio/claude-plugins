import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
	collectGitEvidence,
	normalizeNumstatPath,
	extractCoAuthorEmails,
	detectFileLanguage,
	EXTENSION_MAP
} from '../plugins/stackportfolio/scripts/git-evidence.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(
	__dirname,
	'../plugins/stackportfolio/scripts/git-evidence.mjs'
);

describe('git-evidence', () => {
	let fixtureDir;

	before(() => {
		fixtureDir = mkdtempSync(join(tmpdir(), 'git-evidence-fixture-'));
		execFileSync('git', ['init', '-b', 'main'], { cwd: fixtureDir });

		// Helper to execute git commit with custom author/committer and dates
		function commitAs({
			authorName,
			authorEmail,
			committerName,
			committerEmail,
			date,
			message,
			files
		}) {
			for (const [relPath, content] of Object.entries(files)) {
				const fullPath = join(fixtureDir, relPath);
				mkdirSync(dirname(fullPath), { recursive: true });
				writeFileSync(fullPath, content, 'utf8');
			}
			execFileSync('git', ['add', '.'], { cwd: fixtureDir });
			execFileSync('git', ['commit', '-m', message], {
				cwd: fixtureDir,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: authorName,
					GIT_AUTHOR_EMAIL: authorEmail,
					GIT_AUTHOR_DATE: date,
					GIT_COMMITTER_NAME: committerName || authorName,
					GIT_COMMITTER_EMAIL: committerEmail || authorEmail,
					GIT_COMMITTER_DATE: date
				}
			});
		}

		// Commit 1 (Alice): Initial core TypeScript setup (#10)
		commitAs({
			authorName: 'Alice Dev',
			authorEmail: 'alice@example.com',
			date: '2026-01-10T10:00:00Z',
			message: 'feat(core): initial engine setup (#10)',
			files: {
				'README.md': '# Test Project\n\nA test repository for git evidence.\n',
				'src/index.ts': 'export const VERSION = "1.0.0";\nconsole.log(VERSION);\n',
				'src/utils.ts': 'export function add(a: number, b: number) {\n  return a + b;\n}\n'
			}
		});

		// Commit 2 (Bob): Python service commit (#25)
		commitAs({
			authorName: 'Bob Builder',
			authorEmail: 'bob@example.com',
			date: '2026-02-15T14:30:00Z',
			message: 'feat(api): add python microservice endpoint (#25)',
			files: {
				'py/app.py': 'def handler():\n    return {"status": "ok"}\n\nprint(handler())\n',
				'py/test.py': 'def test_handler():\n    assert True\n'
			}
		});

		// Commit 3 (Bob with Alice as Co-author): Shared Go service with trailer (#42)
		commitAs({
			authorName: 'Bob Builder',
			authorEmail: 'bob@example.com',
			date: '2026-03-01T11:00:00Z',
			message:
				'feat(shared): add cross-service connector (#42)\n\n' +
				'Designed jointly with Alice to bridge TypeScript and Python.\n\n' +
				'Co-authored-by: Alice Dev <alice@example.com>',
			files: {
				'shared/bridge.go': 'package main\n\nimport "fmt"\n\nfunc Bridge() {\n\tfmt.Println("bridged")\n}\n'
			}
		});

		// Commit 4 (Alice committer on automated bot commit): CI config
		commitAs({
			authorName: 'Automation Bot',
			authorEmail: 'bot@ci.local',
			committerName: 'Alice Dev',
			committerEmail: 'alice@example.com',
			date: '2026-03-10T08:00:00Z',
			message: 'chore(ci): update workflow configuration',
			files: {
				'.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
			}
		});

		// Commit 5 (Alice): Merge pull request #105
		commitAs({
			authorName: 'Alice Dev',
			authorEmail: 'alice@example.com',
			date: '2026-03-20T16:00:00Z',
			message:
				'Merge pull request #105 from alice/feature-ts\n\n' +
				'Refactor core TypeScript utilities for performance',
			files: {
				'src/utils.ts':
					'export function add(a: number, b: number) {\n  return a + b;\n}\n\n' +
					'export function multiply(a: number, b: number) {\n  return a * b;\n}\n'
			}
		});
	});

	after(() => {
		if (fixtureDir) {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});

	it('separates contributions per author and includes co-authored-by commits', async () => {
		const aliceEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		// Alice has: Commit 1 (author), Commit 3 (co-author), Commit 4 (committer), Commit 5 (author) = 4 commits
		assert.strictEqual(aliceEvidence.commitCount, 4);

		// Alice touched files should include her TypeScript files, shared Go file, root README, and .github workflow
		assert.ok(aliceEvidence.filesTouched.includes('src/index.ts'));
		assert.ok(aliceEvidence.filesTouched.includes('src/utils.ts'));
		assert.ok(aliceEvidence.filesTouched.includes('shared/bridge.go'));
		assert.ok(aliceEvidence.filesTouched.includes('README.md'));
		assert.ok(aliceEvidence.filesTouched.includes('.github/workflows/ci.yml'));

		// Alice should NOT have touched Bob's solo Python files
		assert.strictEqual(aliceEvidence.filesTouched.includes('py/app.py'), false);
		assert.strictEqual(aliceEvidence.filesTouched.includes('py/test.py'), false);

		const bobEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'bob@example.com'
		});

		// Bob has: Commit 2 (author), Commit 3 (author) = 2 commits
		assert.strictEqual(bobEvidence.commitCount, 2);

		// Bob touched Python files and shared Go file
		assert.ok(bobEvidence.filesTouched.includes('py/app.py'));
		assert.ok(bobEvidence.filesTouched.includes('py/test.py'));
		assert.ok(bobEvidence.filesTouched.includes('shared/bridge.go'));

		// Bob should NOT have touched Alice's solo files
		assert.strictEqual(bobEvidence.filesTouched.includes('src/index.ts'), false);
		assert.strictEqual(bobEvidence.filesTouched.includes('.github/workflows/ci.yml'), false);
	});

	it('matches author and committer emails case-insensitively', async () => {
		const uppercaseEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'ALICE@EXAMPLE.COM'
		});
		const lowercaseEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		assert.strictEqual(uppercaseEvidence.commitCount, lowercaseEvidence.commitCount);
		assert.deepStrictEqual(uppercaseEvidence.filesTouched, lowercaseEvidence.filesTouched);
		assert.deepStrictEqual(uppercaseEvidence.prRefs, lowercaseEvidence.prRefs);
	});

	it('computes accurate active span (first and last dates, days)', async () => {
		const aliceEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		assert.strictEqual(aliceEvidence.firstCommitDate, '2026-01-10T10:00:00Z');
		assert.strictEqual(aliceEvidence.lastCommitDate, '2026-03-20T16:00:00Z');

		assert.ok(aliceEvidence.activeSpan);
		assert.strictEqual(aliceEvidence.activeSpan.first, '2026-01-10T10:00:00Z');
		assert.strictEqual(aliceEvidence.activeSpan.last, '2026-03-20T16:00:00Z');

		// Difference between Jan 10 and Mar 20 is 69 days
		assert.strictEqual(aliceEvidence.activeSpan.days, 69);
	});

	it('maps file extensions to languages and sorts top languages by changed lines', async () => {
		const aliceEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		const languages = aliceEvidence.topLanguages.map((l) => l.language);
		assert.ok(languages.includes('TypeScript'));
		assert.ok(languages.includes('Go'));
		assert.ok(languages.includes('YAML'));
		assert.ok(languages.includes('Markdown'));

		// Alice did not write Python
		assert.strictEqual(languages.includes('Python'), false);

		// Assert changed lines numbers are present
		const tsStat = aliceEvidence.topLanguages.find((l) => l.language === 'TypeScript');
		assert.ok(tsStat);
		assert.ok(tsStat.changedLines > 0);
		assert.ok(tsStat.linesAdded > 0);

		// Bob wrote Python and Go
		const bobEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'bob@example.com'
		});
		const bobLangs = bobEvidence.topLanguages.map((l) => l.language);
		assert.ok(bobLangs.includes('Python'));
		assert.ok(bobLangs.includes('Go'));
		assert.strictEqual(bobLangs.includes('TypeScript'), false);
	});

	it('extracts PR numbers and merge references from commit messages', async () => {
		const aliceEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		// Alice's matching commits had: #10, #42 (co-author), #105 (merge commit)
		assert.ok(aliceEvidence.prRefs.includes('#10'));
		assert.ok(aliceEvidence.prRefs.includes('#42'));
		assert.ok(aliceEvidence.prRefs.includes('#105'));

		assert.ok(aliceEvidence.prNumbers.includes(10));
		assert.ok(aliceEvidence.prNumbers.includes(42));
		assert.ok(aliceEvidence.prNumbers.includes(105));

		// Assert mergeRefs
		const mergeRef = aliceEvidence.mergeRefs.find((r) =>
			r.includes('Merge pull request #105')
		);
		assert.ok(mergeRef, 'Expected Merge pull request #105 to be captured in mergeRefs');
	});

	it('categorises touched files into top-level areas', async () => {
		const aliceEvidence = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com'
		});

		assert.ok(aliceEvidence.areasTouched.includes('src'));
		assert.ok(aliceEvidence.areasTouched.includes('shared'));
		assert.ok(aliceEvidence.areasTouched.includes('root'));
		assert.ok(aliceEvidence.areasTouched.includes('.github'));

		assert.ok(aliceEvidence.areas.src);
		assert.strictEqual(aliceEvidence.areas.src.files, 2); // index.ts, utils.ts
		assert.ok(aliceEvidence.areas.src.commits >= 2);
	});

	it('supports comma-separated emails and multiple aliases', async () => {
		const combined = await collectGitEvidence({
			repoDir: fixtureDir,
			author: 'alice@example.com,bob@example.com'
		});

		// Total commits across both authors
		assert.strictEqual(combined.commitCount, 5);
		assert.strictEqual(combined.authorEmails.length, 2);
	});

	it('runs cleanly as CLI script with JSON stdout', () => {
		const stdout = execFileSync(
			'node',
			[SCRIPT_PATH, fixtureDir, '--author', 'alice@example.com'],
			{ encoding: 'utf8' }
		);

		const parsed = JSON.parse(stdout);
		assert.strictEqual(parsed.commitCount, 4);
		assert.strictEqual(parsed.fileCount, 5);
		assert.ok(parsed.topLanguages.length > 0);
		assert.ok(parsed.prRefs.includes('#10'));
	});

	it('exits with error when --author is missing', () => {
		assert.throws(
			() => {
				execFileSync('node', [SCRIPT_PATH, fixtureDir], {
					encoding: 'utf8',
					stdio: 'pipe'
				});
			},
			(err) => {
				assert.strictEqual(err.status, 1);
				return true;
			}
		);
	});

	it('exits with error when repository directory does not exist', () => {
		assert.throws(
			() => {
				execFileSync(
					'node',
					[SCRIPT_PATH, '/non/existent/path', '--author', 'alice@example.com'],
					{
						encoding: 'utf8',
						stdio: 'pipe'
					}
				);
			},
			(err) => {
				assert.strictEqual(err.status, 1);
				return true;
			}
		);
	});

	it('handles empty repositories gracefully with zero count and null span', () => {
		const emptyDir = mkdtempSync(join(tmpdir(), 'git-empty-fixture-'));
		try {
			execFileSync('git', ['init'], { cwd: emptyDir });
			const stdout = execFileSync(
				'node',
				[SCRIPT_PATH, emptyDir, '--author', 'alice@example.com'],
				{ encoding: 'utf8' }
			);
			const parsed = JSON.parse(stdout);
			assert.strictEqual(parsed.commitCount, 0);
			assert.strictEqual(parsed.firstCommitDate, null);
			assert.strictEqual(parsed.lastCommitDate, null);
			assert.strictEqual(parsed.activeSpan, null);
			assert.strictEqual(parsed.fileCount, 0);
			assert.deepStrictEqual(parsed.filesTouched, []);
			assert.deepStrictEqual(parsed.topLanguages, []);
			assert.deepStrictEqual(parsed.prRefs, []);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it('normalizes numstat paths for git renames', () => {
		assert.strictEqual(normalizeNumstatPath('src/file.ts'), 'src/file.ts');
		assert.strictEqual(normalizeNumstatPath('old.ts => new.ts'), 'new.ts');
		assert.strictEqual(
			normalizeNumstatPath('src/{old => new}/file.ts'),
			'src/new/file.ts'
		);
		assert.strictEqual(
			normalizeNumstatPath('src/{ => components}/Button.tsx'),
			'src/components/Button.tsx'
		);
	});

	it('extracts co-author emails from diverse trailer conventions', () => {
		const body =
			'Some commit notes\n\n' +
			'Co-authored-by: Alice <alice@example.com>\n' +
			'Co-Authored-By: Bob Builder <BOB@EXAMPLE.COM>\n' +
			'co-authored-by: charlie@test.org\n';
		const emails = extractCoAuthorEmails(body);
		assert.deepStrictEqual(emails, [
			'alice@example.com',
			'bob@example.com',
			'charlie@test.org'
		]);
	});

	it('detectFileLanguage correctly maps common file extensions and special files', () => {
		assert.strictEqual(detectFileLanguage('src/app.ts'), 'TypeScript');
		assert.strictEqual(detectFileLanguage('src/component.svelte'), 'Svelte');
		assert.strictEqual(detectFileLanguage('lib/server.py'), 'Python');
		assert.strictEqual(detectFileLanguage('main.go'), 'Go');
		assert.strictEqual(detectFileLanguage('Dockerfile'), 'Docker');
		assert.strictEqual(detectFileLanguage('Makefile'), 'Makefile');
		assert.strictEqual(detectFileLanguage('unknown.xyz'), null);
	});
});
