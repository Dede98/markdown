# Handoff — v1 sealed, next up: auto-update + Comments milestone

Status: the local editor MVP is feature-complete and the v1 polish pass is
done. `DECISIONS.md` § 11 already declared the local MVP feature-complete;
the polish punch list closed in the session that produced this handoff.

The next two lanes are:

1. **Auto-update for the Tauri Mac build** (gating before the v1 release
   announcement so users on v1 can pull v1.0.x and v1.1 without manual
   downloads). See § Auto-update lane below.
2. **Comments and annotations milestone** — the first non-built-in feature
   that drives out the seams in `ARCHITECTURE.md` § Decoupling Seams.

The user asked for the auto-update lane to land before the Comments
milestone starts. Treat that as the load-bearing ordering.

## What landed in the polish session

Five commits closed every item on the polish punch list and raised the
e2e baseline from 99 to 122 passing tests across the chrome-desktop /
chrome-mobile project pair:

```
2d8956d Add HTML5 drag-and-drop to open .md files in the web build
1b31c8a Show line count in status bar only when raw mode is active
1009c09 Add aria-pressed to Zen toggle for accessibility parity with Raw toggle
9fccb30 Bind Cmd/Ctrl-Shift-R and Cmd/Ctrl-. to raw and zen mode toggles
ad954ee Persist raw and zen view-mode prefs to localStorage across reload
```

Closed punch-list items:

1. **Mode-pref persistence** — `src/viewMode.ts` mirrors `src/theme.ts`:
   SSR-safe `getStoredRaw`/`storeRaw`/`getStoredZen`/`storeZen` helpers
   keyed `markdown.raw` / `markdown.zen`. Lazy `useState` init plus a
   write-through `useEffect` in `App.tsx`. Defense-in-depth boolean check
   on the write side parallels `isThemePref` in theme.ts.
2. **View-mode keyboard shortcuts** — Cmd/Ctrl-Shift-R toggles raw,
   Cmd/Ctrl-. toggles zen. Wired into the existing window keydown handler
   that already handled Cmd-S/O/N. Module-level `SHORTCUT_LABELS` IIFE
   reads `navigator.platform` once and renders ⌘⇧R / ⌘. on Mac, Ctrl+
   variants elsewhere; both toggle button titles embed the hint. A
   negative regression test asserts bare Cmd-R does not flip raw.
3. **Zen `aria-pressed`** — two-line a11y parity fix; existing zen test
   extended to assert both pressed states.
4. **Status-bar line count in raw mode** — `lineCount(markdown)` helper
   sits next to `wordCount`, conditional render between the "Markdown"
   label and the existing char count, only when `raw` is true. Comment
   notes the deliberate divergence from `EditorState.doc.lines`
   (gutter-style count includes a phantom trailing line).
5. **Web HTML5 drag-and-drop** — `loadDroppedFile` callback mirrors
   `loadPathFile`. Window-scoped capture-phase `dragover`/`drop`
   listeners gated on `!isTauriRuntime()` (Tauri keeps its
   `tauri://drag-drop` IPC path). Filter on
   `dataTransfer.types.includes("Files")` so plain text drags fall
   through to CodeMirror untouched. Four Playwright tests using real
   `DataTransfer` payloads cover happy path, non-`.md` rejection, dirty
   prompt (dismiss + accept), and multi-file "first markdown wins".

## Repo state

- Branch: `spike/editor-core`.
- HEAD: `2d8956d` plus any uncommitted handoff edits in this session.
- Working tree: see `git status`.
- Test baseline: 122 passed / 34 skipped / 0 failed (`pnpm test:e2e`).
- Typecheck: clean (`pnpm typecheck` runs `tsc -b --noEmit`).
- Bundle: still pinned at 0.0.15 (Tauri crate + `tauri.conf.json`
  unchanged since the migration session). The auto-update lane below
  needs a 0.0.16 (or higher) version bump before the first published
  release; do not bump speculatively.

## Auto-update lane

Goal: when the team publishes a GitHub Release, the Mac app on a user's
machine surfaces an in-app "update available" affordance and installs
the new version without the user touching a download page.

This is a planning lane until the user signs off on the design. The
research below documents the Tauri-blessed path; choose a release-source
and signing-key custodian before writing code.

### Moving parts

- **Tauri updater plugin** (`@tauri-apps/plugin-updater` plus the
  `tauri-plugin-updater` Rust crate). Tauri 2's official auto-update
  surface. Provides `check()` / `downloadAndInstall()` from the
  frontend; Rust side handles the signed-payload verification.
- **Update endpoint** (one of):
  - **GitHub Releases as the endpoint** — the simplest path. The plugin
    can be pointed at a static JSON URL (e.g.
    `https://github.com/<org>/<repo>/releases/latest/download/latest.json`).
    The release workflow uploads `latest.json` plus the signed
    `.app.tar.gz` / `.dmg` artefacts as release assets.
  - Self-hosted JSON endpoint — only worth it if we ever need
    differential updates or staged rollouts.
- **Signing keys** — Tauri requires a separate updater keypair (NOT the
  Apple Developer ID cert; a libsodium signature over the bundle). The
  public key is baked into `tauri.conf.json`; the private key signs
  release artefacts in CI. Decide where the private key lives (1Password
  secret, GitHub Actions encrypted secret, etc.) before generating it
  via `pnpm tauri signer generate`.
- **GitHub Actions release workflow** — `tauri-apps/tauri-action` is
  the canonical action. It runs `tauri build`, signs the bundle with
  the updater key, generates `latest.json`, attaches everything to the
  release, and (optionally) drafts the release as published.
- **App-side UI** — minimal: a non-intrusive "Update available" badge
  in the status bar or theme menu, with a "Restart and install" button.
  The download progress can show in the same affordance.

### Deciding before implementation

- Release cadence and tag pattern (e.g. `v0.0.16`, `v1.0.0`) — gates the
  GH Actions trigger and the version bump in `tauri.conf.json` /
  `package.json` / `src-tauri/Cargo.toml`. The current three-version
  drift (package.json 0.0.0, tauri.conf 0.0.15, Cargo crate?) needs
  reconciling before the first signed release.
- Signing key custodian and rotation policy.
- Whether updates should be opt-in (user clicks check) or auto-checked
  on launch with a notification — Tauri supports both; pick one before
  wiring the UI.
- Apple notarization strategy — the updater handles signing the
  *update payload*, but the bundle itself still needs an Apple Developer
  ID + notarization to avoid Gatekeeper warnings. If the project is
  shipping unsigned today, that needs to land in the same release pass.
- Channel strategy (stable only vs stable + beta). Default to stable
  only for v1; add a beta channel later if needed.

### Suggested first slice

1. **Plan agent** to design the full lane: version reconciliation,
   signing key generation, GH Actions release workflow, Tauri updater
   plugin wiring, in-app UI, and a test/staging path. Surface every
   open question above before touching code.
2. **One commit per concern** (mirrors the polish session pattern):
   version bump + reconcile, updater plugin install + config,
   `latest.json` shape, GH Actions workflow, UI affordance.
3. **Test the loop end-to-end** by publishing a 0.0.16 → 0.0.17 release
   on a draft tag before announcing v1.

Route through `gsd-explore` if any of the open questions need a deeper
look before planning.

## Comments and annotations milestone (next, after auto-update)

Per `PRODUCT_PLAN.md` § Milestones, the next active milestone is
Comments and annotations.

Direction (from `ARCHITECTURE.md` § Comments And Annotations and
`DECISIONS.md` § 6):

- Comment body and thread metadata live outside the Markdown body.
  Local: sidecar metadata files (e.g. `<filename>.md.meta.json`).
  Cloud (later): database records.
- Optional hidden HTML comment anchors
  (`<!-- mdx-comment-anchor:id=c_abc123 -->`) may be inserted into the
  `.md` for robust reattachment. The current `htmlCommentBlockState`
  extension already hides `<!-- ... -->` blocks from the rendered
  view, so anchors stay invisible to readers.
- Pencil frames in `markdown.pen` show right-side thread panel and
  margin markers — both light and dark variants.
- Anchors should target Lezer node ranges (the Lezer-tree migration
  was explicitly done to enable tree-stable anchoring).

Open design question from `DESIGN_BRIEF.md` § Open Design Questions:
"Should comments be visible as margin markers by default or only when
the comments panel is open?" Resolve before implementation; route
through `gsd-explore` if scope is unclear.

The Comments milestone is the first feature that should drive out the
seams in `ARCHITECTURE.md` § Decoupling Seams:

- Toolbar registry — Comments needs a "comment on selection" toolbar
  button. Carve the registry as part of this work.
- `MarkdownCommand` interface — formalize the existing
  `wrapSelection` / `insertBlock` / `toggleLinePrefix` shape, then add
  `insertCommentAnchor` against it.
- `EditorContribution` shape — Comments contributes CM extensions
  (decorations for highlighted ranges + margin gutter), a toolbar
  item, and a keymap entry. Bundle them behind the contribution shape
  rather than wiring each into `App.tsx` ad hoc.

The seams are tools, not goals. Carve only what Comments forces out.
Do not pre-design for collaboration / history / MCP — those will
refine the seams when they are built.

## Architecture invariants (carry forward)

- `.md` text is the canonical document source.
- AI / MCP edits go through the same mutation path as human edits.
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
- HTML comment seeding uses `isPositionInHtmlComment` with a bounded
  4 KB doc-text fallback for inline-multiline comments.
- View-mode prefs (`markdown.raw`, `markdown.zen`) and theme
  (`markdown.theme`) live in `localStorage`; never leak to the
  Markdown body.
- Web drag-drop `.md` and Tauri `tauri://drag-drop` both funnel through
  `replaceFile` so the dirty-guard prompt and downstream UI behave
  identically regardless of the shell.

## Pipeline reminders

- Spawn explorers per domain in parallel before touching code.
- For cross-cutting changes (auto-update is one), run the `architect`
  agent and present the plan before implementing.
- Run `code-reviewer` on the unstaged diff before each commit.
- Use `commit-writer`; never write commit messages inline.
- The `gsd-*` skill family is available if a phase or milestone needs
  structured plan / verify / ship orchestration.

## How to start

If picking up the auto-update lane, start by reconciling the version
strings (`package.json` 0.0.0 vs `tauri.conf.json` 0.0.15 vs the Cargo
crate) and surface the open questions in § Auto-update lane to the user.
Do not generate signing keys or wire the GH Actions workflow until the
release-source / custodian / cadence questions are answered.

If picking up the Comments milestone after auto-update is done, start
in `PRODUCT_PLAN.md` § Comments And Annotations and `ARCHITECTURE.md`
§ Comments And Annotations, then route through `gsd-explore` or
`architect` for the design before implementation.
