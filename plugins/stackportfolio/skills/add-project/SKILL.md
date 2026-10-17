---
name: add-project
description: Use when the user wants to add the current repo (or a named one) to their Stackportfolio as a project.
allowed-tools:
  - whoami
  - list_projects
  - create_project
  - add_project_technology
  - add_project_media
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
Call `whoami` to verify that the Stackportfolio MCP connection is active and to retrieve the user's `id` and `username`.
- If not signed in or the call fails with an authorization error, prompt the user to run `/mcp` to connect their Stackportfolio account.

### Step 2: Inspect Repository Evidence
Inspect the local workspace to collect project details:
- **Project Name**: Check repository root manifests (`package.json`, `Cargo.toml`, `go.mod`, etc.) or the repository root directory name.
- **Description**: Read the repository's `README.md` or package manifest description field.
- **Repository URL**: Inspect git remotes (e.g., `git remote get-url origin`) to obtain the canonical repository URL.
- **Technologies**: Scan dependencies and lockfiles. Extract valid technology names (frameworks, runtimes, primary libraries, databases, cloud tooling) that are directly evidenced.

### Step 3: Check for Existing Projects
Call `list_projects` (default scope `"mine"`) to check if a project with the same name or repository URL already exists in the user's portfolio.
- If an existing project matches, inform the user and suggest running `/stackportfolio:sync-project` instead of creating a duplicate.

### Step 4: Confirm Details with User
Present the proposed project details to the user:
- Name
- Description
- Visibility: `public` (default), `unlisted`, or `private`
- Repository URL
- Evidenced technologies list

Wait for user confirmation or adjustments before proceeding to creation.

### Step 5: Create Project
Call `create_project` with:
- `name`: Project title
- `description`: Project summary
- `visibility`: Selected visibility (`public`, `unlisted`, or `private`)
- `repositoryUrl`: Git repository link (if public or shareable)

Capture the returned `id` (`projectId`).

### Step 6: Add Evidenced Technologies
For each evidenced technology confirmed in Step 4:
- Call `add_project_technology` with `projectId` and `name`.
- Note: This credits the technology to the project owner and accepted contributors.

### Step 7: Optional Screenshots / Media
If screenshots exist in `assets/`, `docs/`, or a path specified by the user:
- Use `add_project_media` to attach screenshots (PNG, JPEG, WebP, still GIF; base64 payload, with `description` for caption/alt text).
- Note: The first image added becomes the cover screenshot.
- **Graceful degradation**: If `add_project_media` fails or is rejected (e.g. due to storage limit or payload size), the skill must continue project creation cleanly and instruct the user to attach screenshots via the web dashboard at `https://stackportfol.io/p/<projectId>`.
- For files larger than tool argument limits, direct the user to upload via `POST /api/v1/projects/{projectId}/media` with multipart/form-data.

### Step 8: Summary
Report the completed setup to the user with a direct link to their project on Stackportfolio (`https://stackportfol.io/p/<projectId>` or via their profile).
