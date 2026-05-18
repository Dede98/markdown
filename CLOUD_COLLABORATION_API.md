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

## Current Implementations

- `inMemoryCloudSessionProvider` is the only wired provider. It has no
  auth, network, or persistence.
- `createInMemoryCloudRoomBackend()` is the test-backed backend room
  contract spike. It models auth/password/claim/AI/persistence
  boundaries in memory and is intentionally not a production storage
  implementation.
- `createWebSocketCloudSessionProvider()` is a non-wired contract stub.
  It exists to reserve the provider shape for backend work and must not
  be exposed in UI until a real `CloudRoomTransport` exists.
