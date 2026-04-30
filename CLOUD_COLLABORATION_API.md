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

## Current Implementations

- `inMemoryCloudSessionProvider` is the only wired provider. It has no
  auth, network, or persistence.
- `createWebSocketCloudSessionProvider()` is a non-wired contract stub.
  It exists to reserve the provider shape for backend work and must not
  be exposed in UI until a real `CloudRoomTransport` exists.
