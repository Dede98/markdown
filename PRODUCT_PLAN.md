# Product Plan

## Vision

Build a simple, local-first Markdown editor that feels closer to a polished writing tool than a full Notion replacement.

The editor should let a user open a `.md` file, edit it in a rendered Markdown writing surface, and save it back as Markdown. Users who know Markdown can type syntax directly. Users who do not know Markdown can use a toolbar.

## Principles

- Markdown remains the source of truth.
- Local offline editing works without an account.
- Cloud features are optional and only required for collaboration.
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
- Horizontal rules

Status: feature-complete. See `DECISIONS.md` § 11 — outstanding work before sealing v1 is polish only. The active polish punch list lives in `HANDOFF_NEXT_SESSION.md`. Once v1 is sealed, the next active milestone is Comments and annotations, built directly against the seams in `ARCHITECTURE.md` § Decoupling Seams.

## Cloud Collaboration

Cloud collaboration is a later milestone.

Cloud should add:

- Accounts for collaboration only.
- Realtime multi-user editing.
- Presence and remote cursors.
- Human and AI-agent participants.
- Comments and annotations.
- History and snapshots.
- Export back to `.md`.

Local-only users should not need an account.

## Comments And Annotations

Comments likely make the most sense in cloud collaboration, but local support should remain possible.

Preferred direction:

- Store comment thread data outside the Markdown body.
- Use sidecar files for local comments.
- Use database records for cloud comments.
- Optionally insert hidden HTML comment anchors into `.md` files for robust anchoring.

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

1. Local editor MVP.
2. Comments and annotations model.
3. Cloud collaboration.
4. History and snapshots.
5. MCP integration.
6. Third-party storage adapters.

## Later Storage Adapters

Do not start with Google Drive, SharePoint, or GitHub as primary storage.

Add them later as adapters:

- GitHub import/export or commit sync.
- Google Drive import/export or file sync.
- SharePoint import/export or file sync.

Realtime collaboration should still happen through the app-owned collaboration layer.
