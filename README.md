# Stackportfolio Claude Code Plugin & Marketplace

Official [Claude Code](https://code.claude.com) plugin and Model Context Protocol (MCP) integration for [Stackportfolio](https://stackportfol.io).

Manage your developer portfolio, sync projects from local repositories, upload screenshots, and update your profile directly from your coding agent.

---

## Quick Start (Claude Code)

### 1. In an interactive Claude Code session

Add the marketplace and install the plugin:

```text
/plugin marketplace add Stackportfolio/claude-plugins
/plugin install stackportfolio@stackportfolio
```

Or install in a single step (Claude Code 2.1.275+):

```text
/plugin install stackportfolio --marketplace Stackportfolio/claude-plugins
```

Then sign in via OAuth:

```text
/mcp
```

### 2. Using the Claude CLI

```bash
claude plugin marketplace add Stackportfolio/claude-plugins
claude plugin install stackportfolio@stackportfolio
claude mcp login stackportfolio
```

---

## Client Setup Guide

| Client | Instructions |
|---|---|
| **Claude Code (Plugin, Recommended)** | Run `/plugin marketplace add Stackportfolio/claude-plugins`, then `/plugin install stackportfolio@stackportfolio`, then `/mcp` to authenticate. Provides both MCP tools and contextual skills. |
| **Claude Code (MCP Only)** | Run `claude mcp add --transport http stackportfolio https://stackportfol.io/mcp`, then `/mcp` to authenticate. |
| **Claude.ai / Desktop** | Go to **Settings** > **Connectors** > **Add custom connector**, paste `https://stackportfol.io/mcp`, and complete OAuth sign-in. |
| **Cursor** | Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:<br>```json<br>{\n  "mcpServers": {\n    "stackportfolio": {\n      "url": "https://stackportfol.io/mcp"\n    }\n  }\n}<br>```<br>Then sign in via Cursor's MCP settings panel. |
| **Codex CLI** | Run `codex mcp add stackportfolio --url https://stackportfol.io/mcp`, then `codex mcp login stackportfolio`. |
| **Other MCP Clients** | Any client supporting Streamable HTTP MCP and OAuth 2.0: configure endpoint `https://stackportfol.io/mcp`. |

---

## Available Skills (Claude Code)

When installed in Claude Code, this plugin registers the following skills namespaced under `/stackportfolio:*`:

### `/stackportfolio:add-project`
- **Trigger**: "Add this repo to my Stackportfolio", "Create a project on Stackportfolio"
- **What it does**: Inspects local repository files (`package.json`, `Cargo.toml`, `go.mod`, `README.md`, git remotes) for evidenced technologies, checks for duplicates, confirms metadata with you, creates the project, and attaches evidenced technologies and screenshots.

### `/stackportfolio:sync-project`
- **Trigger**: "Sync this repo with Stackportfolio", "Update my project tech stack on Stackportfolio"
- **What it does**: Compares repository dependencies and lockfiles against recorded Stackportfolio technologies. Discovers new technologies to add, marks migrated tools as former technologies, and safely prompts for confirmation before removing any obsolete technologies.

### `/stackportfolio:upload-screenshots`
- **Trigger**: "Upload screenshots to Stackportfolio", "Append screenshot to project gallery"
- **What it does**: Appends screenshots (PNG, JPEG, WebP, still GIF) to a project's gallery with descriptive text, automatically setting the first upload as the cover image. Directs to the web dashboard for editing captions or removing media.

### `/stackportfolio:update-profile`
- **Trigger**: "Update my Stackportfolio headline", "Change my experience level or git handles"
- **What it does**: Inspects and updates developer headline, experience level, external git handles, job-seeking status, salary preferences, and availability.

---

## Core Principles

Every skill in this plugin adheres to the following principles:

1. **Credibility through evidence**: Never invent technologies. Only list technologies evidenced in repository configuration files, manifests, and lockfiles.
2. **Proficiency is computed**: Contributor proficiency scores and domain distributions are computed automatically by Stackportfolio from evidenced work.
3. **Confirmation before destructive actions**: The agent will always prompt for confirmation before deleting or removing any technology or contributor record.
4. **Verbatim error surfacing**: All API error responses are surfaced directly to provide full transparency.
5. **Clear re-authentication**: If an action requires additional scopes, the agent directs you to re-run `/mcp` to update permissions.
6. **No project deletion**: Project deletion is restricted to the Stackportfolio web interface for security.

---

## Repository Structure

```text
.
├── .claude-plugin/
│   └── marketplace.json            # Marketplace catalog manifest
├── plugins/
│   └── stackportfolio/
│       ├── .claude-plugin/
│       │   └── plugin.json         # Plugin manifest
│       ├── .mcp.json               # Remote HTTP MCP server configuration
│       └── skills/                 # Bundled skills
│           ├── add-project/
│           │   └── SKILL.md
│           ├── sync-project/
│           │   └── SKILL.md
│           ├── update-profile/
│           │   └── SKILL.md
│           └── upload-screenshots/
│               └── SKILL.md
├── scripts/
│   └── validate.mjs                # Manifest and skill verification script
└── .github/
    └── workflows/
        └── validate.yml            # CI validation workflow
```

---

## Validation & Testing

To validate manifests, skill frontmatter, and schema compliance locally:

```bash
# Run contract guard and frontmatter checks
npm test

# Validate marketplace manifest with Claude Code
claude plugin validate .

# Validate plugin manifest with Claude Code
claude plugin validate plugins/stackportfolio
```

---

## License

[MIT](LICENSE)
