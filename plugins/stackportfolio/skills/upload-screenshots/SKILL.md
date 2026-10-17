---
name: upload-screenshots
description: Use when the user wants to upload or append screenshots to a Stackportfolio project gallery.
allowed-tools:
  - list_projects
  - get_project
  - add_project_media
---

# /stackportfolio:upload-screenshots

Upload and append screenshots to a Stackportfolio project gallery.

## Overview

This skill allows you to attach image assets (screenshots, diagrams, mockups) to an existing Stackportfolio project gallery and set an image description. In v1, this skill appends new images via `add_project_media`. To edit existing captions, reorder images, or remove screenshots, direct the user to the web dashboard at `https://stackportfol.io/p/<projectId>`.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or media assets. All screenshots and descriptions must accurately represent genuine work done on the project.
2. **Proficiency is computed**: Media contributions do not alter proficiency scores directly; proficiency is calculated across all evidenced project technologies.
3. **Web UI for editing or removal**: In v1, editing existing image captions, reordering images, or removing screenshots must be performed directly in the web UI at `https://stackportfol.io/p/<projectId>`. Destructive media operations cannot be performed via the agent.
4. **Verbatim error surfacing**: Always output API and tool errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion.

## Workflow

### Step 1: Identify Target Project
- If the project ID or name is provided in the prompt, verify it by calling `get_project(projectId)`.
- If not specified, call `list_projects` (scope `"mine"`) to list the user's projects and help them choose the destination project.

### Step 2: Locate & Inspect Image Assets
- Check the local filesystem for target image files (e.g. in `screenshots/`, `assets/`, `docs/`, or a user-provided file path).
- Supported formats: PNG, JPEG, WebP, still GIF.
- Note: The server automatically converts images to WebP, strips EXIF metadata, and downscales them to a maximum dimension of 2048px.

### Step 3: Size & Payload Limits
- The `add_project_media` tool accepts base64-encoded strings (with or without a `data:image/...;base64,` prefix) up to the server payload limit.
- **Large file handling**: For files exceeding tool parameter size limits, instruct the user to use the REST API multipart upload endpoint:
  `POST https://stackportfol.io/api/v1/projects/{projectId}/media` with `multipart/form-data`.

### Step 4: Prepare Description
- Collect a concise description for the image to serve as caption and accessible alt text (sent in the `description` field).
- Note that the first image in a project's gallery automatically serves as its cover screenshot.
- Each project has a maximum gallery image capacity; exceeding the limit returns a conflict error.
- If the user wants to update or replace an existing screenshot, direct them to manage media on the web UI at `https://stackportfol.io/p/<projectId>`.

### Step 5: Upload Media
Call `add_project_media` with:
- `projectId`: Target project identifier
- `data`: Base64-encoded image data
- `description`: Caption and alt text for the image

### Step 6: Confirmation
Summarize the upload result, noting whether the image was set as the cover image or added to the project gallery, and provide a link to review the project gallery on Stackportfolio (`https://stackportfol.io/p/<projectId>`).
