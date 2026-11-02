---
name: readme-badge
description: Use when the user wants to add or update the Stackportfolio stack card badge in their repository README.md.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__get_project_badge_markdown
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:readme-badge

Embed or update an idempotent Stackportfolio stack card badge in your local repository `README.md`.

## Overview

A Stackportfolio badge showcases your project's verified technologies and contributor stack card directly in your repository `README.md`.

This skill fetches the canonical Markdown snippet and marker block for a project using the `get_project_badge_markdown` MCP tool, asks whether to include the owner profile badge, shows the preview to the user, and inserts or updates the idempotent block using the bundled deterministic script `readme-block.mjs` upon user confirmation. Finally, it displays `git diff README.md` and prompts the user to commit the change.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or metrics. The stack card rendered in the badge derives strictly from verified project technology evidence on Stackportfolio.
2. **Proficiency is computed**: Embedding or updating README badges displays project technology evidence publicly, but proficiency is calculated across evidenced project technologies.
3. **Confirm before destructive calls**: ALWAYS request explicit user confirmation before modifying local files or performing destructive actions. Modifying `README.md` requires explicit user confirmation of the preview snippet before running `readme-block.mjs`.
4. **Local working copy only**: Never commit, git push, or open a GitHub pull request from this plugin skill. The web app's automated P14.5 README pull request flow owns remote PR creation and branch management on GitHub. This skill strictly operates on the local working copy for the user to inspect and commit themselves.
5. **Verbatim error surfacing**: Always output API and tool errors in the exact `{error: {code, message}}` structure returned by the server.
6. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize with `projects:read` scope.
7. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Verify Authentication and Resolve Target Project
1. Call `whoami` (`mcp__plugin_stackportfolio_stackportfolio__whoami`) to verify active authentication. If unauthorized, prompt the user to run `/mcp` to connect their account.
2. Resolve which Stackportfolio project to link to:
   - Check for a local `.stackportfolio.json` link file in the repository root. If present and containing a `projectId`, use that project ID.
   - If no `.stackportfolio.json` file is present, or if the user requests a different project:
     - Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects` with `scope: "mine"`) to list the user's projects and help them select the destination project.
     - Or call `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project` with `projectId`) to verify a specified project UUID.
   - Confirm the selected project with the user before proceeding.

### Step 2: Prompt for Optional Profile Badge
1. Ask the user whether they would like to include their owner profile badge alongside the project stack card.
2. Default to **no** (`includeProfileBadge: false`) unless the user explicitly requests it.
3. If the user opts in, set `includeProfileBadge: true`.

### Step 3: Fetch Badge Markdown Snippet
1. Call `get_project_badge_markdown` (`mcp__plugin_stackportfolio_stackportfolio__get_project_badge_markdown`) with:
   - `projectId`: The resolved project UUID
   - `includeProfileBadge`: Boolean (`true` if user opted in, else `false`)
2. The server returns `{ markdown, block }`.
   - `markdown`: The raw Markdown snippet.
   - `block`: The snippet already wrapped in the standard Stackportfolio markers (`<!-- stackportfolio:stack-card -->` … `<!-- /stackportfolio:stack-card -->`).

### Step 4: Display Preview and Confirm
1. Present the badge snippet and the marker block clearly to the user:
   ```markdown
   <!-- stackportfolio:stack-card -->
   ...
   <!-- /stackportfolio:stack-card -->
   ```
2. Explain where the block will be placed in `README.md`:
   - Directly after the main `# Title` heading (and any existing top-level badge row).
   - Or replacing an existing `<!-- stackportfolio:stack-card -->` block in-place if already present.
3. Ask the user for explicit confirmation to apply the changes to `README.md`.

### Step 5: Write Block with `readme-block.mjs`
Upon user confirmation, execute the bundled script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/readme-block.mjs" README.md --block "<block-content>"
```
Or write the block to a temporary file and invoke:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/readme-block.mjs" README.md --block-file <temp-file>
```
If `README.md` does not exist, pass `--create` only if the user explicitly requested creating a starter `README.md`.

The script returns a JSON summary:
```json
{
  "action": "inserted" | "updated" | "unchanged",
  "path": "/path/to/README.md"
}
```
- `inserted`: The marker block was placed after the title heading or badges.
- `updated`: An existing marker block was updated in-place (and any duplicate blocks cleaned).
- `unchanged`: The README already contained the identical block; the file was left completely untouched.

### Step 6: Review Diff and Instruct User to Commit
1. Run `git diff README.md` to display the exact diff to the user.
2. Instruct the user to review the changes and commit them when ready:
   ```bash
   git add README.md
   git commit -m "docs: add stackportfolio stack card badge"
   ```
3. Remind the user that this plugin skill does not push commits or open pull requests; the Stackportfolio web app owns automated GitHub pull requests (via the `/projects/{id}` interface).
