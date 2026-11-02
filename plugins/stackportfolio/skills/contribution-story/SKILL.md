---
name: contribution-story
description: Use when the user wants to draft, view, edit, or delete a contribution story ("How I worked on this") for a Stackportfolio project.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__list_contribution_stories
  - mcp__plugin_stackportfolio_stackportfolio__list_project_contribution_stories
  - mcp__plugin_stackportfolio_stackportfolio__get_contribution_story
  - mcp__plugin_stackportfolio_stackportfolio__save_contribution_story
  - mcp__plugin_stackportfolio_stackportfolio__delete_contribution_story
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:contribution-story

Draft, view, update, and manage your "How I worked on this" contribution story on Stackportfolio projects based strictly on deterministic repository git evidence.

## Overview

A contribution story is a contributor's personal account of their technical work on a project. It explains the problem faced, the approach taken, course corrections made, hindsight insights, tools and AI practices used, and links to verified evidence.

This skill extracts verifiable repository metrics using the deterministic bundled script `git-evidence.mjs`, resolves the destination project on Stackportfolio, inspects any existing story, drafts an authentic account grounded **strictly and solely** in the discovered git evidence, displays the draft for user inspection, and saves the story via `save_contribution_story` only with explicit user approval. It also supports viewing, updating, or deleting existing stories.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies, contributions, dates, commit counts, or metrics. All statements, statistics, active spans, touched areas, languages, and PR references must derive directly from the repository git evidence JSON. State and enforce this as a **hard rule: never cite work, numbers, dates, or technologies not present in the evidence JSON**.
2. **Proficiency is computed**: Contribution stories provide qualitative narrative context on "How I worked on this" but do not alter proficiency scores directly; proficiency is calculated across evidenced project technologies.
3. **Confirm before destructive calls**: ALWAYS request explicit user confirmation before performing destructive actions such as `delete_contribution_story`. Deleting a story removes the write-up; the contributor's project association and evidenced technologies remain untouched.
4. **Verbatim error surfacing**: Always output API and tool errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize with `projects:write`.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.
7. **Anti-AI-washing rule**: Declaring any tool practice makes the `corrections` field mandatory (minimum 40 characters). An honest account of using assistive tools requires describing what had to be corrected or verified.

## Workflow

### Step 1: Discover Author Identity and Commit Emails
1. Call `whoami` (`mcp__plugin_stackportfolio_stackportfolio__whoami`) to obtain the authenticated user's ID, username, and primary email address.
2. Check `git config user.email` in the local repository directory to discover the current local commit email.
3. Present the discovered emails to the user and prompt them to confirm or supply any additional emails they have committed under (such as work emails, personal addresses, or GitHub noreply addresses like `<id>+<username>@users.noreply.github.com`).
4. Collect all verified author email addresses. Matching against git commits is case-insensitive and covers author emails and `Co-authored-by:` trailers.

### Step 2: Resolve Target Project
Identify which Stackportfolio project to link the contribution story to:
1. Check for a local `.stackportfolio.json` file in the repository root. If present and containing a `projectId`, prefer that project ID.
2. If no link file is present, or if the user specifies a project name or ID:
   - Call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects` with `scope: "mine"`) to list the user's projects and help them select the destination project.
   - Or call `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project` with `projectId`) to verify a specified project UUID.

### Step 3: Extract Deterministic Git Evidence with `git-evidence.mjs`
Check `node --version` first. If Node is available, run the deterministic bundled script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/git-evidence.mjs" [target-dir] --author <email1>,<email2>...
```
(If Node is unavailable, manually inspect `git log` with an argument array using equivalent logic).

`git-evidence.mjs` inspects repository history via git log only (no shell, argument array only) and outputs deterministic JSON:
- `commitCount`: Total commits matched for the specified authors (including co-authored commits).
- `firstCommitDate` & `lastCommitDate`: Earliest and latest commit dates in ISO 8601 format.
- `activeSpan`: `{ first, last, days }` detailing the active calendar span of the contributor's work.
- `isShallow`: Boolean indicating whether the repository clone is shallow (`git rev-parse --is-shallow-repository`). If `isShallow` is `true`, evidence is truncated; warn the user and suggest running `git fetch --unshallow`.
- `filesTouched` & `fileCount`: List and count of unique files changed.
- `areasTouched` & `areas`: Top-level directory areas touched (e.g., `src`, `test`, `plugins`, `scripts`, `root`) with breakdown of files and changed lines.
- `topLanguages`: Programming and markup languages mapped from file extensions, sorted descending by changed lines.
- `prRefs` & `mergeRefs`: Pull request numbers (`#123`) and merge commit references (`Merge pull request #123`) found in commit messages.

If `isShallow` is `true`, inform the user that commit evidence is truncated and suggest running `git fetch --unshallow` before proceeding to draft the story.

### Step 4: Check for Existing Story (View / Edit / Delete)
Call `get_contribution_story` (`mcp__plugin_stackportfolio_stackportfolio__get_contribution_story` with `projectId` and `userId`) to check if the caller already has a story recorded on this project (the caller's user identifier was retrieved in Step 1):
- **View existing story**: If the user asks to view their story (or another contributor's story), display the stored fields (`problem`, `approach`, `corrections`, `hindsight`, `practices`, `links`). You can also call `list_project_contribution_stories` (`mcp__plugin_stackportfolio_stackportfolio__list_project_contribution_stories` with `projectId` and `scope: "mine"` to retrieve the caller's own story, or `scope: "all"` / omitted to list all contribution stories on the project).
- **Delete existing story**: If the user requests deleting their story, **ALWAYS request explicit confirmation first**. State that deleting the story write-up leaves their contribution record and technologies intact. Once explicitly confirmed, call `delete_contribution_story` (`mcp__plugin_stackportfolio_stackportfolio__delete_contribution_story` with `projectId`).
- **Create or edit story**: If drafting a new story or revising an existing one, proceed to Step 5.

### Step 5: Draft Contribution Story from Evidence JSON ONLY
**Hard rule**: Never cite work, numbers, dates, or technologies not present in the evidence JSON. Every sentence in the draft must trace to a verified metric, touched area, or commit reference.

Draft the six story fields adhering strictly to server schema constraints:
1. `problem` (required, 40 to 600 characters): The core technical problem or goal addressed by the contributor's work. Grounded in the commit subjects, top-level areas touched, and pull request themes evidenced.
2. `approach` (required, 40 to 800 characters): How the contributor tackled the problem. Reference the actual top languages by changed lines, key modules/areas touched, and architectural boundaries verified in the evidence JSON.
3. `corrections` (optional if no practices declared; **mandatory 40 to 800 characters if practices are declared**): What challenges, regressions, course-corrections, or unexpected problems arose during development. If assistive tools or practices are listed, this section must detail what had to be caught, rewritten, or corrected.
4. `hindsight` (optional, up to 400 characters): Architectural or implementation lessons learned with the benefit of hindsight.
5. `practices` (optional, array of up to 6 objects): Tools or practices used during the work.
   - Each practice object requires:
     - `tool`: Canonical name of the tool (1 to 100 characters, e.g., `Claude Code`, `TypeScript`, `Jest`).
     - `role`: One of the exact enum values:
       - `EXPLORED_OPTIONS`
       - `WROTE_FIRST_DRAFT`
       - `REVIEWED_MY_WORK`
       - `DID_REPETITIVE_PART`
       - `BUILT_END_TO_END`
       - `SOMETHING_ELSE`
     - `askedFor`: Specific task description (10 to 140 characters).
   - If any practice is declared, `corrections` MUST be at least 40 characters long.
6. `links` (optional, array of up to 5 objects): Labelled references supporting the account.
   - Each link object requires:
     - `label`: Descriptive label (1 to 100 characters).
     - `url`: Full `https://` address (up to 500 characters), e.g., repository PR URLs derived from evidenced `prRefs`.

### Step 6: Present Draft for User Inspection and Approval
Present the drafted contribution story clearly to the user, including:
- Character counts for each text field against minimum and maximum limits.
- A Grounding Table showing the exact evidence metric supporting each section:
  | Section | Character Count | Bounds | Evidenced Grounding |
  |---|---|---|---|
  | Problem | 240 chars | 40–600 | Commits and PRs in `prRefs` |
  | Approach | 510 chars | 40–800 | Top languages and `areasTouched` |
  | Corrections | 195 chars | 40–800 | Required: 1 practice declared |
  | Hindsight | 160 chars | 0–400 | Architectural learnings |
  | Practices | 1 item | 0–6 | Declared tool practice |
  | Links | 1 item | 0–5 | Evidenced PR link |

Ask the user:
- "Would you like to make any adjustments to this draft?"
- "Do you approve saving this contribution story to Stackportfolio?"

### Step 7: Save Story upon Approval via `save_contribution_story`
ONLY after the user explicitly confirms and approves the draft:
Call `save_contribution_story` (`mcp__plugin_stackportfolio_stackportfolio__save_contribution_story`) with:
- `projectId`: Destination project UUID
- `problem`: Drafted problem text
- `approach`: Drafted approach text
- `corrections`: Drafted corrections text (or empty string if none)
- `hindsight`: Drafted hindsight text (or empty string if none)
- `practices`: Array of declared practice objects
- `links`: Array of declared link objects

### Step 8: Confirmation and Web Link
Provide a confirmation summary of the saved contribution story:
- Project name and ID
- Active contributor span and commit count recorded
- Direct link to the project on Stackportfolio:
  `https://stackportfol.io/projects/<projectId>`
