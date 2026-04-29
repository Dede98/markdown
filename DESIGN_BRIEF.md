# Design Brief

Design exploration has produced first-pass Pencil frames in `markdown.pen`.

## Product

Design a native-feeling Mac and web Markdown editor.

The app is local-first. Users can open a `.md` file, edit it in a rendered writing surface, and save it back as Markdown.

The app should feel focused, quiet, and document-centric. It should not feel like a marketing site or generic SaaS dashboard.

## Core Requirements

- `.md` files are the canonical document source.
- The editor is WYSIWYM: Markdown renders while typing, but Markdown syntax remains editable.
- Local offline use does not require an account.
- Cloud collaboration requires an account only when a user explicitly
  chooses online collaboration.
- The app has Zen and Normal modes.
- Future AI agents appear as collaboration participants.

## Screens To Explore

1. Local file editor in Zen Mode.
2. Local file editor in Normal Mode with toolbar.
3. Cloud collaboration state with human and AI-agent presence.
4. Comments and annotations sidebar.
5. Minimal open/recent documents view.

## Current Design Artifacts

`markdown.pen` contains light and dark explorations for:

- Zen Mode.
- Normal Mode.
- Collaboration with human and AI-agent presence.
- Comments sidebar.
- Recent documents/open document view.

The current implementation covers the local Zen and Normal editor direction, rendered Markdown widgets, and the local comments sidebar. Collaboration, history, recent documents, and cloud account states remain design references until those product milestones are explicitly started.

## Zen Mode

Zen Mode should include:

- Main editor surface.
- Minimal titlebar with a centered filename.
- No persistent toolbar.
- Minimal visual noise.
- Strong writing focus.
- A subtle Zen Mode indicator may sit at the bottom edge.

Visual notes from the design:

- Warm off-white background: `#FBFBFA`.
- Centered writing column around 700px wide.
- Document text uses a serif writing face such as Charter where available.
- Metadata is small, muted, and secondary to the document body.

## Normal Mode

Normal Mode should include:

- Main editor surface.
- Toolbar for common Markdown actions.
- File controls.
- Optional utility controls for sidebar/search and document tools.
- A bottom status bar with local path, Markdown mode, and cursor/status metadata.
- Entry points for comments and collaboration when available.

Toolbar controls should feel like editing tools, not marketing buttons.
Topbar mode controls should be icon-only with tooltips and accessible labels. Raw/Rendered uses source/eye icons; Zen uses a calm Zen-like icon and a distinct active-state icon/pressed treatment so the state remains visible without text. Settings close uses a simple `X`.

When a Tauri update is available, the topbar update affordance should show the target version. During download/install it should show an inline circular progress fill when byte totals are known, with an indeterminate ring fallback when totals are unknown.

Visual notes from the design:

- Keep the Mac titlebar compact at about 38px tall.
- Keep the toolbar compact at about 48px tall, centered, and icon-led.
- Use thin separators and low-contrast borders.
- Use a 700px writing column with generous top spacing.
- Avoid card framing around the editor surface.

## Collaboration

Cloud collaboration is optional. The local editor should never open into
a login wall, empty cloud dashboard, or online-first workspace. Cloud
entry points should feel like a first-party capability that can be
enabled from file sharing, collaboration controls, or account settings.

Collaboration UI should show:

- Active human participants.
- Active AI-agent participants.
- Remote cursors or selections.
- Sync/save state.
- Comment activity when relevant.
- A clear distinction between local file state and online room state.
- Account/sign-in UI that is scoped to collaboration, not local editing.

AI-agent presence should make clear which user account owns or authorized the agent.

The Pencil collaboration frames show both light and dark treatments with presence avatars, remote selection highlights, named cursor tags, and an AI tag that includes the authorizing user. These are reference frames only for the current local editor spike.

## Comments

Comments should feel anchored to the document without polluting the writing surface.

Possible UI patterns:

- Inline highlight on selected text.
- Right-side comment thread panel.
- Resolved/open state.
- Lightweight markers in the margin.

The underlying `.md` file should remain readable in other Markdown tools.

The Pencil comments frames place comment markers in the document margin and threads in a right sidebar. The implemented local comments UI follows that direction: markers are visible in Normal mode, hidden in quiet Zen mode, and thread bodies live in the right sidebar.

## Visual Direction

- Native Mac feel.
- Quiet writing surface.
- Restrained toolbar.
- Dense enough for real work.
- No oversized hero areas.
- No decorative card-heavy dashboard layout.
- No one-note color palette.

First implementation target:

- Light local editor UI.
- Native-feeling chrome without simulating Mac window controls in the shared web UI.
- Serif document typography paired with Inter/system UI chrome.
- Muted separators: `#E5E5EA`.
- Text palette around `#1A1A1E`, `#2A2A2E`, `#5E5E66`, and `#9A9AA2`.

## Open Design Questions

- How visible should Markdown syntax be when the cursor is outside a formatted range?
- Should Zen Mode hide file chrome completely or keep a subtle title/status line?
- Should cloud collaboration reuse the current comments sidebar density or introduce a richer activity panel?
- How should AI-agent presence differ visually from a human participant without making it feel alien to the collaboration model?
