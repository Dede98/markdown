# Architecture

## Current Phase

This is a greenfield project. No framework or package manager exists yet.

This document records the intended architecture direction before implementation starts.

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

Raw Markdown syntax should be editable, especially when the cursor is inside formatted text.

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
