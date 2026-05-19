import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import { type CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import {
  CloudRealtimeServerMountError,
  createCloudRealtimeServerMount,
} from "../../src/cloudCollaboration/backendRealtimeServer";

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

test.describe("cloud backend realtime server mount contract", () => {
  test("exposes a Hocuspocus-shaped config that delegates authenticate, load, and store to the adapter", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const mount = createCloudRealtimeServerMount({ hooks: backend.hooks });
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Server mount room",
      seedMarkdown: "# Server\n\nInitial.",
      password: "room-pass",
    });

    expect(mount).toMatchObject({
      id: "cloud-hocuspocus-realtime",
      transport: "hocuspocus",
      pathPattern: "/rooms/:roomId/realtime",
    });
    expect(mount.config.name).toBe("Markdown Cloud realtime");
    expect(mount.config.hooks.load).toBe(mount.config.hooks.loadDocument);
    expect(mount.config.hooks.store).toBe(mount.config.hooks.onStoreDocument);
    expect(mount.roomIdFromDocumentName(mount.documentNameForRoomId(room.document.id))).toBe(room.document.id);

    const context = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: room.document.id,
        roomToken: room.roomToken,
        password: "room-pass",
      }),
    );
    expect(context).toMatchObject({
      tenantId: ownerAuth.tenantId,
      roomId: room.document.id,
      documentId: room.document.id,
      role: "owner",
      canWrite: true,
      userId: ownerAuth.userId,
    });

    const loaded = mount.config.hooks.loadDocument({
      documentName: room.document.id,
      context,
    });
    expect(loaded.getText("markdown").toString()).toBe("# Server\n\nInitial.");

    replaceMarkdown(loaded, "# Server\n\nStored through server mount.");
    const result = mount.config.hooks.onStoreDocument({
      documentName: room.document.id,
      context,
      document: loaded,
      state: Y.encodeStateAsUpdate(loaded),
    });
    expect(result.updateArchive).toMatchObject({
      document_id: room.document.id,
      encryption: "application-level-at-rest",
    });
    expect(backend.hooks.load(room.document.id, context).getText("markdown").toString()).toBe(
      "# Server\n\nStored through server mount.",
    );
  });

  test("maps auth token and password failures to explicit server mount errors", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const mount = createCloudRealtimeServerMount({ hooks: backend.hooks });
    const room = backend.repository.createAnonymousRoom({
      tenantId: ownerAuth.tenantId,
      title: "Protected server room",
      seedMarkdown: "# Protected",
      password: "room-pass",
    });

    expectServerError(
      () =>
        mount.config.hooks.authenticate({
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
    expectServerError(
      () =>
        mount.config.hooks.authenticate({
          token: room.roomToken,
          documentName: room.document.id,
          requestParameters: { password: "wrong" },
        }),
      {
        hook: "authenticate",
        code: "authentication_failed",
        message: /valid password/i,
      },
    );
  });

  test("maps context and document mismatches to explicit server mount errors", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const mount = createCloudRealtimeServerMount({ hooks: backend.hooks });
    const firstRoom = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "First server room",
      seedMarkdown: "# First",
    });
    const secondRoom = backend.repository.createAccountRoom({
      auth: { ...ownerAuth, userId: "tenant_two_owner", tenantId: "tenant_two" },
      title: "Second server room",
      seedMarkdown: "# Second",
    });
    const firstContext = mount.config.hooks.authenticate({
      token: firstRoom.roomToken,
      documentName: firstRoom.document.id,
    });

    expectServerError(
      () =>
        mount.config.hooks.loadDocument({
          documentName: secondRoom.document.id,
          context: firstContext,
        }),
      {
        hook: "loadDocument",
        code: "context_scope_mismatch",
        message: /not scoped/i,
      },
    );
  });

  test("keeps viewer loads available but maps write-denied store failures", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const mount = createCloudRealtimeServerMount({ hooks: backend.hooks });
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Viewer server room",
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
    const viewerContext = mount.config.hooks.authenticate({
      token: viewerToken,
      documentName: room.document.id,
    });
    expect(viewerContext).toMatchObject({ role: "viewer", canWrite: false });

    const loaded = mount.config.hooks.loadDocument({
      documentName: room.document.id,
      context: viewerContext,
    });
    expect(loaded.getText("markdown").toString()).toBe("# Viewer");

    replaceMarkdown(loaded, "# Viewer\n\nIllegal edit.");
    expectServerError(
      () =>
        mount.config.hooks.onStoreDocument({
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

function expectServerError(
  action: () => void,
  expected: { hook: string; code: string; message: RegExp },
) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CloudRealtimeServerMountError);
  expect(thrown).toMatchObject({
    hook: expected.hook,
    code: expected.code,
  });
  expect((thrown as CloudRealtimeServerMountError).message).toMatch(expected.message);
}
