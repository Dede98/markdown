# Markdown

A local-first Markdown editor for Mac and Web. `.md` files are the canonical
source, so anything you write here stays readable and editable in any other
Markdown tool.

- WYSIWYM live preview — your formatting renders inline, but the source is
  still plain Markdown the moment you toggle Raw view.
- Zen mode hides the chrome for distraction-free writing.
- Normal mode adds a toolbar so you do not have to memorise Markdown syntax.
- Comments live inside the `.md` file as hidden metadata, so a copied file
  keeps its review threads without requiring a sidecar or account.
- Open / save real `.md` files on disk. No accounts, no cloud sync.

Realtime collaboration, history, and MCP support are planned for later
milestones — see [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md).

## Install (macOS)

The Mac app is shipped through GitHub Releases. The build is **not signed
with an Apple Developer ID** (this is a personal open-source project),
so the first launch needs one extra step to clear macOS Gatekeeper.

### 1. Download the right DMG

Go to the [latest release](https://github.com/Dede98/markdown/releases/latest)
and pick the DMG for your CPU:

- **Apple Silicon** (M1, M2, M3, M4 — most Macs from 2020 onward):
  `Markdown_<version>_aarch64.dmg`
- **Intel Mac**:
  `Markdown_<version>_x64.dmg`

If you are unsure: open  → About This Mac. "Apple M…" means Apple Silicon;
"Intel" means Intel.

### 2. Drag the app into /Applications

Double-click the DMG, drag `Markdown.app` to `Applications`, eject the disk
image.

### 3. Clear the quarantine flag

When you double-click `Markdown.app` for the first time, macOS will refuse
with **"Apple could not verify…"** because the app is unsigned. Pick one of:

**Option A — Terminal (fastest):**

```sh
xattr -dr com.apple.quarantine /Applications/Markdown.app
```

Then double-click the app normally.

**Option B — System Settings:**

1. Try to open the app. The "could not verify" dialog appears. Close it.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the bottom — there is a line `"Markdown" was blocked to protect
   your Mac` with an **Open Anyway** button.
4. Click it, authenticate with Touch ID / password, and macOS opens the app.

After either option runs, the OS marks the app as trusted and future launches
are silent. You only do this once per install.

### 4. Auto-updates

Once the app is running, it checks GitHub on every launch for newer releases.
When an update is available, a small download badge appears in the topbar —
click it and the new version installs and restarts automatically. No more
DMG downloads.

> Existing v0.0.16 installs will need a one-time manual reinstall to v0.0.17
> because the bundle identifier changed in that release. From v0.0.17 onward
> the auto-update path runs end-to-end with no manual steps.

## Use it on the Web

Not deployed yet. You can run the web build locally with `pnpm dev` (see
[Development](#development) below).

## Features

- Live-preview Markdown editing built on CodeMirror 6.
- Raw view toggle (`⌘⇧R` / `Ctrl+Shift+R`) to see every byte of the source.
- Zen mode (`⌘.` / `Ctrl+.`) hides the toolbar and chrome.
- Headings, bold, italic, underline, strikethrough, inline code, code blocks,
  links, lists (ordered, unordered, task), blockquotes, tables, and
  horizontal rules — all toolbar-driven.
- Editable GFM table widgets and rendered Mermaid diagrams that save back to
  normal Markdown source.
- Export the rendered Markdown view to PDF through the system print dialog.
- Inline comments with right-side thread sidebar, replies, resolved state,
  detached-thread repair, and Raw view access to the underlying metadata.
- Light, dark, and system theme.
- Drag a `.md` file onto the window to open it (web and desktop).
- Native Mac integrations: file associations, Finder open-with, drag onto
  the dock icon, native menu bar with the standard File / Edit / View /
  Window menus.

## Development

Requires Node 20+ and pnpm. The Mac build also requires Rust + the Tauri
toolchain — see <https://v2.tauri.app/start/prerequisites/>.

Install dependencies:

```sh
pnpm install
```

Run the web dev server:

```sh
pnpm dev
```

Run the Mac dev build (rebuilds the native shell, slower):

```sh
pnpm tauri:dev
```

Run checks:

```sh
pnpm typecheck     # tsc -b --noEmit
pnpm test:e2e      # Playwright (chrome-desktop + chrome-mobile)
pnpm build         # production web bundle
```

## Releasing

Pushing a `v*` tag (e.g. `git tag v0.0.18 && git push origin v0.0.18`) fires
the GitHub Actions release workflow. It builds for both Mac architectures,
signs the update payload with the Tauri updater key, generates `latest.json`
(the auto-update manifest), and uploads everything as assets on a draft
release. Click **Publish release** in the GitHub UI when the assets look right.

The signing key + password live in the repo secrets `TAURI_SIGNING_PRIVATE_KEY`
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Rotating them means existing
installs can never auto-update again — keep both backed up.

## Project structure

- `src/` — React + CodeMirror frontend (shared by web and desktop).
- `src-tauri/` — Tauri 2 native shell (Rust). Wires file IO, the menu bar,
  the auto-updater, and OS file association handling.
- `tests/e2e/` — Playwright suite covering both viewports.

## Planning and design docs

- [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md) — product vision, scope, modes,
  milestones.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — technical direction, decoupling
  seams, future collaboration / history / MCP plans.
- [`DECISIONS.md`](DECISIONS.md) — explicit architecture and product
  decisions with their rationale.
- [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) — design notes and open design
  questions.
- [`AGENTS.md`](AGENTS.md) — agent instruction file (also imported by
  `CLAUDE.md` for Claude Code compatibility).

## License

MIT — see [`LICENSE`](LICENSE).
