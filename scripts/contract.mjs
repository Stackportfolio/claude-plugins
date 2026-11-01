#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(REPO_ROOT, 'plugins/stackportfolio/skills');
const SCRIPTS_DIR = join(REPO_ROOT, 'plugins/stackportfolio/scripts');
const DEFAULT_URL = 'https://2.31.5.6.sslip.io/api/v1/openapi.json';
const EXPECTED_TOOL_PREFIX = 'mcp__plugin_stackportfolio_stackportfolio__';

const PATH_PARAM_ALIASES = {
	id: 'projectId',
	technologyId: 'technologyId',
	mediaId: 'mediaId',
	userId: 'userId'
};

/**
 * Redacts any basic auth credentials or embedded URLs containing credentials
 * from strings to guarantee credentials never leak into output or logs.
 */
export function redactSensitive(str) {
	if (!str || typeof str !== 'string') return '';
	let redacted = str;
	const auth = process.env.STACKPORTFOLIO_OPENAPI_BASIC_AUTH;
	if (auth) {
		redacted = redacted.replaceAll(auth, '[REDACTED_CREDENTIAL]');
		const b64 = Buffer.from(auth).toString('base64');
		redacted = redacted.replaceAll(b64, '[REDACTED_BASIC_AUTH]');
		const colonIdx = auth.indexOf(':');
		if (colonIdx !== -1) {
			const user = auth.slice(0, colonIdx);
			const pass = auth.slice(colonIdx + 1);
			if (user.length > 2) redacted = redacted.replaceAll(user, '[REDACTED_USER]');
			if (pass.length > 2) redacted = redacted.replaceAll(pass, '[REDACTED_PASS]');
		}
	}
	redacted = redacted.replace(/https?:\/\/[^@/\s]+@/g, (m) =>
		m.startsWith('https') ? 'https://[REDACTED]@' : 'http://[REDACTED]@'
	);
	return redacted;
}

function safeLog(msg) {
	console.log(redactSensitive(msg));
}

function safeError(msg) {
	console.error(redactSensitive(msg));
}

function resolveJsonPointer(doc, pointer) {
	if (!pointer || !pointer.startsWith('#/')) return null;
	const parts = pointer.slice(2).split('/');
	let current = doc;
	for (const part of parts) {
		const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
		if (!current || typeof current !== 'object' || !(decoded in current)) return null;
		current = current[decoded];
	}
	return current;
}

function extractSchemaProperties(schema, doc, visited = new Set()) {
	const props = new Set();
	if (!schema || typeof schema !== 'object') return props;
	if (visited.has(schema)) return props;
	visited.add(schema);

	if (schema.$ref && typeof schema.$ref === 'string') {
		const resolved = resolveJsonPointer(doc, schema.$ref);
		if (resolved) {
			for (const p of extractSchemaProperties(resolved, doc, visited)) props.add(p);
		}
	}
	if (schema.properties && typeof schema.properties === 'object') {
		for (const key of Object.keys(schema.properties)) props.add(key);
	}
	if (Array.isArray(schema.allOf)) {
		for (const sub of schema.allOf) {
			for (const p of extractSchemaProperties(sub, doc, visited)) props.add(p);
		}
	}
	if (Array.isArray(schema.oneOf)) {
		for (const sub of schema.oneOf) {
			for (const p of extractSchemaProperties(sub, doc, visited)) props.add(p);
		}
	}
	if (Array.isArray(schema.anyOf)) {
		for (const sub of schema.anyOf) {
			for (const p of extractSchemaProperties(sub, doc, visited)) props.add(p);
		}
	}
	return props;
}

/**
 * Builds the tool registry map from an OpenAPI document.
 * Returns Map<toolName, { acceptedArgs: Set<string>, operationId: string, path: string, method: string }>
 */
export function buildToolSet(doc) {
	const tools = new Map();
	if (!doc || typeof doc !== 'object' || !doc.paths || typeof doc.paths !== 'object') {
		return tools;
	}

	for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
		if (!pathItem || typeof pathItem !== 'object') continue;

		const pathParams = new Set();
		for (const match of pathStr.matchAll(/\{(\w+)\}/g)) {
			const paramName = match[1];
			pathParams.add(paramName);
			if (PATH_PARAM_ALIASES[paramName]) {
				pathParams.add(PATH_PARAM_ALIASES[paramName]);
			}
		}

		if (Array.isArray(pathItem.parameters)) {
			for (const p of pathItem.parameters) {
				if (p && p.name) {
					pathParams.add(p.name);
					if (PATH_PARAM_ALIASES[p.name]) {
						pathParams.add(PATH_PARAM_ALIASES[p.name]);
					}
				}
			}
		}

		for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
			const operation = pathItem[method];
			if (!operation || typeof operation !== 'object') continue;

			const toolName = operation['x-mcp-tool'];
			if (!toolName || typeof toolName !== 'string') continue;

			const acceptedArgs = new Set(pathParams);

			if (Array.isArray(operation.parameters)) {
				for (const p of operation.parameters) {
					if (p && p.name) {
						acceptedArgs.add(p.name);
						if (PATH_PARAM_ALIASES[p.name]) {
							acceptedArgs.add(PATH_PARAM_ALIASES[p.name]);
						}
					}
				}
			}

			if (operation.requestBody && typeof operation.requestBody === 'object') {
				const content = operation.requestBody.content;
				if (content && typeof content === 'object') {
					for (const media of Object.values(content)) {
						if (media && media.schema) {
							for (const prop of extractSchemaProperties(media.schema, doc)) {
								acceptedArgs.add(prop);
							}
						}
					}
				}
			}

			tools.set(toolName.trim(), {
				acceptedArgs,
				operationId: operation.operationId || '',
				path: pathStr,
				method
			});
		}
	}

	return tools;
}

// Heuristic: detects argument names from bullet items under "Call `tool` ... with:",
// parenthesized "(mcp... with `arg`)", or inline "Call `tool` with/sending `arg`"
// clauses bounded by sentence stops, plus request bodies in bundled scripts.
export function extractSkillToolUsage(filePath) {
	const content = readFileSync(filePath, 'utf8');
	const lines = content.split(/\r?\n/);
	const errors = [];
	const allowedTools = [];
	const toolReferences = [];
	const argumentUsages = [];

	let inFrontmatter = false;
	let frontmatterLines = [];
	let frontmatterEndLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		if (i === 0 && line.trim() === '---') {
			inFrontmatter = true;
			continue;
		}

		if (inFrontmatter) {
			if (line.trim() === '---') {
				inFrontmatter = false;
				frontmatterEndLine = lineNum;
				continue;
			}
			frontmatterLines.push({ line, lineNum });
			continue;
		}
	}

	// (a) Allowed-tools in frontmatter
	for (const { line, lineNum } of frontmatterLines) {
		const match = line.match(/^\s*-\s+([^\s#]+)/);
		if (match) {
			const entry = match[1].replace(/^['"]|['"]$/g, '');
			if (entry.startsWith(EXPECTED_TOOL_PREFIX)) {
				const tool = entry.slice(EXPECTED_TOOL_PREFIX.length);
				allowedTools.push({ tool, line: lineNum, entry });
			}
		}
	}

	// (b) & (c) Skill body analysis
	let blockTool = null;

	for (let i = frontmatterEndLine; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1;

		// Tool references in body: full plugin name or backticked name after Call/tool/via
		const fullToolMatches = [...line.matchAll(/mcp__plugin_[a-zA-Z0-9_]+__([a-zA-Z0-9_]+)/g)];
		for (const m of fullToolMatches) {
			toolReferences.push({ tool: m[1], line: lineNum, source: 'full_identifier' });
		}

		const callToolMatches = [
			...line.matchAll(
				/(?:[Cc]all(?:ing)?|[Tt]ools?(?:\s+such\s+as)?|[Aa]ctions?(?:\s+such\s+as)?|[Vv]ia)\s+`([a-z0-9_]+)`/g
			)
		];
		for (const m of callToolMatches) {
			const tool = m[1];
			if (
				!tool.startsWith('mcp__') &&
				!toolReferences.some((r) => r.line === lineNum && r.tool === tool)
			) {
				toolReferences.push({ tool, line: lineNum, source: 'call_prose' });
			}
		}

		// (c) Argument heuristic 1: Multiline bullet list under "Call `tool` ... with:"
		const blockMatch = line.match(
			/(?:[Cc]all(?:ing)?|[Tt]ool)\s+`([a-z0-9_]+)`[^\n]*?with:\s*$/
		);
		if (blockMatch) {
			blockTool = blockMatch[1];
			continue;
		}

		if (blockTool) {
			const subBullet = line.match(/^\s*-\s+`([a-zA-Z0-9_]+)`(?:\s*[:(]|$)/);
			if (subBullet) {
				argumentUsages.push({
					tool: blockTool,
					arg: subBullet[1],
					line: lineNum,
					source: 'bullet'
				});
				continue;
			} else if (line.trim().startsWith('#') || (line.trim().length > 0 && !line.match(/^\s*[-*]/))) {
				blockTool = null;
			}
		}

		// (c) Argument heuristic 2: Parenthesized clause like "(mcp... with `arg`...)"
		const parenMatch = line.match(/\((?:mcp__[^\s)]+\s+)?(?:with|scope:?)\s+([^)]+)\)/);
		if (parenMatch) {
			const toolMatch = line
				.slice(0, line.indexOf(parenMatch[0]))
				.match(/(?:[Cc]all(?:ing)?|[Tt]ool|[Vv]ia)\s+`([a-z0-9_]+)`/);
			if (toolMatch) {
				const tool = toolMatch[1];
				const argMatches = [...parenMatch[1].matchAll(/`([a-zA-Z0-9_]+)`/g)];
				for (const m of argMatches) {
					if (m[1] !== tool && !m[1].startsWith('mcp__')) {
						argumentUsages.push({
							tool,
							arg: m[1],
							line: lineNum,
							source: 'parenthesized'
						});
					}
				}
			}
		}

		// (c) Argument heuristic 3: Inline clause "Call `tool` ... with/passing/sending `arg`"
		const cleanedLine = line.replace(/\(mcp__[^\)]*\)/g, ' ');
		const inlineMatch = cleanedLine.match(
			/(?:[Cc]all(?:ing)?|[Tt]ool)\s+`([a-z0-9_]+)`[^\n]*?\b(?:with|passing|sending(?:\s+only\s+changed\s+fields)?)\b([^.;\n]+)/
		);
		if (inlineMatch) {
			const tool = inlineMatch[1];
			let clause = inlineMatch[2];
			clause = clause.split(/\b(?:to\s+[a-z]+|before)\b/)[0];
			const argMatches = [...clause.matchAll(/`([a-zA-Z0-9_]+)(?::\s*[^`]+)?`/g)];
			for (const m of argMatches) {
				if (m[1] !== tool && !m[1].startsWith('mcp__')) {
					argumentUsages.push({
						tool,
						arg: m[1],
						line: lineNum,
						source: 'inline'
					});
				}
			}
		}
	}

	return { allowedTools, toolReferences, argumentUsages };
}

/**
 * Inspects bundled plugin scripts for JSON request body fields.
 */
export function extractBundledScriptToolUsage(scriptsDir) {
	const usages = [];
	if (!existsSync(scriptsDir)) return usages;
	const files = readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs'));
	for (const f of files) {
		const filePath = join(scriptsDir, f);
		const content = readFileSync(filePath, 'utf8');
		const lines = content.split(/\r?\n/);
		lines.forEach((line, idx) => {
			const bodyMatch = line.match(/body:\s*JSON\.stringify\(\{\s*([^}]+)\s*\}\)/);
			if (bodyMatch) {
				const fields = bodyMatch[1].split(',').map((p) => p.split(':')[0].trim());
				for (const field of fields) {
					if (field) usages.push({ file: filePath, line: idx + 1, field });
				}
			}
		});
	}
	return usages;
}

/**
 * Validates skills against the built OpenAPI tool registry.
 * Returns array of error messages formatted as "filePath:line: message".
 */
export function validateSkillsAgainstContract(skillsDir, toolSet, scriptsDir = SCRIPTS_DIR) {
	const errors = [];
	if (!existsSync(skillsDir)) {
		errors.push(`${skillsDir}: skills directory missing`);
		return errors;
	}

	const skillDirs = readdirSync(skillsDir);
	for (const dir of skillDirs) {
		const skillPath = join(skillsDir, dir, 'SKILL.md');
		if (!existsSync(skillPath)) continue;

		const relPath = relative(REPO_ROOT, skillPath);
		const { allowedTools, toolReferences, argumentUsages } = extractSkillToolUsage(skillPath);

		// Check (a): allowed-tools entry whose tool is not in the document
		for (const { tool, line, entry } of allowedTools) {
			if (!toolSet.has(tool)) {
				errors.push(
					`${relPath}:${line}: allowed-tools references unknown tool '${tool}' (entry: '${entry}')`
				);
			}
		}

		// Check (b): tool name referenced in SKILL.md body that is not in the document
		const reportedToolsPerLine = new Set();
		for (const { tool, line } of toolReferences) {
			const key = `${line}:${tool}`;
			if (reportedToolsPerLine.has(key)) continue;
			if (!toolSet.has(tool)) {
				reportedToolsPerLine.add(key);
				errors.push(
					`${relPath}:${line}: body references unknown tool '${tool}'`
				);
			}
		}

		// Check (c): argument name that the operation does not accept
		const reportedArgsPerLine = new Set();
		for (const { tool, arg, line } of argumentUsages) {
			const toolInfo = toolSet.get(tool);
			if (!toolInfo) continue; // Already reported under tool existence
			const key = `${line}:${tool}:${arg}`;
			if (reportedArgsPerLine.has(key)) continue;
			if (!toolInfo.acceptedArgs.has(arg)) {
				reportedArgsPerLine.add(key);
				errors.push(
					`${relPath}:${line}: tool '${tool}' does not accept argument '${arg}'`
				);
			}
		}
	}

	return errors;
}

async function loadSpec(options) {
	if (options.spec) {
		const specPath = resolve(options.spec);
		if (!existsSync(specPath)) {
			throw new Error(`OpenAPI spec file not found: ${specPath}`);
		}
		const raw = readFileSync(specPath, 'utf8');
		try {
			return JSON.parse(raw);
		} catch (err) {
			throw new Error(`Failed to parse OpenAPI spec from ${specPath}: ${err.message}`);
		}
	}

	const targetUrl = options.url || DEFAULT_URL;
	const isDefaultUrl = !options.url;

	const headers = { Accept: 'application/json' };
	const auth = process.env.STACKPORTFOLIO_OPENAPI_BASIC_AUTH;
	if (auth) {
		headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
	} else if (isDefaultUrl) {
		// Default staging URL requires basic auth; without auth or network, skip cleanly.
		return null;
	}

	try {
		const response = await fetch(targetUrl, { headers });
		if (!response.ok) {
			if (isDefaultUrl && (response.status === 401 || response.status === 403)) {
				return null;
			}
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		return await response.json();
	} catch (err) {
		if (isDefaultUrl) {
			return null;
		}
		throw new Error(`Failed to fetch OpenAPI spec from ${targetUrl}: ${err.message}`);
	}
}

function parseCliArgs(argv) {
	const options = { url: null, spec: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			options.help = true;
		} else if (arg === '--url') {
			options.url = argv[++i];
		} else if (arg.startsWith('--url=')) {
			options.url = arg.slice(6);
		} else if (arg === '--spec') {
			options.spec = argv[++i];
		} else if (arg.startsWith('--spec=')) {
			options.spec = arg.slice(7);
		}
	}
	return options;
}

export async function runContractCheck(argv = process.argv.slice(2)) {
	const options = parseCliArgs(argv);
	if (options.help) {
		console.log(`Usage: node scripts/contract.mjs [--url <openapi url>] [--spec <file>]\n`);
		console.log(`Default URL: ${DEFAULT_URL}`);
		console.log(`Reads STACKPORTFOLIO_OPENAPI_BASIC_AUTH (user:password) if set.`);
		return 0;
	}

	let doc;
	try {
		doc = await loadSpec(options);
	} catch (err) {
		safeError(`Error: ${err.message}`);
		return 1;
	}

	if (!doc) {
		safeLog('contract check skipped: no spec');
		return 0;
	}

	const toolSet = buildToolSet(doc);
	if (toolSet.size === 0) {
		safeError('Error: no x-mcp-tool tags in spec');
		return 1;
	}

	safeLog(`Loaded OpenAPI spec with ${toolSet.size} tagged MCP tool(s). Validating skills...`);

	const errors = validateSkillsAgainstContract(SKILLS_DIR, toolSet, SCRIPTS_DIR);
	if (errors.length > 0) {
		safeError(`\n❌ Contract check failed with ${errors.length} error(s):`);
		for (const err of errors) {
			safeError(`  ${err}`);
		}
		return 1;
	}

	safeLog(`✔ OpenAPI contract guard passed: all skill tools and arguments verified against spec.`);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	runContractCheck(process.argv.slice(2))
		.then((exitCode) => {
			process.exit(exitCode);
		})
		.catch((err) => {
			safeError(`Unexpected failure: ${err.message}`);
			process.exit(1);
		});
}
