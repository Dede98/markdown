import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import { type CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import { createCloudRouteRealtimeBridge } from "../../src/cloudCollaboration/backendTokenBridge";
import { createCloudRealtimeServerMount, CloudRealtimeServerMountError } from "../../src/cloudCollaboration/backendRealtimeServer";
import { createInMemoryCloudBackendService } from "../../src/cloudCollaboration/backendService";

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

test.describe("cloud backend route to realtime token bridge", () => {
  test("uses a route-created room token to authenticate load and store through the realtime mount", () => {
    const { service, mount, realtime } = createBridgeHarness();

    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Route-created realtime room",
        seedMarkdown: "# Bridge\n\nInitial.",
        password: "room-pass",
      },
    });

    expect(create.status).toBe(201);
    const ticket = create.body as { roomId: string; roomToken: string; role: string };
    expect(ticket).toMatchObject({ role: "owner" });

    const context = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: ticket.roomId,
        roomToken: ticket.roomToken,
        password: "room-pass",
      }),
    );
    expect(context).toMatchObject({
      roomId: ticket.roomId,
      documentId: ticket.roomId,
      tenantId: ownerAuth.tenantId,
      userId: ownerAuth.userId,
      role: "owner",
      canWrite: true,
    });

    const loaded = mount.config.hooks.loadDocument({
      documentName: ticket.roomId,
      context,
    });
    expect(loaded.getText("markdown").toString()).toBe("# Bridge\n\nInitial.");

    replaceMarkdown(loaded, "# Bridge\n\nStored through route token.");
    mount.config.hooks.onStoreDocument({
      documentName: ticket.roomId,
      context,
      document: loaded,
      state: Y.encodeStateAsUpdate(loaded),
    });
    expect(realtime.hooks.load(ticket.roomId, context).getText("markdown").toString()).toBe(
      "# Bridge\n\nStored through route token.",
    );
  });

  test("uses a route-joined room token to authenticate through the realtime mount", () => {
    const { service, mount } = createBridgeHarness();
    const create = createAnonymousRoom(service);
    const created = create.body as { roomId: string };

    const join = service.handle({
      method: "POST",
      path: `/v1/rooms/${created.roomId}/join`,
      body: {
        access: { kind: "anonymous", guestId: "guest_viewer" },
        password: "room-pass",
      },
    });

    expect(join.status).toBe(200);
    const joined = join.body as { roomId: string; roomToken: string; role: string };
    expect(joined).toMatchObject({ roomId: created.roomId, role: "viewer" });

    const context = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: joined.roomId,
        roomToken: joined.roomToken,
        password: "room-pass",
      }),
    );
    expect(context).toMatchObject({
      roomId: joined.roomId,
      guestId: "guest_viewer",
      role: "viewer",
      canWrite: false,
    });
    expect(
      mount.config.hooks
        .loadDocument({
          documentName: joined.roomId,
          context,
        })
        .getText("markdown")
        .toString(),
    ).toBe("# Anonymous bridge");
  });

  test("creates an invite route token that joins and authenticates through the realtime mount", () => {
    const { service, mount } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Invite bridge room",
        seedMarkdown: "# Invite bridge",
      },
    });
    const created = create.body as { roomId: string };

    const invite = service.handle({
      method: "POST",
      path: `/v1/rooms/${created.roomId}/invites`,
      auth: ownerAuth,
      body: { role: "editor", maxUses: 1 },
    });
    expect(invite.status).toBe(201);
    const inviteBody = invite.body as { inviteSecret: string };

    const join = service.handle({
      method: "POST",
      path: `/v1/rooms/${created.roomId}/join`,
      auth: peerAuth,
      body: { inviteSecret: inviteBody.inviteSecret },
    });
    expect(join.status).toBe(200);
    const joined = join.body as { roomId: string; roomToken: string; role: string };
    expect(joined).toMatchObject({ roomId: created.roomId, role: "editor" });

    const context = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: joined.roomId,
        roomToken: joined.roomToken,
      }),
    );
    expect(context).toMatchObject({
      roomId: joined.roomId,
      userId: peerAuth.userId,
      role: "editor",
      canWrite: true,
    });
    expect(
      mount.config.hooks
        .loadDocument({
          documentName: joined.roomId,
          context,
        })
        .getText("markdown")
        .toString(),
    ).toBe("# Invite bridge");
  });

  test("gates invite and password management to owner admin or anonymous owner capability", () => {
    const { service, realtime } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Permission bridge room",
        seedMarkdown: "# Permissions",
      },
    });
    const created = create.body as { roomId: string };
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_admin",
      role: "admin",
    });
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_viewer",
      role: "viewer",
    });
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_commenter",
      role: "commenter",
    });

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${created.roomId}/invites`,
        auth: { ...ownerAuth, userId: "user_admin" },
        body: { role: "viewer" },
      }),
    ).toMatchObject({ status: 201, body: { role: "viewer" } });

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${created.roomId}/invites`,
        auth: { ...ownerAuth, userId: "user_viewer" },
        body: { role: "viewer" },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/viewer cannot manage room invites/i) },
    });
    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${created.roomId}/password`,
        auth: { ...ownerAuth, userId: "user_commenter" },
        body: { password: "denied" },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/commenter cannot manage room password/i) },
    });

    const anonymous = createAnonymousRoom(service).body as { roomId: string; ownerSecret: string };
    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${anonymous.roomId}/password`,
        body: { password: "anon-pass", ownerSecret: "wrong-secret" },
      }),
    ).toMatchObject({
      status: 401,
      body: { error: expect.stringMatching(/valid anonymous owner secret/i) },
    });
    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${anonymous.roomId}/password`,
        body: { password: "anon-pass", ownerSecret: anonymous.ownerSecret },
      }),
    ).toMatchObject({
      status: 200,
      body: { roomId: anonymous.roomId, hasPassword: true, action: "rotated" },
    });
  });

  test("password set rotate and clear routes immediately affect realtime mount authentication", () => {
    const { service, mount } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Password bridge room",
        seedMarkdown: "# Password bridge",
      },
    });
    const ticket = create.body as { roomId: string; roomToken: string };

    expect(
      mount.config.hooks.authenticate(
        mount.createConnectionParameters({
          roomId: ticket.roomId,
          roomToken: ticket.roomToken,
        }),
      ),
    ).toMatchObject({ role: "owner" });

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: "first-pass" },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: true, action: "set" } });
    expectServerError(
      () =>
        mount.config.hooks.authenticate(
          mount.createConnectionParameters({
            roomId: ticket.roomId,
            roomToken: ticket.roomToken,
          }),
        ),
      { hook: "authenticate", code: "authentication_failed", message: /valid password/i },
    );
    expect(
      mount.config.hooks.authenticate(
        mount.createConnectionParameters({
          roomId: ticket.roomId,
          roomToken: ticket.roomToken,
          password: "first-pass",
        }),
      ),
    ).toMatchObject({ role: "owner" });

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: "second-pass" },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: true, action: "rotated" } });
    expectServerError(
      () =>
        mount.config.hooks.authenticate(
          mount.createConnectionParameters({
            roomId: ticket.roomId,
            roomToken: ticket.roomToken,
            password: "first-pass",
          }),
        ),
      { hook: "authenticate", code: "authentication_failed", message: /valid password/i },
    );
    expect(
      mount.config.hooks.authenticate(
        mount.createConnectionParameters({
          roomId: ticket.roomId,
          roomToken: ticket.roomToken,
          password: "second-pass",
        }),
      ),
    ).toMatchObject({ role: "owner" });

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: null },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: false, action: "cleared" } });
    expect(
      mount.config.hooks.authenticate(
        mount.createConnectionParameters({
          roomId: ticket.roomId,
          roomToken: ticket.roomToken,
        }),
      ),
    ).toMatchObject({ role: "owner" });
  });

  test("revokes a route-joined member and rejects the member's existing realtime token", () => {
    const { service, mount } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Revocation bridge room",
        seedMarkdown: "# Revoke",
      },
    });
    const created = create.body as { roomId: string };
    const invite = service.handle({
      method: "POST",
      path: `/v1/rooms/${created.roomId}/invites`,
      auth: ownerAuth,
      body: { role: "editor" },
    }).body as { inviteSecret: string };
    const join = service.handle({
      method: "POST",
      path: `/v1/rooms/${created.roomId}/join`,
      auth: peerAuth,
      body: { inviteSecret: invite.inviteSecret },
    });
    expect(join.status).toBe(200);
    const joined = join.body as { roomId: string; roomToken: string; role: string };
    expect(
      mount.config.hooks.authenticate(
        mount.createConnectionParameters({
          roomId: joined.roomId,
          roomToken: joined.roomToken,
        }),
      ),
    ).toMatchObject({ userId: peerAuth.userId, role: "editor", canWrite: true });

    expect(
      service.handle({
        method: "DELETE",
        path: `/v1/rooms/${created.roomId}/members/${peerAuth.userId}`,
        auth: ownerAuth,
      }),
    ).toMatchObject({
      status: 200,
      body: { roomId: created.roomId, userId: peerAuth.userId, revoked: true },
    });

    expectServerError(
      () =>
        mount.config.hooks.authenticate(
          mount.createConnectionParameters({
            roomId: joined.roomId,
            roomToken: joined.roomToken,
          }),
        ),
      { hook: "authenticate", code: "authentication_failed", message: /active room member/i },
    );
  });

  test("gates member revocation to owner or admin and protects the owner membership", () => {
    const { service, realtime } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Member permission room",
        seedMarkdown: "# Members",
      },
    });
    const created = create.body as { roomId: string };
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_admin",
      role: "admin",
    });
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_viewer",
      role: "viewer",
    });
    realtime.repository.addMembership({
      documentId: created.roomId,
      tenantId: ownerAuth.tenantId,
      userId: "user_editor",
      role: "editor",
    });

    expect(
      service.handle({
        method: "DELETE",
        path: `/v1/rooms/${created.roomId}/members/user_editor`,
        auth: { ...ownerAuth, userId: "user_viewer" },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/viewer cannot manage room members/i) },
    });

    expect(
      service.handle({
        method: "DELETE",
        path: `/v1/rooms/${created.roomId}/members/${ownerAuth.userId}`,
        auth: { ...ownerAuth, userId: "user_admin" },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/admins cannot remove the room owner/i) },
    });

    expect(
      service.handle({
        method: "DELETE",
        path: `/v1/rooms/${created.roomId}/members/user_editor`,
        auth: { ...ownerAuth, userId: "user_admin" },
      }),
    ).toMatchObject({
      status: 200,
      body: { roomId: created.roomId, userId: "user_editor", revoked: true },
    });
  });

  test("downloads latest and versioned Markdown snapshots through the route bridge", () => {
    const { service, realtime, mount } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Snapshot bridge room",
        seedMarkdown: "# Snapshot bridge\n\nInitial.",
      },
    });
    const ticket = create.body as { roomId: string; roomToken: string };
    const context = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: ticket.roomId,
        roomToken: ticket.roomToken,
      }),
    );
    const updatedDoc = mount.config.hooks.loadDocument({
      documentName: ticket.roomId,
      context,
    });
    replaceMarkdown(updatedDoc, "# Snapshot bridge\n\nVersioned.");
    const stored = realtime.hooks.store(ticket.roomId, Y.encodeStateAsUpdate(updatedDoc), {
      context,
      compact: true,
      materializeSnapshotReason: "manual",
      createdByUserId: ownerAuth.userId,
    });
    const versionId = stored.version?.id;
    expect(versionId).toBeTruthy();
    expect(realtime.repository.document_versions.map((row) => row.id)).toContain(versionId);

    expect(
      service.handle({
        method: "GET",
        path: `/v1/rooms/${ticket.roomId}/snapshots/latest.md`,
        auth: ownerAuth,
      }),
    ).toMatchObject({
      status: 200,
      body: {
        roomId: ticket.roomId,
        versionId: "latest",
        markdown: "# Snapshot bridge\n\nVersioned.",
      },
    });
    expect(
      service.handle({
        method: "GET",
        path: `/v1/rooms/${ticket.roomId}/snapshots/${versionId}.md`,
        auth: ownerAuth,
      }),
    ).toMatchObject({
      status: 200,
      body: {
        roomId: ticket.roomId,
        versionId,
        markdown: "# Snapshot bridge\n\nVersioned.",
      },
    });
  });

  test("applies snapshot route access password and missing-version failures explicitly", () => {
    const { service } = createBridgeHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      body: {
        mode: "anonymous",
        source: "local-file",
        title: "Anonymous snapshot bridge",
        seedMarkdown: "# Anonymous snapshot",
        password: "snapshot-pass",
      },
    });
    const room = create.body as { roomId: string; ownerSecret: string };

    expect(
      service.handle({
        method: "GET",
        path: `/v1/rooms/${room.roomId}/snapshots/latest.md`,
        body: { guestId: "guest_snapshot", password: "wrong" },
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/valid password/i) },
    });
    expect(
      service.handle({
        method: "GET",
        path: `/v1/rooms/${room.roomId}/snapshots/latest.md`,
        body: { ownerSecret: room.ownerSecret, password: "snapshot-pass" },
      }),
    ).toMatchObject({
      status: 200,
      body: { markdown: "# Anonymous snapshot" },
    });
    expect(
      service.handle({
        method: "GET",
        path: `/v1/rooms/${room.roomId}/snapshots/missing-version.md`,
        body: { ownerSecret: room.ownerSecret, password: "snapshot-pass" },
      }),
    ).toMatchObject({
      status: 404,
      body: { error: expect.stringMatching(/snapshot version does not exist/i) },
    });
  });

  test("keeps password failure invalid token document mismatch and write denial explicit on bridged tokens", () => {
    const { service, mount } = createBridgeHarness();
    const create = createAnonymousRoom(service);
    const ticket = create.body as { roomId: string; roomToken: string };

    expectServerError(
      () =>
        mount.config.hooks.authenticate(
          mount.createConnectionParameters({
            roomId: ticket.roomId,
            roomToken: ticket.roomToken,
            password: "wrong",
          }),
        ),
      {
        hook: "authenticate",
        code: "authentication_failed",
        message: /valid password/i,
      },
    );

    expectServerError(
      () =>
        mount.config.hooks.authenticate({
          documentName: ticket.roomId,
          token: "missing-token",
          requestParameters: { password: "room-pass" },
        }),
      {
        hook: "authenticate",
        code: "authentication_failed",
        message: /invalid room token/i,
      },
    );

    const other = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: { ...ownerAuth, userId: "other_owner", tenantId: "tenant_other" },
      body: {
        mode: "account",
        source: "local-file",
        title: "Other room",
        seedMarkdown: "# Other",
      },
    }).body as { roomId: string };
    expectServerError(
      () =>
        mount.config.hooks.authenticate({
          documentName: other.roomId,
          token: ticket.roomToken,
          requestParameters: { password: "room-pass" },
        }),
      {
        hook: "authenticate",
        code: "context_scope_mismatch",
        message: /not scoped/i,
      },
    );

    const join = service.handle({
      method: "POST",
      path: `/v1/rooms/${ticket.roomId}/join`,
      body: {
        access: { kind: "anonymous", guestId: "guest_viewer" },
        password: "room-pass",
      },
    }).body as { roomId: string; roomToken: string };
    const viewerContext = mount.config.hooks.authenticate(
      mount.createConnectionParameters({
        roomId: join.roomId,
        roomToken: join.roomToken,
        password: "room-pass",
      }),
    );
    const loaded = mount.config.hooks.loadDocument({
      documentName: join.roomId,
      context: viewerContext,
    });
    replaceMarkdown(loaded, "# Anonymous bridge\n\nViewer edit.");
    expectServerError(
      () =>
        mount.config.hooks.onStoreDocument({
          documentName: join.roomId,
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

function createBridgeHarness() {
  const realtime = createInMemoryCloudRealtimeBackend();
  const service = createInMemoryCloudBackendService(createCloudRouteRealtimeBridge(realtime));
  const mount = createCloudRealtimeServerMount({ hooks: realtime.hooks });
  return { realtime, service, mount };
}

function createAnonymousRoom(service: ReturnType<typeof createInMemoryCloudBackendService>) {
  return service.handle({
    method: "POST",
    path: "/v1/rooms",
    body: {
      mode: "anonymous",
      source: "local-file",
      title: "Anonymous bridge room",
      seedMarkdown: "# Anonymous bridge",
      password: "room-pass",
    },
  });
}

function replaceMarkdown(ydoc: Y.Doc, markdown: string) {
  const ytext = ydoc.getText("markdown");
  ytext.delete(0, ytext.length);
  ytext.insert(0, markdown);
}

function expectServerError(action: () => void, expected: { hook: string; code: string; message: RegExp }) {
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
