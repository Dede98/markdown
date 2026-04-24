# Markdown Editor

Greenfield planning repository for a local-first Markdown editor for Mac and Web.

The product goal is a focused Markdown editor that keeps `.md` files as the canonical source, while offering a rendered writing experience and toolbar actions for people who do not know Markdown syntax by heart.

## Current Status

Planning and design exploration are in progress.

No framework, package manager, or runtime has been selected in code yet. The current direction is documented in the planning files below.

## Planning Docs

- [PRODUCT_PLAN.md](PRODUCT_PLAN.md): product vision, scope, modes, and milestones
- [ARCHITECTURE.md](ARCHITECTURE.md): technical direction and system boundaries
- [DECISIONS.md](DECISIONS.md): explicit architecture and product decisions
- [DESIGN_BRIEF.md](DESIGN_BRIEF.md): design brief and future design notes
- [AGENTS.md](AGENTS.md): canonical agent instructions
- [CLAUDE.md](CLAUDE.md): Claude Code compatibility wrapper importing `AGENTS.md`

## Core Direction

- `.md` files are the canonical document source.
- Local offline use must not require an account.
- The app has Zen and Normal modes.
- The first native Mac app should use Tauri.
- The web app and desktop app should share the same web UI.
- CodeMirror 6 is the preferred editor core.
- Realtime collaboration, history, comments, and MCP support are later milestones.
