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
