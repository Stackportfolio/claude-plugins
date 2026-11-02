#!/usr/bin/env node
import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from './detect-stack.mjs';

/**
 * Normalises technology names for case-insensitive and whitespace-insensitive comparison.
 */
function normName(name) {
	return String(name || '').trim().toLowerCase();
}

/**
 * Normalises version strings for comparison.
 */
function normVersion(v) {
	if (v === null || v === undefined || v === '') return null;
	return String(v).trim();
}

/**
 * Known technology migration and replacement pairings (lowercase).
 */
const KNOWN_REPLACEMENTS = {
	webpack: ['Vite', 'Turbopack', 'Rollup', 'esbuild'],
	javascript: ['TypeScript'],
	express: ['Fastify', 'Hono', 'NestJS', 'Koa'],
	rest: ['GraphQL', 'gRPC'],
	sass: ['Tailwind CSS'],
	less: ['Tailwind CSS'],
	css: ['Tailwind CSS'],
	redux: ['Zustand', 'MobX', 'Pinia'],
	jest: ['Vitest'],
	npm: ['pnpm', 'yarn', 'bun'],
	celery: ['RQ']
};

/**
 * Extracts an array of technology objects from various input formats.
 * Supports:
 * - File path: path to JSON file
 * - Array: [...]
 * - MCP / REST API envelope: { data: [...] }
 * - Pagination / query results: { items: [...] } or { technologies: [...] }
 */
export function extractRemoteTechnologies(raw) {
	if (!raw) return [];
	let obj = raw;
	if (typeof raw === 'string') {
		if (existsSync(raw)) {
			try {
				const stat = statSync(raw);
				if (!stat.isDirectory()) {
					const content = readFileSync(raw, 'utf8');
					return extractRemoteTechnologies(content);
				}
			} catch {
				// fall through to JSON.parse
			}
		}
		try {
			obj = JSON.parse(raw);
		} catch (err) {
			throw new Error(`Failed to parse remote technologies JSON: ${err.message}`);
		}
	}

	if (Array.isArray(obj)) return obj;
	if (obj && typeof obj === 'object') {
		if (Array.isArray(obj.data)) return obj.data;
		if (Array.isArray(obj.items)) return obj.items;
		if (Array.isArray(obj.technologies)) return obj.technologies;
	}
	throw new Error('Invalid remote technologies format: expected array or object with data/items/technologies array');
}

/**
 * Resolves local technologies from either a directory (running detectStack)
 * or a pre-computed JSON file / array.
 */
export function resolveLocalStack(localInput, options = {}) {
	if (!localInput) {
		return detectStack('.', options);
	}
	if (Array.isArray(localInput)) {
		return localInput;
	}
	if (typeof localInput === 'string') {
		if (existsSync(localInput)) {
			const stat = statSync(localInput);
			if (stat.isDirectory()) {
				return detectStack(localInput, options);
			}
			const content = readFileSync(localInput, 'utf8');
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed)) return parsed;
			if (parsed && Array.isArray(parsed.stack)) return parsed.stack;
			if (parsed && Array.isArray(parsed.data)) return parsed.data;
			throw new Error(`Local file '${localInput}' does not contain a JSON array of technologies`);
		}
		// Treat as directory path if not found directly
		return detectStack(localInput, options);
	}
	throw new Error(`Invalid local stack input: expected directory path, JSON file, or array`);
}

/**
 * Proposes a likely replacement for a removed technology.
 */
function findReplacementProposal(removedTech, addedTechs) {
	const lower = normName(removedTech.name);
	const knownTargets = KNOWN_REPLACEMENTS[lower];

	if (knownTargets && addedTechs.length > 0) {
		for (const target of knownTargets) {
			const matched = addedTechs.find((a) => normName(a.name) === normName(target));
			if (matched) return matched.name;
		}
	}

	// Heuristic: same kind replacement if exactly one added tech matches kind
	if (removedTech.kind && addedTechs.length > 0) {
		const sameKind = addedTechs.filter((a) => a.kind === removedTech.kind);
		if (sameKind.length === 1) {
			return sameKind[0].name;
		}
	}

	return null;
}

/**
 * Computes the diff between a local detected stack and remote project technologies.
 *
 * @param {string|Array} localInput Directory path, local stack JSON file, or array
 * @param {string|object|Array} remoteInput Remote technologies JSON, file, or object
 * @param {object} options Options passed to detectStack ({ includeDev: boolean })
 * @returns {object} Diff proposal: { add, remove, version, former, unchanged, proposedTechnologies }
 */
export function diffStack(localInput, remoteInput, options = {}) {
	const localStack = resolveLocalStack(localInput, options);
	const remoteTechnologies = extractRemoteTechnologies(remoteInput);

	// Separate active technologies from already-former technologies
	const activeRemote = remoteTechnologies.filter((r) => !r.former);
	const alreadyFormerRemote = remoteTechnologies.filter((r) => !!r.former);

	const localMap = new Map();
	for (const item of localStack) {
		localMap.set(normName(item.name), item);
	}

	const remoteMap = new Map();
	for (const item of activeRemote) {
		remoteMap.set(normName(item.name), item);
	}

	const add = [];
	const unchanged = [];
	const version = [];
	const remove = [];
	const former = [];

	// 1. Process local detections against remote active technologies
	for (const [normLocal, localItem] of localMap.entries()) {
		const remoteItem = remoteMap.get(normLocal);

		if (!remoteItem) {
			add.push({
				name: localItem.name,
				evidence: localItem.evidence || null,
				kind: localItem.kind || null,
				version: normVersion(localItem.version)
			});
		} else {
			const localVer = normVersion(localItem.version);
			const remoteVer = normVersion(remoteItem.version);

			if (localVer !== null && localVer !== remoteVer) {
				version.push({
					id: remoteItem.id || null,
					name: remoteItem.name,
					currentVersion: remoteVer,
					proposedVersion: localVer
				});
			} else {
				unchanged.push({
					id: remoteItem.id || null,
					name: remoteItem.name,
					version: remoteVer
				});
			}
		}
	}

	// 2. Identify active remote technologies missing locally (candidates for remove and former)
	for (const [normRem, remoteItem] of remoteMap.entries()) {
		if (!localMap.has(normRem)) {
			const remVer = normVersion(remoteItem.version);
			const replacement = findReplacementProposal(remoteItem, add);

			if (replacement) {
				former.push({
					id: remoteItem.id || null,
					name: remoteItem.name,
					currentVersion: remVer,
					replacedByName: replacement,
					reason: 'No longer detected in repository manifests'
				});
			} else {
				remove.push({
					id: remoteItem.id || null,
					name: remoteItem.name,
					version: remVer
				});
			}
		}
	}

	// 3. Sort lists alphabetically by technology name for deterministic output
	add.sort((a, b) => a.name.localeCompare(b.name));
	unchanged.sort((a, b) => a.name.localeCompare(b.name));
	version.sort((a, b) => a.name.localeCompare(b.name));
	remove.sort((a, b) => a.name.localeCompare(b.name));
	former.sort((a, b) => a.name.localeCompare(b.name));

	// 4. Build proposed active technologies array for update_project replace
	// Contract: update_project replaces the entire list of technologies on the project,
	// including both active and former technologies. Any attached technology omitted
	// from technologies[] is immediately deleted by the backend.
	// Therefore, proposedTechnologies retains every technology the user has not
	// confirmed for deletion: unchanged, version-bumped, added, already-former,
	// and those being marked former. Only confirmed plain removals leave the list.
	const proposedMap = new Map();
	function addProposed(name, version) {
		const key = normName(name);
		const formatted = version ? `${name}@${version}` : name;
		proposedMap.set(key, formatted);
	}

	for (const item of alreadyFormerRemote) {
		addProposed(item.name, normVersion(item.version));
	}
	for (const item of former) {
		addProposed(item.name, item.currentVersion);
	}
	for (const item of unchanged) {
		addProposed(item.name, item.version);
	}
	for (const item of version) {
		addProposed(item.name, item.proposedVersion);
	}
	for (const item of add) {
		addProposed(item.name, item.version);
	}

	const proposed = Array.from(proposedMap.values());
	proposed.sort((a, b) => a.localeCompare(b));

	return {
		add,
		remove,
		version,
		former,
		unchanged,
		proposedTechnologies: proposed
	};
}

/**
 * Checks if current module is invoked directly from CLI.
 */
export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(metaUrl) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

/**
 * Reads all data from standard input if piped.
 */
async function readStdin() {
	if (process.stdin.isTTY) return null;
	return new Promise((resolve) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => {
			data += chunk;
		});
		process.stdin.on('end', () => {
			resolve(data.trim() ? data : null);
		});
		process.stdin.on('error', () => {
			resolve(null);
		});
	});
}

/**
 * CLI runner for diff-stack.mjs.
 */
export async function runCli(args = process.argv.slice(2)) {
	let localArg = null;
	let remoteArg = null;
	const options = { includeDev: false };

	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--all-deps' || arg === '--include-dev' || arg === '--dev') {
			options.includeDev = true;
		} else if (arg === '--local') {
			localArg = args[++i];
		} else if (arg === '--remote') {
			remoteArg = args[++i];
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const stdinData = await readStdin();

	if (!localArg && positional.length > 0) {
		localArg = positional[0];
	}
	if (!remoteArg) {
		if (positional.length > 1) {
			remoteArg = positional[1];
		} else if (stdinData) {
			remoteArg = stdinData;
		} else if (positional.length === 1 && existsSync(positional[0])) {
			// If single positional arg is a JSON file and not a dir, could it be remote JSON?
			const stat = statSync(positional[0]);
			if (!stat.isDirectory() && positional[0].endsWith('.json')) {
				remoteArg = readFileSync(positional[0], 'utf8');
				localArg = '.';
			}
		}
	}

	if (!remoteArg) {
		console.error('Usage: diff-stack.mjs [local-dir-or-json] [remote-technologies.json]');
		console.error('       cat remote.json | diff-stack.mjs [local-dir-or-json]');
		console.error('       diff-stack.mjs --local <dir-or-json> --remote <file>');
		process.exit(1);
	}

	try {
		let remoteContent = remoteArg;
		if (typeof remoteArg === 'string' && existsSync(remoteArg)) {
			remoteContent = readFileSync(remoteArg, 'utf8');
		}

		const result = diffStack(localArg || '.', remoteContent, options);
		process.stdout.write(JSON.stringify(result, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
