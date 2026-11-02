#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from './detect-stack.mjs';
import { ALIAS_TABLE } from './alias-table.mjs';

const execFileAsync = promisify(execFile);

// Contributor row shape and invite schema
// src/lib/schemas/project.ts:403
// src/lib/server/projects/contributors.ts:53

// Per-contributor technology credit schema
// src/lib/schemas/credits.ts:75

// API contributor representation with technology credits
// src/lib/server/api/operations/projects.ts:169

const KNOWN_BOT_KEYWORDS = ['dependabot', 'renovate', 'github-actions'];

/**
 * Normalises a file path to forward slashes.
 */
function normPath(p) {
	return p.replace(/\\/g, '/');
}

/**
 * Normalises author name: trims, lowercases, collapses whitespace.
 */
function normalizeName(name) {
	return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extracts and normalises the local part of an email address.
 * Strips GitHub ID prefixes (e.g. "12345+username"), plus-aliases ("name+alias"),
 * and punctuation (dots, dashes, underscores) to reliably match the same person.
 */
function normalizeLocalPart(email) {
	if (!email || typeof email !== 'string' || !email.includes('@')) return '';
	const local = email.split('@')[0].trim().toLowerCase();
	const strippedId = local.replace(/^\d+\+/, '');
	return strippedId.replace(/\+.*$/, '').replace(/[\._\-]/g, '');
}

/**
 * Determines whether an author identity represents an automated bot.
 * Filters dependabot, renovate, github-actions, *[bot], and noreply bot addresses.
 *
 * @param {{ name?: string, email?: string }} author
 * @returns {boolean}
 */
export function isBot(author) {
	const cleanName = (author?.name || '').trim().toLowerCase();
	const cleanEmail = (author?.email || '').trim().toLowerCase();
	const localPart = cleanEmail.includes('@') ? cleanEmail.split('@')[0] : cleanEmail;
	const domain = cleanEmail.includes('@') ? cleanEmail.split('@')[1] : '';

	// 1. Any name or email containing "[bot]"
	if (cleanName.includes('[bot]') || cleanEmail.includes('[bot]')) {
		return true;
	}

	// 2. Known bot usernames and slugs
	for (const kw of KNOWN_BOT_KEYWORDS) {
		if (cleanName.includes(kw) || localPart.includes(kw)) {
			return true;
		}
	}

	// 3. Bot addresses with bot suffixes or service labels
	if (
		localPart === 'bot' ||
		localPart.startsWith('bot-') ||
		localPart.endsWith('-bot') ||
		localPart.endsWith('[bot]') ||
		cleanName.endsWith(' bot')
	) {
		return true;
	}

	// 4. Noreply bot addresses
	if (
		cleanEmail === 'actions@github.com' ||
		cleanEmail === 'noreply@github.com' ||
		cleanEmail === 'noreply@gitlab.com' ||
		cleanEmail === 'support+actions@github.com'
	) {
		return true;
	}

	// Note: Human developers also use GitHub private noreply addresses
	// (e.g. "<id>+<username>@users.noreply.github.com").
	// Only filter users.noreply if the local part matches bot keywords or contains "bot".
	if (domain === 'users.noreply.github.com') {
		if (
			localPart.includes('bot') ||
			localPart.includes('action') ||
			localPart.includes('renovate') ||
			localPart.includes('dependabot')
		) {
			return true;
		}
	}

	return false;
}

/**
 * Parses a git .mailmap file into mapping rules.
 * Supports:
 * - Proper Name <proper@email.xx> <commit@email.xx>
 * - Proper Name <proper@email.xx> Commit Name <commit@email.xx>
 * - <proper@email.xx> <commit@email.xx>
 * - Proper Name <commit@email.xx>
 *
 * @param {string} content
 * @returns {Array<{ properName: string|null, properEmail: string|null, commitName: string|null, commitEmail: string }>}
 */
export function parseMailmap(content) {
	const rules = [];
	if (!content || typeof content !== 'string') return rules;

	const lines = content.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		const emails = [...line.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
		if (emails.length === 2) {
			const properEmail = emails[0];
			const commitEmail = emails[1];
			const firstAngle = line.indexOf('<');
			const properName = line.slice(0, firstAngle).trim();
			const firstClose = line.indexOf('>');
			const secondAngle = line.indexOf('<', firstAngle + 1);
			const commitName = line.slice(firstClose + 1, secondAngle).trim();

			rules.push({
				properName: properName || null,
				properEmail,
				commitName: commitName || null,
				commitEmail
			});
		} else if (emails.length === 1) {
			const firstAngle = line.indexOf('<');
			const name = line.slice(0, firstAngle).trim();
			const email = emails[0];
			rules.push({
				properName: name || null,
				properEmail: null,
				commitName: null,
				commitEmail: email
			});
		}
	}
	return rules;
}

/**
 * Applies mailmap rules to an author identity.
 */
function applyMailmap(name, email, rules) {
	let resolvedName = name;
	let resolvedEmail = email;

	for (const rule of rules) {
		const emailMatches =
			rule.commitEmail && rule.commitEmail.toLowerCase() === (email || '').toLowerCase();
		const nameMatches =
			!rule.commitName || rule.commitName.toLowerCase() === (name || '').toLowerCase();

		if (emailMatches && nameMatches) {
			if (rule.properEmail) resolvedEmail = rule.properEmail;
			if (rule.properName) resolvedName = rule.properName;
			break;
		}
	}

	return { name: resolvedName, email: resolvedEmail };
}

/**
 * Maps a set of files touched by an author to technologies present in the repository
 * using detectStack and alias-table rules.
 *
 * @param {Set<string>} filesTouchedSet
 * @param {Array<{ name: string, evidence: string, kind: string }>} projectStack
 * @returns {Array<{ name: string, kind: string, evidence: string[] }>}
 */
function mapFilesToTechnologies(filesTouchedSet, projectStack) {
	const techMap = new Map();

	function addEvidence(name, kind, file) {
		let entry = techMap.get(name);
		if (!entry) {
			entry = { name, kind, evidence: new Set() };
			techMap.set(name, entry);
		}
		entry.evidence.add(file);
	}

	for (const rawFile of filesTouchedSet) {
		const norm = normPath(rawFile);
		const base = basename(norm);

		// 1. Language and runtime extensions
		if (/\.(ts|tsx|mts|cts)$/i.test(norm)) {
			addEvidence('TypeScript', 'runtime', norm);
		}
		if (/\.(js|mjs|cjs)$/i.test(norm)) {
			addEvidence('Node.js', 'runtime', norm);
		}
		if (/\.py$/i.test(norm)) {
			addEvidence('Python', 'runtime', norm);
		}
		if (/\.go$/i.test(norm)) {
			addEvidence('Go', 'runtime', norm);
		}
		if (/\.rs$/i.test(norm)) {
			addEvidence('Rust', 'runtime', norm);
		}
		if (/\.rb$/i.test(norm)) {
			addEvidence('Ruby', 'runtime', norm);
		}
		if (/\.php$/i.test(norm)) {
			addEvidence('PHP', 'runtime', norm);
		}
		if (/\.java$/i.test(norm)) {
			addEvidence('Java', 'runtime', norm);
		}
		if (/\.(kt|kts)$/i.test(norm)) {
			addEvidence('Kotlin', 'runtime', norm);
		}
		if (/\.swift$/i.test(norm)) {
			addEvidence('Swift', 'runtime', norm);
		}

		// 2. Framework source files
		if (/\.svelte$/i.test(norm)) {
			addEvidence('Svelte', 'framework', norm);
			if (projectStack.some((t) => t.name === 'SvelteKit')) {
				addEvidence('SvelteKit', 'framework', norm);
			}
		}
		if (/\.vue$/i.test(norm)) {
			addEvidence('Vue', 'framework', norm);
			if (projectStack.some((t) => t.name === 'Nuxt')) {
				addEvidence('Nuxt', 'framework', norm);
			}
		}
		if (/\.jsx$/i.test(norm)) {
			if (projectStack.some((t) => t.name === 'React')) {
				addEvidence('React', 'framework', norm);
			}
		}

		// 3. Infrastructure & cloud configuration files
		if (base === 'Dockerfile' || base.startsWith('Dockerfile.') || base.endsWith('.dockerfile')) {
			addEvidence('Docker', 'infra', norm);
		}
		if (/^(?:compose\.ya?ml|docker-compose\.ya?ml)$/i.test(base)) {
			addEvidence('Docker Compose', 'infra', norm);
		}
		if (/\.tf$/i.test(norm)) {
			addEvidence('Terraform', 'infra', norm);
		}
		if (norm.startsWith('.github/workflows/')) {
			addEvidence('GitHub Actions', 'infra', norm);
		}
		if (base === '.gitlab-ci.yml') {
			addEvidence('GitLab CI', 'infra', norm);
		}
		if (base === 'vercel.json') {
			addEvidence('Vercel', 'infra', norm);
		}
		if (base === 'netlify.toml') {
			addEvidence('Netlify', 'infra', norm);
		}
		if (base === 'wrangler.toml' || base === 'wrangler.json') {
			addEvidence('Cloudflare', 'infra', norm);
		}
		if (base === 'fly.toml') {
			addEvidence('Fly.io', 'infra', norm);
		}
	}

	// 4. Manifest evidence from detectStack:
	// When an author modified a project manifest (e.g. package.json, go.mod, Cargo.toml),
	// attribute any detected technologies sourced from that manifest to that author.
	for (const tech of projectStack) {
		if (!tech.evidence) continue;
		const manifestFile = normPath(tech.evidence.split(':')[0]);
		if (filesTouchedSet.has(manifestFile)) {
			addEvidence(tech.name, tech.kind, manifestFile);
		}
	}

	return Array.from(techMap.values())
		.map((t) => ({
			name: t.name,
			kind: t.kind,
			evidence: Array.from(t.evidence).sort()
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extracts authors from git log, groups identities, filters automated bots,
 * and attributes technology evidence based on touched files.
 *
 * @param {string} repoPath Path to git repository
 * @param {{ includeBots?: boolean, includeDev?: boolean }} [options]
 * @returns {Promise<Array<{
 *   name: string,
 *   email: string,
 *   emails: string[],
 *   commits: number,
 *   firstCommit: string,
 *   lastCommit: string,
 *   files: string[],
 *   technologies: Array<{ name: string, kind: string, evidence: string[] }>
 * }>>}
 */
export async function getGitContributors(repoPath, options = {}) {
	const resolvedRepo = resolve(repoPath || '.');
	if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
		throw new Error(`Directory not found: ${resolvedRepo}`);
	}

	// Parse local .mailmap if present
	const mailmapFile = join(resolvedRepo, '.mailmap');
	const mailmapRules = existsSync(mailmapFile)
		? parseMailmap(readFileSync(mailmapFile, 'utf8'))
		: [];

	// Read project stack once for technology mapping
	let projectStack = [];
	try {
		projectStack = detectStack(resolvedRepo, { includeDev: options.includeDev });
	} catch {
		projectStack = [];
	}

	// Execute git log with argument array
	const gitArgs = [
		'log',
		'--use-mailmap',
		'--format=format:__COMMIT__%x00%H%x00%aN%x00%aE%x00%an%x00%ae%x00%aI',
		'--name-only'
	];

	let stdout = '';
	try {
		const res = await execFileAsync('git', gitArgs, {
			cwd: resolvedRepo,
			maxBuffer: 50 * 1024 * 1024,
			encoding: 'utf8'
		});
		stdout = res.stdout;
	} catch (err) {
		const msg = err?.message || String(err);
		// Empty git repo without commits
		if (
			msg.includes('does not have any commits yet') ||
			msg.includes('unknown revision or path not in the working tree')
		) {
			return [];
		}
		if (msg.includes('not a git repository')) {
			throw new Error(`Not a git repository: ${resolvedRepo}`);
		}
		throw err;
	}

	if (!stdout || !stdout.trim()) {
		return [];
	}

	// Parse commits and changed files
	const rawCommits = [];
	const blocks = stdout.split('__COMMIT__\0').filter(Boolean);

	for (const block of blocks) {
		const firstNewline = block.indexOf('\n');
		let header = block;
		let filesStr = '';

		if (firstNewline !== -1) {
			header = block.slice(0, firstNewline);
			filesStr = block.slice(firstNewline + 1);
		}

		const parts = header.split('\0');
		if (parts.length < 6) continue;

		const [hash, aN, aE, an, ae, aI] = parts;
		const files = filesStr
			.split(/\r?\n/)
			.map((f) => normPath(f.trim()))
			.filter(Boolean);

		rawCommits.push({
			hash,
			name: aN.trim(),
			email: aE.trim(),
			rawName: an.trim(),
			rawEmail: ae.trim(),
			date: aI.trim(),
			files
		});
	}

	// Filter bots and group by identity
	const identities = [];

	for (const commit of rawCommits) {
		// Apply mailmap rules
		const mailmapped = applyMailmap(commit.name, commit.email, mailmapRules);
		const effectiveName = mailmapped.name || commit.name;
		const effectiveEmail = mailmapped.email || commit.email;

		// Bot filtering (check both effective and raw identity)
		if (!options.includeBots) {
			if (
				isBot({ name: effectiveName, email: effectiveEmail }) ||
				isBot({ name: commit.rawName, email: commit.rawEmail })
			) {
				continue;
			}
		}

		const normCommitName = normalizeName(effectiveName);
		const normCommitLocal = normalizeLocalPart(effectiveEmail);

		// Find existing matching identity
		let match = null;

		for (const id of identities) {
			// 1. Direct email match
			if (id.emails.some((e) => e.toLowerCase() === effectiveEmail.toLowerCase())) {
				match = id;
				break;
			}

			// 2. Name matches AND email local part matches
			const idNormName = normalizeName(id.name);
			const idNormLocal = normalizeLocalPart(id.email);
			if (idNormName === normCommitName && idNormLocal && idNormLocal === normCommitLocal) {
				match = id;
				break;
			}
		}

		if (match) {
			match.commits += 1;
			if (!match.emails.some((e) => e.toLowerCase() === effectiveEmail.toLowerCase())) {
				match.emails.push(effectiveEmail);
			}
			if (commit.rawEmail && !match.emails.some((e) => e.toLowerCase() === commit.rawEmail.toLowerCase())) {
				match.emails.push(commit.rawEmail);
			}
			if (commit.date < match.firstCommit) {
				match.firstCommit = commit.date;
			}
			if (commit.date > match.lastCommit) {
				match.lastCommit = commit.date;
			}
			for (const f of commit.files) {
				match.filesSet.add(f);
			}
		} else {
			const emails = [effectiveEmail];
			if (commit.rawEmail && commit.rawEmail.toLowerCase() !== effectiveEmail.toLowerCase()) {
				emails.push(commit.rawEmail);
			}
			identities.push({
				name: effectiveName,
				email: effectiveEmail,
				emails,
				commits: 1,
				firstCommit: commit.date,
				lastCommit: commit.date,
				filesSet: new Set(commit.files)
			});
		}
	}

	// Map technologies for each contributor and format output
	const results = identities.map((id) => {
		const files = Array.from(id.filesSet).sort();
		const technologies = mapFilesToTechnologies(id.filesSet, projectStack);

		return {
			name: id.name,
			email: id.email,
			emails: id.emails,
			commits: id.commits,
			firstCommit: id.firstCommit,
			lastCommit: id.lastCommit,
			files,
			technologies
		};
	});

	// Sort contributors by commit count descending, then by lastCommit descending
	return results.sort((a, b) => b.commits - a.commits || b.lastCommit.localeCompare(a.lastCommit));
}

/**
 * Checks if current module is being invoked directly via CLI.
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
 * CLI execution handler.
 */
export async function runCli(argv = process.argv.slice(2)) {
	const repo = argv[0] || '.';
	try {
		const contributors = await getGitContributors(repo);
		process.stdout.write(JSON.stringify(contributors, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
