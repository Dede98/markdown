# Handoff — Editor Feature Pack v2

Status: paused after a botched rendering attempt. Branch was reverted to a
known-good state (`34a8021`). The bundle ships as **v0.0.5** with the
post-revert tree.

## Context

A previous session shipped the Mac MVP polish + Dark Mode work plus an
editor feature pack (H4-H6, strikethrough, GFM table source styling,
Cmd+Click links). That pack landed in commit `41cf97d`. The follow-up
attempt to (a) render tables as real `<table>` widgets, (b) hide HTML
comments, and (c) add `<u>` underline broke mid-file rendering and only
partially handled comments. That commit (`c9be05e`) was reverted in
`34a8021`.

The user's reported failure modes from the broken build:

1. _"Rendering breaks mid file"_ — likely caused by the block-level
   `Decoration.replace` for tables: ranges or ordering were almost
   certainly wrong, and on some documents the decoration set got
   rejected silently. The follow-up code adds a `Decoration.line`
   marker for every line of the active block during the first
   iteration, which probably collides with subsequent per-line
   handling.
2. _"I still see html comments"_ — the regex was single-line only
   (`<!--[\s\S]*?-->` matched against `text` of one line). Multi-line
   HTML comments stay visible.
3. _Underline rolled back along with the rest_ — `<u>...</u>` regex
   itself worked, but the surrounding feature pack had to come out
   wholesale because the changes were intermixed in the same commit.

## Repo State

- Branch: `spike/editor-core`
- HEAD: `34a8021` (revert) → version bump to 0.0.5 staged in working tree
  but not yet committed at the time of this writeup
- Last good behavior commit: `41cf97d` (Add H4-H6, strikethrough,
  tables, and Cmd+Click links)
- Tauri bundle: produced at
  `src-tauri/target/release/bundle/macos/Markdown.app` and
  `src-tauri/target/release/bundle/dmg/Markdown_0.0.5_aarch64.dmg`

## What works (do NOT regress)

- Dark mode (theme toggle, `data-theme` attribute, prefers-color-scheme,
  no FOUC)
- Mod+S save without closure-capture race (`markdownRef` + `fileVersionRef`)
- Adapter exposure gated to dev origin
- `bundle.fileAssociations` for `.md/.markdown/.mdx/.mdown`
- `RunEvent::Opened` handler with cold-start queue + live emit
- `tauri://drag-drop` listener
- `titleBarStyle: Overlay` with explicit JS drag handler in capture phase
- Real macOS app icon set (icon.icns, icon.ico, sized PNGs)
- About panel populated, baseline CSP
- Tauri shell plugin enabled with `shell:allow-open` permission for
  http/https/mailto
- `Cmd+Click` on rendered links opens externally
- Heading dropdown 1–6, dedicated H3 button alongside H1/H2
- Strikethrough rendering (`~~text~~`) + toolbar button + format
  detection
- Source-mode table rendering: pipe-bordered lines render in monospace
  with separator-row class — note this is NOT a real `<table>`,
  just lined-up source

## What's missing — the next session's task

1. **HTML comments hidden in preview.** Both single-line `<!-- foo -->`
   and multi-line variants. Multi-line needs a state flag in the loop
   similar to `inCodeFence` so a line that opens a comment but doesn't
   close it enters `inHtmlComment = true`, and following lines stay in
   that mode until a `-->` is seen. When a line is entirely inside the
   comment AND not active, replace the whole line range; when active,
   mark with `cm-md-syntax`.

2. **Real `<table>` widget for GFM tables.** When the cursor is outside
   the block, render a real `<table>` element via `Decoration.replace`
   with `block: true`. When inside, fall back to source view.
   Lessons from the failed attempt:
   - The first iteration of the block must NOT add per-line
     `Decoration.line` for every block line. That collides with
     subsequent loop iterations on the same lines, which CodeMirror
     either rejects or silently breaks.
   - Use a single advance: detect block start, decide active vs
     widget, set `position = block.lastLine.to + 1` regardless, and
     `continue`. Only the FIRST iteration of the block does any work
     for the block; subsequent iterations skip it because position
     jumps over them.
   - Block-level `Decoration.replace` ranges must span complete
     lines. `from = firstLine.from`, `to = lastLine.to`. Don't include
     the trailing newline.
   - `Decoration.set(decorations, true)` already sorts. Order added
     doesn't matter in the array, but RANGES must not overlap with
     other line decorations on the same lines if they were already
     added by some earlier iteration. Skipping subsequent iterations
     fully prevents double-decoration.
   - For active blocks, don't add anything block-wide on the first
     iteration; let each row iteration add its own line class. Move
     position forward by one line only when active.
   - The `TableWidget.eq` from the failed attempt is correct. Keep it.

3. **HTML underline `<u>...</u>`.** Single-line is fine; multi-line is
   not a goal. Add as inline regex similar to `~~strike~~`. Wire up:
   - regex in `markdownPreview.ts` after the strike block
   - `underline` field on `ActiveFormat` + `emptyFormat`
   - getter in `editorFormat.getActiveFormat`
   - toolbar button using lucide `Underline` icon
   - CSS rule `.cm-md-underline { text-decoration: underline; }`

4. **(Optional)** Tighten link UX: add a hover/focus indicator that
   hints at Cmd+Click. Today the link looks the same regardless of
   modifier. Could be a discrete "open" cursor when meta is held.

## Implementation order suggestion

Do all four in separate commits so any one can be reverted cleanly:

1. Multi-line + single-line HTML comments — small surface, easiest to
   verify by hand.
2. `<u>` underline — small inline regex pattern, low risk.
3. Real `<table>` widget — biggest risk. Build it incrementally:
   first only widget mode (always replace; ignore the
   active-stays-source path) to validate the decoration math; THEN
   add the active-stays-source branch.
4. Optional link cursor polish.

## Verification

Run for every commit:

```bash
pnpm typecheck
pnpm build
pnpm test:e2e          # baseline must stay at 67 passed, 25 skipped
cd src-tauri && cargo check
pnpm tauri:build       # produces .app + .dmg
```

For tables specifically: write a fixture file like the one below and
scroll past it to confirm rendering doesn't fall apart anywhere
mid-file. The previous attempt failed somewhere AFTER the table
block, which suggests the issue is downstream decoration ranges.

```md
# Heading

Paragraph before the table.

| Col A | Col B | Col C |
| ----- | :---: | ----: |
| 1     | 2     | 3     |
| 4     | 5     | 6     |

Paragraph after the table.

<!-- single-line comment that should disappear -->

<!--
multi-line
comment
-->

Some text with <u>underlined run</u> in the middle.
```

After loading: the comments should be invisible, the table should
read as a styled grid, the underline should appear underlined, AND
all paragraphs around them should still render correctly.

## Files most relevant

- `src/markdownPreview.ts` — main decoration loop. All three features
  live here.
- `src/editorFormat.ts` — adds `underline` (and confirm `table`
  already exists) to `ActiveFormat`.
- `src/App.tsx` — toolbar button wiring, lucide icon imports.
- `src/styles.css` — visual rules. Tables and underline.
- `src/MarkdownEditor.tsx` — Cmd+Click handler is here. No changes
  needed for the missing features unless the table widget grows
  interactive cells.

## Naming rule reminder

Per `AGENTS.md`: only "file" / "handle" / "path" / "save". Avoid
"document" / "doc id" / "sync" in new code, comments, and commit
messages.

## Pipeline rule reminder

Per the user's global agents instructions: every coding task runs
the explore → architect (if cross-cutting) → implement → security +
tests in parallel → code review → commit pipeline. Never skip steps.
