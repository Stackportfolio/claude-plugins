#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	matchDependency,
	DOCKER_IMAGE_MAP,
	TF_PROVIDER_MAP,
	GH_ACTION_MAP
} from './alias-table.mjs';

/**
 * Normalises file paths to forward slashes for cross-platform consistency.
 */
function normPath(p) {
	return p.replace(/\\/g, '/');
}

/**
 * Finds the 1-indexed line number matching a regex in file lines.
 */
function findLineNumber(lines, regex, startIndex = 0) {
	for (let i = startIndex; i < lines.length; i++) {
		if (regex.test(lines[i])) {
			return i + 1;
		}
	}
	return 1;
}

/**
 * Safe JSON reader returning parsed object and lines.
 */
function readJsonAndLines(filePath) {
	try {
		const raw = readFileSync(filePath, 'utf8');
		const lines = raw.split(/\r?\n/);
		return { data: JSON.parse(raw), lines, raw };
	} catch {
		return null;
	}
}

/**
 * Scans package.json and related node configs.
 */
function scanNode(repoDir, options, detected) {
	const pkgPath = join(repoDir, 'package.json');
	if (existsSync(pkgPath)) {
		const parsed = readJsonAndLines(pkgPath);
		if (parsed) {
			const { data, lines } = parsed;

			// dependencies
			const depGroups = [
				{ deps: data.dependencies, isDev: false },
				{ deps: data.peerDependencies, isDev: false },
				{ deps: data.optionalDependencies, isDev: false },
				{ deps: data.devDependencies, isDev: true }
			];

			for (const group of depGroups) {
				if (!group.deps || typeof group.deps !== 'object') continue;
				for (const depName of Object.keys(group.deps)) {
					const match = matchDependency(depName, group.isDev, options);
					if (match) {
						// Look for `"depName"`: in lines
						const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
						const line = findLineNumber(lines, new RegExp(`["']${escaped}["']\\s*:`));
						detected.push({
							name: match.name,
							evidence: `package.json:${line}`,
							kind: match.kind
						});
					}
				}
			}

			// engines: node
			if (data.engines && data.engines.node) {
				const line = findLineNumber(lines, /["']node["']\s*:/);
				detected.push({
					name: 'Node.js',
					evidence: `package.json:${line}`,
					kind: 'runtime'
				});
			}

			// Node.js presence from package.json if not already added
			if (!detected.some((d) => d.name === 'Node.js')) {
				detected.push({
					name: 'Node.js',
					evidence: 'package.json:1',
					kind: 'runtime'
				});
			}
		}
	}

	// tsconfig.json -> TypeScript
	const tsconfigPath = join(repoDir, 'tsconfig.json');
	if (existsSync(tsconfigPath)) {
		detected.push({
			name: 'TypeScript',
			evidence: 'tsconfig.json:1',
			kind: 'runtime'
		});
	}

	// svelte.config.js / svelte.config.ts -> SvelteKit / Svelte
	for (const svelteCfg of ['svelte.config.js', 'svelte.config.ts']) {
		if (existsSync(join(repoDir, svelteCfg))) {
			detected.push({
				name: 'SvelteKit',
				evidence: `${svelteCfg}:1`,
				kind: 'framework'
			});
			break;
		}
	}

	// next.config.* -> Next.js
	for (const nextCfg of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
		if (existsSync(join(repoDir, nextCfg))) {
			detected.push({
				name: 'Next.js',
				evidence: `${nextCfg}:1`,
				kind: 'framework'
			});
			break;
		}
	}

	// Lockfile runtime / tool evidence
	if (existsSync(join(repoDir, 'bun.lockb')) || existsSync(join(repoDir, 'bun.lock'))) {
		const f = existsSync(join(repoDir, 'bun.lockb')) ? 'bun.lockb' : 'bun.lock';
		detected.push({
			name: 'Bun',
			evidence: `${f}:1`,
			kind: 'runtime'
		});
	}

	for (const denoFile of ['deno.json', 'deno.jsonc', 'deno.lock']) {
		if (existsSync(join(repoDir, denoFile))) {
			detected.push({
				name: 'Deno',
				evidence: `${denoFile}:1`,
				kind: 'runtime'
			});
			break;
		}
	}
}

/**
 * Scans Python projects (pyproject.toml, requirements*.txt, Pipfile, .python-version).
 */
function scanPython(repoDir, options, detected) {
	let hasPython = false;

	const pyVersionPath = join(repoDir, '.python-version');
	if (existsSync(pyVersionPath)) {
		hasPython = true;
		detected.push({
			name: 'Python',
			evidence: '.python-version:1',
			kind: 'runtime'
		});
	}

	const pyprojectPath = join(repoDir, 'pyproject.toml');
	if (existsSync(pyprojectPath)) {
		hasPython = true;
		try {
			const raw = readFileSync(pyprojectPath, 'utf8');
			const lines = raw.split(/\r?\n/);

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line || line.startsWith('#')) continue;

				// Matches e.g. "fastapi>=0.100", "django", or poetry `django = "^4.0"`
				const tomlDepMatch = line.match(/^([a-zA-Z0-9_\-@/]+)\s*(=|>=|<=|==|~=|\^)/) ||
					line.match(/^["']([a-zA-Z0-9_\-@/]+)(?:[=<>!~^].*)?["']/);

				if (tomlDepMatch) {
					const dep = tomlDepMatch[1];
					const match = matchDependency(dep, false, options);
					if (match) {
						detected.push({
							name: match.name,
							evidence: `pyproject.toml:${i + 1}`,
							kind: match.kind
						});
					}
				}
			}
		} catch {
			// ignore read failure
		}
	}

	// Search for requirements*.txt or Pipfile
	const files = readdirSync(repoDir);
	for (const file of files) {
		if (file === 'Pipfile' || (file.startsWith('requirements') && file.endsWith('.txt'))) {
			hasPython = true;
			const isDev = file.includes('dev') || file.includes('test');
			try {
				const raw = readFileSync(join(repoDir, file), 'utf8');
				const lines = raw.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i].trim();
					if (!line || line.startsWith('#') || line.startsWith('-')) continue;

					const dep = line.split(/[=<>!~;@\s]/)[0].trim();
					if (dep) {
						const match = matchDependency(dep, isDev, options);
						if (match) {
							detected.push({
								name: match.name,
								evidence: `${file}:${i + 1}`,
								kind: match.kind
							});
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}

	if (hasPython && !detected.some((d) => d.name === 'Python')) {
		const ev = existsSync(pyprojectPath)
			? 'pyproject.toml:1'
			: existsSync(join(repoDir, 'requirements.txt'))
				? 'requirements.txt:1'
				: 'setup.py:1';
		detected.push({
			name: 'Python',
			evidence: ev,
			kind: 'runtime'
		});
	}
}

/**
 * Scans Go projects (go.mod).
 */
function scanGo(repoDir, _options, detected) {
	const goModPath = join(repoDir, 'go.mod');
	if (existsSync(goModPath)) {
		try {
			const raw = readFileSync(goModPath, 'utf8');
			const lines = raw.split(/\r?\n/);
			let goLine = 1;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('go ')) {
					goLine = i + 1;
				}

				// Check require modules
				for (const [mod, entry] of [
					['github.com/gin-gonic/gin', { name: 'Gin', kind: 'framework' }],
					['github.com/labstack/echo', { name: 'Echo', kind: 'framework' }],
					['github.com/gofiber/fiber', { name: 'Fiber', kind: 'framework' }],
					['github.com/lib/pq', { name: 'PostgreSQL', kind: 'db' }],
					['github.com/jackc/pgx', { name: 'PostgreSQL', kind: 'db' }],
					['github.com/go-sql-driver/mysql', { name: 'MySQL', kind: 'db' }],
					['github.com/mattn/go-sqlite3', { name: 'SQLite', kind: 'db' }],
					['github.com/redis/go-redis', { name: 'Redis', kind: 'db' }],
					['gorm.io/gorm', { name: 'GORM', kind: 'db' }],
					['go.mongodb.org/mongo-driver', { name: 'MongoDB', kind: 'db' }]
				]) {
					if (line.includes(mod)) {
						detected.push({
							name: entry.name,
							evidence: `go.mod:${i + 1}`,
							kind: entry.kind
						});
					}
				}
			}

			detected.push({
				name: 'Go',
				evidence: `go.mod:${goLine}`,
				kind: 'runtime'
			});
		} catch {
			// ignore
		}
	}
}

/**
 * Scans Rust projects (Cargo.toml).
 */
function scanCargo(repoDir, options, detected) {
	const cargoPath = join(repoDir, 'Cargo.toml');
	if (existsSync(cargoPath)) {
		try {
			const raw = readFileSync(cargoPath, 'utf8');
			const lines = raw.split(/\r?\n/);
			let isDevSection = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('[') && line.endsWith(']')) {
					isDevSection = line.includes('dev-dependencies');
					continue;
				}

				const match = line.match(/^([a-zA-Z0-9_\-]+)\s*=/);
				if (match) {
					const crateName = match[1];
					const res = matchDependency(crateName, isDevSection, options);
					if (res) {
						detected.push({
							name: res.name,
							evidence: `Cargo.toml:${i + 1}`,
							kind: res.kind
						});
					}
				}
			}

			detected.push({
				name: 'Rust',
				evidence: 'Cargo.toml:1',
				kind: 'runtime'
			});
		} catch {
			// ignore
		}
	}
}

/**
 * Scans Ruby projects (Gemfile).
 */
function scanRuby(repoDir, options, detected) {
	const gemfilePath = join(repoDir, 'Gemfile');
	if (existsSync(gemfilePath)) {
		try {
			const raw = readFileSync(gemfilePath, 'utf8');
			const lines = raw.split(/\r?\n/);
			let rubyLine = 1;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('ruby ')) {
					rubyLine = i + 1;
				}

				const gemMatch = line.match(/^gem\s+['"]([^'"]+)['"]/);
				if (gemMatch) {
					const gemName = gemMatch[1];
					const res = matchDependency(gemName, false, options);
					if (res) {
						detected.push({
							name: res.name,
							evidence: `Gemfile:${i + 1}`,
							kind: res.kind
						});
					}
				}
			}

			detected.push({
				name: 'Ruby',
				evidence: `Gemfile:${rubyLine}`,
				kind: 'runtime'
			});
		} catch {
			// ignore
		}
	}
}

/**
 * Scans PHP projects (composer.json).
 */
function scanPhp(repoDir, options, detected) {
	const compPath = join(repoDir, 'composer.json');
	if (existsSync(compPath)) {
		const parsed = readJsonAndLines(compPath);
		if (parsed) {
			const { data, lines } = parsed;

			const depGroups = [
				{ deps: data.require, isDev: false },
				{ deps: data['require-dev'], isDev: true }
			];

			for (const group of depGroups) {
				if (!group.deps || typeof group.deps !== 'object') continue;
				for (const depName of Object.keys(group.deps)) {
					const match = matchDependency(depName, group.isDev, options);
					if (match) {
						const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
						const line = findLineNumber(lines, new RegExp(`["']${escaped}["']\\s*:`));
						detected.push({
							name: match.name,
							evidence: `composer.json:${line}`,
							kind: match.kind
						});
					}
				}
			}

			detected.push({
				name: 'PHP',
				evidence: 'composer.json:1',
				kind: 'runtime'
			});
		}
	}
}

/**
 * Scans Dockerfiles and Docker Compose files.
 */
function scanDocker(repoDir, _options, detected) {
	// Dockerfiles
	const files = readdirSync(repoDir);
	for (const file of files) {
		if (
			file === 'Dockerfile' ||
			file === 'Containerfile' ||
			file.startsWith('Dockerfile.') ||
			file.endsWith('.Dockerfile')
		) {
			detected.push({
				name: 'Docker',
				evidence: `${file}:1`,
				kind: 'infra'
			});

			try {
				const raw = readFileSync(join(repoDir, file), 'utf8');
				const lines = raw.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const match = lines[i].match(/^FROM\s+([^\s:]+)(?::([^\s]+))?/i);
					if (match) {
						const image = match[1].toLowerCase();
						const baseImage = image.split('/').pop();
						const mapped = DOCKER_IMAGE_MAP[image] || DOCKER_IMAGE_MAP[baseImage];
						if (mapped) {
							detected.push({
								name: mapped.name,
								evidence: `${file}:${i + 1}`,
								kind: mapped.kind
							});
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}

	// Compose files
	for (const composeFile of [
		'compose.yaml',
		'compose.yml',
		'docker-compose.yaml',
		'docker-compose.yml'
	]) {
		const fullPath = join(repoDir, composeFile);
		if (existsSync(fullPath)) {
			detected.push({
				name: 'Docker Compose',
				evidence: `${composeFile}:1`,
				kind: 'infra'
			});

			try {
				const raw = readFileSync(fullPath, 'utf8');
				const lines = raw.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const match = lines[i].match(/^\s*image:\s*([^\s:]+)(?::([^\s]+))?/);
					if (match) {
						const image = match[1].toLowerCase();
						const baseImage = image.split('/').pop();
						const mapped = DOCKER_IMAGE_MAP[image] || DOCKER_IMAGE_MAP[baseImage];
						if (mapped) {
							detected.push({
								name: mapped.name,
								evidence: `${composeFile}:${i + 1}`,
								kind: mapped.kind
							});
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}
}

/**
 * Scans CI/CD configurations (.github/workflows, .gitlab-ci.yml, etc.).
 */
function scanCi(repoDir, _options, detected) {
	// GitHub Actions
	const ghDir = join(repoDir, '.github/workflows');
	if (existsSync(ghDir) && statSync(ghDir).isDirectory()) {
		try {
			const wfFiles = readdirSync(ghDir).filter(
				(f) => f.endsWith('.yml') || f.endsWith('.yaml')
			);
			for (const wf of wfFiles) {
				const relPath = `.github/workflows/${wf}`;
				detected.push({
					name: 'GitHub Actions',
					evidence: `${relPath}:1`,
					kind: 'infra'
				});

				const raw = readFileSync(join(ghDir, wf), 'utf8');
				const lines = raw.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];

					// Check action uses
					for (const act of GH_ACTION_MAP) {
						if (act.pattern.test(line)) {
							detected.push({
								name: act.name,
								evidence: `${relPath}:${i + 1}`,
								kind: act.kind
							});
						}
					}

					// Check services
					if (/services:\s*$/i.test(line) || /image:\s*postgres/i.test(line)) {
						if (/postgres/i.test(line)) {
							detected.push({
								name: 'PostgreSQL',
								evidence: `${relPath}:${i + 1}`,
								kind: 'db'
							});
						}
					}
				}
			}
		} catch {
			// ignore
		}
	}

	if (existsSync(join(repoDir, '.gitlab-ci.yml'))) {
		detected.push({
			name: 'GitLab CI',
			evidence: '.gitlab-ci.yml:1',
			kind: 'infra'
		});
	}

	if (existsSync(join(repoDir, '.circleci/config.yml'))) {
		detected.push({
			name: 'CircleCI',
			evidence: '.circleci/config.yml:1',
			kind: 'infra'
		});
	}
}

/**
 * Scans Infrastructure as Code files (Terraform, Pulumi, Serverless, Vercel, Netlify).
 */
function scanIac(repoDir, _options, detected) {
	// Terraform / OpenTofu
	const files = readdirSync(repoDir);
	for (const file of files) {
		if (file.endsWith('.tf') || file.endsWith('.tofu')) {
			detected.push({
				name: 'Terraform',
				evidence: `${file}:1`,
				kind: 'infra'
			});

			try {
				const raw = readFileSync(join(repoDir, file), 'utf8');
				const lines = raw.split(/\r?\n/);
				for (let i = 0; i < lines.length; i++) {
					const match = lines[i].match(/^\s*provider\s+["']([^"']+)["']/);
					if (match) {
						const prov = match[1].toLowerCase();
						const mapped = TF_PROVIDER_MAP[prov];
						if (mapped) {
							detected.push({
								name: mapped.name,
								evidence: `${file}:${i + 1}`,
								kind: mapped.kind
							});
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}

	if (existsSync(join(repoDir, 'Pulumi.yaml'))) {
		detected.push({
			name: 'Pulumi',
			evidence: 'Pulumi.yaml:1',
			kind: 'infra'
		});
	}

	for (const sls of ['serverless.yml', 'serverless.yaml']) {
		if (existsSync(join(repoDir, sls))) {
			detected.push({
				name: 'Serverless Framework',
				evidence: `${sls}:1`,
				kind: 'infra'
			});
			break;
		}
	}

	if (existsSync(join(repoDir, 'vercel.json'))) {
		detected.push({
			name: 'Vercel',
			evidence: 'vercel.json:1',
			kind: 'infra'
		});
	}

	if (existsSync(join(repoDir, 'netlify.toml'))) {
		detected.push({
			name: 'Netlify',
			evidence: 'netlify.toml:1',
			kind: 'infra'
		});
	}

	for (const w of ['wrangler.toml', 'wrangler.json']) {
		if (existsSync(join(repoDir, w))) {
			detected.push({
				name: 'Cloudflare',
				evidence: `${w}:1`,
				kind: 'infra'
			});
			break;
		}
	}

	if (existsSync(join(repoDir, 'fly.toml'))) {
		detected.push({
			name: 'Fly.io',
			evidence: 'fly.toml:1',
			kind: 'infra'
		});
	}
}

/**
 * Assigns an evidentiary priority weight to evidence paths.
 * Higher number = stronger evidence to retain on deduplication.
 */
function getEvidencePriority(evidence) {
	const file = evidence.split(':')[0];
	if (
		file === 'package.json' ||
		file === 'go.mod' ||
		file === 'Cargo.toml' ||
		file === 'Gemfile' ||
		file === 'composer.json' ||
		file === 'pyproject.toml' ||
		file.startsWith('requirements')
	) {
		return 100;
	}
	if (file.includes('lock') || file.endsWith('.lock') || file.endsWith('.lockb')) {
		return 80;
	}
	if (file.includes('config') || file === 'tsconfig.json' || file === '.python-version') {
		return 70;
	}
	if (file.startsWith('Dockerfile') || file.includes('compose')) {
		return 60;
	}
	if (
		file.endsWith('.tf') ||
		file === 'vercel.json' ||
		file === 'netlify.toml' ||
		file === 'wrangler.toml' ||
		file === 'fly.toml'
	) {
		return 50;
	}
	if (
		file.startsWith('.github/') ||
		file.startsWith('.gitlab-ci') ||
		file.startsWith('.circleci/')
	) {
		return 40;
	}
	return 10;
}

/**
 * Runs all stack detectors and deduplicates by technology name.
 *
 * @param {string} repoPath
 * @param {{ includeDev?: boolean }} [options]
 * @returns {Array<{ name: string, evidence: string, kind: 'runtime'|'framework'|'db'|'infra' }>}
 */
export function detectStack(repoPath, options = {}) {
	const resolvedRepo = resolve(repoPath || '.');
	if (!existsSync(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
		throw new Error(`Directory not found: ${resolvedRepo}`);
	}

	const rawDetected = [];

	scanNode(resolvedRepo, options, rawDetected);
	scanPython(resolvedRepo, options, rawDetected);
	scanGo(resolvedRepo, options, rawDetected);
	scanCargo(resolvedRepo, options, rawDetected);
	scanRuby(resolvedRepo, options, rawDetected);
	scanPhp(resolvedRepo, options, rawDetected);
	scanDocker(resolvedRepo, options, rawDetected);
	scanCi(resolvedRepo, options, rawDetected);
	scanIac(resolvedRepo, options, rawDetected);

	// Deduplicate by name, keeping highest evidence priority
	const map = new Map();
	for (const item of rawDetected) {
		const existing = map.get(item.name);
		if (!existing) {
			map.set(item.name, item);
		} else {
			const existingWeight = getEvidencePriority(existing.evidence);
			const newWeight = getEvidencePriority(item.evidence);
			if (newWeight > existingWeight) {
				map.set(item.name, item);
			}
		}
	}

	const results = Array.from(map.values());
	results.sort((a, b) => a.name.localeCompare(b.name));

	return results;
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

export function runCli(args = process.argv.slice(2)) {
	let repo = '.';
	const options = { includeDev: false };

	for (const arg of args) {
		if (arg === '--all-deps' || arg === '--include-dev' || arg === '--dev') {
			options.includeDev = true;
		} else if (!arg.startsWith('-')) {
			repo = arg;
		}
	}

	try {
		const stack = detectStack(repo, options);
		process.stdout.write(JSON.stringify(stack, null, 2) + '\n');
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

if (isMainModule(import.meta.url)) {
	runCli();
}
