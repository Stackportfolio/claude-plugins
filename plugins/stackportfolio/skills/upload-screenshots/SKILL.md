---
name: upload-screenshots
description: Use when the user wants to upload or append screenshots to a Stackportfolio project gallery.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__whoami
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__list_project_media
  - mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload
  - mcp__plugin_stackportfolio_stackportfolio__add_project_media
  - mcp__plugin_stackportfolio_stackportfolio__update_project_media
  - mcp__plugin_stackportfolio_stackportfolio__replace_project_media
  - mcp__plugin_stackportfolio_stackportfolio__remove_project_media
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# /stackportfolio:upload-screenshots

Upload, arrange, and manage screenshots and images in a Stackportfolio project gallery.

## Overview

This skill inspects the repository for screenshots and images using the deterministic script `find-images.mjs`, validates candidate files against server type and size constraints, presents the discovered assets for user selection, requests single-use signed capability upload URLs via `create_project_media_upload`, uploads the raw image files via `put-upload.mjs`, and sets display order, captions, and cover status via `update_project_media`. Existing media can also be captioned, replaced, or removed (with explicit user confirmation).

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or media assets. All screenshots, diagrams, and captions must accurately represent real assets and genuine work in the repository.
2. **Proficiency is computed**: Media contributions do not alter proficiency scores directly; proficiency is calculated across evidenced project technologies.
3. **Confirm before destructive calls**: ALWAYS request user confirmation before performing destructive actions such as `remove_project_media`, explaining that removing media permanently deletes the image record and all responsive image variants from storage.
4. **Verbatim error surfacing**: Always output API and tool errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Verify Identity and Identify Target Project
1. Call `whoami` (`mcp__plugin_stackportfolio_stackportfolio__whoami`) to verify active authentication. If unauthorized, prompt the user to run `/mcp` to connect their account.
2. If the user provided a project name or ID, look up or verify the project via `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project` with `projectId`).
3. If not specified, check for a local `.stackportfolio.json` link file (which stores `{"projectId": "..."}`) or call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects` with `scope: "mine"`) to list the user's projects and help them select the destination project.

### Step 2: Scan Candidate Images with `find-images.mjs`
Check `node --version` first. If Node is available, run the deterministic bundled script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/find-images.mjs" [target-dir]
```
(If Node is unavailable, manually inspect `screenshots/`, `docs/`, `assets/`, and `README.md` for image references).

`find-images.mjs` inspects:
- `screenshots/` directory
- `docs/` directory
- `assets/` directory
- Image references in `README.md` (`![alt](path)`, `<img src="path">`, and reference-style image definitions)

The script validates candidates directly against Stackportfolio server upload rules:
- **Accepted MIME types**: `image/png`, `image/jpeg`, and `image/webp`. Magic bytes are sniffed from file headers (never trusting extension or label alone).
- **Maximum size**: 5 MiB (5,242,880 bytes). Oversized files are refused with a clear reason (the server never resizes client-side).
- **GIF rule**: GIF images (animated or static) are not supported for signed capability upload; candidates in GIF format are refused with an explicit explanation.
- **Missing / empty files**: Zero-byte files or broken references are detected and refused with a reason.

### Step 3: Present Candidate Assets for User Selection
Present a clear table of candidates discovered:
| File | Source | Type | Size | Status / Reason |
|---|---|---|---|---|
| `screenshots/dashboard.png` | `screenshots` | PNG | 184 KB | Ready |
| `docs/architecture.webp` | `README.md:14` | WebP | 92 KB | Ready |
| `assets/recording.gif` | `assets` | GIF | 2.1 MB | Refused (GIF not supported for upload) |
| `docs/oversize.png` | `docs` | PNG | 6.2 MB | Refused (exceeds 5 MiB limit) |

Prompt the user to:
1. Select which valid image(s) to upload.
2. Provide short descriptions for captions and accessible alt text (up to 200 characters each).
3. Specify the desired gallery order or identify which image should be the cover.

### Step 4: Request Signed Capability Upload URLs
For each approved image:
1. Call `create_project_media_upload` (`mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload`) with:
   - `projectId`: Target project UUID
   - `filename`: Image filename (e.g., `dashboard.png`)
   - `contentType`: Sniffed MIME type (`image/png`, `image/jpeg`, or `image/webp`)
   - `description`: Optional caption / description text (max 200 chars)
   - `altText`: Optional accessibility description text (max 200 chars)
2. The server responds with a single-use, 10-minute HMAC-signed PUT URL (`uploadUrl`), method `PUT`, and `maxBytes`.

### Step 5: Upload Image Files via `put-upload.mjs`
Upload each raw image file directly to its signed capability URL:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/put-upload.mjs" "<uploadUrl>" "<localFilePath>"
```
- `put-upload.mjs` streams the raw binary file with the correct `Content-Type` header using Node fetch (falling back to `curl -T` if fetch is unavailable).
- URL query strings (containing HMAC tokens) are automatically redacted in logs and console output.
- **Base64 fallback**: When shell access is completely unavailable (e.g. headless web environments), fall back to `add_project_media` (`mcp__plugin_stackportfolio_stackportfolio__add_project_media`) with `projectId`, `data` (base64-encoded string, optional `data:` URI prefix), and `description`.
- **Capacity limits**: If the project gallery is full, the server returns a 409 conflict error (`The project is at its plan's image limit.`).

### Step 6: Arrange Gallery Order and Set Cover Image
Call `list_project_media` (`mcp__plugin_stackportfolio_stackportfolio__list_project_media` with `projectId`) to verify uploaded items and obtain their `mediaId` identifiers.
- To set the cover screenshot: Call `update_project_media` (`mcp__plugin_stackportfolio_stackportfolio__update_project_media`) with `projectId`, `mediaId`, and `makeCover: true`.
- To reorder items: Call `update_project_media` with `projectId`, `mediaId`, and `position` (integer order).
- The first image uploaded to a project automatically becomes its cover if no cover was previously set.

### Step 7: Manage Existing Media (Captioning, Replace, Remove)
For any existing media item in the gallery:
- **Edit caption or alt text**: Call `update_project_media` with `projectId`, `mediaId`, and updated `caption` or `altText`.
- **Replace image**: Call `replace_project_media` (`mcp__plugin_stackportfolio_stackportfolio__replace_project_media`) with `projectId`, `mediaId`, and new base64 `data`.
- **Remove image**: Removal permanently deletes the database record and all responsive WebP variant files from storage. **ALWAYS confirm with the user before calling `remove_project_media`**. Once confirmed, call `remove_project_media` (`mcp__plugin_stackportfolio_stackportfolio__remove_project_media`) with `projectId` and `mediaId`.

### Step 8: Summary & Project Link
Summarize completed gallery updates, indicating:
- Images successfully uploaded and attached
- Cover image designation
- Total media items in the gallery
- Provide a direct link to the project on Stackportfolio:
  `https://stackportfol.io/projects/<projectId>`
