# Changelog

All notable changes to this project are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the versioning is [Semantic](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Planning docs now define Cloud collaboration as optional first-party
  extension work over explicit session/contribution seams, keeping local
  `.md` editing account-free while avoiding a premature public plugin
  API.

## [0.0.23] - 2026-04-29

### Fixed

- macOS release builds now include both the `.app` updater payload and the DMG
  installer so `latest.json` can include `darwin-*` updater entries.

## [0.0.22] - 2026-04-29

### Added

- Release workflow now drafts native desktop assets for macOS arm64, macOS
  x64, Windows x64, and Linux x64 while keeping Tauri updater payload signing
  on the existing updater key.
- Windows/Linux release docs now describe the first installer choices and the
  expected unsigned-app trust prompts.

### Changed

- Tauri bundling now deliberately ships DMG, NSIS setup, and AppImage targets
  instead of every supported package format.
- Native View menu now exposes Raw View and Zen Mode commands, and the macOS
  titlebar traffic-light spacing is scoped to macOS instead of all Tauri
  desktop platforms.

## [0.0.21] - 2026-04-28

### Added

- Autosave preference in Settings with Off, After edits, and Every
  interval modes. Autosave is disabled by default and only writes
  existing file-backed documents.
- PDF export v1 through the rendered Markdown surface and the
  browser/Tauri print dialog.

### Fixed

- PDF export now invokes print synchronously, grants the Tauri webview
  print permission, and restores the editor immediately when the print
  dialog closes or is cancelled.

## [0.0.20] - 2026-04-28

### Added

- Detached comment threads can now be re-anchored to the current
  selection or deleted from the sidebar.
- Settings now show the app version and a Mac-app update check action.

### Changed

- Planning and handoff docs now reflect that the local MVP, rendered
  Markdown widgets, and local comments milestone have shipped; Cloud
  collaboration is the next major product lane.
- Content width now defaults to Wide for new users.
- Adding a comment without a display name opens Settings with a visible
  prompt instead of failing silently.

## [0.0.19] - 2026-04-28

### Added

- Mermaid fenced code blocks render as source-preserving diagrams with
  edit / pan / zoom controls.
- `markdown.pen` design canvas updated with the latest local editor
  direction.

### Changed

- Topbar controls were polished and the app version was bumped to
  `0.0.19`.

## [0.0.18] - 2026-04-26

### Added

- `CHANGELOG.md` so each release surfaces what changed without
  digging through commit history. The first entries below
  reconstruct v0.0.16 and v0.0.17 from the git log.

### Notes

This release is the first test of the end-to-end auto-update loop
under the new `io.github.dede98.markdown` bundle identifier. Users
running v0.0.17 should see the update badge in the topbar on next
launch and install v0.0.18 with one click.

## [0.0.17] - 2026-04-26

### Added

- `LICENSE` (MIT) at repo root.
- `README.md` rewritten around the install path: DMG download per
  CPU architecture, Gatekeeper bypass options (Terminal `xattr`,
  System Settings, right-click Open), auto-update overview, dev
  setup, release recipe.
- License metadata in `src-tauri/Cargo.toml` (`license`,
  `repository`, `authors`) and `package.json` (`license`, `author`,
  `homepage`, `repository`, `bugs`). GitHub now recognises the repo
  as MIT.

### Changed

- About panel rebranded: author "Dejan Brinker", website
  `github.com/Dede98/markdown`, copyright "© 2026 Dejan Brinker.
  MIT licensed." Drops the `ole.de` placeholder.
- Bundle copy and Cargo crate description drop the "(spike)"
  qualifier; the project is past spike phase.
- Bundle identifier renamed from `de.ole.markdown.spike` to
  `io.github.dede98.markdown`. macOS treats different bundle IDs
  as different apps, so this release required a one-time manual
  reinstall for v0.0.16 users.

## [0.0.16] - 2026-04-26

### Added

- **Auto-update path** for the Mac build. Tauri updater plugin
  (`tauri-plugin-updater`) plus the process plugin
  (`tauri-plugin-process`) wired in Rust + JS. The running app
  checks `https://github.com/Dede98/markdown/releases/latest/download/latest.json`
  on launch; when an update is available, a download badge appears
  in the topbar — click → install → relaunch. No manual DMG
  download needed.
- GitHub Actions release workflow at `.github/workflows/release.yml`.
  Pushing a `v*` tag builds for both Mac architectures, signs the
  update payload, generates `latest.json`, and drafts a GitHub
  release.
- Updater signing keypair (libsodium / minisign). Public key baked
  into `tauri.conf.json`; private key + password live in repo
  secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Notes

This was the first signed release. Existing users had to install
this version manually — there was no prior version with the updater
plugin baked in.

## Pre-0.0.16

The repo went through a long planning + spike phase before reaching
v0.0.16. Highlights from that period (see git log for the full
record):

- Local-first Markdown editor MVP: open / new / save `.md` files,
  WYSIWYM live preview built on CodeMirror 6, Zen + Normal modes,
  toolbar-driven formatting, light / dark / system theme.
- Tauri 2 native Mac shell with file associations, menu bar, drag
  region for the overlay title bar, OS-supplied path handling
  (Finder open-with, drag onto dock icon).
- Web build with the File System Access API plus an
  `<input type=file>` fallback. HTML5 drag-and-drop `.md` opens
  directly into the editor.
- Polish pass: persisted view-mode preferences, view-mode keyboard
  shortcuts (`⌘⇧R` raw, `⌘.` zen), `aria-pressed` parity on toggle
  buttons, line-count indicator in the status bar in raw mode.
- Lezer-tree-driven decoration pipeline for inline constructs and
  table / HTML-comment block detection, replacing earlier regex
  heuristics.

[0.0.23]: https://github.com/Dede98/markdown/releases/tag/v0.0.23
[0.0.22]: https://github.com/Dede98/markdown/releases/tag/v0.0.22
[0.0.21]: https://github.com/Dede98/markdown/releases/tag/v0.0.21
[0.0.20]: https://github.com/Dede98/markdown/releases/tag/v0.0.20
[0.0.19]: https://github.com/Dede98/markdown/releases/tag/v0.0.19
[0.0.18]: https://github.com/Dede98/markdown/releases/tag/v0.0.18
[0.0.17]: https://github.com/Dede98/markdown/releases/tag/v0.0.17
[0.0.16]: https://github.com/Dede98/markdown/releases/tag/v0.0.16
