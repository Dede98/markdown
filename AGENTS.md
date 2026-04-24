# AGENTS.md

## Project Status

This is a greenfield project in planning and spike phase.

The first editor-core spike uses Vite, React, TypeScript, CodeMirror 6, and lucide-react.

## Product Direction

Build a local-first Markdown editor for Mac and Web.

Core requirements:

- `.md` files are the canonical document source.
- Local offline use must not require an account.
- The editor has Zen and Normal modes.
- Normal Mode includes toolbar actions for users who do not know Markdown syntax.
- Future cloud collaboration must support realtime editing, history, comments, and visible AI-agent participants.

## Architecture Direction

Default technical direction:

- Web UI shared by web app and desktop app.
- Tauri 2 for the first native Mac app.
- CodeMirror 6 for the editor core.
- Markdown live preview / WYSIWYM editing.
- Yjs for future realtime collaboration.
- App-owned DB/S3 for the first cloud storage milestone.
- Third-party storage providers come later as adapters.

## Commands

- Install dependencies: `pnpm install`
- Start dev server: `pnpm dev`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`
- Browser E2E: `pnpm test:e2e`

## Planning And Design Docs

Read these before proposing architecture or implementation changes:

- `PRODUCT_PLAN.md`
- `ARCHITECTURE.md`
- `DECISIONS.md`
- `DESIGN_BRIEF.md`

## Working Rules

- Keep `.md` as the source of truth unless `DECISIONS.md` is explicitly changed.
- Do not introduce a block-editor document model as canonical storage.
- Do not require a cloud account for local editing.
- Keep local and cloud concepts separate in names and APIs.
- Treat comments as metadata anchored to Markdown, not as normal visible Markdown content.
- AI/MCP edits must use the same document mutation path as human edits.
- AI agents must be visible as participants in realtime collaboration.

## Before Editing

- Check current repo status when the folder becomes a git repository.
- Read the relevant planning docs first.
- Keep changes scoped.
- Update planning docs when decisions change.

## `AGENTS.md` And `CLAUDE.md`

`AGENTS.md` is the canonical instruction source.

`CLAUDE.md` should stay as a small compatibility wrapper that imports this file:

```md
@AGENTS.md
```

Do not duplicate shared agent instructions into `CLAUDE.md`.
