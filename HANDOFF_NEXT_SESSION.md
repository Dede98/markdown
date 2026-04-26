# Handoff — Post Lezer-tree migration

Status: shipped. Every decoration in `src/markdownPreview.ts` now reads
from `syntaxTree(state)` (the Lezer tree parsed by
`@codemirror/lang-markdown` with the GFM extension) instead of regex
over text. The `lineContextField` StateField is gone. Bundle is at
0.0.15 with a built `.dmg`. Test baseline holds at 95 passed / 31
skipped / 0 failed.

The next session has a choice between three lanes: small polish on
the migration, the next product milestone, or unblocking work on the
codebase that this migration enables.

## What landed this session

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

- `@lezer/markdown` and `@lezer/common` are now direct deps
  (pnpm's strict resolver only hoists direct deps, so the `GFM` and
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
- HEAD: `3009e9a`
- Working tree: clean
- Test baseline: 95 passed, 31 skipped, 0 failed (`pnpm test:e2e`)
- Typecheck: clean (`pnpm typecheck` runs `tsc -b --noEmit`)
- Bundle: 0.0.15 (Tauri crate + app + `tauri.conf.json` aligned)

## Architecture invariants now enforced by the tree

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
- HTML comment seeding at the start of each visible range comes
  from `isPositionInHtmlComment(state, pos)` walking up to a
  `Comment` / `CommentBlock` ancestor.

## Active-toggle semantics preserved

`isLineActive` for line-level constructs (heading prefix, task /
bullet markers, blockquote `> `, HR, fence opener / closer);
`isRangeActive` for inline constructs (bold / italic / code / strike
/ underline / link). Both helpers and the `decorateSyntax` mark-vs-
replace pattern survived the migration unchanged.

## Open follow-ups

### Migration polish (small, ~half session)

1. **Migrate `tableBlockState` + `htmlCommentBlockState` to the
   tree.** Both StateFields still scan `^\`\`\`` per line via regex
   to avoid emitting their block decorations inside fenced code.
   The ViewPlugin path no longer does this — the StateField path
   should follow. `FencedCode` ranges are already in the tree;
   walking them is cheaper than per-line regex. Reviewer flagged
   the divergence as a smell.

2. **Stale test comment.** `tests/e2e/editor.spec.ts:449-451`
   still references the retired `lineContextField` precompute. The
   test passes (the new tree-based fence detection is also
   viewport-independent), but the comment misleads. Update to
   reference `getFencedCodeContext` reading the `FencedCode` node.

3. **Inline-multi-line HTML comment seed gap.** Lezer's `Comment`
   and `CommentBlock` nodes only fire for top-level or single-line
   `<!-- ... -->`. A comment opened inline in a paragraph that
   spans newlines (` prose <!-- a\nb --> prose `) is not tagged,
   so a visible range opening exactly mid-comment in that shape
   would seed `inHtmlComment = false` instead of `true`. Documented
   in `isPositionInHtmlComment`. Not exercised by the e2e suite.
   Fix would be a forward-scan fallback when no Lezer comment node
   covers the range start, or accept and add an e2e test that
   pins current behaviour.

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

If picking up migration polish:

```bash
git status                        # confirm clean working tree
pnpm typecheck                    # baseline
pnpm test:e2e                     # baseline 95 / 31
```

Then pick item 1, 2, or 3 from "Migration polish" above. Each is
a single small commit.

If picking up the next milestone, start in `PRODUCT_PLAN.md` and
read `ARCHITECTURE.md` + `DECISIONS.md` before proposing a plan.
The agent pipeline (explore → architect → implement → security +
tests in parallel → review → commit) applies to every coding task,
per the user's global instructions.

## Pipeline reminders for next session

- Spawn explorers per domain in parallel before touching code.
- For cross-cutting changes, run `architect` agent and present the
  plan before implementing.
- Run `code-reviewer` on the unstaged diff before each commit
  (this session caught a missing `Text` import and a missing
  `@lezer/common` direct dep that way).
- Use `commit-writer`; never write commit messages inline.
- The `gsd-*` skill family is available if a phase or milestone
  needs structured plan / verify / ship orchestration.
