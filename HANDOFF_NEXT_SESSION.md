# Handoff — Seal v1 polish, then start Comments milestone

Status: the local editor MVP is feature-complete. The next session
runs a short polish pass to seal v1, then moves into the Comments
and annotations milestone using the decoupling seams documented in
`ARCHITECTURE.md` § Decoupling Seams.

Two new product decisions landed this session:

- `DECISIONS.md` § 10 — plugin API is earned, not designed.
- `DECISIONS.md` § 11 — local MVP is feature-complete.

`PRODUCT_PLAN.md` § Local MVP and `ARCHITECTURE.md` § Editor Model
were updated to reflect the raw-view toggle and the three planned
seams (toolbar registry, `MarkdownCommand`, `EditorContribution`).

## What landed in this session

```
a5e9cd2 Add raw markdown view mode with Compartment-based live toggle
```

The raw view swaps the preview decoration pipeline
(`markdownPreview` + `tableBlockState` + `htmlCommentBlockState`)
in and out via a CodeMirror `Compartment`, so the doc, selection,
and history survive the toggle. Font swap to monospace happens via
a CSS class (`.editorMountRaw`) so the editor theme does not have
to be reconfigured. Four new e2e tests cover the toggle.

## Repo state

- Branch: `spike/editor-core`
- HEAD: `a5e9cd2` (plus the four uncommitted doc updates this
  session if not yet committed when you read this).
- Working tree: see `git status`.
- Test baseline: 99 passed / 31 skipped / 0 failed
  (`pnpm test:e2e`) — 95 from the prior baseline plus the 4 new
  raw-mode tests.
- Typecheck: clean (`pnpm typecheck` runs `tsc -b --noEmit`).
- Bundle: 0.0.15 (Tauri crate + app + `tauri.conf.json` aligned —
  unchanged since the migration session; rebuild before the next
  release).

## Polish punch list — close these before sealing v1

Each item is small enough to land as a single commit. Run the
agent pipeline (explore → architect if cross-cutting → implement →
security + tests in parallel → review → commit) per the user's
global instructions.

1. **Persist `raw` and `zen` mode prefs to localStorage.** Theme
   already persists via `src/theme.ts`; the two view-mode toggles
   forget on reload. Mirror the theme pattern: `getStoredViewMode`
   / `storeViewMode` helpers, hydrate the `useState` initial value.
   Make sure SSR-safe (the file already uses `typeof window`
   guards elsewhere — match those). Add e2e coverage that reload
   preserves both flags.

2. **Keyboard shortcuts for view modes.** Bind `Cmd-Shift-R` (raw)
   and `Cmd-.` (zen) at the app level — not in the CodeMirror
   keymap, since these toggle React state, not editor state. Wire
   through `keydown` listener on `window` with the existing
   meta-key precedent in `src/MarkdownEditor.tsx` (the link-click
   handler). Update the `title` attributes on the toggle buttons
   to mention the shortcut. Add e2e coverage.

3. **`aria-pressed` parity on the Zen toggle.** The Raw toggle now
   exposes `aria-pressed`; Zen does not. Code reviewer flagged
   this as a follow-up. Two-line fix in `src/App.tsx`. No new test
   needed beyond updating the existing zen-mode assertion if it
   touches accessibility.

4. **Status bar word/char count behaviour in raw mode.** Today the
   status bar shows `markdown.length` chars in both modes. In raw
   mode it could also show line count (the source view exposes
   line numbers as a meaningful unit). Optional — promote to "do"
   only if the user wants it.

5. **Drag-and-drop `.md` onto the window.** Optional. The Tauri
   adapter already supports file open via dialog; HTML5 drop
   handling on the editor shell is straightforward. Promote only
   if the user wants it.

Items 1–3 are the v1-blockers. Items 4–5 are nice-to-haves and can
be deferred into the Comments milestone or skipped.

## After polish — Comments and annotations milestone

Per `PRODUCT_PLAN.md` § Milestones, the next active milestone is
Comments and annotations.

Direction (from `ARCHITECTURE.md` § Comments And Annotations and
`DECISIONS.md` § 6):

- Comment body and thread metadata live outside the Markdown
  body. Local: sidecar metadata files
  (e.g. `<filename>.md.meta.json`). Cloud (later): database
  records.
- Optional hidden HTML comment anchors (`<!-- mdx-comment-anchor:id=c_abc123 -->`)
  may be inserted into the `.md` for robust reattachment. The
  current `htmlCommentBlockState` extension already hides
  `<!-- ... -->` blocks from the rendered view, so anchors stay
  invisible to readers.
- Pencil frames in `markdown.pen` show right-side thread panel and
  margin markers — both light and dark variants.
- Anchors should target Lezer node ranges (the Lezer-tree
  migration was explicitly done to enable tree-stable anchoring).

Open design question from `DESIGN_BRIEF.md` § Open Design
Questions: "Should comments be visible as margin markers by
default or only when the comments panel is open?" Resolve before
implementation; route through `gsd-explore` if scope is unclear.

The Comments milestone is the first feature that should drive
out the seams in `ARCHITECTURE.md` § Decoupling Seams:

- Toolbar registry — Comments needs a "comment on selection"
  toolbar button. Carve the registry as part of this work.
- `MarkdownCommand` interface — formalize the existing
  `wrapSelection` / `insertBlock` / `toggleLinePrefix` shape, then
  add `insertCommentAnchor` against it.
- `EditorContribution` shape — Comments contributes CM extensions
  (decorations for highlighted ranges + margin gutter), a toolbar
  item, and a keymap entry. Bundle them behind the contribution
  shape rather than wiring each into `App.tsx` ad hoc.

The seams are tools, not goals. Carve only what Comments forces
out. Do not pre-design for collaboration / history / MCP — those
will refine the seams when they are built.

## Architecture invariants (carry forward)

- `.md` text is the canonical document source.
- AI / MCP edits go through the same mutation path as human
  edits.
- Comments are metadata anchored to Markdown, not normal visible
  Markdown content.
- Local offline use does not require an account.
- No "document" / "doc id" / "sync" in new code, comments, commit
  messages — use "file" / "handle" / "path" / "save" per
  `AGENTS.md`.
- Inline-construct decorations come from Lezer nodes
  (`StrongEmphasis` / `Emphasis` / `InlineCode` / `Strikethrough`
  / `Link`); the `<u>...</u>` underline stays regex-driven (no
  Lezer node exists for it).
- Block-level constructs classify from `classifyBlockLine` (heading,
  bullet/ordered list, GFM task list, blockquote, horizontal rule).
- Fenced code detection comes from `getFencedCodeContext` and the
  shared `isLineInsideFencedCode` helper.
- HTML comment seeding uses `isPositionInHtmlComment` with a
  bounded 4 KB doc-text fallback for inline-multiline comments.

## Pipeline reminders

- Spawn explorers per domain in parallel before touching code.
- For cross-cutting changes, run the `architect` agent and
  present the plan before implementing.
- Run `code-reviewer` on the unstaged diff before each commit.
- Use `commit-writer`; never write commit messages inline.
- The `gsd-*` skill family is available if a phase or milestone
  needs structured plan / verify / ship orchestration.

## How to start

If picking up the polish punch list, work items 1–3 in order and
commit each independently. The pipeline applies even for small
commits; security-audit and test-coverage-guardian still run in
parallel.

If picking up the Comments milestone, start in `PRODUCT_PLAN.md`
§ Comments And Annotations and `ARCHITECTURE.md` § Comments And
Annotations, then route through `gsd-explore` or `architect` for
the design before implementation.
