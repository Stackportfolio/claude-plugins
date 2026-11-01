---
name: sync-project
description: Use after significant work in a repo already on Stackportfolio, to refresh its description, tech list and status.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__update_project
  - mcp__plugin_stackportfolio_stackportfolio__list_project_technologies
  - mcp__plugin_stackportfolio_stackportfolio__add_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__update_project_technology
  - mcp__plugin_stackportfolio_stackportfolio__remove_project_technology
---

# /stackportfolio:sync-project

Synchronize an existing Stackportfolio project with the latest changes in the local repository.

## Overview

Use this skill after completing significant development work, refactors, or dependency changes in a repository. It compares current local repository state (dependencies, README, description, git tags) with Stackportfolio, discovers new or deprecated technologies, and updates project metadata.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies. Only synchronize technologies directly evidenced in repository lockfiles, manifests, or source code.
2. **Proficiency is computed**: Contributor proficiency scores and domain distributions are computed automatically by Stackportfolio from the project evidence. Never attempt to set proficiency directly.
3. **Confirm before destructive calls**: ALWAYS prompt for user confirmation before calling destructive tools such as `remove_project_technology`, explaining that removing a technology deletes contributor evidence and recomputes proficiency scores.
4. **Verbatim error surfacing**: Report all API errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope (e.g. `INSUFFICIENT_SCOPE`), instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Match Local Repo with Stackportfolio Project
- Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects`, scope `"mine"`) to list the user's projects.
- Match by git remote origin URL (`git remote get-url origin`) or project title.
- Call `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project`) with `projectId` to fetch current recorded details (name, description, visibility, active status).
- Call `list_project_technologies` (`mcp__plugin_stackportfolio_stackportfolio__list_project_technologies`) with `projectId` to fetch currently listed technologies.

### Step 2: Analyze Local Repository Changes
Inspect the local workspace using the bundled deterministic scripts:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" [target-dir]` to build the current evidenced technology list.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/repo-facts.mjs" [target-dir]` to inspect updated README descriptions and repository metadata.

- Check `README.md` and repository manifests for updated descriptions.
- Scan package manifests and lockfiles via `detect-stack.mjs` to build the current evidenced technology list.
- Use canonical naming for technologies (e.g. `PostgreSQL`, `TypeScript`, `Node.js`) to prevent creating pending-approval technology records.
- Compare current evidenced technologies with technologies returned by `list_project_technologies`.

### Step 3: Classify Technology Diffs
Identify changes into three groups:
1. **New technologies**: Evidenced locally but not yet recorded on Stackportfolio.
2. **Replaced or former technologies**: Technologies that the project transitioned away from (e.g. migrated from REST to GraphQL, or Webpack to Vite).
   - In Stackportfolio, former technologies can be marked with `former: true` and linked via `replacedBy: <newTechId>`. Former technologies retain historical contributor experience.
3. **Removed technologies**: Technologies no longer relevant or accidentally added.
   - **Destructive confirmation**: Removing a technology permanently removes evidence. Ask the user for explicit confirmation before removing.

### Step 4: Review Changes with User
Present a clear summary diff to the user:
- Description / metadata updates (if any)
- Status changes (e.g. parking or reactivating a project)
- Technologies to add (canonical names)
- Technologies to mark as former / replaced
- Technologies proposed for removal (requiring confirmation)

Wait for user approval.

### Step 5: Execute Updates
- **Metadata and Status**: Call `update_project` (`mcp__plugin_stackportfolio_stackportfolio__update_project`) sending only changed fields (`name`, `description`, `visibility`, `deactivated`).
  - `update_project` can also replace the full active technology list at once by providing the complete `technologies: string[]` array.
  - **Drafts and active-project limit (409)**: Setting `deactivated: false` reactivates a parked project. If the owner is already at their active-project limit, the API returns a 409 conflict error (`The owner is at their active-project limit. Deactivate another project first.`). The user must deactivate another project first before reactivating.
- **Add technologies individually**: For new technologies not replaced in bulk, call `add_project_technology` (`mcp__plugin_stackportfolio_stackportfolio__add_project_technology`) with `projectId` and `name`.
- **Update former technologies**: For replaced technologies, call `update_project_technology` (`mcp__plugin_stackportfolio_stackportfolio__update_project_technology`) with `projectId`, `technologyId`, `former: true`, and optional `replacedBy`.
- **Remove technologies**: Only upon confirmed user request, call `remove_project_technology` (`mcp__plugin_stackportfolio_stackportfolio__remove_project_technology`) with `projectId` and `technologyId`.

### Step 6: Summary
Display a concise summary of all changes synchronized, with a link to the updated project page: `https://stackportfol.io/projects/<projectId>`.
