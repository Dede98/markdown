# Product Plan

## Vision

Build a simple, local-first Markdown editor that feels closer to a polished writing tool than a full Notion replacement.

The editor should let a user open a `.md` file, edit it in a rendered Markdown writing surface, and save it back as Markdown. Users who know Markdown can type syntax directly. Users who do not know Markdown can use a toolbar.

## Principles

- Markdown remains the source of truth.
- Local offline editing works without an account.
- Cloud features are optional and only required for collaboration.
- Login, cloud storage, and online collaboration are optional first-party
  capabilities, not a prerequisite for opening or editing local `.md` files.
- The product should stay document-centric and quiet.
- AI agents should edit through the same collaboration model as humans.
- Future features must not force a proprietary document format for normal Markdown files.

## Modes

### Zen Mode

Zen Mode is the focused writing experience.

Expected UI:

- Main editor surface only.
- Minimal file title/status.
- No persistent toolbar.
- Keyboard-first Markdown input.
- Optional subtle save/sync state.

### Normal Mode

Normal Mode helps users who do not remember Markdown syntax.

Expected UI:

- Editor surface.
- Toolbar for common Markdown formatting.
- File controls.
- Optional document outline/status.
- Comment and collaboration controls when available.

Toolbar actions should modify Markdown text, not create a separate proprietary format.

## Local MVP

The first product milestone should support:

- Open an existing `.md` file.
- Create a new `.md` file.
- Edit Markdown in a WYSIWYM live-preview editor.
- Save back to the same `.md` file.
- Toggle between Zen and Normal modes.
- Toggle a Raw view mode that shows the `.md` source verbatim.
- Use toolbar actions for common Markdown constructs.
- Render GFM tables as editable table widgets while keeping the Markdown table as the saved source.
- Render Mermaid fenced code blocks (`mermaid` / `mmd`) as diagrams while keeping the fenced code as the saved source.
- Work offline without authentication.

Common formatting support:

- Headings
- Bold
- Italic
- Links
- Blockquotes
- Bulleted lists
- Numbered lists
- Task lists
- Fenced code blocks
- GFM tables
- Mermaid fenced code blocks
- Horizontal rules

Status: feature-complete. See `DECISIONS.md` § 11 and § 12. The implemented local editor keeps `.md` canonical, including rendered tables and Mermaid diagrams. Raw mode remains the escape hatch for verbatim source editing.

## Local QoL Polish

Small local-first polish can land before the Cloud collaboration
milestone as long as it does not introduce account requirements or a
new canonical document model.

Current QoL direction:

- Autosave: implemented as an opt-in Settings preference. It is off by
  default, can save after edits or on a chosen interval, and only writes
  files that already have a writable handle/path. New untitled files
  still need an explicit Save once.
- PDF export: implemented as a pragmatic v1 that exports the rendered
  Markdown surface through print-quality CSS and the browser/Tauri
  print pipeline. Raw mode stays a source-editing mode; the export
  command temporarily prints the rendered view without changing the
  Markdown source. Custom pagination, templates, headers, and
  publishing controls remain deferred.

## Cloud Collaboration

Cloud collaboration is the next major milestone.

Status: first architecture spike implemented. The app now has a
bundled first-party Cloud collaboration contribution that can open a
mock cloud-room session from the local editor surface. The main editor
and a peer client bind to the same Markdown `Y.Text`, mock awareness
presence renders human and AI-agent participants, and leaving the room
materializes a deterministic `.md` snapshot back into the normal editor
buffer. Room creation and joining are behind an internal
`CloudSessionProvider` contract with an in-memory provider first. This
does not add auth, backend persistence, or a login requirement for local
editing.

It should be built as a bundled first-party extension over explicit
core seams, not as a mandatory app mode and not yet as a public plugin
API. Local editing remains the default product path.

Cloud should add:

- Accounts for collaboration only.
- Realtime multi-user editing.
- Presence and remote cursors.
- Human and AI-agent participants.
- Comments and annotations.
- History and snapshots.
- Export back to `.md`.

Local-only users should never need an account. The app should not show a
login wall on launch, should not require online state to open files, and
should keep local file controls free of cloud terminology. Cloud entry
points belong in optional collaboration affordances, account settings,
and explicit "share/collaborate" flows.

## Comments And Annotations

Status: implemented for local files. Comments are the first non-built-in editor feature and validate the toolbar registry, `MarkdownCommand`, and `EditorContribution` seams.

Preferred direction:

- Keep `.md` as the portable unit: local comments are embedded in the same Markdown file as metadata, not stored in a required sidecar.
- Anchor each thread with paired hidden HTML comment range markers.
- Store thread bodies, authors, timestamps, and resolved state in one trailing `markdown-comments-v1` HTML comment metadata block.
- Keep cloud audit/history server-side later, while saving materialized state back into the `.md` file.

The Markdown document should remain readable in other editors and renderers.

## MCP

The app should eventually expose an MCP surface for agents.

MCP goals:

- Agents can read and edit documents.
- Agents can add comments.
- Agents can create snapshots before large edits.
- Agents appear as visible collaboration participants.
- Agent identity is tied to the authenticated user account for cloud use.

## Milestones

1. Local editor MVP. Implemented.
2. Comments and annotations model. Implemented for local files.
3. Local QoL polish before cloud. Implemented for autosave, PDF export,
   and current native release parity.
4. Cloud collaboration. Next major milestone, starting with a
   first-party extension/session architecture spike. Spike implemented;
   backend sync/auth/history are still future work.
5. History and snapshots.
6. MCP integration.
7. Third-party storage adapters.

## Later Storage Adapters

Do not start with Google Drive, SharePoint, or GitHub as primary storage.

Add them later as adapters:

- GitHub import/export or commit sync.
- Google Drive import/export or file sync.
- SharePoint import/export or file sync.

Realtime collaboration should still happen through the app-owned collaboration layer.
