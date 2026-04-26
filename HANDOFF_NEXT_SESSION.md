# Handoff — Lezer-driven decorations

Status: ready to start. Two CM6 decoration bugs were fixed and locked in
with regression tests in this session. The next session migrates
`buildDecorations` from regex-over-text to the Lezer syntax tree
already parsed by `@codemirror/lang-markdown`.

## Why this is the next move

`ARCHITECTURE.md` Layer 2 of the editor model is "Markdown
parser/syntax tree". Current code violates this: `markdown()` is loaded
in `MarkdownEditor.tsx` only for the default highlighter. All inline
decorations come from line-bounded regex passes inside `buildDecorations`
(`src/markdownPreview.ts`). Two bugs this session both came from this
architecture:

1. **Margin-on-table-widget click drift** (`161a53a`) — solved with a
   `<div>` wrapper + padding, but the underlying class of "widget root
   geometry must agree with CM6 height map" is recurring.
2. **Viewport-only `inCodeFence` reset** (`161a53a`) — solved with a
   `lineContextField` StateField that snapshots fence/comment state
   per line over the full doc; `buildDecorations` seeds its loop from
   the field. Tree-driven decorations would never have been able to
   produce this bug because Lezer parses the whole doc.

Long-term, every milestone in `PRODUCT_PLAN.md` (Comments, Yjs cloud
collab, History/snapshots, MCP) wants tree-shaped knowledge of the
document. Migrating now means each future feature gets the tree for
free instead of growing its own ad-hoc parser.

## What landed this session

- `161a53a` Fix CM6 decoration drift on long and scrolled docs
  - `TableWidget.toDOM` wraps `<table>` in
    `<div class="cm-md-table-wrapper">` (display:block, padding for
    spacing instead of margin so `getBoundingClientRect` reports the
    full widget height)
  - `lineContextField` StateField precomputes per-line
    `{ inFence, fenceLanguage, inHtmlComment }` over the full doc;
    `buildDecorations` reads it via `state.field()` to seed loop
    variables when entering each visible range
  - Field registered in `MarkdownEditor.tsx` extensions list
- `b742a1b` Add regression tests for table height-map drift and fence
  body styling
  - "clicking a line below a rendered table positions the caret on
    that exact line" — locks in the height-map fix
  - "fence body stays styled as code after the opening ``` scrolls
    out of view" — locks in the lineContextField behavior

## Repo state

- Branch: `spike/editor-core`
- HEAD: `b742a1b`
- Last bundle bump: `9cc004e` v0.0.14 (predates this session's fixes —
  next bundle bump should cover both `161a53a` and `b742a1b` plus the
  Lezer refactor that follows)
- Working tree clean
- Test baseline: 95 passed, 31 skipped (mobile keyboard skips), 0 failed
- Tauri Mac dev tested live and confirmed by user

## Next session task — Lezer refactor

Goal: drive every decoration in `src/markdownPreview.ts` from
`syntaxTree(state)` instead of regex-over-text. Preserve every
visible behavior (active-cursor marker toggle, all CSS classes, all
widgets, all StateFields).

### Constraints — do not regress

These behaviors are explicitly tested or visually relied on:

- Active-cursor marker toggle: `isLineActive` for line-level
  constructs (heading prefix, task/bullet markers, blockquote `> `,
  HR, fence opener); `isRangeActive` for inline constructs
  (bold/italic/code/strike/underline/link)
- Custom `<u>...</u>` underline (no Lezer node — keep regex)
- JS/TS syntax highlighting inside fenced code blocks (custom
  `decorateCodeLine` regex pile — keep as is, but feed it from the
  tree's `FencedCode` body range instead of `lineContextField`)
- Block-level TableWidget StateField (`tableBlockState`) — keep
- Block-level HTML comment hide StateField (`htmlCommentBlockState`) — keep
- TaskMarkerWidget click-to-toggle, BulletMarkerWidget, RuleWidget —
  keep
- Every CSS class in the catalog (see prior session research; all
  `.cm-md-*` classes used by tests are listed)

### Implementation order — four commits, each independently revertable

1. **Enable GFM extension on `markdown()`**
   - Use `markdown({ extensions: [GFM] })` from
     `@lezer/markdown`. This adds Strikethrough, Task, Table,
     Autolink, TaskList nodes to the parsed tree.
   - No behavior change yet — `buildDecorations` still uses regex.
   - Verify: `pnpm typecheck` + `pnpm test:e2e` baseline holds.

2. **Migrate inline syntax to tree**
   - In `buildDecorations`, replace these regex passes with a
     `syntaxTree(view.state).iterate({ from, to, enter })` walk
     inside each visible range:
     - `StrongEmphasis` → mark inner `cm-md-bold`, toggle markers
     - `Emphasis` → mark inner `cm-md-italic`, toggle markers
     - `InlineCode` → mark inner `cm-md-inline-code`, toggle markers
     - `Strikethrough` (GFM node) → mark inner `cm-md-strike`,
       toggle markers
     - `Link` → label `cm-md-link`; active vs inactive collapse rules
       per current code
   - Keep `<u>...</u>` regex pass (no Lezer node).
   - Walk markers via child node iteration: `EmphasisMark`,
     `CodeMark`, `StrikethroughMark`, `LinkMark`, `URL`.
   - Verify after each construct: rerun the inline tests in
     `tests/e2e/editor.spec.ts`.

3. **Migrate line-level block constructs to tree**
   - Replace these regex passes with tree visits:
     - `ATXHeading1..6` → `Decoration.line` for `cm-md-heading`
       + `cm-md-heading-{N}`; `decorateSyntax` for `HeaderMark` child
     - `BulletList` / `ListItem` → `cm-md-list` + bullet marker
       widget
     - `OrderedList` / `ListItem` → `cm-md-list` + ordered marker
       mark
     - `Task` (GFM) → `cm-md-task-list` + `TaskMarkerWidget`
     - `Blockquote` → `cm-md-quote` + `> ` marker toggle
     - `HorizontalRule` → `cm-md-rule` + `RuleWidget`
   - Keep table row decoration logic for now (interacts with
     `tableBlockState`).
   - Verify line-level e2e tests.

4. **Migrate fence to tree, retire `lineContextField`**
   - `FencedCode` (with `CodeText` child for body) gives exact body
     range. Apply `cm-md-code-line` line decoration to every line in
     the body range. Apply `cm-md-code-fence` line + active-toggled
     fence-line replace to opener/closer.
   - `decorateCodeLine` (JS/TS highlighting) still runs, but its
     line iteration is driven by the tree's `CodeText` range, not
     by the per-line `inCodeFence` flag.
   - Once `buildDecorations` no longer reads
     `view.state.field(lineContextField)`, delete the field, its
     export, the `LineContext` type, `buildLineContextMap`, and the
     extension registration in `MarkdownEditor.tsx`.
   - HTML comment block detection in `htmlCommentBlockState` still
     runs over full doc — keep it.
   - Verify: full suite + manual scroll-past-fence test.

After all four commits, optionally bump bundle version (e.g. v0.0.15)
and produce the .dmg.

### Implementation notes

- `syntaxTree` is imported from `@codemirror/language`.
- `tree.iterate({ from, to, enter })` visits every node whose range
  overlaps `[from, to]`. Return `false` from `enter` to skip children.
- Node names are stable strings (e.g. `"StrongEmphasis"`,
  `"FencedCode"`). Compare via `node.type.name`.
- For GFM nodes (`Strikethrough`, `Task`, `Table*`,
  `TaskList`, `Autolink`), the GFM extension must be passed to
  `markdown()`. Without it, those nodes don't exist in the tree.
- For each construct, child nodes carry the markers
  (`EmphasisMark`, `CodeMark`, `LinkMark`, `URL`, `HeaderMark`).
  Use `node.firstChild` / `node.lastChild` / `cursor.iterate` over
  the parent's children to find them.
- The `enter` callback signature: `(type: NodeType, from: number,
  to: number, get: () => SyntaxNode) => boolean | void`. Use
  `get()` to grab a `SyntaxNode` for parent/child traversal.
- The `lang-markdown` package version in `package.json` is
  `^6.3.4`. Confirm node names against that version — Lezer node
  names occasionally rename across major versions.
- The active-cursor toggle behavior is independent of the tree — it
  reads `view.state.selection`. Keep `isRangeActive` and
  `isLineActive` helpers as-is.

### Verification per commit

```bash
pnpm typecheck
pnpm test:e2e          # baseline 95 passed, 31 skipped
```

For commit 4 specifically: also run a manual scroll test in
`pnpm tauri:dev` with a doc containing a long fenced code block, to
confirm the tree-driven fence detection holds when the opener
scrolls out of view.

### Files most relevant

- `src/markdownPreview.ts` — entire decoration pipeline
- `src/MarkdownEditor.tsx` — `markdown()` extension registration,
  StateField imports
- `src/styles.css` — visual rules (no changes expected, but verify)
- `tests/e2e/editor.spec.ts` — full regression baseline

## Naming rule reminder

Per `AGENTS.md`: only "file" / "handle" / "path" / "save". Avoid
"document" / "doc id" / "sync" in new code, comments, and commit
messages.

## Pipeline rule reminder

Per the user's global agents instructions: every coding task runs
the explore → architect (if cross-cutting) → implement → security +
tests in parallel → code review → commit pipeline. For this refactor:

- Explore: confirm Lezer node names against the installed
  `@lezer/markdown` version, and verify GFM extension API surface
  (`@codemirror/lang-markdown` exports `GFM` or accepts an
  extensions list — read the actual package.json + types from
  `node_modules`)
- Architect: write the per-commit decoration → tree-node mapping
  table before touching code; sanity-check active-toggle behavior is
  preserved
- Implement, test, commit one piece at a time
