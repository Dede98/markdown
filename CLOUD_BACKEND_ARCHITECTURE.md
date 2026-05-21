# Cloud Backend Architecture

Status: accepted direction for the first real Cloud collaboration backend.
The first backend contract spike is test-backed in
`src/cloudCollaboration/backendContract.ts`; it models room
create/join/claim/password/AI gates and encrypted persistence boundary
metadata in memory before a production database exists.
`src/cloudCollaboration/backendService.ts` wraps that contract in an
HTTP-shaped service skeleton for the initial `/v1/rooms` route surface.
`src/cloudCollaboration/backendSchema.ts` defines the Postgres metadata
schema for the same lifecycle (rooms, memberships, invites, password
verifiers, encrypted Yjs checkpoint refs, encrypted Yjs update archive
refs, encrypted Markdown snapshot refs, versions, and audit events) as
typed table descriptors plus a `renderSchemaSql()` emitter; it is
schema-only and does not require a production database runtime.
`src/cloudCollaboration/backendHooks.ts` models the first
Hocuspocus-shaped auth/load/store hook contract against in-memory rows
whose keys match the schema columns. It validates room tokens,
memberships, password verifiers, anonymous owner capability, tenant
scope, encrypted checkpoint/update replay, compaction, Markdown
snapshot materialization, and signed-in-only AI authorization without
requiring a running WebSocket server.
`src/cloudCollaboration/backendHocuspocusAdapter.ts` wraps those hooks
in a thin Hocuspocus-shaped adapter boundary (`authenticate`,
`loadDocument` / `load`, `onStoreDocument` / `store`) and preserves the
same room context without requiring a running Hocuspocus server,
transport, database driver, or migration runner.
`src/cloudCollaboration/backendRealtimeServer.ts` models the next
non-wired server mount/configuration boundary over that adapter. It
binds the Hocuspocus-shaped authenticate/load/store hooks into a server
mount object and keeps token issuance inside the backend hook/repository
boundary.
`src/cloudCollaboration/backendTokenBridge.ts` adapts direct backend
create/join calls and the HTTP-shaped backend service route contract
onto that same realtime repository/hook backend so route-created and
route-joined room tokens can authenticate through the non-wired
Hocuspocus server mount. The HTTP-shaped service now also covers invite
creation and password set/rotate/clear routes, with route-issued invite
access and password changes flowing through the same realtime
repository/mount authentication path. Member revocation also uses the
same repository, so revoked account-member tokens fail realtime mount
authentication.

This is an internal first-party backend architecture. It must not turn
local `.md` editing into a logged-in or online-only workflow.

## Decision

Use Hocuspocus as the first Cloud realtime backend, behind the existing
`CloudSessionProvider` / `CloudRoomTransport` client boundary.

Cloud runtime state is Yjs binary state. Deterministic `.md`
materialization is the canonical user-facing snapshot/export artifact.

Support anonymous temporary collaboration rooms to keep the web editor
frictionless. Anonymous rooms are cloud-backed, password-capable,
claimable by signing in, and intentionally limited. AI usage requires a
signed-in account.

Encrypt Cloud document content at rest before writing database or object
storage blobs. V1 encryption is application-level encryption at rest,
not full end-to-end encryption.

## Non-Goals

- Do not require an account for local file editing.
- Do not expose a public plugin API.
- Do not store Cloud collaboration only as Markdown snapshots.
- Do not put durable auth into share URLs.
- Do not let Cloud room/sync/auth terms leak into local file
  open/save/autosave APIs.
- Do not allow anonymous AI usage.
- Do not promise anonymous temporary rooms the same recovery guarantees
  as account-owned rooms.

## Mode Boundary

Local mode:

- Opens, edits, saves, autosaves, and exports `.md`.
- Stores comments as inline anchors plus `markdown-comments-v1`
  metadata.
- Works offline and account-free.

Cloud mode:

- Starts only after an explicit collaborate/share action.
- Can start as an anonymous temporary room or an account-owned room.
- Uses realtime Yjs sync, room presence, permissions, server-side
  history, invite management, and AI-agent participant visibility.

Anonymous room mode:

- Creator does not need an account.
- Room is temporary until claimed by signing in.
- Creator receives an owner capability link and may set a room
  password.
- Guests can join by invite link and password when configured.
- Exporting `.md` is always available.
- AI usage is unavailable until the room is claimed by a signed-in
  account.

## Backend Components

1. App HTTP API
   - Owns room creation, invite redemption, membership checks, room
     metadata, version metadata, audit logs, and snapshot reads.
2. Hocuspocus realtime service
   - Owns Yjs WebSocket sync, per-room auth, awareness, persistence
     hooks, and read-only/write connection behavior.
3. Postgres
   - Stores users, tenants/workspaces, room metadata, memberships,
     anonymous room capability hashes, password verifiers, invites,
     version rows, audit rows, and searchable/indexed comment metadata.
4. Object storage
   - Stores encrypted compacted Yjs state blobs, encrypted update
     segment archives, and encrypted deterministic `.md` snapshots.
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

Recommended storage model (the typed schema definition lives in
`src/cloudCollaboration/backendSchema.ts`):

- `tenants`
  - tenant/workspace boundary, even when v1 only has personal workspaces
- `users`
  - account identity for Cloud collaboration only
- `documents`
  - logical document/room metadata
  - owner account id for claimed/account rooms
  - anonymous owner capability hash for unclaimed temporary rooms
  - retention/expiry policy, claim timestamp
- `document_memberships`
  - per-user role: owner, admin, editor, commenter, viewer
- `document_invites`
  - hashed invite secret, role, max uses, expiry, revoked timestamp
- `document_password_verifiers`
  - Argon2id-style verifier metadata per room, never plaintext password
- `document_yjs_checkpoints`
  - encrypted compacted current-state blob reference
  - state vector
  - key id / wrapped document key reference
  - byte length, created timestamp
- `document_yjs_update_archives`
  - append-only encrypted update segment refs until compacted
  - may start in Postgres `bytea` for small/recent updates, but larger
    archives should move to object storage
- `document_markdown_snapshots`
  - encrypted deterministic `.md` blob refs and metadata
  - materialization reason: `manual`, `autosnapshot`, `before_ai_edit`,
    `restore`, `room_close`
- `document_versions`
  - user-facing version rows
  - references a Yjs checkpoint and a materialized `.md` snapshot
  - same reason enum as snapshots, optional created-by user/agent
- `document_audit_events`
  - room lifecycle, membership, invite, password, AI-session, snapshot,
    and version events with separate human/anonymous/AI-agent actor
    fields and an `authorized_by_user_id` for delegated AI actions

Encryption at rest:

- Generate a per-document data encryption key.
- Encrypt Yjs checkpoints, update archives, and materialized `.md`
  snapshots before writing them to Postgres or object storage.
- Store only wrapped document keys in the database, using KMS or an app
  key manager.
- A raw database dump or object-store dump must not expose Markdown
  body text, Yjs document content, or snapshots.
- Hocuspocus/server workers may decrypt in memory to perform realtime
  sync, persistence, materialization, snapshots, and AI workflows.
- Full end-to-end encryption is deferred because it changes AI,
  server-side materialization, comments indexing, recovery, and abuse
  handling.

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
  - Creates either an anonymous temporary room or an account-owned room.
  - Body: `{ seedMarkdown, title, source: "local-file", mode:
    "anonymous" | "account", password? }`.
  - Anonymous mode creates an owner capability secret, expiry policy,
    encrypted initial Yjs state, and first encrypted snapshot.
  - Account mode requires signed-in user and creates owner membership.
  - Returns `{ roomId, websocketUrl, roomToken, ownerSecret?,
    expiresAt? }`.
- `POST /v1/rooms/:roomId/claim`
  - Requires signed-in user plus valid owner capability for anonymous
    rooms.
  - Converts temporary anonymous room into account-owned durable room.
- `POST /v1/rooms/:roomId/join`
  - Requires membership, valid invite token, or valid anonymous room
    capability; also requires password when the room has one.
  - Returns short-lived room token scoped to one room and role.
- `GET /v1/rooms/:roomId`
  - Returns metadata, role, participants, and current snapshot version.
- `POST /v1/rooms/:roomId/invites`
  - Owner/admin only for account rooms; anonymous owner capability for
    anonymous rooms.
  - Creates revocable invite secret with role, expiry, and optional
    audience constraints.
- `POST /v1/rooms/:roomId/password`
  - Owner/admin only for account rooms; anonymous owner capability for
    anonymous rooms.
  - Sets, rotates, or removes a room password.
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

- `sub` for signed-in users or `guestId` for anonymous guests
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
- `guest-owner`: temporary anonymous creator role, authorized by owner
  capability secret rather than account identity.

Enforce permissions server-side. UI hiding is not security.

For Yjs writes, gate write-capable connections at authentication time.
Where fine-grained comment permissions matter, route comment workflows
through explicit server APIs or constrained Yjs structures.

Password gates:

- Both anonymous and account rooms may require a password in addition to
  invite/membership/capability checks.
- Never store plaintext passwords.
- Store a strong password verifier/hash such as Argon2id with per-room
  salt and versioned parameters.
- Rate-limit password attempts by room, IP/device, and invite secret.
- Owners can rotate or remove the password.
- Passwords are access gates, not stable user identity.

## Invite Tokens

Use two-token semantics:

- Share URL contains a high-entropy invite secret.
- Database stores only a hash plus room id, role, creator, expiry, max
  uses, and revoked timestamp.
- Anonymous creator links contain a separate high-entropy owner
  capability secret. Store only its hash.

On redemption:

- Signed-in users get membership according to invite policy.
- Anonymous access is allowed for temporary rooms and for account rooms
  whose owner explicitly enables guest links.
- Editor/admin/owner access requires account sign-in.
- Anonymous editor access is allowed only when explicitly configured on
  a temporary room or guest invite, and remains subject to expiry,
  password, rate limits, room size limits, and export-first recovery
  expectations.

## Tenant Boundary

Use `tenantId` even if v1 only has personal workspaces.

- Every room, membership, invite, Yjs update, snapshot, comment index,
  and audit row is tenant-scoped.
- Use opaque room ids.
- Prefer Postgres row-level security or equivalent default-deny policy
  enforcement for pooled tenancy.

## AI Agents

AI agents are visible delegated actors, not fake humans.

- AI usage requires a signed-in account.
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

Completed pre-step: add an in-memory backend room contract spike for
anonymous/account rooms, password gates, anonymous claim flow,
signed-in-only AI usage, deterministic `.md` materialization, and
encrypted persistence boundary refs. Implemented in
`src/cloudCollaboration/backendContract.ts`.

1. Add backend package/service skeleton. Initial route adapter
   implemented in `src/cloudCollaboration/backendService.ts`; future
   work should move this route surface into a real backend package or
   service runtime.
2. Add Postgres schema for rooms, memberships, invites, versions,
   snapshots, update refs, and audit events. Typed schema definition
   and SQL emitter implemented in
   `src/cloudCollaboration/backendSchema.ts`; future work should wire
   this into a real migration runner.
3. Add Hocuspocus-shaped `onAuthenticate`, load/store hooks, and room
   context. Initial in-memory hook contract implemented in
   `src/cloudCollaboration/backendHooks.ts`; future work should mount
   the same contract in a real Hocuspocus server. The thin adapter
   boundary over that contract is implemented in
   `src/cloudCollaboration/backendHocuspocusAdapter.ts`. The non-wired
   server mount/configuration slice is implemented in
   `src/cloudCollaboration/backendRealtimeServer.ts`. The token bridge
   is implemented in `src/cloudCollaboration/backendTokenBridge.ts`.
4. Implement binary Yjs checkpoint/update persistence. Initial
   in-memory encrypted checkpoint/update row contract implemented in
   `src/cloudCollaboration/backendHooks.ts`; future work should replace
   the in-memory repository/blob store with Postgres/object storage.
5. Implement application-level encryption at rest for Yjs blobs and
   `.md` snapshots. Initial `wrapKey` / `encryptBlob` / `decryptBlob`
   boundaries are present as an in-memory shim; future work should
   replace them with a real key manager/KMS and object storage.
6. Implement `.md` materialization worker. Initial lifecycle-triggered
   deterministic Markdown snapshot rows are implemented in the hook
   contract; future work should move materialization to a backend
   worker.
7. Implement HTTP room/create/join/claim/invite/password APIs. The
   invite and password-management slice is implemented in
   `src/cloudCollaboration/backendService.ts`,
   `src/cloudCollaboration/backendHooks.ts`, and
   `src/cloudCollaboration/backendTokenBridge.ts`; tests prove
   owner/admin and anonymous-owner permission behavior, explicit
   denial for lower roles, invite-issued realtime auth, and password
   set/rotate/clear effects at mount authentication.
8. Implement WebSocket provider behind `CloudRoomTransport`.
9. Add anonymous temporary room expiry, owner capability, and claim
   flow.
10. Add role-gated read/write behavior and revocation handling.
    Initial member revocation is implemented through
    `DELETE /v1/rooms/:roomId/members/:userId`; tests prove owner/admin
    permission behavior, lower-role denial, owner-protection, and
    existing route-issued member tokens failing realtime authentication
    after revocation.
11. Add AI-agent participant sessions and audit events.

## Open Questions

- Whether comments should start as Markdown-only metadata or a Yjs map
  plus Markdown materialization from day one.
- Whether object storage is required immediately or only after update
  blobs exceed a Postgres threshold.
- Whether restore should create a new Yjs checkpoint from a historical
  version or apply a Yjs transaction against the current room.
- Exact anonymous room default TTL and size/participant limits.
- Whether anonymous editor links are enabled in v1 or held behind a
  product flag.

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
- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Key Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- PostgreSQL row security: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
