import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import { type CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createHocuspocusAdapterHooks, HocuspocusAdapterError } from "../../src/cloudCollaboration/backendHocuspocusAdapter";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";

const ownerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_owner",
  tenantId: "tenant_personal",
};

const peerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_peer",
  tenantId: "tenant_personal",
};

test.describe("cloud backend Hocuspocus adapter boundary", () => {
  test("maps authenticate, load, and store payloads onto realtime hooks", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Adapter room",
      seedMarkdown: "# Adapter\n\nInitial.",
      password: "room-pass",
    });

    const context = adapter.authenticate({
      token: room.roomToken,
      documentName: room.document.id,
      requestParameters: new URLSearchParams({ password: "room-pass" }),
    });
    expect(context).toMatchObject({
      tenantId: ownerAuth.tenantId,
      roomId: room.document.id,
      documentId: room.document.id,
      role: "owner",
      canWrite: true,
      userId: ownerAuth.userId,
    });

    const loaded = adapter.loadDocument({
      documentName: room.document.id,
      context,
      document: new Y.Doc(),
    });
    expect(loaded.getText("markdown").toString()).toBe("# Adapter\n\nInitial.");
    expect(adapter.load).toBe(adapter.loadDocument);
    expect(adapter.store).toBe(adapter.onStoreDocument);

    replaceMarkdown(loaded, "# Adapter\n\nStored through adapter.");
    const state = Y.encodeStateAsUpdate(loaded);
    const result = adapter.onStoreDocument({
      documentName: room.document.id,
      context,
      document: loaded,
      state,
    });
    expect(result.updateArchive).toMatchObject({
      document_id: room.document.id,
      encryption: "application-level-at-rest",
    });
    expect(backend.hooks.load(room.document.id, context).getText("markdown").toString()).toBe(
      "# Adapter\n\nStored through adapter.",
    );
  });

  test("maps auth token and password failures to explicit adapter errors", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const room = backend.repository.createAnonymousRoom({
      tenantId: ownerAuth.tenantId,
      title: "Protected adapter room",
      seedMarkdown: "# Protected",
      password: "room-pass",
    });

    expectAdapterError(
      () =>
        adapter.authenticate({
          token: "missing-token",
          documentName: room.document.id,
          requestParameters: new URLSearchParams({ password: "room-pass" }),
        }),
      {
        hook: "authenticate",
        code: "authentication_failed",
        message: /invalid room token/i,
      },
    );
    expectAdapterError(
      () =>
        adapter.authenticate({
          token: room.roomToken,
          documentName: room.document.id,
          requestParameters: new URLSearchParams({ password: "wrong" }),
        }),
      {
        hook: "authenticate",
        code: "authentication_failed",
        message: /valid password/i,
      },
    );
  });

  test("rejects contexts that are missing, malformed, or scoped to a different Hocuspocus document", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const firstRoom = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "First room",
      seedMarkdown: "# First",
    });
    const secondRoom = backend.repository.createAccountRoom({
      auth: { ...ownerAuth, userId: "tenant_two_owner", tenantId: "tenant_two" },
      title: "Second room",
      seedMarkdown: "# Second",
    });
    const firstContext = adapter.authenticate({
      token: firstRoom.roomToken,
      documentName: firstRoom.document.id,
      requestParameters: new URLSearchParams(),
    });

    expectAdapterError(
      () =>
        adapter.loadDocument({
          documentName: firstRoom.document.id,
          context: undefined,
          document: new Y.Doc(),
        }),
      {
        hook: "loadDocument",
        code: "context_required",
        message: /context is required/i,
      },
    );
    expectAdapterError(
      () =>
        adapter.loadDocument({
          documentName: firstRoom.document.id,
          context: { roomId: firstRoom.document.id },
          document: new Y.Doc(),
        }),
      {
        hook: "loadDocument",
        code: "context_invalid",
        message: /context shape is invalid/i,
      },
    );
    expectAdapterError(
      () =>
        adapter.loadDocument({
          documentName: secondRoom.document.id,
          context: firstContext,
          document: new Y.Doc(),
        }),
      {
        hook: "loadDocument",
        code: "context_scope_mismatch",
        message: /not scoped/i,
      },
    );
  });

  test("keeps read loads available for viewers but maps write-denied store failures cleanly", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const adapter = createHocuspocusAdapterHooks(backend.hooks);
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Viewer room",
      seedMarkdown: "# Viewer",
    });
    backend.repository.addMembership({
      tenantId: peerAuth.tenantId,
      documentId: room.document.id,
      userId: peerAuth.userId,
      role: "viewer",
    });
    const viewerToken = backend.repository.issueRoomToken({
      documentId: room.document.id,
      access: { kind: "account", userId: peerAuth.userId },
    });
    const viewerContext = adapter.authenticate({
      token: viewerToken,
      documentName: room.document.id,
      requestParameters: new URLSearchParams(),
    });
    expect(viewerContext).toMatchObject({ role: "viewer", canWrite: false });

    const loaded = adapter.loadDocument({
      documentName: room.document.id,
      context: viewerContext,
      document: new Y.Doc(),
    });
    expect(loaded.getText("markdown").toString()).toBe("# Viewer");

    replaceMarkdown(loaded, "# Viewer\n\nIllegal edit.");
    expectAdapterError(
      () =>
        adapter.onStoreDocument({
          documentName: room.document.id,
          context: viewerContext,
          document: loaded,
          state: Y.encodeStateAsUpdate(loaded),
        }),
      {
        hook: "onStoreDocument",
        code: "store_failed",
        message: /write capability/i,
      },
    );
  });
});

function replaceMarkdown(ydoc: Y.Doc, markdown: string) {
  const ytext = ydoc.getText("markdown");
  ytext.delete(0, ytext.length);
  ytext.insert(0, markdown);
}

function expectAdapterError(
  action: () => void,
  expected: { hook: string; code: string; message: RegExp },
) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HocuspocusAdapterError);
  expect(thrown).toMatchObject({
    hook: expected.hook,
    code: expected.code,
  });
  expect((thrown as HocuspocusAdapterError).message).toMatch(expected.message);
}
