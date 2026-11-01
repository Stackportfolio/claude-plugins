#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Normalises a git remote URL into a standard https:// URL without trailing .git.
 */
export function normaliseOriginUrl(rawUrl) {
	if (!rawUrl || typeof rawUrl !== 'string') return null;
	let trimmed = rawUrl.trim();

	// Convert SSH git@host:owner/repo.git -> https://host/owner/repo
	const scpMatch = trimmed.match(/^git@([^:]+):(.+?)(\.git)?$/);
	if (scpMatch) {
		return `https://${scpMatch[1]}/${scpMatch[2]}`;
	}

	// Convert ssh://git@host/owner/repo.git -> https://host/owner/repo
	const sshMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/(.+?)(\.git)?$/);
	if (sshMatch) {
		return `https://${sshMatch[1]}/${sshMatch[2]}`;
	}

	// Convert git:// -> https://
	if (trimmed.startsWith('git://')) {
		trimmed = 'https://' + trimmed.slice(6);
	}

	// Strip trailing .git
	trimmed = trimmed.replace(/\.git$/, '');
	// Strip trailing slash
	trimmed = trimmed.replace(/\/$/, '');

	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return trimmed;
	}

	return null;
}

/**
 * Extracts origin remote URL from git repository.
 */
function getGitOrigin(repoDir) {
	const gitEntry = join(repoDir, '.git');
	if (!existsSync(gitEntry)) return null;

	let configContent = null;

	if (statSync(gitEntry).isDirectory()) {
		const cfgPath = join(gitEntry, 'config');
		if (existsSync(cfgPath)) {
			try {
				configContent = readFileSync(cfgPath, 'utf8');
			} catch {
				// ignore
			}
		}
	} else if (statSync(gitEntry).isFile()) {
		// Worktree pointer: gitdir: <path>
		try {
			const pointer = readFileSync(gitEntry, 'utf8').trim();
			const match = pointer.match(/^gitdir:\s*(.+)$/m);
			if (match) {
				const gitDir = resolve(repoDir, match[1]);
				// In worktrees, config may be at <gitDir>/config or parent repo
				for (const candidate of [
					join(gitDir, 'config'),
					join(gitDir, '../config'),
					join(gitDir, '../../config')
				]) {
					if (existsSync(candidate)) {
						configContent = readFileSync(candidate, 'utf8');
						break;
					}
				}
			}
		} catch {
			// ignore
		}
	}

	if (configContent) {
		const remoteMatch = configContent.match(
			/\[remote\s+["']origin["']\][^\[]*?url\s*=\s*([^\r\n]+)/m
		);
		if (remoteMatch) {
			const normalised = normaliseOriginUrl(remoteMatch[1]);
			if (normalised) return normalised;
		}
	}

	// Fallback to git CLI if git is installed
	try {
		const out = execFileSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return normaliseOriginUrl(out);
	} catch {
		return null;
	}
}

/**
 * Extracts repository name from manifests, git origin, or folder.
 */
function extractRepoName(repoDir, originUrl) {
	// 1. package.json name
	const pkgPath = join(repoDir, 'package.json');
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (typeof pkg.name === 'string' && pkg.name.trim()) {
				// Strip scope if present e.g. @org/project -> project
				return pkg.name.replace(/^@[^/]+\//, '').trim();
			}
		} catch {
			// ignore
		}
	}

	// 2. Cargo.toml [package] name
	const cargoPath = join(repoDir, 'Cargo.toml');
	if (existsSync(cargoPath)) {
		try {
			const raw = readFileSync(cargoPath, 'utf8');
			const match = raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
			if (match) return match[1].trim();
		} catch {
			// ignore
		}
	}

	// 3. pyproject.toml name
	const pyprojectPath = join(repoDir, 'pyproject.toml');
	if (existsSync(pyprojectPath)) {
		try {
			const raw = readFileSync(pyprojectPath, 'utf8');
			const match = raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
			if (match) return match[1].trim();
		} catch {
			// ignore
		}
	}

	// 4. go.mod module name
	const goModPath = join(repoDir, 'go.mod');
	if (existsSync(goModPath)) {
		try {
			const raw = readFileSync(goModPath, 'utf8');
			const match = raw.match(/^\s*module\s+([^\s\r\n]+)/m);
			if (match) {
				const parts = match[1].trim().split('/');
				return parts[parts.length - 1];
			}
		} catch {
			// ignore
		}
	}

	// 5. composer.json name
	const compPath = join(repoDir, 'composer.json');
	if (existsSync(compPath)) {
		try {
			const comp = JSON.parse(readFileSync(compPath, 'utf8'));
			if (typeof comp.name === 'string' && comp.name.trim()) {
				const parts = comp.name.trim().split('/');
				return parts[parts.length - 1];
			}
		} catch {
			// ignore
		}
	}

	// 6. Git origin URL last path segment
	if (originUrl) {
		const parts = originUrl.split('/');
		const last = parts[parts.length - 1];
		if (last) return last;
	}

	// 7. Directory basename
	return basename(resolve(repoDir));
}

/**
 * Cleans markdown formatting from paragraph text.
 */
function cleanMarkdownText(text) {
	let cleaned = text;

	// Remove HTML comments
	cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

	// Strip link markup [text](url) -> text
	cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

	// Strip bold and italic **text** or *text*
	cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
	cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
	cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
	cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

	// Strip inline code `code`
	cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

	// Collapse all whitespace into single spaces
	cleaned = cleaned.replace(/\s+/g, ' ').trim();

	return cleaned;
}

/**
 * Extracts the first meaningful paragraph from README.
 */
function extractReadmeParagraph(repoDir) {
	const readmeCandidates = [
		'README.md',
		'README',
		'readme.md',
		'readme.markdown',
		'README.markdown'
	];

	for (const candidate of readmeCandidates) {
		const readmePath = join(repoDir, candidate);
		if (existsSync(readmePath)) {
			try {
				let raw = readFileSync(readmePath, 'utf8');

				// Strip frontmatter if present
				if (raw.startsWith('---')) {
					const secondIdx = raw.indexOf('\n---', 3);
					if (secondIdx !== -1) {
						raw = raw.slice(secondIdx + 4);
					}
				}

				// Split by double newlines into paragraphs
				const paragraphs = raw.split(/\r?\n\s*\r?\n/);

				for (const para of paragraphs) {
					const trimmed = para.trim();
					if (!trimmed) continue;

					// Skip headings
					if (/^#+\s+/.test(trimmed) || /^===+$/.test(trimmed) || /^---+$/.test(trimmed)) {
						continue;
					}

					// Skip paragraphs that only contain badges or images
					const withoutBadges = trimmed
						.replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '')
						.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
						.replace(/<img[^>]*>/g, '')
						.trim();

					if (!withoutBadges) continue;

					const cleaned = cleanMarkdownText(withoutBadges);
					if (cleaned.length > 0) {
						return cleaned;
					}
				}
			} catch {
				// ignore
			}
		}
	}

	// Fallback to manifest descriptions
	const pkgPath = join(repoDir, 'package.json');
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (typeof pkg.description === 'string' && pkg.description.trim()) {
				return pkg.description.trim();
			}
		} catch {
			// ignore
		}
	}

	const pyprojectPath = join(repoDir, 'pyproject.toml');
	if (existsSync(pyprojectPath)) {
		try {
			const raw = readFileSync(pyprojectPath, 'utf8');
			const match = raw.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
			if (match) return match[1].trim();
		} catch {
			// ignore
		}
	}

	return '';
}

/**
 * Extracts deployed URL hints from package.json, CNAME, vercel, netlify.
 */
function extractDeployedHints(repoDir) {
	const hints = [];

	// 1. CNAME / public/CNAME / static/CNAME
	for (const cnameCandidate of ['CNAME', 'public/CNAME', 'static/CNAME']) {
		const cpath = join(repoDir, cnameCandidate);
		if (existsSync(cpath)) {
			try {
				const line = readFileSync(cpath, 'utf8').trim().split(/\r?\n/)[0].trim();
				if (line && !line.startsWith('#')) {
					const url = line.startsWith('http://') || line.startsWith('https://')
						? line
						: `https://${line}`;
					hints.push({ source: 'CNAME', url });
					break;
				}
			} catch {
				// ignore
			}
		}
	}

	// 2. package.json homepage
	const pkgPath = join(repoDir, 'package.json');
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (typeof pkg.homepage === 'string' && pkg.homepage.trim()) {
				const hp = pkg.homepage.trim();
				if (hp.startsWith('http://') || hp.startsWith('https://')) {
					// Avoid adding repository URLs as deployed URLs
					if (!hp.includes('github.com/') && !hp.includes('gitlab.com/')) {
						hints.push({ source: 'package.json:homepage', url: hp });
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// 3. vercel.json alias / domains
	const vercelPath = join(repoDir, 'vercel.json');
	if (existsSync(vercelPath)) {
		try {
			const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));
			if (vercel.alias) {
				const aliases = Array.isArray(vercel.alias) ? vercel.alias : [vercel.alias];
				for (const a of aliases) {
					if (typeof a === 'string' && a.trim()) {
						const url = a.startsWith('http://') || a.startsWith('https://')
							? a.trim()
							: `https://${a.trim()}`;
						hints.push({ source: 'vercel.json:alias', url });
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// 4. netlify.toml
	const netlifyPath = join(repoDir, 'netlify.toml');
	if (existsSync(netlifyPath)) {
		try {
			const raw = readFileSync(netlifyPath, 'utf8');
			const match = raw.match(/^\s*URL\s*=\s*["']([^"']+)["']/m);
			if (match) {
				hints.push({ source: 'netlify.toml', url: match[1].trim() });
			}
		} catch {
			// ignore
		}
	}

	return hints;
}

/**
 * Gathers repo facts: name, description, origin URL, deployed URL hints.
 *
 * @param {string} repoPath
 * @returns {{
 *   name: string,
 *   description: string,
 *   origin: string|null,
 *   originUrl: string|null,
 *   deployedUrl: string|null,
 *   deployedUrlHints: Array<{ source: string, url: string }>
 * }}
 */
export function getRepoFacts(repoPath) {
	const resolvedRepo = resolve(repoPath || '.');
	if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
		throw new Error(`Directory not found: ${resolvedRepo}`);
	}

	const originUrl = getGitOrigin(resolvedRepo);
	const name = extractRepoName(resolvedRepo, originUrl);
	const description = extractReadmeParagraph(resolvedRepo);
	const deployedUrlHints = extractDeployedHints(resolvedRepo);
	const deployedUrl = deployedUrlHints.length > 0 ? deployedUrlHints[0].url : null;

	return {
		name,
		description,
		origin: originUrl,
		originUrl,
		deployedUrl,
		deployedUrlHints
	};
}

// CLI execution check
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
	const repo = process.argv[2] || '.';
	try {
		const facts = getRepoFacts(repo);
		process.stdout.write(JSON.stringify(facts, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}
