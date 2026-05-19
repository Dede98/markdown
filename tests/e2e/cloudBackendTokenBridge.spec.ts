import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import { createCloudTokenBridge } from "../../src/cloudCollaboration/backendTokenBridge";
import { CloudRealtimeServerMountError } from "../../src/cloudCollaboration/backendRealtimeServer";

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

test.describe("cloud backend token bridge", () => {
  test("token from anonymous room creation authenticates through realtime mount", () => {
    const bridge = createCloudTokenBridge();
    const ticket = bridge.createRoom({
      mode: "anonymous",
      title: "Anonymous room",
      seedMarkdown: "# Hello",
      tenantId: "tenant_personal",
    });

    expect(ticket.roomToken).toBeTruthy();
    expect(ticket.ownerSecret).toBeTruthy();
    expect(ticket.role).toBe("guest-owner");

    const params = bridge.serverMount.createConnectionParameters({
      roomId: ticket.roomId,
      roomToken: ticket.roomToken,
    });
    const context = bridge.serverMount.config.hooks.authenticate(params);
    expect(context).toMatchObject({
      roomId: ticket.roomId,
      role: "guest-owner",
      canWrite: true,
    });
  });

  test("token from account room creation authenticates and can load and store through realtime mount", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const bridge = createCloudTokenBridge(backend);
    const ticket = bridge.createRoom({
      mode: "account",
      title: "Account room",
      seedMarkdown: "# Account seed",
      auth: ownerAuth,
    });

    expect(ticket.role).toBe("owner");

    const params = bridge.serverMount.createConnectionParameters({
      roomId: ticket.roomId,
      roomToken: ticket.roomToken,
    });
    const context = bridge.serverMount.config.hooks.authenticate(params);
    expect(context).toMatchObject({
      roomId: ticket.roomId,
      documentId: ticket.roomId,
      tenantId: ownerAuth.tenantId,
      userId: ownerAuth.userId,
      role: "owner",
      canWrite: true,
    });

    const loaded = bridge.serverMount.config.hooks.loadDocument({
      documentName: ticket.roomId,
      context,
    });
    expect(loaded.getText("markdown").toString()).toBe("# Account seed");

    replaceMarkdown(loaded, "# Updated through bridge");
    const result = bridge.serverMount.config.hooks.onStoreDocument({
      documentName: ticket.roomId,
      context,
      document: loaded,
      state: Y.encodeStateAsUpdate(loaded),
    });
    expect(result.updateArchive).toMatchObject({
      document_id: ticket.roomId,
      encryption: "application-level-at-rest",
    });

    const reloaded = backend.hooks.load(ticket.roomId, context);
    expect(reloaded.getText("markdown").toString()).toBe("# Updated through bridge");
  });

  test("token from account room join authenticates and can load and store through realtime mount", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const bridge = createCloudTokenBridge(backend);

    const ownerTicket = bridge.createRoom({
      mode: "account",
      title: "Shared room",
      seedMarkdown: "# Shared",
      auth: ownerAuth,
    });

    const joinTicket = bridge.joinRoom({
      roomId: ownerTicket.roomId,
      auth: peerAuth,
      role: "editor",
    });

    expect(joinTicket.roomId).toBe(ownerTicket.roomId);
    expect(joinTicket.role).toBe("editor");

    const params = bridge.serverMount.createConnectionParameters({
      roomId: joinTicket.roomId,
      roomToken: joinTicket.roomToken,
    });
    const context = bridge.serverMount.config.hooks.authenticate(params);
    expect(context).toMatchObject({
      roomId: joinTicket.roomId,
      userId: peerAuth.userId,
      role: "editor",
      canWrite: true,
    });

    const loaded = bridge.serverMount.config.hooks.loadDocument({
      documentName: joinTicket.roomId,
      context,
    });
    expect(loaded.getText("markdown").toString()).toBe("# Shared");

    replaceMarkdown(loaded, "# Shared — peer edit");
    const result = bridge.serverMount.config.hooks.onStoreDocument({
      documentName: joinTicket.roomId,
      context,
      document: loaded,
      state: Y.encodeStateAsUpdate(loaded),
    });
    expect(result.updateArchive).toMatchObject({ document_id: joinTicket.roomId });
  });

  test("password failure at realtime mount authenticate is explicit", () => {
    const bridge = createCloudTokenBridge();
    const ticket = bridge.createRoom({
      mode: "account",
      title: "Password-protected room",
      seedMarkdown: "# Protected",
      auth: ownerAuth,
      password: "correct-pass",
    });

    expectServerError(
      () =>
        bridge.serverMount.config.hooks.authenticate(
          bridge.serverMount.createConnectionParameters({
            roomId: ticket.roomId,
            roomToken: ticket.roomToken,
            password: "wrong-pass",
          }),
        ),
      { hook: "authenticate", code: "authentication_failed", message: /valid password/i },
    );

    const context = bridge.serverMount.config.hooks.authenticate(
      bridge.serverMount.createConnectionParameters({
        roomId: ticket.roomId,
        roomToken: ticket.roomToken,
        password: "correct-pass",
      }),
    );
    expect(context.canWrite).toBe(true);
  });

  test("invalid token at realtime mount authenticate is explicit", () => {
    const bridge = createCloudTokenBridge();
    const ticket = bridge.createRoom({
      mode: "account",
      title: "Token check room",
      seedMarkdown: "# Token",
      auth: ownerAuth,
    });

    expectServerError(
      () =>
        bridge.serverMount.config.hooks.authenticate({
          documentName: ticket.roomId,
          token: "not-a-valid-token",
          requestParameters: new URLSearchParams(),
        }),
      { hook: "authenticate", code: "authentication_failed", message: /invalid room token/i },
    );
  });

  test("document mismatch at realtime mount authenticate is explicit", () => {
    const bridge = createCloudTokenBridge();

    const firstTicket = bridge.createRoom({
      mode: "account",
      title: "Room A",
      seedMarkdown: "# A",
      auth: ownerAuth,
    });
    const secondTicket = bridge.createRoom({
      mode: "account",
      title: "Room B",
      seedMarkdown: "# B",
      auth: { ...ownerAuth, userId: "user_b", tenantId: "tenant_b" },
    });

    // Token scoped to firstTicket's room — used against secondTicket's documentName
    expectServerError(
      () =>
        bridge.serverMount.config.hooks.authenticate({
          documentName: secondTicket.roomId,
          token: firstTicket.roomToken,
          requestParameters: new URLSearchParams(),
        }),
      { hook: "authenticate", code: "context_scope_mismatch", message: /not scoped|tenant and room/i },
    );
  });

  test("write-denied store is explicit for viewer-role join", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const bridge = createCloudTokenBridge(backend);

    const ownerTicket = bridge.createRoom({
      mode: "account",
      title: "Viewer room",
      seedMarkdown: "# Read-only",
      auth: ownerAuth,
    });

    const viewerTicket = bridge.joinRoom({
      roomId: ownerTicket.roomId,
      auth: peerAuth,
      role: "viewer",
    });

    const params = bridge.serverMount.createConnectionParameters({
      roomId: viewerTicket.roomId,
      roomToken: viewerTicket.roomToken,
    });
    const context = bridge.serverMount.config.hooks.authenticate(params);
    expect(context).toMatchObject({ role: "viewer", canWrite: false });

    const loaded = bridge.serverMount.config.hooks.loadDocument({
      documentName: viewerTicket.roomId,
      context,
    });
    replaceMarkdown(loaded, "# Illegal edit");

    expectServerError(
      () =>
        bridge.serverMount.config.hooks.onStoreDocument({
          documentName: viewerTicket.roomId,
          context,
          document: loaded,
          state: Y.encodeStateAsUpdate(loaded),
        }),
      { hook: "onStoreDocument", code: "store_failed", message: /write capability/i },
    );
  });

  test("token bridge createRoom throws explicitly without auth in account mode", () => {
    const bridge = createCloudTokenBridge();
    expect(() =>
      bridge.createRoom({
        mode: "account",
        title: "No auth",
        seedMarkdown: "# No auth",
      }),
    ).toThrow(/requires auth/i);
  });

  test("token bridge joinRoom throws explicitly without auth or guestId", () => {
    const bridge = createCloudTokenBridge();
    const ticket = bridge.createRoom({
      mode: "account",
      title: "Join test room",
      seedMarkdown: "# Join",
      auth: ownerAuth,
    });

    expect(() =>
      bridge.joinRoom({ roomId: ticket.roomId }),
    ).toThrow(/requires auth or guestId/i);
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
  expect(thrown).toMatchObject({ hook: expected.hook, code: expected.code });
  expect((thrown as CloudRealtimeServerMountError).message).toMatch(expected.message);
}
