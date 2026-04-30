# Handoff — Cloud collaboration architecture spike landed

Status: v0.0.23 is the current released app version in the repo. The
project is MIT-licensed, has the Tauri auto-update loop wired through
GitHub Releases, and the local editor MVP is feature-complete
(`DECISIONS.md` § 11).

The local Comments and annotations milestone has shipped. It was the
first non-built-in feature and drove out the toolbar registry,
`MarkdownCommand`, and `EditorContribution` seams in `ARCHITECTURE.md`
§ Decoupling Seams.

The active short lane before Cloud is complete for the current scope:
autosave is implemented as an opt-in Settings preference, PDF export v1
is implemented through the rendered Markdown surface and print dialog,
and Windows/Linux release parity has been reported working after the
multi-platform v0.0.23 release workflow fix.

The current Cloud collaboration lane has its first architecture spike:
an internal `DocumentSession` / `AppContribution` layer plus a bundled
first-party Cloud panel that runs a mock in-memory Yjs room.

Architecture direction is now locked: Cloud collaboration should be a
bundled first-party optional extension over explicit core seams. Login
and online state must not become prerequisites for local `.md` editing.
Do not build a public plugin API yet.

## What landed in the Cloud architecture spike

- `src/documentSession.ts` defines `local-file` and `cloud-room`
  session shapes. `App.tsx` creates a local-file session from existing
  file state while leaving local file/open/save/autosave terminology and
  behavior intact.
- `src/appContributions.ts` defines internal first-party contribution
  registration for editor extensions, panels, settings, status items,
  and lifecycle hooks.
- `src/cloudCollaboration/session.ts` creates an in-memory Cloud room
  backed by `Y.Text`, mock awareness, two human participants, one
  AI-agent participant shape, and deterministic `.md` materialization.
  It now exposes this through the internal `CloudSessionProvider` /
  `RealtimeRoomConnection` / `CloudRoomHandle` contract, with
  `inMemoryCloudSessionProvider` as the only implementation.
- `src/cloudCollaboration/contribution.tsx` registers the Cloud
  collaboration side panel. `App.tsx` owns the active mock room,
  binds the main editor to the shared `Y.Text`, and the panel mounts a
  peer `MarkdownEditor` client with the CodeMirror/Yjs binding.
- The topbar collaboration control starts the mock room explicitly.
  Leaving the room destroys the in-memory Yjs state after materializing
  the current `.md` snapshot back into the normal editor buffer.
- The spike keeps raw/rendered mode compatibility by reusing the
  existing `MarkdownEditor` raw-mode compartment per client.
- If the current local file has no comment markers, the mock Cloud room
  adds an isolated sample `<!--c:ULID-->...<!--/c:ULID-->` range plus a
  trailing `markdown-comments-v1` block so the cloud comments mapping can
  be inspected without mutating the local file.

Remaining Cloud work: real auth, room creation/share flow, provider
connection, server persistence, snapshot/history storage, remote cursor
identity from real accounts, and Yjs-backed comments storage.

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
  originally Mac matrix (aarch64 + x86_64), now extended for macOS,
  Windows, and Linux desktop assets while preserving draft releases on
  `v*` tag push so a stray push never auto-publishes.
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
- HEAD before this handoff refresh: `e2ff8c4` (`Document rendered markdown widgets`).
- Remote: `git@github.com:Dede98/markdown.git`. Repo is **public**
  and MIT-licensed.
- Latest local tag: `v0.0.23`.
- Verify current working tree and checks before relying on this file as a
  release handoff.
- App identifier: `io.github.dede98.markdown` (current).
- Release target set: macOS DMG, Windows NSIS setup executable, and Linux
  AppImage. `.deb`, Flatpak, Snap, store publishing, notarization, and
  Windows code-signing certificates remain out of scope until explicitly
  requested.
- Next architecture decision anchor: `DECISIONS.md` § 14 says Cloud
  collaboration is optional first-party extension work; the first spike
  now validates the core seams but does not add backend sync/auth.

## Comments and annotations milestone (implemented)

Per `PRODUCT_PLAN.md` § Milestones, this milestone is implemented for
local files.

Storage contract is locked. See
`DECISIONS.md` § 6 and `ARCHITECTURE.md` § Comments And Annotations
for the binding spec. Summary:

- Comments are stored inline in the same `.md` file. No sidecar.
  A user mailing a `.md` carries the comments with it.
- Each thread anchors via a paired HTML comment range
  `<!--c:ULID-->...<!--/c:ULID-->`. IDs are ULIDs for cross-file
  uniqueness under copy-paste.
- Thread bodies, authors, timestamps, and resolved state live in a
  single trailing HTML comment block tagged `markdown-comments-v1`,
  carrying escaped JSON. After `JSON.stringify`, a single sweep
  rewrites every `<` to `\u003c` and every `--` to `-\u002d` so the
  body can never close the surrounding HTML comment. `JSON.parse`
  decodes both natively on read.
- The file stores materialized current state, not an edit log. Cloud
  retains audit history server-side.
- Resolved threads stay in the file by default. A later "export
  clean Markdown" command can strip them on demand.
- Local author identity = editable display name + stable local UUID.
  No email default. Hidden is not private.
- Format versioning is strict — unknown versions load read-only.
- Runtime anchoring uses `Y.RelativePosition` pairs once Yjs lands;
  CodeMirror range trackers serve until then. Inline markers are
  read at load and written at save, not walked per keystroke.
- Marker atomicity: opening and closing tokens are written as single
  transactions so no CRDT op ever observes half a marker.
- Orphan handling: a broken anchor pair (e.g. user deleted one half
  in raw mode) flags the thread as orphaned in the sidebar. Body is
  preserved; user can re-anchor or delete. Never silently drop.
- Sidecar mode is deferred — opt-in only, not the first milestone.

Cloud mapping (later, when collab milestone lands):

- Body in `Y.Text`. Inline anchors travel as ordinary text inside it.
- Threads in `Y.Map<ULID, Thread>`. Replies in a `Y.Array` of plain
  records (`{id, author, ts, body}`) as append-only events. Reply
  bodies are not `Y.Text` — concurrent typing inside a single comment
  is not a workflow worth the cost.
- Awareness CRDT for presence (cursor, "user replying in thread X").
- Save to disk snapshots back to the inline + trailing format.

The existing `htmlCommentBlockState` extension already hides
`<!-- ... -->` blocks from the rendered view, so both inline anchors
and the trailing metadata block stay invisible to readers without
extra work. Pencil frames in `markdown.pen` show right-side thread
panel and margin markers — both light and dark variants.

The prior open UX question about margin-marker default visibility is
resolved for local editing: markers are visible in Normal mode and
hidden in quiet Zen mode.

The Comments milestone drove out the seams in `ARCHITECTURE.md`
§ Decoupling Seams:

- Toolbar registry — Comments added a "comment on selection" toolbar
  button as a first non-formatting toolbar contribution.
- `MarkdownCommand` interface — existing text mutations were formalized
  so comment commands use the same editor mutation path.
- `EditorContribution` shape — Comments contributes CM extensions
  (decorations for highlighted ranges + margin gutter), a toolbar item,
  and key bindings through one contribution.

The seams are tools, not goals. Cloud collaboration, history, and MCP
should refine them only where those features force new shape.

## Release process (carry forward)

1. Make the change(s).
2. Bump version in `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`. Run `cargo generate-lockfile` from
   `src-tauri/` so `Cargo.lock` reflects the new crate version.
3. Commit the version bump (or fold it into the last feature commit
   if the lane is small).
4. Tag and push: `git tag v<version> && git push origin v<version>`.
5. Wait for the release workflow to draft. Cache hits make subsequent
   runs ~5 min for macOS-only history; multi-platform cold runs will take
   longer because Windows and Linux bundle on their own runners.
6. Open the draft on GitHub, check macOS / Windows / Linux assets and
   `latest.json`, then run the platform smoke matrix before clicking
   **Publish**.
7. Existing v0.0.17+ installs see the badge on next launch and pull
   the update.

## Architecture invariants (carry forward)

- `.md` text is the canonical document source.
- AI / MCP edits go through the same mutation path as human edits.
- Comments are metadata anchored to Markdown, not normal visible
  Markdown content.
- Local offline use does not require an account.
- Cloud collaboration is optional first-party extension work. It may
  register editor extensions, panels, settings, status items, presence,
  and session lifecycle hooks, but must not force login or online state
  for local `.md` files.
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
- Autosave prefs (`markdown.autosave.mode`,
  `markdown.autosave.intervalSeconds`) live in `localStorage`.
  Autosave is opt-in and writes only existing file-backed documents;
  untitled files still require explicit Save/Save As once.
- Web drag-drop `.md` and Tauri `tauri://drag-drop` both funnel through
  `replaceFile` so the dirty-guard prompt and downstream UI behave
  identically regardless of the shell.
- Auto-update is Tauri-only — the web build short-circuits on
  `!isTauriRuntime()` and never imports the updater plugin. The updater
  manifest now needs macOS, Windows, and Linux entries from the draft
  release before platform parity can be called verified.
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

If continuing QoL polish, keep additions similarly pragmatic. PDF
export v1 intentionally stops at rendered Markdown + print CSS +
browser/Tauri print pipeline. Avoid custom pagination, templates,
headers/footers, or a publishing settings surface until the simple
export proves insufficient.

If picking up Cloud collaboration, start in `PRODUCT_PLAN.md` § Cloud
Collaboration, `DECISIONS.md` § 10 and § 14, and `ARCHITECTURE.md`
§ Decoupling Seams / § Document Sessions / § Realtime Collaboration /
§ Cloud Storage. The first useful step is an architecture spike for:

- `DocumentSession` separating local-file sessions from cloud-room
  sessions without leaking room/sync/auth terminology into local file
  code.
- `AppContribution` style first-party extension registration for editor
  extensions, panels, settings, status items, and lifecycle hooks.
- Yjs `Y.Text` plus CodeMirror/Yjs binding.
- awareness presence for humans and AI-agent participants.
- Hocuspocus or a thin WebSocket server.
- binary Yjs update persistence.
- materialized Markdown snapshots and `.md` export.

Acceptance for the spike: two editor clients can edit the same Markdown
text without breaking raw/rendered mode, presence renders for at least
one human and one AI-agent participant shape, comments remain mappable,
and the session can materialize deterministic `.md`.

If picking up an unrelated lane (e.g. notarization with an Apple
Developer ID or a web deploy), it does not block Cloud collaboration
and can land in parallel.
