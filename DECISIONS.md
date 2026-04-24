# Decisions

This file records explicit product and architecture decisions. Update it when a decision changes.

## 1. Markdown Files Are Canonical

Decision: `.md` files are the canonical document source.

Reason:

- The product should remain local-first.
- Users should be able to open files in other Markdown editors.
- Cloud and collaboration features should not force a proprietary local format.

Implications:

- Toolbar actions must write Markdown syntax.
- Editor state must round-trip to Markdown.
- Comments and collaboration metadata should not be normal visible Markdown content.

## 2. CodeMirror Live Preview For V1

Decision: Use CodeMirror 6 with Markdown live preview / WYSIWYM behavior for the first editor direction.

Reason:

- It preserves exact text control.
- It supports syntax-aware editing and decorations.
- It has a path to Yjs collaboration through existing bindings.
- It fits the requirement that typed Markdown remains first-class.

Alternatives considered:

- Milkdown: faster WYSIWYG Markdown start, but less direct control over exact Markdown text.
- Tiptap/BlockNote: strong rich/block editing, but a separate document model becomes too central.
- Source plus preview: robust but less aligned with the desired Notion-like writing feel.

## 3. Tauri First For Native Mac

Decision: Use Tauri 2 as the first native Mac strategy.

Reason:

- The same web UI can run in browser and desktop.
- Tauri provides native file-system integration.
- The app can stay lighter than Electron.

Future option:

- A native SwiftUI client can be reconsidered later if a more native shell becomes worth the extra implementation cost.

## 4. Shared Web UI For Web And Desktop

Decision: The web app and desktop app should share the same UI codebase.

Reason:

- The product needs both web and Mac.
- The editor, toolbar, comments, and collaboration UX should remain consistent.
- A single UI codebase lowers early product risk.

## 5. App-Owned Cloud Storage First

Decision: The first cloud milestone should use app-owned DB/object storage.

Reason:

- Realtime collaboration, history, comments, auth, and MCP need a controlled backend.
- Google Drive, SharePoint, and GitHub add API and sync complexity before the core product is proven.

## 6. Comments Are Metadata Anchored To Markdown

Decision: Comments should not be stored as normal visible Markdown content.

Reason:

- Inline comments would pollute the document.
- Sidecar/cloud metadata keeps `.md` readable.
- Optional hidden HTML comment anchors can improve reattachment while staying invisible in common renderers.

## 7. MCP Agents Are Visible Participants

Decision: MCP/AI agents must appear as collaboration participants when editing cloud documents.

Reason:

- Agent edits should be auditable and understandable.
- Agents act on behalf of a user account.
- Human collaborators should see when an agent is active.

## 8. `AGENTS.md` Is Canonical

Decision: `AGENTS.md` is the canonical agent instruction file. `CLAUDE.md` imports it.

Reason:

- `AGENTS.md` is a cross-agent convention.
- Claude Code reads `CLAUDE.md`, so a small wrapper keeps Claude compatible.
- Avoiding duplicated content prevents drift.

Rule:

- Put shared agent instructions in `AGENTS.md`.
- Keep `CLAUDE.md` as an import wrapper unless there is a documented Claude-specific reason to extend it.
