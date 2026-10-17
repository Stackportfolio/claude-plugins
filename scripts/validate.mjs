#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const REPO_ROOT = resolve(process.cwd());
const MARKETPLACE_PATH = join(REPO_ROOT, '.claude-plugin/marketplace.json');
const PLUGIN_PATH = join(REPO_ROOT, 'plugins/stackportfolio/.claude-plugin/plugin.json');
const MCP_CONFIG_PATH = join(REPO_ROOT, 'plugins/stackportfolio/.mcp.json');
const SKILLS_DIR = join(REPO_ROOT, 'plugins/stackportfolio/skills');

// Known MCP tool names mirrored from stackportfolio src/lib/server/mcp/tools.ts
export const MCP_TOOLS_SNAPSHOT = new Set([
	'whoami',
	'get_profile',
	'update_profile',
	'list_projects',
	'get_project',
	'create_project',
	'update_project',
	'list_project_technologies',
	'add_project_technology',
	'add_project_media',
	'update_project_technology',
	'remove_project_technology',
	'list_project_contributors',
	'invite_project_contributor',
	'set_contributor_role',
	'remove_project_contributor',
	'set_contributor_technologies',
	'set_contributor_skills',
	'list_contribution_stories',
	'list_project_contribution_stories',
	'get_contribution_story',
	'save_contribution_story',
	'delete_contribution_story'
]);

const EXPECTED_V1_SKILLS = [
	'add-project',
	'upload-screenshots',
	'sync-project',
	'update-profile'
];

let failed = false;

function error(msg) {
	console.error(`❌ ${msg}`);
	failed = true;
}

function pass(msg) {
	console.log(`✓ ${msg}`);
}

function parseFrontmatter(content, filePath) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		error(`${filePath}: missing frontmatter block (between --- and ---)`);
		return null;
	}

	const lines = match[1].split(/\r?\n/);
	const data = {};
	let currentListKey = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		if (trimmed.startsWith('- ') && currentListKey) {
			const item = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
			data[currentListKey].push(item);
			continue;
		}

		const colonIdx = line.indexOf(':');
		if (colonIdx !== -1) {
			const key = line.slice(0, colonIdx).trim();
			const val = line.slice(colonIdx + 1).trim();

			if (!val) {
				currentListKey = key;
				data[key] = [];
			} else {
				currentListKey = null;
				data[key] = val.replace(/^['"]|['"]$/g, '');
			}
		}
	}

	return {
		frontmatter: data,
		body: content.slice(match[0].length)
	};
}

console.log('--- Validating Marketplace Manifest ---');
if (!existsSync(MARKETPLACE_PATH)) {
	error(`marketplace.json missing at ${MARKETPLACE_PATH}`);
} else {
	try {
		const raw = readFileSync(MARKETPLACE_PATH, 'utf8');
		const json = JSON.parse(raw);
		if (json.name !== 'stackportfolio') {
			error(`marketplace.json name must be 'stackportfolio', got '${json.name}'`);
		}
		if (!json.owner || json.owner.name !== 'Stackportfolio') {
			error(`marketplace.json owner.name must be 'Stackportfolio'`);
		}
		if (!Array.isArray(json.plugins) || json.plugins.length === 0) {
			error(`marketplace.json plugins must be a non-empty array`);
		} else {
			const sp = json.plugins.find((p) => p.name === 'stackportfolio');
			if (!sp) {
				error(`marketplace.json plugins array missing 'stackportfolio' entry`);
			} else if (sp.source !== './plugins/stackportfolio') {
				error(`marketplace.json 'stackportfolio' source must be './plugins/stackportfolio'`);
			}
		}
		pass('marketplace.json valid and matches requirements');
	} catch (e) {
		error(`Failed parsing marketplace.json: ${e.message}`);
	}
}

console.log('\n--- Validating Plugin Manifest ---');
if (!existsSync(PLUGIN_PATH)) {
	error(`plugin.json missing at ${PLUGIN_PATH}`);
} else {
	try {
		const raw = readFileSync(PLUGIN_PATH, 'utf8');
		const json = JSON.parse(raw);
		if (json.name !== 'stackportfolio') {
			error(`plugin.json name must be 'stackportfolio', got '${json.name}'`);
		}
		if (!json.description || typeof json.description !== 'string') {
			error(`plugin.json description is required`);
		}
		if (!json.author || json.author.name !== 'Stackportfolio') {
			error(`plugin.json author.name must be 'Stackportfolio'`);
		}
		pass('plugin.json valid and matches requirements');
	} catch (e) {
		error(`Failed parsing plugin.json: ${e.message}`);
	}
}

console.log('\n--- Validating .mcp.json Configuration ---');
if (!existsSync(MCP_CONFIG_PATH)) {
	error(`.mcp.json missing at ${MCP_CONFIG_PATH}`);
} else {
	try {
		const raw = readFileSync(MCP_CONFIG_PATH, 'utf8');
		const json = JSON.parse(raw);
		const server = json?.mcpServers?.stackportfolio || json?.stackportfolio;
		if (!server) {
			error(`.mcp.json missing server config for 'stackportfolio'`);
		} else {
			if (server.type !== 'http') {
				error(`.mcp.json stackportfolio server type must be 'http', got '${server.type}'`);
			}
			if (server.url !== 'https://stackportfol.io/mcp') {
				error(`.mcp.json stackportfolio server url must be 'https://stackportfol.io/mcp', got '${server.url}'`);
			}
		}
		pass('.mcp.json valid and points to https://stackportfol.io/mcp');
	} catch (e) {
		error(`Failed parsing .mcp.json: ${e.message}`);
	}
}

console.log('\n--- Validating Skills ---');
if (!existsSync(SKILLS_DIR)) {
	error(`Skills directory missing at ${SKILLS_DIR}`);
} else {
	const skillDirs = readdirSync(SKILLS_DIR).filter((f) =>
		statSync(join(SKILLS_DIR, f)).isDirectory()
	);

	for (const expected of EXPECTED_V1_SKILLS) {
		if (!skillDirs.includes(expected)) {
			error(`Expected v1 skill '${expected}' is missing from ${SKILLS_DIR}`);
		}
	}

	for (const dir of skillDirs) {
		const skillPath = join(SKILLS_DIR, dir, 'SKILL.md');
		if (!existsSync(skillPath)) {
			error(`Missing SKILL.md for skill in ${dir}`);
			continue;
		}

		const raw = readFileSync(skillPath, 'utf8');
		const parsed = parseFrontmatter(raw, skillPath);
		if (!parsed) continue;

		const { frontmatter, body } = parsed;

		// Name check
		if (frontmatter.name !== dir) {
			error(`${skillPath}: frontmatter name '${frontmatter.name}' does not match directory '${dir}'`);
		}

		// Description check
		if (!frontmatter.description || typeof frontmatter.description !== 'string') {
			error(`${skillPath}: frontmatter description missing or invalid`);
		}

		// Allowed tools check
		if (!Array.isArray(frontmatter['allowed-tools']) || frontmatter['allowed-tools'].length === 0) {
			error(`${skillPath}: frontmatter allowed-tools must be a non-empty list`);
		} else {
			for (const tool of frontmatter['allowed-tools']) {
				if (!MCP_TOOLS_SNAPSHOT.has(tool)) {
					error(`${skillPath}: allowed-tools references unknown tool '${tool}' (not in MCP_TOOLS)`);
				}
			}
		}

		// Shared rules check in body
		const bodyLower = body.toLowerCase();
		if (!bodyLower.includes('evidence') || !bodyLower.includes('never invent')) {
			error(`${skillPath}: body missing evidence rule ('never invent technologies')`);
		}
		if (!bodyLower.includes('computed') && !bodyLower.includes('proficiency')) {
			error(`${skillPath}: body missing computed proficiency rule`);
		}
		if (!bodyLower.includes('destructive') && !bodyLower.includes('confirm')) {
			error(`${skillPath}: body missing destructive confirmation rule`);
		}
		if (!bodyLower.includes('error') || !bodyLower.includes('verbatim')) {
			error(`${skillPath}: body missing verbatim error surfacing rule`);
		}
		if (!bodyLower.includes('scope') || !bodyLower.includes('/mcp')) {
			error(`${skillPath}: body missing scope error recovery rule (re-run /mcp)`);
		}
		if (!bodyLower.includes('projects:delete') && !bodyLower.includes('deletion')) {
			error(`${skillPath}: body missing no project deletion rule`);
		}

		pass(`skill '${dir}' valid (frontmatter, allowed-tools, and shared rules verified)`);
	}
}

if (failed) {
	console.error('\n❌ Validation failed with errors.');
	process.exit(1);
} else {
	console.log('\n✔ All validation checks passed successfully.');
}
