# Handoff — Lezer-tree migration polish complete

Status: shipped. Every decoration in `src/markdownPreview.ts` now reads
from `syntaxTree(state)` (the Lezer tree parsed by
`@codemirror/lang-markdown` with the GFM extension) instead of regex
over text. The `lineContextField` StateField is gone. The three
migration-polish follow-ups flagged in the previous handoff are also
done. Test baseline holds at 95 passed / 31 skipped / 0 failed.

The next session picks the next product milestone from
`PRODUCT_PLAN.md` or one of the unblocked codebase moves the
migration enabled.

## What landed in the polish session

```
4c6da72 Add doc-text fallback to isPositionInHtmlComment for inline multi-line comments
4a0469e Migrate tableBlockState and htmlCommentBlockState fence detection to Lezer tree
3829e40 Update fence-body test comment to reference Lezer-tree detection
07afeb0 Reframe handoff: Lezer-tree migration shipped, surface next lane choices
```

`3829e40` closed prior item #2 (stale `lineContextField` test comment).
`4a0469e` closed item #1 (`tableBlockState` + `htmlCommentBlockState`
fence detection moved off `^\`\`\`` regex onto the new
`isLineInsideFencedCode(state, line)` helper, which walks the Lezer
tree for a `FencedCode` ancestor — same source the ViewPlugin path
already used via `getFencedCodeContext`).
`4c6da72` closed item #3 (inline-multiline `<!--` / `-->` comment seed
gap — `isPositionInHtmlComment` now falls back to a bounded 4 KB
doc-text scan when no Lezer `Comment` / `CommentBlock` ancestor covers
the position).

## What landed in the original migration session

```
3009e9a Bump Tauri crate and app version to 0.0.15
c3d45ba Fix typecheck script to use project-references build mode
7153879 Replace lineContextField precompute with Lezer tree queries
890ba35 Replace regex block-line detection with Lezer-tree classification
7a02e1f Replace inline-syntax regex passes with Lezer tree walk
96c861f Enable GFM extension on markdown() language config
```

Each migration commit (`96c861f`, `7a02e1f`, `890ba35`, `7153879`) is
independently revertable; the test baseline held at every step.

Notable details:

- `@lezer/markdown` and `@lezer/common` are direct deps (pnpm's
  strict resolver only hoists direct deps, so the `GFM` and
  `SyntaxNode` symbols had to be imported from a hoisted path).
- `pnpm typecheck` was a silent no-op for composite projects until
  `c3d45ba`. The real check used to live only inside `pnpm build`
  (`tsc -b && vite build`); now `pnpm typecheck` does the right
  thing on its own.
- Manual scroll-past-fence test passed live in `pnpm tauri:dev`:
  fence body stays styled when the opener row is above the
  viewport, ` **markers** ` inside fenced code render as raw text.
- `.dmg` bundle: `src-tauri/target/release/bundle/dmg/Markdown_0.0.15_aarch64.dmg`
  (4.2 MB).

## Repo state

- Branch: `spike/editor-core`
- HEAD: `4c6da72`
- Working tree: clean
- Test baseline: 95 passed, 31 skipped, 0 failed (`pnpm test:e2e`)
- Typecheck: clean (`pnpm typecheck` runs `tsc -b --noEmit`)
- Bundle: 0.0.15 (Tauri crate + app + `tauri.conf.json` aligned —
  unchanged since the migration session; rebuild before the next
  release).

## Architecture invariants enforced by the tree

- Inline constructs (bold, italic, inline code, strikethrough, link)
  decorate from `StrongEmphasis` / `Emphasis` / `InlineCode` /
  `Strikethrough` / `Link` Lezer nodes. The `<u>...</u>` underline is
  the only inline construct that stays regex-driven (no Lezer node
  exists for it).
- Line-level block constructs (heading, bullet/ordered list, GFM
  task list, blockquote, horizontal rule) classify from
  `classifyBlockLine(state, line)` which reads marker children
  (`HeaderMark`, `ListMark`, `TaskMarker`, `QuoteMark`) plus
  `HorizontalRule` and `ATXHeading1..6`.
- Fenced code detection comes from `getFencedCodeContext(state, line)`
  walking up to the `FencedCode` ancestor and reading its `CodeMark`
  + `CodeInfo` children. Body lines get `cm-md-code-line` and the
  JS/TS tokenizer in `decorateCodeLine`; opener and closer lines
  share `cm-md-code-fence` + replace-when-inactive.
- Both block-decoration StateFields (`tableBlockState`,
  `htmlCommentBlockState`) now share the same fence source via
  `isLineInsideFencedCode(state, line)` — a thin helper that
  short-circuits at the first `FencedCode` ancestor without
  collecting `CodeMark` / `CodeInfo`.
- HTML comment seeding at the start of each visible range comes
  from `isPositionInHtmlComment(state, pos)`. Primary path walks up
  to a `Comment` / `CommentBlock` ancestor; fallback path scans
  ±4 KB of doc text for `<!--` / `-->` to handle inline-opened
  multi-line comments (`prose <!-- a\nb --> tail`) which Lezer's
  GFM grammar leaves untagged.

## Active-toggle semantics preserved

`isLineActive` for line-level constructs (heading prefix, task /
bullet markers, blockquote `> `, HR, fence opener / closer);
`isRangeActive` for inline constructs (bold / italic / code / strike
/ underline / link). Both helpers and the `decorateSyntax` mark-vs-
replace pattern survived the migration unchanged.

## Open follow-ups

### Migration polish — closed

All three items from the prior handoff are landed:

1. ~~`tableBlockState` + `htmlCommentBlockState` regex fence
   toggle.~~ Closed by `4a0469e`.
2. ~~Stale test comment referencing `lineContextField`.~~ Closed
   by `3829e40`.
3. ~~Inline-multi-line HTML comment seed gap.~~ Closed by
   `4c6da72`.

Two reviewer notes carried forward as low-priority cleanups; both
are style-only and not blocking:

- `getFencedCodeContext` and `isLineInsideFencedCode` duplicate the
  "walk parents to FencedCode" loop. A private
  `findFencedCodeAncestor(state, pos): SyntaxNode | null` helper
  could collapse the duplication. Skipped to keep the polish diff
  minimal.
- `SCAN_WINDOW = 4096` is locally scoped inside
  `isPositionInHtmlComment`. If a second caller appears, lift to a
  module constant.

One acceptable edge case in the new fallback: when `SCAN_WINDOW`
truncates a prior closer, `lastIndexOf("<!--")` can match an
already-closed comment's opener and report `pos` as in-comment when
it isn't. Bounded impact — only seeds the per-line scanner, which
recovers as soon as visible-range text contains a real `<!--` /
`-->` boundary. Documented inline at the call site. No e2e
regression test was added: the inline-multiline scroll-mid-comment
scenario is hard to pin deterministically and the test-coverage
agent recommended shipping without one.

### Product milestones from `PRODUCT_PLAN.md`

The migration unblocks every milestone that wants tree-shaped
knowledge of the file:

- **Comments** — comment anchors over Lezer node ranges, not text
  offsets. Tree-stable across edits is the right substrate.
- **Yjs realtime collab** — Yjs awareness presence rendered as
  decorations next to `syntaxTree` ranges; AI-agent participants
  get the same treatment as humans.
- **History / snapshots** — diffs anchored to tree paths instead
  of raw line numbers.
- **MCP / AI agent edits** — agent edits go through the same
  `EditorState` mutation path as human edits, and the tree gives
  the agent a stable structural view.

The roadmap order in `PRODUCT_PLAN.md` is canonical. Pick the next
milestone there, route through `gsd-explore` if scope is unclear.

### Codebase invariants for any next change

- Keep `.md` as the canonical file (per `DECISIONS.md`).
- Local offline use must not require an account.
- AI / MCP edits use the same document mutation path as human
  edits.
- Comments are metadata anchored to Markdown, not normal visible
  Markdown content.
- No "document" / "doc id" / "sync" in new code, comments, commit
  messages — use "file" / "handle" / "path" / "save" per
  `AGENTS.md`.

## How to start

If picking up the next milestone, start in `PRODUCT_PLAN.md` and
read `ARCHITECTURE.md` + `DECISIONS.md` before proposing a plan.
The agent pipeline (explore → architect → implement → security +
tests in parallel → review → commit) applies to every coding task,
per the user's global instructions.

If revisiting the optional polish suggestions above, they're a
single small commit each — no need for the full pipeline.

## Pipeline reminders for next session

- Spawn explorers per domain in parallel before touching code.
- For cross-cutting changes, run `architect` agent and present the
  plan before implementing.
- Run `code-reviewer` on the unstaged diff before each commit.
- Use `commit-writer`; never write commit messages inline.
- The `gsd-*` skill family is available if a phase or milestone
  needs structured plan / verify / ship orchestration.
