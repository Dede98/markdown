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

Comment metadata lives inside the `.md` file. The file is the unit of portability — mailing or copying a `.md` carries its comments with it. No sidecar, no server requirement for local use. See `DECISIONS.md` § 6 for the binding rationale.

### Storage Format

Two pieces in the same file.

**1. Inline range anchors.** Each commented span is wrapped by a paired HTML comment:

```md
Some text with <!--c:01HXYZ12345678901234567890-->a commented phrase<!--/c:01HXYZ12345678901234567890--> in it.
```

IDs are ULIDs so anchors stay unique under copy-paste between files. The markers are plain text in the buffer; they move with the text they wrap under any edit, including future CRDT merges.

**2. Trailing metadata block.** A single HTML comment at end of file carries thread bodies, authors, timestamps, and resolved state as JSON:

```md
<!--
markdown-comments-v1
{"threads":{"01HXYZ12345678901234567890":{"createdAt":"2026-04-26T20:30:00Z","resolved":false,"replies":[{"id":"r_1","author":{"name":"Local User","uuid":"..."},"ts":"2026-04-26T20:30:00Z","body":"Reword?"}]}}}
-->
```

JSON is post-processed before write. After `JSON.stringify`, a single sweep performs two replacements so the JSON body can never contain a sequence that closes the surrounding HTML comment:

- Every `<` becomes the JSON unicode escape `\u003c`.
- Every `--` becomes `-\u002d`. The pass is iterative — runs of three or more dashes are resolved left-to-right until no `--` remains.

Both escapes are valid JSON and decode natively under `JSON.parse`. No custom decoder is needed on read.

The file stores materialized current state, not an edit log. Audit history, when needed, lives cloud-side.

### Format Versioning

The `markdown-comments-v1` tag is strict. An unknown version makes the file load read-only with a banner in the sidebar; the editor never attempts to mutate metadata it does not understand. A v2 spec gets its own tag and parser.

### Runtime Anchors

Inside the editor session, comment ranges are tracked as `Y.RelativePosition` pairs (start + end) once the Yjs binding is in place. Until Yjs lands, CodeMirror range trackers play the same role. Inline markers are read at load and written at save; they are not walked on every keystroke.

Marker atomicity: any command that writes a marker writes the entire opening or closing token as a single transaction. No edit ever lands between `<!--c:` and `-->`, and no concurrent CRDT op observes half a marker.

### Orphan Handling

If a user raw-edits the file and breaks an anchor pair (deletes one half, splits it across a paste boundary), the parse pass flags the affected thread as orphaned. The thread body stays in the file, the sidebar surfaces it as detached, and the user can re-anchor or delete. Comment data is never silently dropped on parse failure.

### Cloud Mapping

When the cloud milestone lands:

- The Markdown body lives in `Y.Text`. Inline anchors travel as ordinary text inside it.
- Threads live in a `Y.Map` keyed by ULID. Replies are appended to a `Y.Array` of plain reply records (`{id, author, ts, body}`). Replies are append-only events; `reply.edit` and `thread.resolve` are additional event types if and when needed. Comment bodies are not `Y.Text` — concurrent typing into a single comment body is not a workflow worth the cost.
- Awareness CRDT carries presence (cursor, "user is replying in thread X") and is not persisted.
- On save to disk the cloud snapshot serializes back to the inline + trailing format above. The file remains the single source of portability.

### Identity

Local: editable display name plus a stable local UUID. No email default. The local UUID is the durable identity for offline-only authors.

Cloud: at first sign-in, an account can claim the local UUID so prior local comments retain authorship continuity instead of orphaning to "Local User".

### Privacy

HTML comments are invisible in renderers, not private. Anything stored in the metadata block is recoverable from the raw file. The comment metadata path must not hold secrets, must not default to email addresses, and must not include content the user would not paste into the visible body.

### Sidecar Mode (Deferred)

A later opt-in "clean `.md`" mode may write a `<filename>.md.meta.json` sidecar instead of the inline format, for users who want zero in-band metadata. This is not the default and is not required for the first Comments milestone.

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
