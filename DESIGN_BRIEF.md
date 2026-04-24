# Design Brief

Design exploration is in progress.

## Product

Design a native-feeling Mac and web Markdown editor.

The app is local-first. Users can open a `.md` file, edit it in a rendered writing surface, and save it back as Markdown.

The app should feel focused, quiet, and document-centric. It should not feel like a marketing site or generic SaaS dashboard.

## Core Requirements

- `.md` files are the canonical document source.
- The editor is WYSIWYM: Markdown renders while typing, but Markdown syntax remains editable.
- Local offline use does not require an account.
- Cloud collaboration requires an account.
- The app has Zen and Normal modes.
- Future AI agents appear as collaboration participants.

## Screens To Explore

1. Local file editor in Zen Mode.
2. Local file editor in Normal Mode with toolbar.
3. Cloud collaboration state with human and AI-agent presence.
4. Comments and annotations sidebar.
5. Minimal open/recent documents view.

## Zen Mode

Zen Mode should include:

- Main editor surface.
- Minimal file title/status.
- No persistent toolbar.
- Minimal visual noise.
- Strong writing focus.

## Normal Mode

Normal Mode should include:

- Main editor surface.
- Toolbar for common Markdown actions.
- File controls.
- Optional outline/status area.
- Entry points for comments and collaboration when available.

Toolbar controls should feel like editing tools, not marketing buttons.

## Collaboration

Collaboration UI should show:

- Active human participants.
- Active AI-agent participants.
- Remote cursors or selections.
- Sync/save state.
- Comment activity when relevant.

AI-agent presence should make clear which user account owns or authorized the agent.

## Comments

Comments should feel anchored to the document without polluting the writing surface.

Possible UI patterns:

- Inline highlight on selected text.
- Right-side comment thread panel.
- Resolved/open state.
- Lightweight markers in the margin.

The underlying `.md` file should remain readable in other Markdown tools.

## Visual Direction

- Native Mac feel.
- Quiet writing surface.
- Restrained toolbar.
- Dense enough for real work.
- No oversized hero areas.
- No decorative card-heavy dashboard layout.
- No one-note color palette.

## Open Design Questions

- How visible should Markdown syntax be when the cursor is outside a formatted range?
- Should Zen Mode hide file chrome completely or keep a subtle title/status line?
- Should comments be visible as margin markers by default or only when the comments panel is open?
- How should AI-agent presence differ visually from a human participant without making it feel alien to the collaboration model?
