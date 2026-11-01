#!/usr/bin/env node
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Extracts origin remote URL from git repository using pure fs.
 * Handles both standard .git directories and git worktree gitdir: pointers.
 */
function getGitOrigin(repoDir) {
	const gitEntry = join(repoDir, '.git');
	if (!existsSync(gitEntry)) return null;

	let configContent = null;

	try {
		if (statSync(gitEntry).isDirectory()) {
			const cfgPath = join(gitEntry, 'config');
			if (existsSync(cfgPath)) {
				configContent = readFileSync(cfgPath, 'utf8');
			}
		} else if (statSync(gitEntry).isFile()) {
			// Worktree pointer: gitdir: <path>
			const pointer = readFileSync(gitEntry, 'utf8').trim();
			const match = pointer.match(/^gitdir:\s*(.+)$/m);
			if (match) {
				const gitDir = resolve(repoDir, match[1]);

				// Check for commondir inside gitDir
				let commondir = null;
				const commondirPath = join(gitDir, 'commondir');
				if (existsSync(commondirPath)) {
					try {
						const cd = readFileSync(commondirPath, 'utf8').trim();
						commondir = resolve(gitDir, cd);
					} catch {
						// ignore
					}
				}

				const candidates = [
					join(gitDir, 'config.worktree'),
					join(gitDir, 'config'),
					commondir && join(commondir, 'config'),
					join(gitDir, '../config'),
					join(gitDir, '../../config')
				].filter(Boolean);

				for (const candidate of candidates) {
					if (existsSync(candidate)) {
						try {
							const c = readFileSync(candidate, 'utf8');
							if (c && /\[remote\s+["']origin["']\]/m.test(c)) {
								configContent = c;
								break;
							}
							if (!configContent) {
								configContent = c;
							}
						} catch {
							// ignore
						}
					}
				}
			}
		}
	} catch {
		return null;
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

	return null;
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
 * Cleans markdown formatting and HTML tags/comments from paragraph text.
 */
export function cleanMarkdownText(text) {
	if (!text || typeof text !== 'string') return '';
	let cleaned = text;

	// Remove HTML comments
	cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

	// Remove script and style tags
	cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
	cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

	// Remove HTML headings (<h1...>...</h1> to <h6...>...</h6>)
	cleaned = cleaned.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '');

	// Remove standalone markdown headings inside the block
	cleaned = cleaned.replace(/^#+\s+[^\r\n]*/gm, '');

	// Remove HTML images
	cleaned = cleaned.replace(/<img[^>]*>/gi, '');

	// Strip linked markdown badges and images
	cleaned = cleaned.replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '');
	cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

	// Strip link markup [text](url) -> text
	cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

	// Strip all remaining HTML tags
	cleaned = cleaned.replace(/<[^>]+>/g, '');

	// Decode common HTML entities
	cleaned = cleaned
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ');

	// Strip bold and italic **text** or *text* or __text__ or _text_
	cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
	cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
	cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
	cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

	// Strip inline code `code`
	cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

	// Strip leading blockquote indicators
	cleaned = cleaned.replace(/^>\s*/gm, '');

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

					// Skip headings or divider lines
					if (/^#+\s+/.test(trimmed) || /^===+$/.test(trimmed) || /^---+$/.test(trimmed)) {
						continue;
					}

					const cleaned = cleanMarkdownText(trimmed);
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
export function isMainModule(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return fileURLToPath(metaUrl) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

export function runCli(argv = process.argv.slice(2)) {
	const repo = argv[0] || '.';
	try {
		const facts = getRepoFacts(repo);
		process.stdout.write(JSON.stringify(facts, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
