---
name: add-project
description: Use when the user wants to add the current repo (or a named one) to their Stackportfolio as a project.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__create_project
  - mcp__plugin_stackportfolio_stackportfolio__add_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload
  - mcp__plugin_stackportfolio_stackportfolio__add_project_media
---

# /stackportfolio:add-project

Add a local repository or named project to your Stackportfolio profile.

## Overview

This skill guides you through inspecting the current repository (or a named one), extracting evidenced metadata and technologies, checking for existing projects to avoid duplicates, confirming project details, creating the project in Stackportfolio, and linking evidenced technologies and media.

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
Inspect the local workspace using the bundled deterministic scripts:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/repo-facts.mjs" [target-dir]` to extract repository name, description, origin, and deployment hints.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" [target-dir]` to detect evidenced technologies and frameworks (add `--all-deps` if including developer tooling like linters/testers).

- **Project Name**: Check repository root manifests (`package.json`, `Cargo.toml`, `go.mod`, etc.) or the repository root directory name, as returned by `repo-facts.mjs`.
- **Description**: Read the repository's `README.md` or package manifest description field, as extracted by `repo-facts.mjs`.
- **Repository URL**: Inspect git remotes (e.g., `git remote get-url origin` or parsed `.git/config`), as extracted by `repo-facts.mjs`.
- **Technologies**: Scan dependencies and lockfiles via `detect-stack.mjs`. Extract valid canonical technology names (frameworks, runtimes, primary libraries, databases, cloud tooling) that are directly evidenced. Use canonical naming (e.g. `PostgreSQL`, `TypeScript`, `Node.js`) because unknown or aliased names create a pending-approval technology record.

### Step 3: Check for Existing Projects
Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects`, default scope `"mine"`) to check if a project with the same name or repository URL already exists in the user's portfolio.
- If an existing project matches, inform the user and suggest running `/stackportfolio:sync-project` instead of creating a duplicate.

### Step 4: Confirm Details with User
Present the proposed project details to the user:
- Name
- Description
- Visibility: `private` (default), `connections`, or `public` (API default is `private`)
- Repository URL
- Evidenced technologies list (canonical names)
- Active-project limit note: If the user is at their plan's active-project limit, the project will still be created, but in an inactive/draft state (`isActive: false`, `deactivatedAt` set).

Wait for user confirmation or adjustments before proceeding to creation.

### Step 5: Create Project
Call `create_project` (`mcp__plugin_stackportfolio_stackportfolio__create_project`) with:
- `name`: Project title
- `description`: Project summary
- `visibility`: Selected visibility (`private`, `connections`, or `public`; default is `private`)
- `repositoryUrl`: Git repository link (if public or shareable)
- `technologies`: Array of canonical technology names (e.g. `["TypeScript", "SvelteKit", "PostgreSQL"]`). Supplying technologies here attaches them at creation in a single operation.

Capture the returned `id` (`projectId`).
- If the owner has reached their active-project allowance, the project is created in an inactive state (`isActive: false`, `deactivatedAt` populated). Inform the user that it can be activated in project settings or by deactivating another project.

### Step 6: Add Evidenced Technologies
If technologies were not passed during `create_project`, or if adding further evidenced technologies individually:
- Call `add_project_technology` (`mcp__plugin_stackportfolio_stackportfolio__add_project_technology`) with `projectId` and `name`.
- Note: This credits the technology to the project owner and accepted contributors.

### Step 7: Optional Screenshots / Media
If screenshots exist in `assets/`, `docs/`, `screenshots/`, or a path specified by the user:
- **Signed upload (recommended)**: Call `create_project_media_upload` (`mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload`) with `projectId` and optional `description` to request an HMAC-signed, single-use, 10-minute PUT URL. Then upload the raw image directly:
  `curl -T shot.png -H "Content-Type: image/png" "<uploadUrl>"`
  Accepts PNG, JPEG, or WebP. The server resizes to ≤2048px, converts to WebP, and generates responsive variants.
- **Base64 upload (fallback)**: When shell access is unavailable, call `add_project_media` (`mcp__plugin_stackportfolio_stackportfolio__add_project_media`) with `projectId`, `data` (base64 string), and `description`.
- Note: The first image added becomes the cover screenshot. Reaching the plan image limit returns a 409 conflict.
- **Media management**: Images can subsequently be reordered, captioned, or set as cover via `update_project_media`, replaced via `replace_project_media`, or removed via `remove_project_media`. Media can also be managed directly on the web at `https://stackportfol.io/projects/<projectId>`.
- **Graceful degradation**: If media upload fails or is rejected, continue project setup cleanly and instruct the user to attach screenshots via the web dashboard at `https://stackportfol.io/projects/<projectId>`.

### Step 8: Summary
Report the completed setup to the user with a direct link to their project on Stackportfolio (`https://stackportfol.io/projects/<projectId>` or via their profile).
