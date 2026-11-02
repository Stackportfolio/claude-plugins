import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import {
	buildToolSet,
	extractSkillToolUsage,
	validateSkillsAgainstContract,
	redactSensitive
} from '../scripts/contract.mjs';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts/contract.mjs');
const FIXTURES_DIR = join(__dirname, 'fixtures');

const CLEAN_SPEC = join(FIXTURES_DIR, 'openapi-contract-clean.json');
const RENAMED_SPEC = join(FIXTURES_DIR, 'openapi-contract-renamed.json');
const MISSING_ARG_SPEC = join(FIXTURES_DIR, 'openapi-contract-missing-arg.json');
const NO_TAGS_SPEC = join(FIXTURES_DIR, 'openapi-contract-no-tags.json');

describe('OpenAPI contract guard (scripts/contract.mjs)', () => {
	it('a clean spec passes against the current skills', async () => {
		const { stdout, stderr } = await execFileAsync(
			'node',
			[SCRIPT_PATH, '--spec', CLEAN_SPEC],
			{ cwd: REPO_ROOT, env: { ...process.env, STACKPORTFOLIO_OPENAPI_BASIC_AUTH: '' } }
		);
		assert.ok(stdout.includes('✔ OpenAPI contract guard passed'));
		assert.strictEqual(stderr, '');
	});

	it('a spec with one tool renamed fails, naming the skill file and line', async () => {
		let failed = false;
		try {
			await execFileAsync('node', [SCRIPT_PATH, '--spec', RENAMED_SPEC], {
				cwd: REPO_ROOT,
				env: { ...process.env, STACKPORTFOLIO_OPENAPI_BASIC_AUTH: '' }
			});
		} catch (err) {
			failed = true;
			assert.strictEqual(err.code, 1);
			const output = `${err.stdout}\n${err.stderr}`;
			assert.ok(
				output.includes('plugins/stackportfolio/skills/update-profile/SKILL.md:6: allowed-tools references unknown tool \'update_profile\''),
				`Expected failure to name SKILL.md:6. Output was:\n${output}`
			);
			assert.ok(
				output.includes('plugins/stackportfolio/skills/update-profile/SKILL.md:57: body references unknown tool \'update_profile\'') ||
				output.includes('plugins/stackportfolio/skills/update-profile/SKILL.md:53: body references unknown tool \'update_profile\''),
				`Expected failure to name SKILL.md body line. Output was:\n${output}`
			);
		}
		assert.ok(failed, 'Execution should fail when a tool is renamed');
	});

	it('a spec missing an argument a skill uses fails, naming the skill file and line', async () => {
		let failed = false;
		try {
			await execFileAsync('node', [SCRIPT_PATH, '--spec', MISSING_ARG_SPEC], {
				cwd: REPO_ROOT,
				env: { ...process.env, STACKPORTFOLIO_OPENAPI_BASIC_AUTH: '' }
			});
		} catch (err) {
			failed = true;
			assert.strictEqual(err.code, 1);
			const output = `${err.stdout}\n${err.stderr}`;
			assert.ok(
				output.includes('plugins/stackportfolio/skills/upload-screenshots/SKILL.md:96: tool \'update_project_media\' does not accept argument \'makeCover\''),
				`Expected failure to name upload-screenshots/SKILL.md:96 and makeCover. Output was:\n${output}`
			);
		}
		assert.ok(failed, 'Execution should fail when an argument is missing');
	});

	it('a spec without x-mcp-tool tags fails loudly with "no x-mcp-tool tags in spec"', async () => {
		let failed = false;
		try {
			await execFileAsync('node', [SCRIPT_PATH, '--spec', NO_TAGS_SPEC], {
				cwd: REPO_ROOT,
				env: { ...process.env, STACKPORTFOLIO_OPENAPI_BASIC_AUTH: '' }
			});
		} catch (err) {
			failed = true;
			assert.strictEqual(err.code, 1);
			const output = `${err.stdout}\n${err.stderr}`;
			assert.ok(
				output.includes('no x-mcp-tool tags in spec'),
				`Expected "no x-mcp-tool tags in spec". Output was:\n${output}`
			);
		}
		assert.ok(failed, 'Execution should fail when spec has no x-mcp-tool tags');
	});

	it('offline runs without --spec say "contract check skipped: no spec" and exit 0', async () => {
		const { stdout, stderr } = await execFileAsync('node', [SCRIPT_PATH], {
			cwd: REPO_ROOT,
			env: { ...process.env, STACKPORTFOLIO_OPENAPI_BASIC_AUTH: '' }
		});
		assert.ok(
			stdout.includes('contract check skipped: no spec'),
			`Expected "contract check skipped: no spec". Output was: ${stdout}`
		);
		assert.strictEqual(stderr, '');
	});

	it('credentials never appear in output when basic auth is provided', async () => {
		const secretUser = 'supersecret_user_xyz';
		const secretPass = 'supersecret_password_123';
		const secretAuth = `${secretUser}:${secretPass}`;

		// Test 1: Redaction function unit test
		const sampleWithCreds = `Connecting with ${secretAuth} using Basic ${Buffer.from(secretAuth).toString('base64')} at https://${secretAuth}@example.com/api`;
		process.env.STACKPORTFOLIO_OPENAPI_BASIC_AUTH = secretAuth;
		const sanitized = redactSensitive(sampleWithCreds);
		assert.ok(!sanitized.includes(secretUser), 'Username must be redacted');
		assert.ok(!sanitized.includes(secretPass), 'Password must be redacted');
		assert.ok(!sanitized.includes(Buffer.from(secretAuth).toString('base64')), 'Base64 token must be redacted');

		// Test 2: Subprocess execution with explicit URL failure
		let failed = false;
		try {
			await execFileAsync(
				'node',
				[SCRIPT_PATH, '--url', `https://${secretAuth}@127.0.0.1:9/invalid-openapi.json`],
				{
					cwd: REPO_ROOT,
					env: {
						...process.env,
						STACKPORTFOLIO_OPENAPI_BASIC_AUTH: secretAuth
					}
				}
			);
		} catch (err) {
			failed = true;
			const fullOutput = `${err.stdout || ''}\n${err.stderr || ''}`;
			assert.ok(!fullOutput.includes(secretUser), `Secret username leaked in output:\n${fullOutput}`);
			assert.ok(!fullOutput.includes(secretPass), `Secret password leaked in output:\n${fullOutput}`);
			assert.ok(
				!fullOutput.includes(Buffer.from(secretAuth).toString('base64')),
				`Base64 credential leaked in output:\n${fullOutput}`
			);
		} finally {
			delete process.env.STACKPORTFOLIO_OPENAPI_BASIC_AUTH;
		}
		assert.ok(failed, 'Expected invalid URL connection to fail');
	});

	it('buildToolSet parses paths, path parameters, query parameters, and body properties', () => {
		const cleanDoc = JSON.parse(readFileSync(CLEAN_SPEC, 'utf8'));
		const tools = buildToolSet(cleanDoc);

		assert.ok(tools.has('create_project'));
		const createProject = tools.get('create_project');
		assert.ok(createProject.acceptedArgs.has('name'));
		assert.ok(createProject.acceptedArgs.has('description'));
		assert.ok(createProject.acceptedArgs.has('visibility'));
		assert.ok(createProject.acceptedArgs.has('technologies'));

		assert.ok(tools.has('update_project_media'));
		const updateMedia = tools.get('update_project_media');
		assert.ok(updateMedia.acceptedArgs.has('projectId'));
		assert.ok(updateMedia.acceptedArgs.has('mediaId'));
		assert.ok(updateMedia.acceptedArgs.has('makeCover'));
		assert.ok(updateMedia.acceptedArgs.has('caption'));
	});

	it('validateSkillsAgainstContract passes cleanly against current clean spec', () => {
		const cleanDoc = JSON.parse(readFileSync(CLEAN_SPEC, 'utf8'));
		const toolSet = buildToolSet(cleanDoc);
		const skillsDir = join(REPO_ROOT, 'plugins/stackportfolio/skills');
		const errors = validateSkillsAgainstContract(skillsDir, toolSet);
		assert.deepStrictEqual(errors, []);
	});
});
