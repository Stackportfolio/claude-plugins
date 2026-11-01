---
name: add-project
description: Use when the user wants to add the current repo (or a named one) to their Stackportfolio as a project.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__search_technologies
  - mcp__plugin_stackportfolio_stackportfolio__create_project
  - mcp__plugin_stackportfolio_stackportfolio__add_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload
  - mcp__plugin_stackportfolio_stackportfolio__add_project_media
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:add-project

Add a local repository or named project to your Stackportfolio profile.

## Overview

This skill inspects the repository using local deterministic scripts, resolves detected technologies against the Stackportfolio technology catalogue via `search_technologies`, presents a clear confirmation table with evidence and approval flags, creates the project and its evidenced technologies in a single `create_project` call, offers an optional hand-off to upload screenshots, and offers to save an opt-in `.stackportfolio.json` link file for exact future synchronization.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies. Only add technologies directly evidenced in repository manifest files (e.g. `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`, `Gemfile`, Dockerfiles, lockfiles), configuration files, or explicitly confirmed by the user.
2. **Proficiency is computed**: Contributor proficiency levels and skill tags are automatically derived by Stackportfolio from evidenced projects and technologies. Never attempt to set proficiency manually.
3. **Confirm before destructive calls**: Always request user confirmation before performing any destructive or irreversible action.
4. **Verbatim error surfacing**: Always surface API and tool errors in the exact `{error: {code, message}}` format returned by the server so issues can be diagnosed immediately.
5. **Scope error recovery**: If an API error indicates insufficient scope (e.g. `INSUFFICIENT_SCOPE`), instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio` in the terminal) to re-authorize with required scopes.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never promise or attempt project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Verify Connection & Identity
Call `whoami` (`mcp__plugin_stackportfolio_stackportfolio__whoami`) to verify that the Stackportfolio MCP connection is active and to retrieve the user's `id` and `username`.
- If not signed in or the call fails with an authorization error, prompt the user to run `/mcp` to connect their Stackportfolio account.

### Step 2: Inspect Repository Evidence
Inspect the local workspace using the bundled deterministic scripts (check `node --version` first; if Node is unavailable, fall back to manual manifest inspection):
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/repo-facts.mjs" [target-dir]` to extract repository name, description, git remote origin, and deployment hints.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" [target-dir]` to detect evidenced technologies and frameworks (add `--all-deps` if the user wants developer tooling such as linters and test frameworks included).

- **Project Name**: Check repository root manifests (`package.json`, `Cargo.toml`, `go.mod`, etc.) or root directory name, as returned by `repo-facts.mjs`.
- **Description**: Read the repository's `README.md` or package manifest description, as extracted by `repo-facts.mjs`.
- **Repository URL**: Extracted from git remotes (`git remote get-url origin` or parsed `.git/config`) by `repo-facts.mjs`.
- **Technologies**: Evidenced dependencies, runtimes, and frameworks returned by `detect-stack.mjs`.

### Step 3: Resolve Names with Catalogue
Batch-resolve detected technologies using the `search_technologies` MCP tool (`mcp__plugin_stackportfolio_stackportfolio__search_technologies`):
- Pass the array of detected names: `search_technologies({ names: ["SvelteKit", "TypeScript", ...] })` (up to 100 names).
- For each detected technology:
  - Match against the returned catalogue items by name or aliases.
  - If matched in catalogue and `isApproved: true`: mark as `Approved` canonical name.
  - If matched in catalogue and `isApproved: false`: mark as `Pending approval`.
  - If not found in catalogue: retain detected name, mark with flag `NEW (pending approval)`. Stackportfolio permits creating new technologies, but they will await administrative approval.

### Step 4: Check for Existing Projects
Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects`, default scope `"mine"`) to check if a project with the same name or repository URL already exists in the user's portfolio.
- If an existing project matches, inform the user and suggest running `/stackportfolio:sync-project` instead of creating a duplicate.

### Step 5: Present Confirmation Table to User
Present the project summary and technology confirmation table to the user:

```markdown
### Proposed Technologies
| Technology | Evidence | Canonical Match | Status |
| :--- | :--- | :--- | :--- |
| SvelteKit | package.json:9 | SvelteKit | Approved |
| PostgreSQL | package.json:13 | PostgreSQL | Approved |
| CustomTool | package.json:20 | CustomTool | NEW (pending approval) |
```

Present project configuration:
- **Title**: Name proposed from manifests
- **Description**: Summary extracted from README
- **Visibility**: `private` (default), `connections`, or `public` (API default is `private`)
- **Repository URL**: Git origin URL
- **Active-project limit note**: If the user is at their plan's active-project limit, the project is still created, but in an inactive/draft state (`isActive: false`, `deactivatedAt` set).

Wait for user confirmation or adjustments before proceeding to create the project.

### Step 6: Create Project in One Call
Call `create_project` (`mcp__plugin_stackportfolio_stackportfolio__create_project`) with:
- `name`: Project title
- `description`: Project summary
- `visibility`: Selected visibility (`private`, `connections`, or `public`; default is `private`)
- `repositoryUrl`: Git repository link (if public or shareable)
- `technologies`: Array of canonical technology names (e.g. `["SvelteKit", "TypeScript", "PostgreSQL"]`). Supplying `technologies[]` attaches them at creation in a single atomic call.

Capture the returned `id` (`projectId`).
- If the owner has reached their active-project allowance, the project is created in an inactive state (`isActive: false`, `deactivatedAt` populated). Inform the user that it can be activated in project settings or by deactivating another project.
- (If bulk technology attachment was skipped or fails, fall back to calling `add_project_technology` for each technology).

### Step 7: Optional Screenshots / Media Hand-off
If screenshots exist in `assets/`, `docs/`, `screenshots/`, or a path specified by the user:
- Ask the user if they wish to upload screenshots now or hand off to `/stackportfolio:upload-screenshots`.
- **Signed upload (recommended)**: Call `create_project_media_upload` (`mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload`) with `projectId` and optional description to request a single-use 10-minute signed PUT URL, then upload directly:
  `curl -T shot.png -H "Content-Type: image/png" "<uploadUrl>"`
- **Base64 upload (fallback)**: When shell access is unavailable, call `add_project_media` (`mcp__plugin_stackportfolio_stackportfolio__add_project_media`) with `projectId`, `data` (base64 string), and `description`.
- Note: Media can also be managed anytime on the web at `https://stackportfol.io/projects/<projectId>`.

### Step 8: Offer Link File (`.stackportfolio.json`)
Ask the user if they would like to create a local `.stackportfolio.json` link file:
```json
{
  "projectId": "<projectId>"
}
```
Explain that saving this file links the local repository directly to their Stackportfolio project, allowing future runs of `/stackportfolio:sync-project` (and CI actions) to synchronize changes instantly and exactly without name guessing. Only write `.stackportfolio.json` after the user agrees.

### Step 9: Summary
Report the completed setup to the user with a direct link to their project on Stackportfolio:
`https://stackportfol.io/projects/<projectId>`
