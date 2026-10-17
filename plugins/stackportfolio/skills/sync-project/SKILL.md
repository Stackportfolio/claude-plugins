---
name: sync-project
description: Use after significant work in a repo already on Stackportfolio, to refresh its description, tech list and status.
allowed-tools:
  - list_projects
  - get_project
  - update_project
  - list_project_technologies
  - add_project_technology
  - update_project_technology
  - remove_project_technology
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
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion.

## Workflow

### Step 1: Match Local Repo with Stackportfolio Project
- Call `list_projects` (scope `"mine"`) to list the user's projects.
- Match by git remote origin URL (`git remote get-url origin`) or project title.
- Call `get_project(projectId)` to fetch current recorded details (name, description, visibility, status).
- Call `list_project_technologies(projectId)` to fetch currently listed technologies.

### Step 2: Analyze Local Repository Changes
Inspect the local workspace:
- Check `README.md` and repository manifests for updated descriptions.
- Scan package manifests and lockfiles (`package.json`, `pnpm-lock.yaml`, `Cargo.lock`, `go.mod`, `poetry.lock`, Dockerfiles) to build the current evidenced technology list.
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
- Technologies to add
- Technologies to mark as former / replaced
- Technologies proposed for removal (requiring confirmation)

Wait for user approval.

### Step 5: Execute Updates
- **Metadata**: If name, description, or visibility changed, call `update_project(projectId, ...)` sending only changed fields.
- **Add technologies**: For each new technology, call `add_project_technology(projectId, name)`.
- **Update former technologies**: For replaced technologies, call `update_project_technology(projectId, technologyId, former: true, replacedBy: <id>)`.
- **Remove technologies**: Only upon confirmed user request, call `remove_project_technology(projectId, technologyId)`.

### Step 6: Summary
Display a concise summary of all changes synchronized, with a link to the updated project page: `https://stackportfol.io/p/<projectId>`.
