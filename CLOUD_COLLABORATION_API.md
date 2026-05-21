# Cloud Collaboration API

This document defines the internal first-party Cloud collaboration API.
It is not a public plugin API.

Local `.md` editing remains account-free and offline-first. Cloud
providers may require auth only when the user explicitly creates or
joins a cloud room.

## Layers

### `CloudSessionProvider`

Product-level entrypoint for room lifecycle.

Source: `src/cloudCollaboration/session.ts`

```ts
type CloudSessionProvider = {
  id: string;
  label: string;
  createRoom(options: CloudRoomCreateOptions): CloudRoomHandle;
  joinRoom(options: CloudRoomJoinOptions): CloudRoomHandle;
};
```

Use this from app/UI code. Do not construct `Y.Doc`, `Y.Text`, or
awareness clients in app components.

### `CloudRoomTransport`

Realtime connection boundary underneath a provider.

Source: `src/cloudCollaboration/transport.ts`

```ts
type CloudRoomTransport = {
  id: string;
  label: string;
  connect(options: CloudRoomTransportConnectOptions): RealtimeRoomConnection;
};
```

The transport owns the low-level connection to shared Yjs state. A real
backend provider should implement this layer with WebSocket/Hocuspocus
or an equivalent Yjs transport.

### `RealtimeRoomConnection`

The active joined client connection.

```ts
type RealtimeRoomConnection = {
  providerId: string;
  transportId: string;
  roomId: string;
  status: "connecting" | "connected" | "reconnecting" | "offline" | "closed" | "error";
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: YAwarenessLike;
  getPresenceParticipants(): PresenceParticipant[];
  materializeMarkdown(): string;
  destroy(): void;
};
```

Editor contributions bind CodeMirror to `ytext` and `awareness`.
Presence UI reads from `getPresenceParticipants()`. Leaving a room must
materialize Markdown before destroying the connection.

## Backend Expectations

A real backend should:

- Keep Markdown as the canonical export/snapshot materialization.
- Persist Yjs updates as binary update data, not only JSON snapshots.
- Periodically materialize deterministic `.md` snapshots.
- Keep comments mappable to inline markers plus `markdown-comments-v1`
  metadata.
- Treat AI agents as visible participants.
- Route AI/MCP edits through the same Yjs mutation path as human edits.
- Keep local file open/save/autosave terminology separate from
  room/sync/auth terminology.
- Support anonymous temporary rooms that can later be claimed by a
  signed-in user.
- Support room password gates for both anonymous and account-owned
  rooms.
- Encrypt Yjs blobs and materialized Markdown snapshots at rest.
- Require sign-in for AI usage.

The accepted backend architecture and implementation sequence are in
`CLOUD_BACKEND_ARCHITECTURE.md`.

## Backend Room Contract Spike

Source: `src/cloudCollaboration/backendContract.ts`

The first backend-facing contract spike models the HTTP/session side of
the room lifecycle without requiring a production database. It is an
in-memory, test-backed contract for the API shapes described in
`CLOUD_BACKEND_ARCHITECTURE.md`.

Contract:

- `createRoom({ mode, source, seedMarkdown, title, auth?, password? })`
  creates either an anonymous temporary room or an account-owned room.
- `mode: "anonymous"` does not require auth and returns an owner
  capability secret plus an expiry timestamp.
- `mode: "account"` requires signed-in account auth and creates owner
  membership.
- `joinRoom({ roomId, access, password? })` enforces password gates for
  both anonymous and account rooms.
- `claimAnonymousRoom({ roomId, auth, ownerSecret })` converts an
  anonymous temporary room into an account-owned room.
- `requestAiSession({ roomId, auth, agentId, displayName })` requires a
  signed-in account and existing room membership.
- Room tickets expose deterministic `.md` materialization and comment
  mapping summary, but persistence is represented as encrypted blob refs
  for Yjs checkpoints, Yjs update archives, and materialized Markdown
  snapshots.

This module is not wired into the editor UI yet. The existing local file
session, file open/save/autosave paths, and mock collaboration panel
remain account-free unless the user explicitly starts Cloud
collaboration work.

## Backend Service Route Skeleton

Source: `src/cloudCollaboration/backendService.ts`

The first service skeleton wraps the in-memory backend contract in an
HTTP-shaped route adapter. It is still not a production server and does
not introduce database storage, but it fixes the route names and
auth/body boundary that the future app backend should preserve.

Routes:

- `POST /v1/rooms` creates anonymous or account rooms. Account auth is
  supplied at the service boundary, not by local editor state.
- `POST /v1/rooms/:roomId/join` joins a room with account auth or
  explicit anonymous access and applies password checks.
- `POST /v1/rooms/:roomId/claim` requires signed-in auth plus the
  anonymous owner secret.
- `POST /v1/rooms/:roomId/invites` lets owner/admin account members
  create invite secrets. Anonymous room owners may also create invites
  with the anonymous owner capability.
- `POST /v1/rooms/:roomId/password` lets owner/admin account members,
  or an anonymous owner capability for anonymous rooms, set, rotate, or
  clear the room password gate.
- `DELETE /v1/rooms/:roomId/members/:userId` lets owner/admin account
  members revoke a room membership. Admins cannot remove the room
  owner.
- `GET /v1/rooms/:roomId/snapshots/:versionId.md` returns
  deterministic Markdown materialization for `latest`, a concrete
  Markdown snapshot id, or a version id. Access is checked at the
  service boundary; encrypted snapshot rows remain opaque in repository
  metadata.
- `POST /v1/rooms/:roomId/ai-sessions` requires signed-in account auth
  and returns a visible `ai-agent` participant session.
- `GET /v1/rooms/:roomId` returns room metadata only.

The service returns HTTP-like `{ status, body }` responses so tests can
lock route behavior before a framework, database, or real auth provider
is selected.

The service also owns route-level request body validation for this
HTTP-shaped boundary. Malformed route bodies, invalid enum values, and
malformed access objects return explicit `400` route errors before the
request reaches the in-memory backend contract.

Shared route ids, HTTP-shaped request/response envelope types, the
published route list, request body parsers, and route success response
validators live in `src/cloudCollaboration/backendRouteContracts.ts`.
`backendService.ts` uses the route contract types, route list, and body
parsers, while `backendHttpClient.ts` uses the same response validators
before returning typed values to providers.

## Backend HTTP Client Boundary

Source: `src/cloudCollaboration/backendHttpClient.ts`

The HTTP client boundary maps typed backend client methods onto the
HTTP-shaped route skeleton without requiring a running server or fetch
transport yet. It keeps route construction, URL segment encoding,
default account auth, service-transport adaptation, and explicit
non-2xx route errors in one backend-owned module.

Contract:

- `createCloudBackendHttpClient({ transport, auth? })` exposes typed
  methods for room creation, join, claim, invite creation, password
  update, member removal, snapshot download, AI-session creation, and
  room metadata.
- `createCloudBackendServiceTransport(service)` adapts the existing
  in-memory `CloudBackendService` route harness into that client
  transport contract.
- `CloudBackendHttpClientError` preserves the route id, method, path,
  status, error code, and route error text for provider-level error
  mapping. It distinguishes non-2xx route failures from malformed
  transport or response bodies.
- `webSocketCloudSessionProvider.ts` consumes this client boundary for
  route-issued room tickets before connecting through
  `CloudRoomTransport` and the realtime server mount.
- The client validates transport envelopes, non-2xx route error bodies,
  and every successful route response body before returning typed
  values to providers. Malformed success responses and malformed error
  payloads fail as explicit `invalid_response` client errors instead
  of leaking unchecked transport data into the provider layer.

This is still backend/client-boundary work only. It does not add a real
HTTP server, UI wiring, auth UI, or local file flow changes.

## Backend Postgres Schema

Source: `src/cloudCollaboration/backendSchema.ts`

The typed Postgres schema definition models the cloud collaboration
metadata side of the same lifecycle that the in-memory contract and
service skeleton expose. It is intentionally schema-only: the module
exports table descriptors plus a `renderSchemaSql()` emitter and does
not require a database driver, migration runner, or production database
to be installed in the repo.

Tables:

- `tenants` and `users` provide the workspace/account boundary.
- `documents` model cloud rooms with `mode` (`anonymous` or `account`),
  optional `owner_user_id`, anonymous owner capability hash, expiry,
  and claim timestamp.
- `document_memberships` model account roles per room.
- `document_invites` store hashed invite secrets with role, expiry,
  max uses, and revocation metadata.
- `document_password_verifiers` store Argon2id-style verifier metadata
  per room and never plaintext passwords.
- `document_yjs_checkpoints`, `document_yjs_update_archives`, and
  `document_markdown_snapshots` store encrypted blob refs plus
  `wrapped_key_id`, byte length, and encryption mode; plaintext Yjs
  body and plaintext Markdown body are never stored in these metadata
  tables.
- `document_versions` reference a Yjs checkpoint and a Markdown
  snapshot with a materialization reason and optional human or AI-agent
  author.
- `document_audit_events` carry separate human, anonymous-guest, and
  AI-agent actor fields plus `authorized_by_user_id` for delegated AI
  actions.

Every cloud-scoped table carries a `tenant_id`, even though v1 only
ships personal workspaces. This keeps the schema ready for pooled
multi-tenant deployment with row-level security later.

## Backend Realtime Hook Contract

Source: `src/cloudCollaboration/backendHooks.ts`

The first Hocuspocus-shaped backend hook slice models realtime room
authentication and encrypted persistence without running a Hocuspocus
server or real WebSocket transport. It is still in-memory and
test-backed.

Contract:

- `onAuthenticate({ roomToken, password? })` validates the room token,
  tenant/document scope, current membership or anonymous owner
  capability, and password verifier metadata. It returns a room context
  with `tenantId`, `roomId`, `documentId`, `role`, `userId` or
  `guestId`, and `canWrite`.
- `load(roomId, context?)` reconstructs a `Y.Doc` by decrypting the
  latest Yjs checkpoint and replaying encrypted update archive
  segments after that checkpoint.
- `store(roomId, update, options?)` appends an encrypted Yjs update
  archive row, can compact into a new encrypted checkpoint, and can
  materialize an encrypted deterministic Markdown snapshot for
  lifecycle reasons (`manual`, `autosnapshot`, `before_ai_edit`,
  `restore`, `room_close`).
- `authorizeAiSession({ roomToken, password?, agentId, displayName })`
  requires a signed-in user with active room membership and returns the
  visible AI-agent authorization context.

The repository row keys intentionally match `cloudBackendSchema` column
names. The encryption layer is a local shim with explicit `wrapKey`,
`encryptBlob`, and `decryptBlob` boundaries; plaintext Yjs and Markdown
bodies are reconstructed in memory only and are not stored in metadata
rows.

## Backend Hocuspocus Adapter Boundary

Source: `src/cloudCollaboration/backendHocuspocusAdapter.ts`

The first adapter slice wraps the realtime hook contract in
Hocuspocus-shaped hook names without requiring a running Hocuspocus
server, WebSocket transport, database driver, or migration runner.

Contract:

- `authenticate(payload)` maps the provider token and optional
  `password` request parameter to `hooks.onAuthenticate(...)` and
  returns the same `CloudRealtimeRoomContext` that later hooks receive.
- `loadDocument(payload)` / `load(payload)` require that room context
  and map Hocuspocus `documentName` to `hooks.load(...)`.
- `onStoreDocument(payload)` / `store(payload)` require the room context,
  encode or forward Yjs state, and map persistence to `hooks.store(...)`.
- Adapter errors are explicit `HocuspocusAdapterError` instances with a
  hook name, code, and original hook failure message.

The adapter also verifies that the authenticated room context is scoped
to the Hocuspocus `documentName`. It does not change local file
open/save/autosave behavior and is not wired into the editor UI.

## Backend Realtime Server Mount

Source: `src/cloudCollaboration/backendRealtimeServer.ts`

The server mount slice models the non-wired Hocuspocus server
configuration that would bind the adapter into a real realtime service.
It still does not start a server, open a WebSocket, require a database
driver, or touch local file flows.

Contract:

- `createCloudRealtimeServerMount({ hooks })` creates
  `createHocuspocusAdapterHooks(hooks)` internally and exposes a
  Hocuspocus-shaped config hook bag.
- `config.hooks.authenticate(...)` maps connection tokens and optional
  password request parameters to `adapter.authenticate(...)`.
- `config.hooks.loadDocument(...)` / `load(...)` delegate to
  `adapter.loadDocument(...)`.
- `config.hooks.onStoreDocument(...)` / `store(...)` delegate to
  `adapter.onStoreDocument(...)`.
- `createConnectionParameters(...)` is a small bridge from a room id,
  room token, and optional password into the Hocuspocus-shaped
  authenticate payload. Token issuance remains owned by the backend
  hook/repository/service boundaries.
- Server mount errors preserve explicit hook names and adapter error
  codes so auth failure, password failure, document/context mismatch,
  and write-denied store behavior remain testable.

## Backend Token Bridge

Source: `src/cloudCollaboration/backendTokenBridge.ts`

The token bridge connects backend-issued route tickets to the realtime
mount. It keeps room token issuance inside backend-owned boundaries
while proving that tokens returned from room create/join paths
authenticate through the Hocuspocus-shaped server mount.

Contract:

- `createCloudTokenBridge(realtime?)` exposes a small direct backend
  create/join harness over the shared realtime repository and
  `createCloudRealtimeServerMount(...)`.
- `createCloudRouteRealtimeBridge(realtime)` returns a
  `CloudRoomBackendContract` for
  `createInMemoryCloudBackendService(...)`, so HTTP-shaped route
  responses issue realtime-authenticatable room tokens.
- Room creation uses the realtime repository to create anonymous or
  account rooms and returns the short-lived room token accepted by
  `createCloudRealtimeServerMount(...)`.
- Room joins issue a realtime repository token, immediately validate
  password/access through `hooks.onAuthenticate(...)`, and return the
  authenticated role in the route ticket. Invite redemption uses the
  same repository before token issuance so route-issued invite access
  authenticates through the realtime mount.
- Invite and password management routes use the same owner/admin and
  anonymous-owner checks as the realtime repository, so password
  changes immediately affect mount authentication behavior.
- Member revocation routes mark account memberships revoked in the same
  repository that realtime auth reads, so existing room tokens for a
  revoked member stop authenticating through the mount.
- Snapshot download routes decrypt Markdown snapshots only inside the
  backend boundary and return deterministic `.md` materialization while
  keeping stored snapshot refs encrypted and opaque.
- Route tickets preserve deterministic Markdown materialization,
  comment mapping summary, and opaque encrypted persistence refs.
- The bridge remains backend-only and does not start a WebSocket
  server, add a database driver, or touch local file open/save/autosave
  flows.

## Current Implementations

- `inMemoryCloudSessionProvider` is the only wired provider. It has no
  auth, network, or persistence.
- `createInMemoryCloudRoomBackend()` is the test-backed backend room
  contract spike. It models auth/password/invite/claim/AI/persistence
  boundaries in memory and is intentionally not a production storage
  implementation.
- `createInMemoryCloudBackendService()` is the test-backed route
  skeleton over that contract. It models the HTTP route boundary,
  including invite, password, member-revocation, and snapshot download
  routes, in memory and is intentionally not wired into the UI.
- `cloudBackendSchema` and `renderSchemaSql()` are the test-backed
  Postgres metadata schema draft. The schema is consumed by structural
  tests only and is not yet wired into a migration runner.
- `createInMemoryCloudRealtimeBackend()` is the test-backed realtime
  hook contract. It models Hocuspocus auth/load/store behavior in
  memory and is not wired into a real server, transport, database, or
  the local editor UI.
- `createHocuspocusAdapterHooks()` is the test-backed adapter over the
  realtime hook contract. It reserves the Hocuspocus hook boundary in
  memory and is not wired into a running server.
- `createCloudRealtimeServerMount()` is the test-backed server mount
  contract over the adapter. It reserves the Hocuspocus server
  configuration boundary in memory and is not wired into a running
  WebSocket server.
- `createCloudTokenBridge()` and `createCloudRouteRealtimeBridge()` are
  the test-backed token bridge helpers. They adapt direct backend
  create/join calls and `backendService` route responses onto the
  realtime backend so issued room tokens authenticate against the
  non-wired server mount, including route-issued invite joins.
- `createWebSocketCloudSessionProvider()` is a non-wired contract stub.
  It exists to reserve the provider shape for backend work and must not
  be exposed in UI until a real `CloudRoomTransport` exists.
