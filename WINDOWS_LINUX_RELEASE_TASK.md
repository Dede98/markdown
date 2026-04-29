# Task: Windows and Linux native release parity

## Goal

Make the native Tauri app available on Windows and Linux with the same
core experience currently shipped on macOS:

- open, create, edit, save, and save-as real `.md` files;
- use the same toolbar, raw/rendered mode, Zen mode, comments, autosave,
  Mermaid/table widgets, and PDF export behavior;
- install from GitHub Releases;
- keep the Tauri auto-update path working from GitHub release assets;
- keep `.md` as the canonical file format.

This is a release-infrastructure and platform-parity lane. It should not
introduce cloud concepts, a proprietary document model, or a plugin API.

## Current state

- Current app version: `0.0.22`.
- Local implementation pass is in progress: `.github/workflows/release.yml`
  now targets macOS arm64, macOS x64, Windows x64, and Linux x64 draft
  release assets; `src-tauri/tauri.conf.json` now deliberately bundles DMG,
  NSIS, and AppImage only.
- CI draft-release validation and manual platform smoke testing are still
  required before publishing or calling parity fully verified.
- `src-tauri/tauri.conf.json` remains mostly cross-platform: updater artifacts
  are enabled, icons include `.ico`, and file associations are declared for
  `md` / `markdown` / `mdx` / `mdown`.
- The README install and release sections now describe macOS, Windows, and
  Linux native assets and unsigned-app warnings.
- Platform shell assumptions still need real OS smoke testing before claiming
  full parity: native menu behavior, titlebar/window chrome, file association
  launch, drag/drop, and print-to-PDF.

## First reads

1. `AGENTS.md`
2. `PRODUCT_PLAN.md`
3. `ARCHITECTURE.md`
4. `DECISIONS.md`
5. `HANDOFF_NEXT_SESSION.md`
6. `.github/workflows/release.yml`
7. `src-tauri/tauri.conf.json`
8. `src-tauri/capabilities/default.json`
9. `src-tauri/src/lib.rs`
10. `README.md`

Before editing, run:

```sh
git status --short --branch
```

Do not revert user changes.

## Implementation scope

### 1. Verify current Tauri platform requirements

Check the current Tauri 2 documentation before editing the workflow,
especially Linux runner dependencies and updater artifact behavior for
multi-platform releases.

The likely Linux dependency set is in this family:

```sh
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

Do not cargo-cult the exact package list. Verify it against the current
Tauri docs and the actual CI errors.

### 2. Expand the release workflow

Update `.github/workflows/release.yml` from "Mac build" to a
multi-platform native release workflow.

Target outcome:

- macOS arm64: keep existing `aarch64-apple-darwin`.
- macOS x64: keep existing `x86_64-apple-darwin`.
- Windows x64: add a `windows-latest` build, likely
  `x86_64-pc-windows-msvc`.
- Linux x64: add an `ubuntu-latest` build, likely
  `x86_64-unknown-linux-gnu`.

Keep the release as a draft. A tag push should build and upload assets,
but a human should still publish the release after inspecting them.

Important details to handle:

- Platform-specific runner setup.
- Rust target installation only where needed.
- Linux system dependencies.
- Artifact names that make CPU/OS/package type obvious.
- Updater payload signing through
  `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Whether `tauri-apps/tauri-action` correctly creates/merges a single
  multi-platform `latest.json`, or whether extra release-manifest handling
  is needed. Verify this with a test tag or workflow dispatch.

### 3. Choose v1 package formats deliberately

Do not ship every possible package just because `bundle.targets` is `all`
if that creates a noisy release.

Recommended v1 distribution:

- macOS: keep DMG for arm64 and x64.
- Windows: ship one normal installer first, preferably NSIS or MSI based
  on the easiest Tauri-supported path in this repo.
- Linux: ship AppImage first; add `.deb` if it is cheap and works cleanly
  in CI.

Out of scope for this task unless the user explicitly asks:

- Windows Store.
- Microsoft code-signing certificate purchase.
- SmartScreen reputation work.
- Flatpak / Snap / distro repository publishing.
- Auto-generated website downloads page.

Unsigned Windows builds are acceptable for the first parity release, but
README must warn users clearly that Windows may show trust prompts.

### 4. Audit app-shell parity

Inspect and test these files before claiming Windows/Linux support:

- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src/App.tsx`
- `src/tauriFileAdapter.ts`
- `src/updater.ts`
- `src/styles.css`

Specific parity risks:

- `titleBarStyle: "Overlay"` and `hiddenTitle: true` were chosen for the
  macOS shell. Verify Windows/Linux window chrome still looks and behaves
  correctly.
- `.topbar` uses `data-tauri-drag-region`. Verify it does not interfere
  with buttons, file controls, or text selection on Windows/Linux.
- Native menus were written with a macOS-style menu in mind. Verify
  File / Edit / View / Window behavior and shortcuts on Windows/Linux.
- File association and "open with" handling must work for `.md` files.
- `fs:scope` currently allows Documents, Desktop, and Downloads. Verify
  Windows/Linux save/open paths are practical without widening the scope
  unnecessarily.
- PDF export uses the system print dialog. Verify WebView2 on Windows and
  WebKitGTK on Linux invoke the dialog and restore the editor after close.
- Updater UI should stay hidden in the web build and work only inside
  Tauri.

### 5. Manual smoke matrix

Run the normal web gates first:

```sh
pnpm typecheck
pnpm build
pnpm test:e2e
```

Then build native bundles through CI and manually smoke each platform.
At minimum, verify:

- Fresh install launches.
- New file edits work.
- Open existing `.md` works.
- Save to existing file works.
- Save As works.
- Drag/drop `.md` onto the window works.
- File association / open-with works where the package format supports it.
- Raw mode toggle works.
- Rendered mode widgets still work: table, Mermaid, code styling.
- Comments can be added, replied to, resolved, and saved in the `.md`.
- Autosave still only writes file-backed files and respects Settings.
- PDF export prints the rendered surface and returns to the prior editor
  state.
- Native menu commands work: New, Open, Save, Save As, Export PDF, Raw,
  Zen.
- Auto-update check does not crash. If practical, verify one update path
  from an older multi-platform test build to a newer one.

### 6. Documentation updates

Update docs once the platform behavior is verified:

- `README.md`
  - Rename the install section from macOS-only to native desktop installs
    or add separate macOS / Windows / Linux subsections.
  - Document which asset to download per platform.
  - Document expected unsigned-app warnings:
    - macOS Gatekeeper;
    - Windows SmartScreen / unknown publisher;
    - Linux AppImage executable bit / distro package notes if needed.
  - Update the release section to say the workflow builds macOS,
    Windows, and Linux assets.
- `CHANGELOG.md`
  - Add the platform release support entry under the next version.
- `HANDOFF_NEXT_SESSION.md`
  - Refresh current release state and remove this task once it is done.

## Acceptance criteria

- `.github/workflows/release.yml` can produce draft release assets for
  macOS, Windows, and Linux from a `v*` tag or workflow dispatch.
- Release assets are named clearly enough for a normal user to choose the
  right download.
- Existing macOS release behavior is not regressed.
- Windows and Linux builds launch and pass the smoke matrix above.
- Auto-update signing remains wired through the existing Tauri updater key.
- README describes all supported native platforms honestly, including
  unsigned-app warnings.
- No canonical storage changes: `.md` remains the source of truth.

## Suggested validation commands

Local before pushing:

```sh
pnpm typecheck
pnpm build
pnpm test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

CI/release validation:

```sh
git tag v<next-version>
git push origin v<next-version>
```

Then inspect the draft release, install each platform artifact, run the
manual smoke matrix, and only publish once the assets are verified.
