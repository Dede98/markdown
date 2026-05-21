import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import { createCloudRouteRealtimeBridge } from "../../src/cloudCollaboration/backendTokenBridge";
import { createCloudRealtimeServerMount } from "../../src/cloudCollaboration/backendRealtimeServer";
import { createInMemoryCloudBackendService } from "../../src/cloudCollaboration/backendService";
import {
  createWebSocketCloudRoomTransport,
  createWebSocketCloudSessionProvider,
  WebSocketCloudSessionProviderError,
  type WebSocketRealtimeRoomConnection,
} from "../../src/cloudCollaboration/webSocketCloudSessionProvider";

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

test.describe("cloud backend WebSocket provider boundary", () => {
  test("connects with route-issued room tokens and delegates load and store through the realtime mount", () => {
    const { service, mount, realtime } = createHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "WebSocket boundary room",
        seedMarkdown: "# WebSocket\n\nInitial.",
        password: "room-pass",
      },
    });
    expect(create.status).toBe(201);
    const ticket = create.body as { roomId: string; roomToken: string };
    const transport = createWebSocketCloudRoomTransport({
      endpointUrl: "wss://cloud.local",
      serverMount: mount,
    });

    const connection = transport.connect({
      roomId: ticket.roomId,
      title: "WebSocket boundary room",
      roomToken: ticket.roomToken,
      password: "room-pass",
      participant: participant("user_owner"),
      participants: [participant("user_owner")],
      createIfMissing: false,
    });

    expect(connection.connectionParameters.documentName).toBe(ticket.roomId);
    expect(connection.connectionParameters.token).toBe(ticket.roomToken);
    expect(connection.connectionParameters.requestParameters.get("password")).toBe("room-pass");
    expect(connection.context).toMatchObject({
      roomId: ticket.roomId,
      userId: ownerAuth.userId,
      role: "owner",
      canWrite: true,
    });
    expect(connection.ytext.toString()).toBe("# WebSocket\n\nInitial.");

    replaceMarkdown(connection, "# WebSocket\n\nStored through provider boundary.");
    const stored = connection.store();
    expect(stored.updateArchive.document_id).toBe(ticket.roomId);
    expect(realtime.hooks.load(ticket.roomId, connection.context).getText("markdown").toString()).toBe(
      "# WebSocket\n\nStored through provider boundary.",
    );
  });

  test("keeps createWebSocketCloudSessionProvider non-wired but usable as a backend contract harness", () => {
    const { service, mount } = createHarness();
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      service,
      serverMount: mount,
      auth: ownerAuth,
      password: "room-pass",
    });

    const handle = provider.createRoom({
      title: "Provider harness room",
      seedMarkdown: "# Provider\n\nRoute-created.",
      participantId: "user_owner",
    });

    expect(handle.providerId).toBe("websocket");
    expect(handle.connection.transportId).toBe("websocket-room-transport");
    expect(handle.ytext.toString()).toBe("# Provider\n\nRoute-created.");
    expect(handle.getPresenceParticipants()).toEqual([
      expect.objectContaining({ id: "user_owner", kind: "human" }),
    ]);
    handle.destroy();
    expect(handle.connection.status).toBe("closed");
  });

  test("maps password authentication failures to explicit provider errors", () => {
    const { service, mount } = createHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Protected WebSocket room",
        seedMarkdown: "# Protected",
        password: "correct-pass",
      },
    });
    const ticket = create.body as { roomId: string; roomToken: string };
    const transport = createWebSocketCloudRoomTransport({
      endpointUrl: "wss://cloud.local",
      serverMount: mount,
    });

    expectProviderError(
      () =>
        transport.connect({
          roomId: ticket.roomId,
          title: "Protected WebSocket room",
          roomToken: ticket.roomToken,
          password: "wrong-pass",
          participant: participant("user_owner"),
          participants: [participant("user_owner")],
          createIfMissing: false,
        }),
      { phase: "connect", code: "authentication_failed", message: /valid password/i },
    );
  });

  test("honors password set rotate and clear behavior through WebSocket transport authentication", () => {
    const { service, mount } = createHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Password lifecycle room",
        seedMarkdown: "# Password lifecycle",
      },
    });
    const ticket = create.body as { roomId: string; roomToken: string };
    const transport = createWebSocketCloudRoomTransport({
      endpointUrl: "wss://cloud.local",
      serverMount: mount,
    });

    expect(connect(transport, ticket).context.role).toBe("owner");

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: "first-pass" },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: true, action: "set" } });
    expectProviderError(
      () => connect(transport, ticket),
      { phase: "connect", code: "authentication_failed", message: /valid password/i },
    );
    expect(connect(transport, ticket, "first-pass").context.role).toBe("owner");

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: "second-pass" },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: true, action: "rotated" } });
    expectProviderError(
      () => connect(transport, ticket, "first-pass"),
      { phase: "connect", code: "authentication_failed", message: /valid password/i },
    );
    expect(connect(transport, ticket, "second-pass").context.role).toBe("owner");

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${ticket.roomId}/password`,
        auth: ownerAuth,
        body: { password: null },
      }),
    ).toMatchObject({ status: 200, body: { hasPassword: false, action: "cleared" } });
    expect(connect(transport, ticket).context.role).toBe("owner");
  });

  test("keeps revoked route-issued member tokens explicit at the WebSocket transport boundary", () => {
    const { service, mount } = createHarness();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      auth: ownerAuth,
      body: {
        mode: "account",
        source: "local-file",
        title: "Revoked WebSocket room",
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
    const joined = join.body as { roomId: string; roomToken: string };
    const transport = createWebSocketCloudRoomTransport({
      endpointUrl: "wss://cloud.local",
      serverMount: mount,
    });

    expect(connect(transport, joined).context).toMatchObject({
      userId: peerAuth.userId,
      role: "editor",
      canWrite: true,
    });
    expect(
      service.handle({
        method: "DELETE",
        path: `/v1/rooms/${created.roomId}/members/${peerAuth.userId}`,
        auth: ownerAuth,
      }),
    ).toMatchObject({ status: 200, body: { revoked: true } });
    expectProviderError(
      () => connect(transport, joined),
      { phase: "connect", code: "authentication_failed", message: /active room member/i },
    );
  });

  test("does not wire the WebSocket provider into UI or local file flows", () => {
    const providerSource = readFileSync("src/cloudCollaboration/webSocketCloudSessionProvider.ts", "utf8");
    expect(providerSource).not.toMatch(/from "\.\.\/(?:fileAdapter|webFileAdapter|tauriFileAdapter|App)"/u);
    for (const filePath of ["src/App.tsx", "src/fileAdapter.ts", "src/webFileAdapter.ts", "src/tauriFileAdapter.ts"]) {
      expect(readFileSync(filePath, "utf8")).not.toContain("webSocketCloudSessionProvider");
    }
  });
});

function createHarness() {
  const realtime = createInMemoryCloudRealtimeBackend();
  const mount = createCloudRealtimeServerMount({ hooks: realtime.hooks });
  const service = createInMemoryCloudBackendService(createCloudRouteRealtimeBridge(realtime));
  return { realtime, mount, service };
}

function connect(
  transport: ReturnType<typeof createWebSocketCloudRoomTransport>,
  ticket: { roomId: string; roomToken: string },
  password?: string,
) {
  return transport.connect({
    roomId: ticket.roomId,
    title: "WebSocket room",
    roomToken: ticket.roomToken,
    password,
    participant: participant("user_owner"),
    participants: [participant("user_owner")],
    createIfMissing: false,
  });
}

function participant(id: string) {
  return {
    id,
    name: id,
    kind: "human" as const,
    color: "#2d5b8c",
    colorLight: "rgba(45, 91, 140, 0.18)",
  };
}

function replaceMarkdown(connection: WebSocketRealtimeRoomConnection, markdown: string) {
  connection.ytext.delete(0, connection.ytext.length);
  connection.ytext.insert(0, markdown);
}

function expectProviderError(
  action: () => void,
  expected: { phase: string; code: string; message: RegExp },
) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(WebSocketCloudSessionProviderError);
  expect(thrown).toMatchObject({
    phase: expected.phase,
    code: expected.code,
  });
  expect((thrown as WebSocketCloudSessionProviderError).message).toMatch(expected.message);
}
