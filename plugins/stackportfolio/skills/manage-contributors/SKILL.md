---
name: manage-contributors
description: Use when the user wants to inspect git authors, invite project contributors, adjust contributor roles, credit evidenced technologies, or remove contributors.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__list_project_contributors
  - mcp__plugin_stackportfolio_stackportfolio__list_project_technologies
  - mcp__plugin_stackportfolio_stackportfolio__invite_project_contributor
  - mcp__plugin_stackportfolio_stackportfolio__set_contributor_role
  - mcp__plugin_stackportfolio_stackportfolio__set_contributor_technologies
  - mcp__plugin_stackportfolio_stackportfolio__remove_project_contributor
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:manage-contributors

Inspect git repository history, propose and manage project contributor invitations, configure contributor roles, credit evidenced technologies, and manage team members.

## Overview

This skill inspects the local git commit history using the deterministic bundled script `git-contributors.mjs`, filters automated bots, groups author identities across multiple email addresses using `.mailmap` and name/email matching, compares git authors against current Stackportfolio project contributors, and guides the user through inviting collaborators, assigning contributor roles, crediting evidenced technologies, or removing contributors with explicit confirmations.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or contributor roles. All contributor roles and technology credits must reflect genuine work evidenced by git history or user confirmation.
2. **Proficiency is computed**: Contributor technologies feed into computed proficiency scores; do not attempt to set proficiency scores directly.
3. **Confirm each invite individually**: An invitation will send an email notification to a real person. Always explain this plainly to the user and require explicit confirmation for EACH invite individually before sending. Never batch or auto-send invitations without per-person approval.
4. **Show proposed technologies first**: Only assign contributor technologies backed by concrete git evidence (files touched in commits). Always display the proposed list of technologies and their evidentiary files to the user before calling `set_contributor_technologies`.
5. **Pending email invites show address only**: In accordance with the 2026-10-25 decision, pending invitations sent by email display only the invited email address; the invitee's profile name and avatar remain hidden until they accept the invitation.
6. **Confirm before destructive calls**: ALWAYS request user confirmation before performing destructive actions such as calling `remove_project_contributor`. Explain that removing a contributor deletes their recorded evidence and rescores their proficiency on this project, or cancels an open invitation.
7. **Verbatim error surfacing**: Always output API and tool errors in the exact verbatim `{error: {code, message}}` structure returned by the server.
8. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize.
9. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent.

## Workflow

### Step 1: Verify Identity and Identify Target Project
1. Call `whoami` (`mcp__plugin_stackportfolio_stackportfolio__whoami`) to verify active authentication. If unauthorized, prompt the user to run `/mcp` to connect their account.
2. If the user provided a project name or ID, look up or verify the project via `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project` with `projectId`).
3. If not specified, check for a local `.stackportfolio.json` link file (which stores `{"projectId": "..."}`) or call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects` with `scope: "mine"`) to list the user's projects and help them select the destination project.

### Step 2: Fetch Current Contributors and Technologies
1. Call `list_project_contributors` (`mcp__plugin_stackportfolio_stackportfolio__list_project_contributors` with `projectId`) to retrieve current contributors and pending invitations.
2. Call `list_project_technologies` (`mcp__plugin_stackportfolio_stackportfolio__list_project_technologies` with `projectId`) to retrieve the project's existing technologies and their IDs.

### Step 3: Scan Local Git History with `git-contributors.mjs`
Check `node --version` first. If Node is available, run the deterministic bundled script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/git-contributors.mjs" [target-dir]
```
(If Node is unavailable, manually inspect `git log --use-mailmap` to identify human authors and files touched).

`git-contributors.mjs` handles:
- **Bot filtering**: Automatically filters out automated bot accounts including `dependabot`, `renovate`, `github-actions`, any author matching `*[bot]`, and noreply bot addresses.
- **Identity grouping**: Merges multiple email addresses for the same person when mapped by `.mailmap` or when author name and email local part match.
- **Commit activity**: Computes total commit count, earliest commit date (`firstCommit`), and latest commit date (`lastCommit`).
- **Technology evidence**: Maps files touched in git commits to technologies detected in the repository via `detect-stack` and alias mapping rules.

### Step 4: Compare Git Authors Against Current Contributors
Cross-reference the discovered git authors with the contributors returned by `list_project_contributors`:

1. **Active Contributors (`accepted: true`)**: Contributors already accepted on the project. Compare their current technology credits with evidenced technologies from git.
2. **Pending Invitations (`accepted: false`)**: Invitations awaiting response. Display pending email invitations by address only (per 2026-10-25 decision).
3. **Uninvited Authors**: Git commit authors who have not yet been invited to the project on Stackportfolio.

Present a clear comparison table to the user:
| Author | Email / Username | Git Commits | Active Span | Status | Evidenced Technologies |
|---|---|---|---|---|---|
| Alice Smith | `alice@example.com` | 42 | 2026-01 to 2026-10 | Accepted (MAINTAINER) | TypeScript, Node.js, Express |
| Bob Jones | `bob@example.com` | 15 | 2026-03 to 2026-09 | Pending invite (`bob@example.com`) | Python, FastAPI |
| Carol Danvers | `carol@corp.com` | 8 | 2026-05 to 2026-08 | Not invited | Go, Docker |

### Step 5: Propose and Confirm Individual Invitations
For uninvited git authors:
1. Propose inviting the author by their username or email address, with a recommended role (`CONTRIBUTOR` or `MAINTAINER`).
2. **Plain notice**: State plainly to the user:
   > "An invitation will send an email notification to a real person. Confirm each invite individually before sending."
3. Request explicit user confirmation for EACH invite individually. Do NOT send invites in bulk without individual user consent.
4. Once confirmed by the user, call `invite_project_contributor` (`mcp__plugin_stackportfolio_stackportfolio__invite_project_contributor`) with:
   - `projectId`: Target project UUID
   - `identifier`: Username or email address
   - `role`: Role for the invitee (`CONTRIBUTOR` or `MAINTAINER`)

### Step 6: Adjust Contributor Roles
If the user requests changing an existing contributor's role:
1. Explain that roles can be set to `MAINTAINER` or `CONTRIBUTOR`. Note that the project owner's role cannot be modified.
2. Call `set_contributor_role` (`mcp__plugin_stackportfolio_stackportfolio__set_contributor_role`) with:
   - `projectId`: Target project UUID
   - `userId`: Target contributor user UUID
   - `role`: New role (`CONTRIBUTOR` or `MAINTAINER`)

### Step 7: Credit Evidenced Technologies
For accepted contributors:
1. Identify technologies evidenced by the author's git commits that exist in the project's technology list (`list_project_technologies`).
2. **Show the proposed list first**: Present the proposed list of technologies and their file-level evidence to the user before making any changes.
3. Once approved, map the evidenced technology names to their corresponding `technologyIds` on the project.
4. Call `set_contributor_technologies` (`mcp__plugin_stackportfolio_stackportfolio__set_contributor_technologies`) with:
   - `projectId`: Target project UUID
   - `userId`: Target contributor user UUID
   - `technologyIds`: Array of technology UUIDs from the project
   *(Note: Setting contributor technologies replaces the whole set; only accepted contributors can have technology credits set).*

### Step 8: Remove Contributors (Confirmation Required)
If the user requests removing a contributor or cancelling an open invitation:
1. **Explain the consequences**: Removing a contributor permanently removes their contribution credits and rescores their proficiency on this project, or revokes a pending invitation. The project owner cannot be removed.
2. **Confirm explicitly**: Always obtain explicit confirmation before calling `remove_project_contributor`.
3. Once confirmed, call `remove_project_contributor` (`mcp__plugin_stackportfolio_stackportfolio__remove_project_contributor`) with:
   - `projectId`: Target project UUID
   - `userId`: Target contributor user UUID

### Step 9: Summary & Project Link
Summarize completed changes:
- Invitations sent (with confirmed recipients and roles)
- Role updates applied
- Technologies credited from git evidence
- Removals executed (if any)
- Provide a direct link to the project on Stackportfolio:
  `https://stackportfol.io/projects/<projectId>/contributors`
