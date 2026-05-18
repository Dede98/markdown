# Cloud Backend Architecture

Status: accepted direction for the first real Cloud collaboration backend.

This is an internal first-party backend architecture. It must not turn
local `.md` editing into a logged-in or online-only workflow.

## Decision

Use Hocuspocus as the first Cloud realtime backend, behind the existing
`CloudSessionProvider` / `CloudRoomTransport` client boundary.

Cloud runtime state is Yjs binary state. Deterministic `.md`
materialization is the canonical user-facing snapshot/export artifact.

## Non-Goals

- Do not require an account for local file editing.
- Do not expose a public plugin API.
- Do not store Cloud collaboration only as Markdown snapshots.
- Do not put durable auth into share URLs.
- Do not let Cloud room/sync/auth terms leak into local file
  open/save/autosave APIs.

## Mode Boundary

Local mode:

- Opens, edits, saves, autosaves, and exports `.md`.
- Stores comments as inline anchors plus `markdown-comments-v1`
  metadata.
- Works offline and account-free.

Cloud mode:

- Starts only after an explicit collaborate/share action.
- May require account/auth for room creation or privileged room entry.
- Uses realtime Yjs sync, room presence, permissions, server-side
  history, invite management, and AI-agent participant visibility.

## Backend Components

1. App HTTP API
   - Owns room creation, invite redemption, membership checks, room
     metadata, version metadata, audit logs, and snapshot reads.
2. Hocuspocus realtime service
   - Owns Yjs WebSocket sync, per-room auth, awareness, persistence
     hooks, and read-only/write connection behavior.
3. Postgres
   - Stores users, tenants/workspaces, room metadata, memberships,
     invites, version rows, audit rows, and searchable/indexed comment
     metadata.
4. Object storage
   - Stores compacted Yjs state blobs, update segment archives, and
     deterministic `.md` snapshots.
5. Redis
   - Optional scaling layer for horizontal realtime coordination. It is
     not durable document storage.

## Runtime Document Model

- One `Y.Doc` per cloud room.
- Main body: `Y.Text("markdown")`.
- Comments:
  - Markdown still materializes with `<!--c:ULID-->...<!--/c:ULID-->`
    markers and a trailing `markdown-comments-v1` metadata block.
  - Runtime may also keep comment metadata in a Yjs map or server-side
    index for queries, detached-thread recovery, and notification
    workflows.
- Presence:
  - Yjs Awareness carries transient human and AI-agent presence,
    cursor/selection, and current action.
  - Awareness is not durable document state.

## Persistence

Persist Yjs binary updates, not JSON snapshots.

Recommended storage model:

- `document_yjs_checkpoints`
  - compacted current-state blob reference
  - state vector
  - created timestamp
- `document_yjs_updates`
  - append-only update segments until compacted
  - may start in Postgres `bytea` for small/recent updates, but larger
    archives should move to object storage
- `document_versions`
  - user-facing version rows
  - references a Yjs checkpoint/blob and a materialized `.md` snapshot
  - includes reason: `manual`, `autosnapshot`, `before_ai_edit`,
    `restore`, `room_close`
- `document_snapshots`
  - deterministic `.md` object refs and metadata

Compaction:

- Use Yjs update merging for cheap duplicate removal.
- Periodically load updates into a `Y.Doc` and write
  `Y.encodeStateAsUpdate(doc)` as the new compacted checkpoint.
- Keep older update segments only as long as needed for recovery,
  audit, or history policy.

Markdown materialization:

- Run on manual export/download.
- Run on room leave/close.
- Run on named version creation.
- Run before large AI edits.
- Run periodically for recovery and previews.

## API Surface

HTTP is for auth, room metadata, permissions, invites, and snapshot
operations. WebSocket is for realtime Yjs sync.

Initial HTTP shape:

- `POST /v1/rooms`
  - Requires signed-in user.
  - Body: `{ seedMarkdown, title, source: "local-file" }`.
  - Creates room, owner membership, initial Yjs state, first snapshot.
  - Returns `{ roomId, websocketUrl, roomToken }`.
- `POST /v1/rooms/:roomId/join`
  - Requires membership or valid invite token.
  - Returns short-lived room token scoped to one room and role.
- `GET /v1/rooms/:roomId`
  - Returns metadata, role, participants, and current snapshot version.
- `POST /v1/rooms/:roomId/invites`
  - Owner/admin only.
  - Creates revocable invite secret with role, expiry, and optional
    audience constraints.
- `DELETE /v1/rooms/:roomId/members/:userId`
  - Owner/admin only.
  - Revokes membership and should close active room sessions.
- `GET /v1/rooms/:roomId/snapshots/:versionId.md`
  - Returns deterministic Markdown materialization for that version.

WebSocket:

- `wss://.../rooms/:roomId/realtime`
- Authenticates with a short-lived room token.
- Validates room id, tenant id, role, and membership before allowing a
  Yjs connection.

## Auth And Permissions

Use one authorization service for HTTP and WebSocket paths.

Room token claims:

- `sub`
- `tenantId`
- `roomId`
- `role`
- `sessionId`
- `exp`
- `aud`

Roles:

- `owner`: manage room, members, invites, edit, comment, export.
- `admin`: manage members/invites except owner, edit, comment, export.
- `editor`: edit Markdown/Yjs content, comment, export.
- `commenter`: comment only, no Markdown mutations.
- `viewer`: read-only room access and presence.

Enforce permissions server-side. UI hiding is not security.

For Yjs writes, gate write-capable connections at authentication time.
Where fine-grained comment permissions matter, route comment workflows
through explicit server APIs or constrained Yjs structures.

## Invite Tokens

Use two-token semantics:

- Share URL contains a high-entropy invite secret.
- Database stores only a hash plus room id, role, creator, expiry, max
  uses, and revoked timestamp.

On redemption:

- Signed-in users get membership according to invite policy.
- Anonymous access, if ever added, should be limited to viewer or
  commenter and implemented as a temporary guest session.
- Editor/admin/owner access requires account sign-in.

## Tenant Boundary

Use `tenantId` even if v1 only has personal workspaces.

- Every room, membership, invite, Yjs update, snapshot, comment index,
  and audit row is tenant-scoped.
- Use opaque room ids.
- Prefer Postgres row-level security or equivalent default-deny policy
  enforcement for pooled tenancy.

## AI Agents

AI agents are visible delegated actors, not fake humans.

- Presence participant kind: `ai-agent`.
- Agent sessions include `agentId`, display name, status, and
  `authorizedByUserId`.
- Agent permissions are capped by the authorizing user's current room
  role.
- Agent edits go through the same Yjs mutation path as human edits.
- Audit logs record both agent identity and authorizing human.

## Comments

Cloud comments must remain materializable to the existing Markdown
comment format.

Runtime rules:

- Keep inline marker ranges in `Y.Text("markdown")`.
- Use Yjs relative positions for live anchors when tracking ranges
  across concurrent edits.
- Keep metadata in a Yjs map and/or server-side index as needed.
- On materialization, reconcile inline markers, metadata, and orphaned
  anchors.
- Detached comments are surfaced explicitly; they are never silently
  dropped.

## Implementation Sequence

1. Add backend package/service skeleton.
2. Add Postgres schema for rooms, memberships, invites, versions,
   snapshots, update refs, and audit events.
3. Add Hocuspocus server with `onAuthenticate`, load/store hooks, and
   room context.
4. Implement binary Yjs checkpoint/update persistence.
5. Implement `.md` materialization worker.
6. Implement HTTP room/create/join/invite APIs.
7. Implement WebSocket provider behind `CloudRoomTransport`.
8. Add role-gated read/write behavior and revocation handling.
9. Add AI-agent participant sessions and audit events.

## Open Questions

- Whether comments should start as Markdown-only metadata or a Yjs map
  plus Markdown materialization from day one.
- Whether viewer/commenter modes need anonymous guest access in v1.
- Whether object storage is required immediately or only after update
  blobs exceed a Postgres threshold.
- Whether restore should create a new Yjs checkpoint from a historical
  version or apply a Yjs transaction against the current room.

## Sources

- Hocuspocus persistence: https://tiptap.dev/docs/hocuspocus/guides/persistence
- Hocuspocus hooks/auth: https://tiptap.dev/docs/hocuspocus/server/hooks
- Hocuspocus database extension: https://tiptap.dev/docs/hocuspocus/server/extensions/database
- Yjs document updates: https://docs.yjs.dev/api/document-updates
- Yjs relative positions: https://docs.yjs.dev/api/relative-positions
- Yjs awareness: https://docs.yjs.dev/api/about-awareness
- y-websocket provider docs: https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
- OWASP WebSocket Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- PostgreSQL row security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
