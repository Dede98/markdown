# Changelog

All notable changes to this project are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the versioning is [Semantic](https://semver.org/spec/v2.0.0.html).

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

[0.0.18]: https://github.com/Dede98/markdown/releases/tag/v0.0.18
[0.0.17]: https://github.com/Dede98/markdown/releases/tag/v0.0.17
[0.0.16]: https://github.com/Dede98/markdown/releases/tag/v0.0.16
