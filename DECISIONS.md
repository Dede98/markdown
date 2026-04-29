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

Decision: Comments are stored as metadata embedded in the same `.md` file, not as normal visible Markdown content. Default storage is inline within the file. Sidecar files are not used by default.

Reason:

- A user can mail or share a single `.md` file and the recipient receives the comments with it. No server, no companion file, no account.
- HTML comments are invisible in every common Markdown renderer (GitHub, VS Code preview, Obsidian, pandoc, iA Writer), so prose stays clean for non-collaborators.
- A sidecar file gets lost the moment the `.md` is copied alone. A local-first product cannot rely on two-file portability.

Implications:

- Each thread is anchored by a paired inline HTML comment range: `<!--c:ID-->...<!--/c:ID-->`. IDs are ULIDs so anchors stay unique under copy-paste between files.
- Thread bodies, authors, timestamps, and resolved state live in a single trailing HTML comment block at end of file, tagged `markdown-comments-v1`, carrying escaped JSON. After `JSON.stringify`, a single sweep rewrites two byte sequences so the JSON body can never close the surrounding HTML comment: every `<` becomes the JSON unicode escape for U+003C, and every `--` becomes a `-` followed by the JSON unicode escape for U+002D. `JSON.parse` decodes both escapes natively on read; no custom decoder is needed. The exact escape sequences are specified in `ARCHITECTURE.md` § Comments And Annotations.
- The file always stores materialized current state, not an edit log. Cloud retains audit history server-side (Yjs + persistence) and snapshots state on `.md` save.
- Resolved threads stay in the file by default. A later "export clean Markdown" command strips them on demand.
- Local author identity is an editable display name plus a stable local UUID. No email default — hidden is not private.
- Format versioning is strict. Unknown versions load read-only with a banner; the editor does not attempt to mutate metadata it does not understand.
- Sidecar files may be added later as an opt-in "clean `.md`" mode for users who want zero in-band metadata. They are not the default.

Supersedes: the prior version of this decision specified sidecar files for local and database records for cloud. Single-file portability is the binding constraint.

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

## 9. Vite/React For The First Spike

Decision: Use Vite, React, and TypeScript for the first editor-core spike.

Reason:

- It is fast to validate CodeMirror behavior.
- It can later be wrapped by Tauri.
- It keeps the web and desktop UI path aligned.

Scope:

- This is a spike decision, not yet a permanent product framework commitment.

## 10. Plugin API Is Earned, Not Designed

Decision: Do not build a generic plugin/extension system before there are real first-party consumers. Ship the next product features directly, extract decoupling seams as the work demands them, and let the plugin API shape itself around the third real consumer.

Reason:

- Plugin APIs designed in the abstract bind future feature work to early guesses. Comments, realtime collaboration, history, and MCP have very different shapes; a single API guessed up front will fit at most one.
- Prior art (VS Code, Obsidian, Tiptap) waited until two or three real first-party consumers existed before formalizing the extension contract.
- CodeMirror 6 is already an extension-based core. Wrapping it in a hand-rolled plugin layer without earned shape adds friction without value.
- `AGENTS.md` already requires that AI/MCP edits go through the same mutation path as human edits. The contract that plugins must respect is therefore product-defined, not invented.

Implications:

- Comments and annotations were built directly, not through a speculative plugin API.
- Three decoupling seams were carved as the work demanded them: a toolbar item registry, a `MarkdownCommand` interface, and an `EditorContribution` shape (see `ARCHITECTURE.md` § Decoupling Seams).
- Cloud collaboration should be a bundled first-party extension over
  core app seams, not a mandatory login/online mode and not a loose
  third-party plugin. It may register editor extensions, panels,
  settings, status items, presence, and session lifecycle hooks, but it
  must not make local file editing depend on auth or network state.
- A formal third-party plugin API may follow once Comments + Realtime collaboration have both been built and the seams have been validated against two real consumers.

Alternatives considered:

- Build a generic plugin system before the next feature: rejected. The cost of designing for four imagined consumers exceeds the cost of refactoring once real shape is known.
- Skip decoupling and build features monolithically: rejected. The toolbar/command/contribution seams are local, low-risk, and paid off the first feature (Comments).
- Treat collaboration as a shallow plugin: rejected. Realtime
  collaboration touches document text, CodeMirror transactions,
  selection mapping, undo/redo, comments, presence, save/export, and
  later AI/MCP edits. It needs first-party depth behind optional
  product entry points.

## 11. Local MVP Is Feature-Complete

Decision: Treat the local editor MVP (`PRODUCT_PLAN.md` § Local MVP) as feature-complete. Outstanding work before sealing v1 is polish only.

Scope of v1:

- Open / new / save `.md` files (web + Tauri).
- WYSIWYM live-preview editor with raw-source toggle.
- Zen and Normal modes with toolbar.
- Common formatting (headings, bold, italic, links, blockquotes, lists, task lists, fenced code, GFM tables, Mermaid fenced code blocks, horizontal rules).
- Offline use without an account.

Out of scope for v1: comments, realtime collaboration, history, MCP, third-party storage adapters. Those are subsequent milestones.

Implications:

- A short polish pass closes v1 (persist mode prefs, view-mode keyboard shortcuts, accessibility parity on the Zen toggle, and any other small gaps captured in the active handoff).
- After v1, Comments and annotations were built directly using the seams in `ARCHITECTURE.md` § Decoupling Seams. The next major product milestone is Cloud collaboration.

## 12. Rendered Widgets Must Preserve Markdown Source

Decision: Rendered block widgets may improve editing and preview quality, but they must keep the `.md` text as the canonical source and raw mode must expose the plain source.

Current widgets:

- GFM tables render as real tables. Cell edits use a wrapping textarea and serialize back to Markdown table rows.
- Mermaid fenced code blocks (`mermaid` / `mmd`) render as diagrams. The widget provides pan/zoom in Move mode and switches back to source editing when the user chooses Edit or clicks the diagram in normal edit mode.

Reason:

- Tables and diagrams are hard to inspect in raw Markdown alone.
- GitHub-style rendered Markdown is a strong user expectation for `.md` files.
- The product direction still rejects a proprietary block document model.

Implications:

- Widget state must be derived from Markdown source, not stored as a separate canonical model.
- Raw mode disables rendered widgets and shows the exact `.md` bytes.
- Saving writes Markdown source only.
- Any future rendered widget follows the same rule: source first, widget second.

## 13. Autosave Is Opt-In And File-Backed

Decision: Autosave is disabled by default and only writes documents
that already have a writable local file handle/path.

Reason:

- Local editing must never surprise the user by choosing a destination
  for a new untitled document.
- Browser and Tauri save capabilities differ; the file adapter already
  encodes whether a file can be written in place.
- Autosave should reduce accidental data loss without changing the
  `.md` source-of-truth model or introducing cloud sync semantics.

Implications:

- Settings owns the autosave preference. Modes are Off, After edits,
  and Every interval.
- After-edits autosave is debounced; interval autosave checks for
  dirtiness on the configured cadence.
- Unsaved untitled files stay dirty until the user explicitly saves
  once. Autosave does not open Save As.
- Manual save, menu save, keyboard save, and autosave use the same
  adapter write path and the same file-switch race guard.

## 14. Cloud Collaboration Is Optional First-Party Extension Work

Decision: Cloud collaboration is optional for users and first-party for
the codebase. Login, online storage, and realtime collaboration must be
activated by explicit collaboration flows, while local `.md` editing
continues to work without an account.

Implementation status: the first architecture spike is in place as an
in-memory bundled contribution. It proves `DocumentSession`,
`AppContribution`, shared `Y.Text` editing, mock awareness presence,
AI-agent participant shape, comment-marker mapping, and deterministic
Markdown materialization. The mock room is now app-owned: users start it
explicitly from the collaboration control, the main editor joins the
room, and leaving the room returns a materialized `.md` snapshot to the
normal editor buffer. It intentionally does not introduce auth, server
persistence, or a public plugin API.

Reason:

- Local-first editing is the product baseline.
- Collaboration needs deep integration with editor transactions,
  comments, presence, snapshots, and future AI/MCP mutation paths.
- A loose plugin boundary would either duplicate core mutation logic or
  create fragile synchronization glue.

Implications:

- The next Cloud milestone starts with a `DocumentSession` /
  `AppContribution` architecture spike before full auth or backend work.
- Local file sessions and cloud room sessions may share the editor
  surface, but their names and APIs remain separate.
- Cloud auth UI belongs to the Cloud contribution, account settings, and
  explicit share/collaborate flows. It must not appear as an app launch
  blocker.
- The Yjs binding, awareness presence, remote cursors, sync status, and
  cloud comments mapping are registered by the Cloud contribution.
- Public third-party plugins remain deferred until first-party seams have
  been validated by Comments, Cloud collaboration, and at least one more
  real consumer such as History or MCP.
