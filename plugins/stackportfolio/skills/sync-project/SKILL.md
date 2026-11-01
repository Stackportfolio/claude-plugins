---
name: sync-project
description: Use after significant work in a repo already on Stackportfolio, to refresh its description, tech list and status.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__update_project
  - mcp__plugin_stackportfolio_stackportfolio__list_project_technologies
  - mcp__plugin_stackportfolio_stackportfolio__search_technologies
  - mcp__plugin_stackportfolio_stackportfolio__add_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__update_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__remove_project_technology
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:sync-project

Synchronize an existing Stackportfolio project with the latest changes in the local repository.

## Overview

This skill synchronizes repository changes with Stackportfolio. It reads `.stackportfolio.json` if present for exact project linking (falling back to remote URL / name matching), analyzes local evidence with `repo-facts.mjs` and `detect-stack.mjs`, computes technology additions, removals, versions, and former transitions with `diff-stack.mjs`, presents a clear proposal requiring one-by-one confirmation for removals, applies changes in a single atomic `update_project` replacement call, updates former technologies, and offers to persist the link file.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies. Only synchronize technologies directly evidenced in repository lockfiles, manifests, configuration, or source code.
2. **Proficiency is computed**: Contributor proficiency scores and domain distributions are computed automatically by Stackportfolio from the project evidence. Never attempt to set proficiency directly.
3. **Confirm before destructive calls**: ALWAYS prompt for user confirmation before calling destructive tools or performing technology removals. Explain that removing a technology deletes contributor evidence and recomputes proficiency scores. Removals must always be confirmed one by one.
4. **Verbatim error surfacing**: Report all API errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope (e.g. `INSUFFICIENT_SCOPE`), instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize with required scopes.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Match Local Repo with Stackportfolio Project
1. Check for `.stackportfolio.json` in the repository root:
   - If present: read `projectId` from the file.
   - If not present:
     - Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects`, scope `"mine"`) to list the user's projects.
     - Match by git remote origin URL (from `repo-facts.mjs` or `git remote get-url origin`) or project title.
     - Note that you will offer to save `.stackportfolio.json` after sync is confirmed so future runs avoid name guessing.
2. Call `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project`) with `projectId` to fetch recorded metadata (name, description, visibility, active status).
3. Call `list_project_technologies` (`mcp__plugin_stackportfolio_stackportfolio__list_project_technologies`) with `projectId` to fetch currently recorded technologies.

### Step 2: Analyze Local Repository Changes & Diff Stack
Run the bundled deterministic scripts (check `node --version` first; fall back to manual inspection if unavailable):
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/repo-facts.mjs" [target-dir]` to check for updated README descriptions or repository metadata.
2. Run `diff-stack.mjs`:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/diff-stack.mjs" [target-dir] <remote-technologies-json>`
   (or pipe the JSON output of `list_project_technologies` directly into `diff-stack.mjs`).
   - The script outputs a structured diff JSON containing:
     - `add`: New technologies detected locally.
     - `remove`: Plain removals — recorded active technologies no longer detected locally that lack replacement evidence.
     - `version`: Recorded technologies whose version differs locally.
     - `former`: Proposed former transitions for technologies no longer detected locally that have replacement evidence (e.g. Celery -> RQ, Webpack -> Vite) with suggested replacement name (`replacedByName`).
     - `unchanged`: Technologies matching without modifications.
     - `proposedTechnologies`: Complete replacement array ready for `update_project`, retaining unchanged, version-bumped, added, already-former, and to-be-former technologies.
3. If new technologies are present in `add`:
   Optionally call `search_technologies` (`mcp__plugin_stackportfolio_stackportfolio__search_technologies`) with `{ names: [...] }` to resolve canonical names and verify approval status.

### Step 3: Review Changes with User
Present a categorized summary to the user:
- **Metadata updates**: Updated description or title from README/manifests (if changed).
- **New technologies to add**: Evidenced locally but not yet on Stackportfolio.
- **Version updates**: Local version vs currently recorded version.
- **Former technologies proposal**: Evidenced transitions where the project moved from one technology to another (with `replacedByName`). Explain that marking a technology as former (`former: true`, with `replacedBy`) preserves historical contributor proficiency. If the user declines marking a technology as former, ask whether to keep it active or remove it.
- **Removals**: Plain removals (technologies removed without detected replacements).
  - **Confirm one by one**: Because removal deletes contributor evidence and recomputes proficiency, every removal MUST be confirmed individually with the user. For each removed technology, ask whether the user wants to remove it, keep it, or manually mark it as former instead.

### Step 4: Execute Updates via `update_project`
Once the user confirms the proposal:
1. **Atomic Technology Replacement**:
   Call `update_project` (`mcp__plugin_stackportfolio_stackportfolio__update_project`) with:
   - `projectId`: Target project id
   - `technologies`: Full replacement array of all retained technologies (active, version-bumped, added, already-former, and to-be-former).
     **Crucial Contract**: In Stackportfolio, `update_project`'s `technologies[]` replaces the complete list of technologies attached to the project. Any technology attached to the project (active OR former) that is omitted from `technologies[]` is immediately and permanently deleted, destroying contributor evidence.
     - `diff-stack.mjs`'s `proposedTechnologies` already preserves unchanged, version-bumped, added, already-former, and to-be-former technologies.
     - Only confirmed removals (technologies the user explicitly approved deleting) must be excluded from `technologies[]`.
     - Retaining an existing technology row in `technologies[]` does not overwrite its `former` or `replacedBy` status on the server.
     - If the user declined any removal in Step 3, ensure that declined technology is added back into `technologies[]`.
   - Send any updated metadata fields (`name`, `description`, `visibility`, `deactivated`).
   - **Drafts and active-project limit (409)**: Setting `deactivated: false` reactivates a parked project. If the owner is already at their active-project limit, the API returns a 409 conflict error (`The owner is at their active-project limit. Deactivate another project first.`).
2. **Update Former Technologies**:
   For any technologies agreed to be marked as former (from `diff.former` or user request):
   - **Resolve `replacedBy` UUID**: The `update_project_technology` tool accepts `replacedBy` as the **UUID** (`technologyId`) of the replacement technology attached to the project, NOT a technology name.
   - Look up the replacement technology's UUID from the `technologies[]` array returned by the `update_project` call (or from `list_project_technologies`) by matching the replacement technology's name (e.g. from `replacedByName`).
   - Call `update_project_technology` (`mcp__plugin_stackportfolio_stackportfolio__update_project_technology`) with:
     - `projectId`: Target project id
     - `technologyId`: UUID of the technology being marked former
     - `former`: `true`
     - `replacedBy`: UUID of the replacement technology (or `null` if no replacement)
3. **Individual Fallbacks**:
   If individual modifications are needed instead of bulk replacement, call `add_project_technology` or `remove_project_technology` accordingly.

### Step 5: Offer Link File (`.stackportfolio.json`)
If `.stackportfolio.json` was not present initially, offer to write it:
```json
{
  "projectId": "<projectId>"
}
```
Explain that saving this file links the local repository directly to their Stackportfolio project for instant, exact future syncs. Only write the file after the user agrees.

### Step 6: Summary
Display a concise summary of all changes synchronized, with a link to the updated project page:
`https://stackportfol.io/projects/<projectId>`
