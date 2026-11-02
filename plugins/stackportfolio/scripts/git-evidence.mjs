#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Aligns with Stackportfolio contribution story API operation:
 * src/lib/server/api/operations/contribution-stories.ts:141 (saveContributionStory)
 */

/**
 * Aligns with story schema and field bounds:
 * src/lib/schemas/story.ts:20 (contributionStoryApiSchema)
 */

/**
 * MCP tool definition for saving contribution stories:
 * src/lib/server/mcp/tools.ts:403 (save_contribution_story)
 */

/**
 * Extension to language mapping for repository evidence.
 */
export const EXTENSION_MAP = {
	'.ts': 'TypeScript',
	'.tsx': 'TypeScript',
	'.mts': 'TypeScript',
	'.cts': 'TypeScript',
	'.js': 'JavaScript',
	'.jsx': 'JavaScript',
	'.mjs': 'JavaScript',
	'.cjs': 'JavaScript',
	'.svelte': 'Svelte',
	'.vue': 'Vue',
	'.py': 'Python',
	'.pyw': 'Python',
	'.go': 'Go',
	'.rs': 'Rust',
	'.rb': 'Ruby',
	'.php': 'PHP',
	'.java': 'Java',
	'.kt': 'Kotlin',
	'.kts': 'Kotlin',
	'.cs': 'C#',
	'.cpp': 'C++',
	'.cc': 'C++',
	'.cxx': 'C++',
	'.hpp': 'C++',
	'.hh': 'C++',
	'.c': 'C',
	'.h': 'C',
	'.swift': 'Swift',
	'.scala': 'Scala',
	'.dart': 'Dart',
	'.ex': 'Elixir',
	'.exs': 'Elixir',
	'.erl': 'Erlang',
	'.hrl': 'Erlang',
	'.clj': 'Clojure',
	'.cljs': 'Clojure',
	'.lua': 'Lua',
	'.r': 'R',
	'.jl': 'Julia',
	'.sh': 'Shell',
	'.bash': 'Shell',
	'.zsh': 'Shell',
	'.fish': 'Shell',
	'.html': 'HTML',
	'.htm': 'HTML',
	'.css': 'CSS',
	'.scss': 'SCSS',
	'.sass': 'Sass',
	'.less': 'Less',
	'.sql': 'SQL',
	'.graphql': 'GraphQL',
	'.gql': 'GraphQL',
	'.json': 'JSON',
	'.yaml': 'YAML',
	'.yml': 'YAML',
	'.toml': 'TOML',
	'.xml': 'XML',
	'.md': 'Markdown',
	'.markdown': 'Markdown',
	'.mdx': 'Markdown'
};

/**
 * Normalises git numstat file paths, resolving git rename arrows.
 */
export function normalizeNumstatPath(rawPath) {
	if (!rawPath || typeof rawPath !== 'string') return '';
	const trimmed = rawPath.trim();
	if (!trimmed.includes('=>')) return trimmed;

	if (trimmed.includes('{') && trimmed.includes('}')) {
		return trimmed.replace(/\{.*?=>\s*(.*?)\}/g, '$1').replace(/\/\//g, '/').trim();
	}
	const parts = trimmed.split('=>');
	return parts[parts.length - 1].trim();
}

/**
 * Extracts co-author email addresses from commit body trailers.
 */
export function extractCoAuthorEmails(body) {
	if (!body || typeof body !== 'string') return [];
	const emails = [];
	const matches = body.matchAll(
		/(?:co-authored-by|co-author):\s*(?:[^<\r\n]*<)?([^>\r\n\s]+)>?/gi
	);
	for (const match of matches) {
		if (match[1]) {
			emails.push(match[1].trim().toLowerCase());
		}
	}
	return emails;
}

/**
 * Detects the programming or markup language from a file path.
 */
export function detectFileLanguage(filePath) {
	const base = basename(filePath).toLowerCase();
	if (base === 'dockerfile' || base.startsWith('dockerfile.') || base.endsWith('.dockerfile')) {
		return 'Docker';
	}
	if (base === 'makefile' || base.endsWith('.mk')) {
		return 'Makefile';
	}
	const ext = extname(filePath).toLowerCase();
	return EXTENSION_MAP[ext] || null;
}

/**
 * Collects deterministic git evidence for the target author email(s) from git log.
 *
 * @param {object} options
 * @param {string} options.repoDir - Directory of the git repository to inspect.
 * @param {string[]|string} options.author - One or more author email addresses.
 * @returns {Promise<object>} Deterministic evidence summary object.
 */
export async function collectGitEvidence({ repoDir, author }) {
	const targetRepo = resolve(process.cwd(), repoDir || '.');

	if (!existsSync(targetRepo) || !statSync(targetRepo).isDirectory()) {
		throw new Error(`Repository path does not exist or is not a directory: ${targetRepo}`);
	}

	const rawEmails = Array.isArray(author)
		? author
		: typeof author === 'string'
			? author.split(',')
			: [];

	const authorEmails = rawEmails
		.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
		.filter(Boolean);

	if (authorEmails.length === 0) {
		throw new Error('At least one author email must be specified via --author');
	}

	const targetEmailSet = new Set(authorEmails);

	// Format: %x1e (record sep) + hash, authorEmail, authorDate, committerEmail, committerDate, subject, body + %x1f
	// Followed on following lines by numstat output.
	const logFormat = '%x1e%H%x1f%aE%x1f%aI%x1f%cE%x1f%cI%x1f%s%x1f%b%x1f';
	let stdout = '';

	try {
		const res = await execFileAsync(
			'git',
			['log', '--all', '--numstat', `--format=${logFormat}`],
			{
				cwd: targetRepo,
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024
			}
		);
		stdout = res.stdout;
	} catch (err) {
		// Empty repo or no commits reachable from --all
		const msg = (err.message || '') + (err.stderr || '');
		if (
			msg.includes('does not have any commits') ||
			msg.includes('unknown revision') ||
			msg.includes('fatal: bad default revision')
		) {
			return {
				authorEmails,
				commitCount: 0,
				firstCommitDate: null,
				lastCommitDate: null,
				activeSpan: null,
				filesTouched: [],
				fileCount: 0,
				areasTouched: [],
				areas: {},
				topLanguages: [],
				languages: {},
				prRefs: [],
				prNumbers: [],
				mergeRefs: []
			};
		}
		throw new Error(`Failed to read git log: ${err.message}`);
	}

	const records = stdout.split('\x1e').filter(Boolean);

	let matchingCommitsCount = 0;
	let earliestMs = null;
	let latestMs = null;
	let earliestDateStr = null;
	let latestDateStr = null;

	const touchedFilesMap = new Map(); // path -> { added, deleted, commits }
	const touchedAreasMap = new Map(); // area -> { files: Set, changedLines, commits }
	const languageStats = new Map(); // language -> { changedLines, linesAdded, linesDeleted }
	const prRefsSet = new Set();
	const prNumbersSet = new Set();
	const mergeRefsSet = new Set();

	for (const record of records) {
		const parts = record.split('\x1f');
		if (parts.length < 7) continue;

		const hash = parts[0]?.trim();
		const authorEmail = parts[1]?.trim().toLowerCase();
		const authorDateStr = parts[2]?.trim();
		const committerEmail = parts[3]?.trim().toLowerCase();
		const committerDateStr = parts[4]?.trim();
		const subject = parts[5]?.trim() || '';
		const body = parts[6]?.trim() || '';
		const numstatRaw = parts[7] || '';

		const coAuthors = extractCoAuthorEmails(body);

		const isAuthorMatch =
			targetEmailSet.has(authorEmail) ||
			targetEmailSet.has(committerEmail) ||
			coAuthors.some((e) => targetEmailSet.has(e));

		if (!isAuthorMatch) continue;

		matchingCommitsCount += 1;

		// Track active dates (author date prioritized, fallback to committer date)
		const effectiveDateStr = authorDateStr || committerDateStr;
		if (effectiveDateStr) {
			const ms = Date.parse(effectiveDateStr);
			if (!Number.isNaN(ms)) {
				if (earliestMs === null || ms < earliestMs) {
					earliestMs = ms;
					earliestDateStr = effectiveDateStr;
				}
				if (latestMs === null || ms > latestMs) {
					latestMs = ms;
					latestDateStr = effectiveDateStr;
				}
			}
		}

		// Extract PR and merge references from subject and body
		const fullMessage = `${subject}\n${body}`;

		// 1. Merge PR patterns: "Merge pull request #123", "Merge PR #123"
		const mergeMatches = fullMessage.matchAll(/Merge (?:pull request|PR) #(\d+)[^\r\n]*/gi);
		for (const m of mergeMatches) {
			const num = parseInt(m[1], 10);
			if (!Number.isNaN(num)) {
				prNumbersSet.add(num);
				prRefsSet.add(`#${num}`);
			}
			mergeRefsSet.add(m[0].trim());
		}

		// 2. All PR / issue references: #123
		const prMatches = fullMessage.matchAll(/#(\d+)\b/g);
		for (const m of prMatches) {
			const num = parseInt(m[1], 10);
			if (!Number.isNaN(num)) {
				prNumbersSet.add(num);
				prRefsSet.add(`#${num}`);
			}
		}

		// Parse numstat lines
		const numstatLines = numstatRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
		const seenFilesInCommit = new Set();

		for (const line of numstatLines) {
			const cols = line.split('\t');
			if (cols.length < 3) continue;

			const addedStr = cols[0].trim();
			const deletedStr = cols[1].trim();
			const rawPath = cols.slice(2).join('\t');

			const filePath = normalizeNumstatPath(rawPath);
			if (!filePath) continue;

			const added = addedStr === '-' ? 0 : parseInt(addedStr, 10) || 0;
			const deleted = deletedStr === '-' ? 0 : parseInt(deletedStr, 10) || 0;
			const changed = added + deleted;

			// File stats
			if (!touchedFilesMap.has(filePath)) {
				touchedFilesMap.set(filePath, { added: 0, deleted: 0, changed: 0, commits: 0 });
			}
			const fileStat = touchedFilesMap.get(filePath);
			fileStat.added += added;
			fileStat.deleted += deleted;
			fileStat.changed += changed;
			if (!seenFilesInCommit.has(filePath)) {
				fileStat.commits += 1;
				seenFilesInCommit.add(filePath);
			}

			// Area stats
			const area = filePath.includes('/') ? filePath.split('/')[0] : 'root';
			if (!touchedAreasMap.has(area)) {
				touchedAreasMap.set(area, { files: new Set(), changedLines: 0, commits: 0 });
			}
			const areaStat = touchedAreasMap.get(area);
			areaStat.files.add(filePath);
			areaStat.changedLines += changed;

			// Language stats
			const lang = detectFileLanguage(filePath);
			if (lang) {
				if (!languageStats.has(lang)) {
					languageStats.set(lang, { changedLines: 0, linesAdded: 0, linesDeleted: 0 });
				}
				const lStat = languageStats.get(lang);
				lStat.changedLines += changed;
				lStat.linesAdded += added;
				lStat.linesDeleted += deleted;
			}
		}

		// Count commits per area touched in this commit
		const areasInCommit = new Set(
			Array.from(seenFilesInCommit).map((f) => (f.includes('/') ? f.split('/')[0] : 'root'))
		);
		for (const area of areasInCommit) {
			const aStat = touchedAreasMap.get(area);
			if (aStat) aStat.commits += 1;
		}
	}

	// Calculate active span
	let activeSpan = null;
	if (matchingCommitsCount > 0 && earliestDateStr && latestDateStr) {
		const diffMs = Math.abs(latestMs - earliestMs);
		const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
		activeSpan = {
			first: earliestDateStr,
			last: latestDateStr,
			days
		};
	}

	// Prepare files touched
	const filesTouched = Array.from(touchedFilesMap.keys()).sort();

	// Prepare areas touched
	const areasTouched = Array.from(touchedAreasMap.keys()).sort();
	const areas = {};
	for (const [areaName, stat] of touchedAreasMap.entries()) {
		areas[areaName] = {
			files: stat.files.size,
			changedLines: stat.changedLines,
			commits: stat.commits
		};
	}

	// Prepare top languages sorted descending by changedLines
	const topLanguages = Array.from(languageStats.entries())
		.map(([language, stat]) => ({
			language,
			changedLines: stat.changedLines,
			linesAdded: stat.linesAdded,
			linesDeleted: stat.linesDeleted
		}))
		.sort((a, b) => b.changedLines - a.changedLines);

	const languages = {};
	for (const l of topLanguages) {
		languages[l.language] = l.changedLines;
	}

	// Prepare sorted PR numbers and refs
	const prNumbers = Array.from(prNumbersSet).sort((a, b) => a - b);
	const prRefs = prNumbers.map((n) => `#${n}`);
	const mergeRefs = Array.from(mergeRefsSet).sort();

	return {
		authorEmails,
		commitCount: matchingCommitsCount,
		firstCommitDate: earliestDateStr,
		lastCommitDate: latestDateStr,
		activeSpan,
		filesTouched,
		fileCount: filesTouched.length,
		areasTouched,
		areas,
		topLanguages,
		languages,
		prRefs,
		prNumbers,
		mergeRefs
	};
}

/**
 * CLI execution entrypoint.
 */
async function main() {
	const args = process.argv.slice(2);
	let repoDir = '.';
	const authorArgs = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--help' || arg === '-h') {
			console.log(
				'Usage: git-evidence.mjs [<repo-dir>] --author <email>[,<email>...]\n\n' +
					'Inspects git history and outputs deterministic JSON evidence of contributions.'
			);
			process.exit(0);
		}
		if (arg === '--author') {
			i += 1;
			if (i < args.length) authorArgs.push(args[i]);
		} else if (arg.startsWith('--author=')) {
			authorArgs.push(arg.slice('--author='.length));
		} else if (!arg.startsWith('-')) {
			repoDir = arg;
		}
	}

	if (authorArgs.length === 0) {
		console.error('Error: missing required argument --author <email>[,<email>...]');
		console.error('Usage: git-evidence.mjs [<repo-dir>] --author <email>[,<email>...]');
		process.exit(1);
	}

	try {
		const evidence = await collectGitEvidence({
			repoDir,
			author: authorArgs.join(',')
		});
		console.log(JSON.stringify(evidence, null, 2));
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFilePath)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
