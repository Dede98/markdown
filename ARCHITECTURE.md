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

The current preview pipeline is source-preserving:

- Inline Markdown syntax is hidden/rendered by CodeMirror decorations while the underlying text remains Markdown.
- GFM table blocks render as real table widgets off-source. Cell edits mount a wrapping textarea, then serialize back to the same Markdown table block.
- Mermaid fenced code blocks with `mermaid` or `mmd` info strings render as diagrams off-source. The diagram frame supports a Move/Edit toggle plus pan and crisp SVG zoom. Clicking the diagram in edit mode focuses the fenced Markdown source.
- HTML comment metadata used by comments is hidden from the rendered surface.

All of these preview extensions live behind the raw-mode `Compartment`. Raw mode disables them and shows the `.md` source verbatim; it must remain the canonical recovery/editing path for any rendered widget.

## Save Pipeline

Manual save, keyboard save, native menu save, and autosave all route
through the same file adapter write path. Autosave is a local
preference only; it never changes the Markdown body and does not create
cloud concepts.

Autosave rules:

- Disabled by default.
- Modes are "after edits" with a short idle debounce and "every
  interval" with a chosen interval.
- Autosave writes only when the current file has an existing writable
  handle/path.
- Untitled files still require an explicit first Save/Save As so the
  user chooses the destination.
- A save that races a file switch must be dropped by the existing
  `fileVersion` guard rather than updating the wrong file state.

## Decoupling Seams

Per `DECISIONS.md` § 10 the project does not build a generic plugin API up front. Instead it carves three local decoupling seams as feature work demands them. Together they will absorb the next product milestones (Comments, Realtime collaboration, History, MCP) without locking the codebase into a guessed-at extension contract.

Cloud collaboration should continue this pattern. It is optional from a
product perspective, but it is too close to the editor transaction path
to be treated as a loose third-party plugin. The next milestone should
introduce first-party extension seams that let Cloud register its editor
extensions, panels, settings, status items, and session lifecycle hooks
without making login or online state part of the local file baseline.

Sketch:

```ts
type AppContribution = {
  id: string;
  editor?: EditorContribution;
  toolbar?: ToolbarItem[];
  panels?: PanelContribution[];
  settings?: SettingsContribution[];
  statusItems?: StatusContribution[];
  documentLifecycle?: DocumentLifecycleHooks;
};
```

The shape should stay internal until at least Comments, Cloud
collaboration, and one additional first-party consumer have exercised
it. A public plugin API can be extracted later from those proven seams.

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
- Comments are the first non-built-in contribution; its shape validates the contract.
- A future formal plugin API can expose `EditorContribution` (or a vetted subset) once at least two real first-party features have been built against it.

### Order Of Carving

The seams were introduced in the order Comments demanded them: toolbar registry first, then `MarkdownCommand`, then `EditorContribution`. New seams should still wait for a concrete consumer.

The concrete next consumer is Cloud collaboration. Carve only the
additional seams it needs:

- `DocumentSession` so local files and cloud rooms can share the editor
  surface while keeping file/save concepts separate from room/sync
  concepts.
- contribution points for panels, settings, status items, and
  lifecycle hooks.
- presence state that can render humans and AI agents without leaking
  auth requirements into local mode.

Do not build a generic marketplace/plugin loader before these
first-party extension seams have been validated.

## Document Sessions

The app should model the active editable thing as a document session,
while preserving the local-first language at the edges.

Sketch:

```ts
type DocumentSession =
  | {
      kind: "local-file";
      name: string;
      handle?: FileSystemFileHandle;
      path?: string;
      savedContents: string;
    }
  | {
      kind: "cloud-room";
      roomId: string;
      provider: CloudSessionProvider;
      presence: PresenceState;
    };
```

Rules:

- Local file sessions remain the default and require no account.
- Cloud room sessions are created only by the Cloud collaboration
  contribution after the user chooses an online collaboration flow.
- Manual save, keyboard save, autosave, and export must keep their local
  `.md` behavior for local sessions.
- Cloud rooms materialize deterministic Markdown snapshots for export
  and local save/download.
- Code that only handles local files should continue to use file,
  handle, path, save, and export terminology. Room, sync, account, and
  auth terminology belongs behind the Cloud session path.

Current implementation:

- `src/documentSession.ts` defines the internal `DocumentSession`
  union. `App.tsx` creates a `local-file` session from the existing
  file state without moving local save/open/autosave paths away from
  file terminology.
- `src/appContributions.ts` defines the internal `AppContribution`
  shape for editor extensions, panels, settings, status items, and
  lifecycle hooks. The shape remains first-party/internal.
- Comments are adapted into this contribution list through their
  existing `EditorContribution`; Cloud registers a first-party panel,
  settings row, and status item.

## Realtime Collaboration

Preferred future direction:

- Use Yjs for CRDT-based realtime editing.
- Represent the Markdown document as `Y.Text`.
- Use a CodeMirror/Yjs binding for collaborative editing.
- Use awareness/presence for cursors and participant metadata.
- Package the Cloud collaboration client as a bundled first-party
  contribution that registers the Yjs binding, presence UI, cloud
  settings, status indicators, and room lifecycle hooks.

Server direction:

- Use Hocuspocus or a thin Yjs WebSocket server.
- Persist Yjs updates as binary data.
- Periodically materialize Markdown snapshots.

Do not store Yjs documents only as JSON snapshots. Binary update/state persistence is needed for correct CRDT behavior.

The first spike should prove the deepest integration points before
building the whole cloud product: two editor clients bound to the same
`Y.Text`, raw/rendered mode compatibility, awareness presence for
humans and an AI-agent participant shape, comment-anchor mapping, and
materialized Markdown snapshot export.

Current spike:

- `src/cloudCollaboration/session.ts` creates an in-memory cloud-room
  session with a shared `Y.Text`, mock awareness, two human editor
  clients, and one AI-agent participant shape.
- `src/cloudCollaboration/contribution.tsx` registers the Cloud panel
  as a bundled first-party contribution. The panel mounts two
  `MarkdownEditor` clients using the CodeMirror/Yjs binding.
- The mock room materializes snapshots by reading `Y.Text.toString()`.
  If the seed Markdown has no comments, the spike room adds a sample
  inline marker plus trailing `markdown-comments-v1` metadata block so
  the comments mapping can be inspected without changing the local file.
- Raw/rendered mode toggles remain per editor client and continue to
  use the existing CodeMirror preview compartment.

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
