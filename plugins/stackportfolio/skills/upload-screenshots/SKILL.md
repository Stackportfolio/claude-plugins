---
name: upload-screenshots
description: Use when the user wants to upload or append screenshots to a Stackportfolio project gallery.
allowed-tools:
  - mcp__plugin_stackportfolio_stackportfolio__list_projects
  - mcp__plugin_stackportfolio_stackportfolio__get_project
  - mcp__plugin_stackportfolio_stackportfolio__list_project_media
  - mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload
  - mcp__plugin_stackportfolio_stackportfolio__add_project_media
  - mcp__plugin_stackportfolio_stackportfolio__update_project_media
  - mcp__plugin_stackportfolio_stackportfolio__replace_project_media
  - mcp__plugin_stackportfolio_stackportfolio__remove_project_media
---

# /stackportfolio:upload-screenshots

Upload, manage, and arrange screenshots in a Stackportfolio project gallery.

## Overview

This skill allows you to attach image assets (screenshots, diagrams, mockups) to an existing Stackportfolio project gallery, set captions and accessible alt text, update cover images, and manage existing gallery media. Images can be uploaded directly via signed capability URLs (`create_project_media_upload`) or via base64 encoding (`add_project_media`). Existing media can be inspected, updated, replaced, or removed via dedicated MCP tools, or managed directly on the web at `https://stackportfol.io/projects/<projectId>`.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or media assets. All screenshots and descriptions must accurately represent genuine work done on the project.
2. **Proficiency is computed**: Media contributions do not alter proficiency scores directly; proficiency is calculated across all evidenced project technologies.
3. **Confirm before destructive calls**: ALWAYS request user confirmation before performing destructive actions such as `remove_project_media`, explaining that removing media permanently deletes the image record and all responsive image variants from storage.
4. **Verbatim error surfacing**: Always output API and tool errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion via the agent. Projects may be managed or deleted directly in the Stackportfolio web interface.

## Workflow

### Step 1: Identify Target Project
- If the project ID or name is provided in the prompt, verify it by calling `get_project` (`mcp__plugin_stackportfolio_stackportfolio__get_project`) with `projectId`.
- If not specified, call `list_projects` (`mcp__plugin_stackportfolio_stackportfolio__list_projects`, scope `"mine"`) to list the user's projects and help them select the destination project.

### Step 2: Locate & Inspect Image Assets
- Check the local filesystem for target image files (e.g. in `screenshots/`, `assets/`, `docs/`, or a user-provided file path).
- Supported formats: PNG, JPEG, WebP, still GIF.
- Note: The server automatically converts images to WebP, strips EXIF metadata, and downscales them to a maximum dimension of 2048px.

### Step 3: Inspect Existing Media (Optional)
- Call `list_project_media` (`mcp__plugin_stackportfolio_stackportfolio__list_project_media`) with `projectId` to view existing gallery images, positions, cover image status, and `mediaId` identifiers.

### Step 4: Upload Media Assets
- **Signed capability upload (primary method)**:
  1. Call `create_project_media_upload` (`mcp__plugin_stackportfolio_stackportfolio__create_project_media_upload`) with `projectId` and optional `description` (caption / alt text).
  2. The server returns a single-use, short-lived (≤10 min) signed URL (`uploadUrl`).
  3. Upload the raw image file with PUT without base64 token overhead:
     `curl -T shot.png -H "Content-Type: image/png" "<uploadUrl>"`
     (Accepts PNG, JPEG, or WebP).
- **Base64 upload (fallback method)**:
  - When shell access or curl is not available, call `add_project_media` (`mcp__plugin_stackportfolio_stackportfolio__add_project_media`) with `projectId`, `data` (base64-encoded string, data: URI optional), and `description`.
- **Image limits & 409 conflict**:
  - Each project has a maximum gallery capacity based on the owner's plan. Uploading when at capacity returns a 409 conflict error (`The project is at its plan's image limit.`).
  - The first image uploaded to a project automatically becomes its cover screenshot.

### Step 5: Update, Replace, or Remove Media
When adjusting existing media in the gallery:
- **Update caption, position, or cover**: Call `update_project_media` (`mcp__plugin_stackportfolio_stackportfolio__update_project_media`) with `projectId`, `mediaId`, and fields to change (`caption`, `alt`, `position`, or `makeCover: true`).
- **Replace an image file**: Call `replace_project_media` (`mcp__plugin_stackportfolio_stackportfolio__replace_project_media`) with `projectId`, `mediaId`, and new base64 `data`.
- **Remove media**: Always ask the user for confirmation first, then call `remove_project_media` (`mcp__plugin_stackportfolio_stackportfolio__remove_project_media`) with `projectId` and `mediaId`.

### Step 6: Confirmation
Summarize the results of the media operations, noting cover image assignments and current gallery count, and provide a link to review the project gallery on Stackportfolio (`https://stackportfol.io/projects/<projectId>`).
