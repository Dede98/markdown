import { expect, test } from "@playwright/test";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import type { CloudBackendRoomTicket } from "../../src/cloudCollaboration/backendRouteContracts";
import {
  CloudBackendHttpClientError,
  createCloudBackendHttpClient,
  createCloudBackendServiceTransport,
} from "../../src/cloudCollaboration/backendHttpClient";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import { createCloudRealtimeServerMount } from "../../src/cloudCollaboration/backendRealtimeServer";
import {
  createInMemoryCloudBackendService,
  type CloudBackendRequest,
} from "../../src/cloudCollaboration/backendService";
import { createCloudRouteRealtimeBridge } from "../../src/cloudCollaboration/backendTokenBridge";
import { createWebSocketCloudSessionProvider } from "../../src/cloudCollaboration/webSocketCloudSessionProvider";

const ownerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_owner",
  tenantId: "tenant_personal",
};

test.describe("cloud backend HTTP client boundary", () => {
  test("maps typed client calls onto encoded HTTP-shaped routes", async () => {
    const requests: CloudBackendRequest[] = [];
    const client = createCloudBackendHttpClient({
      auth: ownerAuth,
      transport: {
        async request(request) {
          requests.push(request);
          if (request.method === "DELETE") {
            return {
              status: 200,
              body: {
                roomId: "room_with_path",
                userId: "user_with_path",
                revoked: true,
              },
            };
          }
          return { status: 200, body: ticketFor("room_with_path") };
        },
      },
    });

    await client.joinRoom({
      roomId: "room/with space",
      access: { kind: "anonymous", guestId: "guest_1" },
      password: "room-pass",
    });
    await client.removeRoomMember({
      roomId: "room/with space",
      userId: "user/with space",
    });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/v1/rooms/room%2Fwith%20space/join",
        auth: ownerAuth,
        body: {
          access: { kind: "anonymous", guestId: "guest_1" },
          password: "room-pass",
        },
      },
      {
        method: "DELETE",
        path: "/v1/rooms/room%2Fwith%20space/members/user%2Fwith%20space",
        auth: ownerAuth,
        body: undefined,
      },
    ]);
  });

  test("surfaces route failures as explicit client errors", async () => {
    const client = createCloudBackendHttpClient({
      transport: {
        async request() {
          return { status: 403, body: { error: "Joining this room requires a valid password." } };
        },
      },
    });

    let thrown: unknown;
    try {
      await client.joinRoom({
        roomId: "room_0001",
        access: { kind: "anonymous", guestId: "guest_1" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CloudBackendHttpClientError);
    expect(thrown).toMatchObject({
      routeId: "join-room",
      method: "POST",
      path: "/v1/rooms/room_0001/join",
      status: 403,
      code: "route_failed",
    });
    expect((thrown as CloudBackendHttpClientError).message).toMatch(/valid password/i);
  });

  test("rejects malformed successful response bodies before returning them", async () => {
    const client = createCloudBackendHttpClient({
      transport: {
        async request() {
          return {
            status: 200,
            body: {
              roomId: "room_0001",
              websocketUrl: "wss://cloud.local/rooms/room_0001/realtime",
              roomToken: "token_room_0001",
              role: "superuser",
            },
          };
        },
      },
    });

    const thrown = await captureError(() =>
      client.createRoom({
        mode: "anonymous",
        source: "local-file",
        title: "Malformed ticket",
        seedMarkdown: "# Malformed",
      }),
    );

    expect(thrown).toBeInstanceOf(CloudBackendHttpClientError);
    expect(thrown).toMatchObject({
      routeId: "create-room",
      method: "POST",
      path: "/v1/rooms",
      status: 200,
      code: "invalid_response",
    });
    expect((thrown as CloudBackendHttpClientError).message).toMatch(/field "role".*owner.*guest-owner/i);
  });

  test("rejects malformed route error responses from the transport", async () => {
    const client = createCloudBackendHttpClient({
      transport: {
        async request() {
          return { status: 403, body: { message: "Forbidden without route error shape." } };
        },
      },
    });

    const thrown = await captureError(() =>
      client.joinRoom({
        roomId: "room_0001",
        access: { kind: "anonymous", guestId: "guest_1" },
      }),
    );

    expect(thrown).toBeInstanceOf(CloudBackendHttpClientError);
    expect(thrown).toMatchObject({
      routeId: "join-room",
      method: "POST",
      path: "/v1/rooms/room_0001/join",
      status: 403,
      code: "invalid_response",
    });
    expect((thrown as CloudBackendHttpClientError).message).toMatch(/field "error".*non-empty string/i);
  });

  test("rejects malformed transport envelopes", async () => {
    const client = createCloudBackendHttpClient({
      transport: {
        async request() {
          return null as never;
        },
      },
    });

    const thrown = await captureError(() => client.getRoomMetadata("room_0001"));

    expect(thrown).toBeInstanceOf(CloudBackendHttpClientError);
    expect(thrown).toMatchObject({
      routeId: "get-room",
      method: "GET",
      path: "/v1/rooms/room_0001",
      status: 0,
      code: "invalid_response",
    });
    expect((thrown as CloudBackendHttpClientError).message).toMatch(/response must be an object/i);
  });

  test("lets the WebSocket provider consume route tickets through the client boundary", async () => {
    const realtime = createInMemoryCloudRealtimeBackend();
    const mount = createCloudRealtimeServerMount({ hooks: realtime.hooks });
    const service = createInMemoryCloudBackendService(createCloudRouteRealtimeBridge(realtime));
    const client = createCloudBackendHttpClient({
      transport: createCloudBackendServiceTransport(service),
      auth: ownerAuth,
    });
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      client,
      serverMount: mount,
      auth: ownerAuth,
      password: "room-pass",
    });

    const handle = await provider.createRoom({
      title: "HTTP client provider room",
      seedMarkdown: "# HTTP client\n\nRoute ticket.",
      participantId: "user_owner",
    });

    expect(handle.ytext.toString()).toBe("# HTTP client\n\nRoute ticket.");
    expect(handle.connection.context).toMatchObject({
      roomId: handle.roomId,
      userId: ownerAuth.userId,
      role: "owner",
      canWrite: true,
    });
    expect(await client.getRoomMetadata(handle.roomId)).toMatchObject({
      roomId: handle.roomId,
      title: "HTTP client provider room",
      mode: "account",
      hasPassword: true,
    });
  });
});

function ticketFor(roomId: string): CloudBackendRoomTicket {
  return {
    roomId,
    websocketUrl: `wss://cloud.local/rooms/${roomId}/realtime`,
    roomToken: `token_${roomId}`,
    role: "editor",
    persistence: {
      yjsCheckpoint: encryptedRef("yjs-checkpoint"),
      yjsUpdateArchive: encryptedRef("yjs-update-archive"),
      markdownSnapshot: encryptedRef("markdown-snapshot"),
    },
  };
}

async function captureError(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw.");
}

function encryptedRef(purpose: "yjs-checkpoint" | "yjs-update-archive" | "markdown-snapshot") {
  return {
    purpose,
    ref: `${purpose}:mock`,
    encryption: "application-level-at-rest" as const,
    keyScope: "room" as const,
    byteLength: 1,
    plaintextAvailable: false as const,
  };
}
