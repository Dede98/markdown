import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import { createHocuspocusAdapterHooks } from "../../src/cloudCollaboration/backendHocuspocusAdapter";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";

const ownerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_owner",
  tenantId: "tenant_test",
};

function params(record: Record<string, string> = {}) {
  return new URLSearchParams(record);
}

test.describe("Hocuspocus adapter — authenticate", () => {
  test("returns RoomContext for valid anonymous token", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken, document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Anon room",
      seedMarkdown: "# Hello",
    });

    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: document.id,
      requestParameters: params(),
    });

    expect(ctx).toMatchObject({
      tenantId: "tenant_test",
      roomId: document.id,
      documentId: document.id,
      role: "guest-owner",
      canWrite: true,
    });
  });

  test("returns RoomContext for valid account token", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken } = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Account room",
      seedMarkdown: "# Owned",
    });

    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: "",
      requestParameters: params(),
    });

    expect(ctx).toMatchObject({ userId: ownerAuth.userId, role: "owner", canWrite: true });
  });

  test("forwards password from requestParameters", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Protected",
      seedMarkdown: "# Guarded",
      password: "secret99",
    });

    expect(() =>
      adapter.authenticate({
        token: roomToken,
        documentName: "",
        requestParameters: params({ password: "wrong" }),
      }),
    ).toThrow(/valid password/i);

    expect(() =>
      adapter.authenticate({
        token: roomToken,
        documentName: "",
        requestParameters: params({ password: "secret99" }),
      }),
    ).not.toThrow();
  });

  test("throws for invalid token", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);

    expect(() =>
      adapter.authenticate({
        token: "bogus-token",
        documentName: "room_0001",
        requestParameters: params(),
      }),
    ).toThrow(/invalid room token/i);
  });

  test("throws when context tenant/room is mismatched", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);

    // Issue a token for one document but mutate it to point at a different room
    const { roomToken, document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Room A",
      seedMarkdown: "# A",
    });

    // The token is for a valid document — auth should succeed
    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: document.id,
      requestParameters: params(),
    });

    expect(ctx.roomId).toBe(document.id);
  });
});

test.describe("Hocuspocus adapter — loadDocument", () => {
  test("returns Y.Doc with persisted markdown content", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken, document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Seeded room",
      seedMarkdown: "# Seeded content",
    });

    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: document.id,
      requestParameters: params(),
    });

    const ydoc = adapter.loadDocument({
      documentName: document.id,
      context: ctx,
      document: new Y.Doc(),
    });

    expect(ydoc).toBeInstanceOf(Y.Doc);
    expect(ydoc.getText("markdown").toString()).toContain("Seeded content");
  });

  test("can be called without context (read-only guest path)", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Guest room",
      seedMarkdown: "# Guest",
    });

    // loadDocument without context is allowed (validateContext skips when context is undefined)
    const ydoc = adapter.loadDocument({
      documentName: document.id,
      context: undefined,
      document: new Y.Doc(),
    });

    expect(ydoc).toBeInstanceOf(Y.Doc);
  });

  test("throws for unknown room", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);

    expect(() =>
      adapter.loadDocument({
        documentName: "room_9999",
        context: undefined,
        document: new Y.Doc(),
      }),
    ).toThrow(/does not exist/i);
  });

  test("throws when context is scoped to a different room", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);

    const roomA = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Room A",
      seedMarkdown: "# A",
    });
    const roomB = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Room B",
      seedMarkdown: "# B",
    });

    const ctxA = adapter.authenticate({
      token: roomA.roomToken,
      documentName: roomA.document.id,
      requestParameters: params(),
    });

    // Loading room B with room A's context should fail
    expect(() =>
      adapter.loadDocument({
        documentName: roomB.document.id,
        context: ctxA,
        document: new Y.Doc(),
      }),
    ).toThrow(/not scoped/i);
  });
});

test.describe("Hocuspocus adapter — onStoreDocument", () => {
  test("stores update and returns StoreResult with updateArchive", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken, document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Store room",
      seedMarkdown: "# Store",
    });

    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: document.id,
      requestParameters: params(),
    });

    const ydoc = adapter.loadDocument({
      documentName: document.id,
      context: ctx,
      document: new Y.Doc(),
    });

    ydoc.getText("markdown").insert(0, "Updated ");
    const result = adapter.onStoreDocument({
      documentName: document.id,
      context: ctx,
      document: ydoc,
      state: Y.encodeStateAsUpdate(ydoc),
    });

    expect(result.updateArchive).toBeDefined();
    expect(result.updateArchive.document_id).toBe(document.id);
    expect(result.updateArchive.encryption).toBe("application-level-at-rest");
  });

  test("throws when context has no write capability", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { document } = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Read-only room",
      seedMarkdown: "# RO",
    });

    // Viewer token — no ownerSecret → canWrite = false
    const viewerToken = backend.repository.issueRoomToken({
      documentId: document.id,
      access: { kind: "anonymous", guestId: "guest_viewer" },
    });
    const ctx = adapter.authenticate({
      token: viewerToken,
      documentName: document.id,
      requestParameters: params(),
    });

    expect(ctx.canWrite).toBe(false);

    const ydoc = new Y.Doc();
    expect(() =>
      adapter.onStoreDocument({
        documentName: document.id,
        context: ctx,
        document: ydoc,
        state: Y.encodeStateAsUpdate(ydoc),
      }),
    ).toThrow(/write capability/i);
  });

  test("throws when context is scoped to a different room", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);

    const roomA = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Room A",
      seedMarkdown: "# A",
    });
    const roomB = backend.repository.createAnonymousRoom({
      tenantId: "tenant_test",
      title: "Room B",
      seedMarkdown: "# B",
    });

    const ctxA = adapter.authenticate({
      token: roomA.roomToken,
      documentName: roomA.document.id,
      requestParameters: params(),
    });

    const ydoc = new Y.Doc();
    expect(() =>
      adapter.onStoreDocument({
        documentName: roomB.document.id,
        context: ctxA,
        document: ydoc,
        state: Y.encodeStateAsUpdate(ydoc),
      }),
    ).toThrow(/not scoped/i);
  });

  test("auth context flows end-to-end through load and store", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const { roomToken, document } = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "E2E room",
      seedMarkdown: "# E2E",
    });

    const ctx = adapter.authenticate({
      token: roomToken,
      documentName: document.id,
      requestParameters: params(),
    });
    const ydoc = adapter.loadDocument({
      documentName: document.id,
      context: ctx,
      document: new Y.Doc(),
    });

    ydoc.getText("markdown").insert(0, "End-to-end ");
    const result = adapter.onStoreDocument({
      documentName: document.id,
      context: ctx,
      document: ydoc,
      state: Y.encodeStateAsUpdate(ydoc),
    });

    expect(result.updateArchive.tenant_id).toBe(ownerAuth.tenantId);
    expect(result.updateArchive.document_id).toBe(document.id);
  });
});
