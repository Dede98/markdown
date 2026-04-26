# Architecture

## Current Phase

This is a greenfield project in spike phase.

This document records the intended architecture direction before implementation starts.

The first editor-core spike uses:

- Vite
- React
- TypeScript
- CodeMirror 6
- lucide-react

## Source Of Truth

`.md` text is the canonical document source.

This means:

- Local files should remain normal Markdown files.
- The editor should not require a block-document format as primary storage.
- Cloud documents should always be exportable to deterministic Markdown.
- Toolbar actions should transform Markdown text.

## Frontend

Preferred direction:

- Shared web UI for browser and desktop.
- CodeMirror 6 as the editor core.
- Markdown live preview / WYSIWYM editing.
- Tauri 2 for the first native Mac desktop app.

CodeMirror is preferred because it preserves exact text control while allowing syntax-aware rendering, decorations, commands, and future Yjs binding.

## Desktop

The first native Mac app should use Tauri.

Reasons:

- One UI codebase can serve web and desktop.
- Tauri gives desktop file-system access through native APIs.
- The app can remain lighter than an Electron app.
- A future SwiftUI client remains possible if the product needs a more native shell.

## Editor Model

The editor should operate on Markdown text.

Expected layers:

1. Text buffer containing Markdown.
2. Markdown parser/syntax tree.
3. Editor decorations for live rendered Markdown.
4. Toolbar commands that apply text transformations.
5. Save/export pipeline that writes Markdown text.

Raw Markdown syntax should be editable, especially when the cursor is inside formatted text. A "raw" view mode swaps the decoration pipeline out via a CodeMirror `Compartment` so the source is shown verbatim while the doc, selection, and history survive the toggle.

## Decoupling Seams

Per `DECISIONS.md` § 10 the project does not build a generic plugin API up front. Instead it carves three local decoupling seams as feature work demands them. Together they will absorb the next product milestones (Comments, Realtime collaboration, History, MCP) without locking the codebase into a guessed-at extension contract.

### Toolbar Item Registry

Goal: replace the hardcoded toolbar JSX in `App.tsx` with a registry of `ToolbarItem` records.

Shape (sketch):

```ts
type ToolbarItem = {
  id: string;
  group: "headings" | "inline" | "blocks" | "lists" | string;
  icon: LucideIcon;
  label: string;
  isActive?: (format: ActiveFormat) => boolean;
  command: (view: EditorView) => void;
};
```

Properties:

- The current built-in buttons (bold, italic, headings, lists, code, link, quote, rule, table) become first-party entries.
- New features (comment-button, history-snapshot-button, etc.) add entries instead of editing toolbar JSX.
- Order and grouping are data, not layout code.

### `MarkdownCommand` Interface

Goal: formalize the shape that `wrapSelection` / `insertBlock` / `setHeading` / `toggleLinePrefix` / `insertLink` already implement.

Shape (sketch):

```ts
type MarkdownCommand = (view: EditorView, args?: unknown) => void;
```

Properties:

- Toolbar buttons, keymap entries, MCP tool calls, and (later) AI-agent edits all dispatch through the same `MarkdownCommand` surface.
- Satisfies the `AGENTS.md` invariant that AI/MCP edits use the same document mutation path as human edits.
- Commands stay pure functions over `EditorView`; no implicit React or app-state coupling.

### `EditorContribution` Shape

Goal: bundle the three things a feature can contribute to the editor — CodeMirror extensions, toolbar items, and key bindings — behind a single shape.

Shape (sketch):

```ts
type EditorContribution = {
  id: string;
  extensions?: Extension[];
  toolbar?: ToolbarItem[];
  keymap?: KeyBinding[];
};
```

Properties:

- Built-in features (formatting, raw mode, file actions) are written as contributions.
- Comments will be the first non-built-in contribution; its shape validates the contract.
- A future formal plugin API can expose `EditorContribution` (or a vetted subset) once at least two real first-party features have been built against it.

### Order Of Carving

The seams are introduced in the order each feature first demands them — typically toolbar registry first (Comments needs a comment button), then `MarkdownCommand` (Comments needs an "insert comment anchor" command), then `EditorContribution` (Comments needs to register its CM extensions, toolbar item, and keymap together). No seam is carved before there is a concrete consumer for it.

## Realtime Collaboration

Preferred future direction:

- Use Yjs for CRDT-based realtime editing.
- Represent the Markdown document as `Y.Text`.
- Use a CodeMirror/Yjs binding for collaborative editing.
- Use awareness/presence for cursors and participant metadata.

Server direction:

- Use Hocuspocus or a thin Yjs WebSocket server.
- Persist Yjs updates as binary data.
- Periodically materialize Markdown snapshots.

Do not store Yjs documents only as JSON snapshots. Binary update/state persistence is needed for correct CRDT behavior.

## Cloud Storage

First cloud milestone should use app-owned storage:

- Postgres for users, documents, permissions, comments, snapshots, and metadata.
- S3-compatible object storage for Markdown snapshots and Yjs state blobs.
- Yjs update persistence for realtime state.

Third-party storage providers should come later as adapters.

## History

Realtime collaboration does not automatically provide a good user-facing history UI.

History should be built from:

- Yjs updates for conflict-free state.
- Periodic snapshots.
- Manual named versions.
- Snapshots before large AI/MCP edits.
- Markdown diff views between versions.

## Comments And Annotations

Preferred direction:

- Comment body and thread metadata live outside the Markdown body.
- Local comments use sidecar metadata files.
- Cloud comments use database records.
- Hidden HTML comment anchors may be inserted into Markdown when useful.

Example hidden anchor:

```md
<!-- mdx-comment-anchor:id=c_abc123 -->
```

Anchors are optional metadata, not the comment content itself.

## MCP

Plan two MCP surfaces:

- Local MCP server for permitted local files.
- Cloud MCP server for authenticated cloud documents.

MCP operations should use the same mutation path as the editor and collaboration clients.

Agents should appear in collaboration presence with:

- Owning user account.
- Agent/client name.
- Cursor or active selection when editing.
- Current operation label when available.

## Third-Party Storage

Google Drive, SharePoint, and GitHub should not be the first live collaboration backend.

Later adapters may support:

- Import/export.
- File sync.
- GitHub commit sync.
- Provider-specific version references.

The app-owned collaboration layer remains responsible for realtime editing.
