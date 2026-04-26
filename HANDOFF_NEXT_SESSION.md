# Handoff — auto-update + OSS release shipped, next up: Comments

Status: v0.0.17 is live on GitHub Releases under the `Dede98/markdown`
project, MIT-licensed, with end-to-end auto-update wired through the
Tauri updater plugin. The local editor MVP is feature-complete
(`DECISIONS.md` § 11) and now the distribution loop is too.

The next active lane is the **Comments and annotations milestone** —
the first non-built-in feature that drives out the seams in
`ARCHITECTURE.md` § Decoupling Seams.

## What landed in the auto-update + OSS session

### Auto-update lane (5 commits, v0.0.16)

```
ae82d9a Surface auto-update affordance in the topbar (Tauri build)
659c9fc Add Release workflow that drafts a signed Mac release on a v* tag
3df8c2e Install and initialize the Tauri updater and process plugins
01a29b1 Configure Tauri updater plugin with GitHub releases endpoint
a85e0b1 Bump bundle to 0.0.16 ahead of first auto-update release
```

- **Tauri updater plugin** wired in Rust (`tauri-plugin-updater` +
  `tauri-plugin-process`) and JS (`@tauri-apps/plugin-updater` +
  `@tauri-apps/plugin-process`). Capabilities at
  `src-tauri/capabilities/default.json` grant `updater:default` and
  `process:allow-restart`.
- **Updater config** in `src-tauri/tauri.conf.json`:
  `bundle.createUpdaterArtifacts: true`, `plugins.updater.pubkey`
  (libsodium public key), and a single static endpoint
  `https://github.com/Dede98/markdown/releases/latest/download/latest.json`.
- **Signing keypair** generated via `pnpm tauri signer generate`.
  Public key baked into the config; private key + password live in
  the user's 1Password and as GitHub Actions secrets
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Release workflow** at `.github/workflows/release.yml` —
  Mac matrix (aarch64 + x86_64), uses `tauri-apps/tauri-action@v0`,
  drafts the release on a `v*` tag push so a stray push never
  auto-publishes.
- **In-app UI** — `src/updater.ts` wraps `check()` and
  `downloadAndInstall()`; both use `await import(...)` so the heavy
  plugin chunks only load on the Tauri shell. `App.tsx` runs a
  one-shot probe on mount (gated on `isTauriRuntime()`), holds the
  `Update` handle in state, and renders a Lucide `Download` button in
  the topbar-right cluster when an update is available. `.updateButton`
  CSS pulses while installing.

### Workflow follow-up (1 commit)

```
4e3188c Bump release workflow actions off the deprecated Node 20 runtime
```

- Bumped `actions/checkout@v4 → v6`, `actions/setup-node@v4 → v6`,
  `pnpm/action-setup@v4 → v5`. Runtime Node version moved 20 → 22.
  GitHub's Node 20 deprecation banner is gone.

### Open-source rebrand (4 commits, v0.0.17)

```
bab1be7 Rewrite README for the open-source release
c07bf6e Bump bundle to 0.0.17
840d855 Rename bundle identifier to io.github.dede98.markdown
5ec5e9e Add MIT license and project metadata for open-source release
b49821b Rebrand About panel and bundle copy as personal open-source project
```

- **About panel** strips the `ole.de` placeholder. Now reads
  `Dejan Brinker` / `© 2026 Dejan Brinker. MIT licensed.` /
  `github.com/Dede98/markdown`.
- **MIT license** at repo root. License fields in `Cargo.toml`
  (`license = "MIT"`, `repository`, `authors`) and `package.json`
  (`license`, `author`, `homepage`, `repository`, `bugs`). GitHub now
  recognises the repo as MIT-licensed.
- **Bundle identifier** moved from the placeholder
  `de.ole.markdown.spike` to `io.github.dede98.markdown`. macOS treats
  different bundle IDs as different apps, so the v0.0.16 → v0.0.17
  upgrade required a one-time manual reinstall. From v0.0.17 onward
  the auto-update path runs end-to-end with no manual steps.
- **README** rewritten around the install path (DMG download +
  Gatekeeper bypass + auto-update overview + dev setup).

### Git history rewrite

All 211 commits in the repo were rewritten via `git filter-repo` to
use `11380762+Dede98@users.noreply.github.com` (GitHub-noreply
identity) instead of the prior work-email author. Display name
"Dejan Brinker" stayed unchanged. Local repo `user.email` config
also points at the noreply address; global git config is untouched.

## Repo state

- Branch: `main` (renamed from `spike/editor-core` during the
  auto-update session; the old `spike/editor-core` and the
  pre-rewrite `main` are gone).
- HEAD: `bab1be7` (the README rewrite that ships in v0.0.17).
- Remote: `git@github.com:Dede98/markdown.git`. Repo is **public**
  and MIT-licensed.
- Working tree: clean.
- Test baseline: 124 passed / 34 skipped / 0 failed (`pnpm test:e2e`).
- Typecheck: clean (`tsc -b --noEmit`).
- Cargo: clean (`cargo check` from `src-tauri/`).
- Latest published release: v0.0.17 with both Mac architectures, the
  updater manifest, and signed payloads.
- App identifier: `io.github.dede98.markdown` (current).

## Comments and annotations milestone (next)

Per `PRODUCT_PLAN.md` § Milestones, the next active milestone.

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

## Release process (carry forward)

1. Make the change(s).
2. Bump version in `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`. Run `cargo generate-lockfile` from
   `src-tauri/` so `Cargo.lock` reflects the new crate version.
3. Commit the version bump (or fold it into the last feature commit
   if the lane is small).
4. Tag and push: `git tag v<version> && git push origin v<version>`.
5. Wait for the release workflow to draft. Cache hits make subsequent
   runs ~5 min; no-cache cold runs ~12–15 min.
6. Open the draft on GitHub, check the assets, click **Publish**.
7. Existing v0.0.17+ installs see the badge on next launch and pull
   the update.

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
- Auto-update is Tauri-only — the web build short-circuits on
  `!isTauriRuntime()` and never imports the updater plugin.
- The updater public key in `src-tauri/tauri.conf.json` MUST stay in
  sync with the private key in the GitHub Actions secret. Rotating
  the keypair means existing installs can never auto-update again.

## Pipeline reminders

- Spawn explorers per domain in parallel before touching code.
- For cross-cutting changes (Comments will be one), run the
  `architect` agent and present the plan before implementing.
- Run `code-reviewer` on the unstaged diff before each commit.
- Use `commit-writer`; never write commit messages inline.
- The `gsd-*` skill family is available if a phase or milestone needs
  structured plan / verify / ship orchestration.

## How to start

If picking up the Comments milestone, start in `PRODUCT_PLAN.md`
§ Comments And Annotations and `ARCHITECTURE.md` § Comments And
Annotations, then route through `gsd-explore` to settle the open
design question (margin markers default-on or default-off) before
moving to `architect` for the implementation plan.

If picking up an unrelated lane (e.g. notarization with an Apple
Developer ID, a web deploy, or a CHANGELOG file), it does not block
Comments and can land in parallel.
