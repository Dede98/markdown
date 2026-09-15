import { expect, test } from "@playwright/test";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import type { CloudBackendRoomTicket } from "../../src/cloudCollaboration/backendRouteContracts";
import {
  CloudBackendHttpClientError,
  createCloudBackendHttpClient,
  createCloudBackendServiceTransport,
} from "../../src/cloudCollaboration/backendHttpClient";
import { createInMemoryCloudRealtimeBackend } from "../../src/cloudCollaboration/backendHooks";
import {
  createCloudRealtimeServerMount,
  type CloudRealtimeServerMount,
} from "../../src/cloudCollaboration/backendRealtimeServer";
import {
  createInMemoryCloudBackendService,
  type CloudBackendResponse,
  type CloudBackendService,
} from "../../src/cloudCollaboration/backendService";
import { createCloudRouteRealtimeBridge } from "../../src/cloudCollaboration/backendTokenBridge";
import { inMemoryCloudSessionProvider } from "../../src/cloudCollaboration/session";
import {
  createWebSocketCloudSessionProvider,
  WebSocketCloudSessionProviderError,
} from "../../src/cloudCollaboration/webSocketCloudSessionProvider";

const ownerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_owner",
  tenantId: "tenant_personal",
};

test.describe("asynchronous cloud backend boundary", () => {
  test("waits for a validated ticket before opening exactly one room", async () => {
    const { service, mount } = createHarness();
    const ticket = createTicket(service);
    let ticketReads = 0;
    const observedTicket = new Proxy(ticket, {
      get(target, property, receiver) {
        ticketReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const response = deferred<CloudBackendResponse>();
    const client = createCloudBackendHttpClient({
      auth: ownerAuth,
      transport: { request: () => response.promise },
    });
    let connectionFactoryCalls = 0;
    const observedMount: CloudRealtimeServerMount = {
      ...mount,
      createConnectionParameters(request) {
        connectionFactoryCalls += 1;
        return mount.createConnectionParameters(request);
      },
    };
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      client,
      serverMount: observedMount,
      auth: ownerAuth,
    });

    const handlePromise = provider.createRoom({ participantId: ownerAuth.userId });

    expect(ticketReads).toBe(0);
    expect(connectionFactoryCalls).toBe(0);

    response.resolve({ status: 201, body: observedTicket });
    const handle = await handlePromise;

    expect(ticketReads).toBeGreaterThan(0);
    expect(connectionFactoryCalls).toBe(1);
    expect(handle.roomId).toBe(ticket.roomId);
    handle.destroy();
  });

  test("maps a delayed transport rejection and never opens a room", async () => {
    const { mount } = createHarness();
    const response = deferred<CloudBackendResponse>();
    const client = createCloudBackendHttpClient({
      transport: { request: () => response.promise },
    });
    let connectionFactoryCalls = 0;
    const observedMount: CloudRealtimeServerMount = {
      ...mount,
      createConnectionParameters(request) {
        connectionFactoryCalls += 1;
        return mount.createConnectionParameters(request);
      },
    };
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      client,
      serverMount: observedMount,
    });
    const routeFailure = new Error("Backend transport unavailable.");

    const handlePromise = provider.joinRoom({ roomId: "room_delayed" });
    expect(connectionFactoryCalls).toBe(0);
    response.reject(routeFailure);
    const thrown = await captureError(() => handlePromise);

    expect(thrown).toBeInstanceOf(WebSocketCloudSessionProviderError);
    expect(thrown).toMatchObject({
      phase: "joinRoom",
      code: "route_request_failed",
      cause: routeFailure,
    });
    expect(connectionFactoryCalls).toBe(0);
  });

  test("maps a delayed non-success route response and never opens a room", async () => {
    const { mount } = createHarness();
    const response = deferred<CloudBackendResponse>();
    const client = createCloudBackendHttpClient({
      transport: { request: () => response.promise },
    });
    let connectionFactoryCalls = 0;
    const observedMount: CloudRealtimeServerMount = {
      ...mount,
      createConnectionParameters(request) {
        connectionFactoryCalls += 1;
        return mount.createConnectionParameters(request);
      },
    };
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      client,
      serverMount: observedMount,
    });

    const handlePromise = provider.joinRoom({ roomId: "room_denied" });
    expect(connectionFactoryCalls).toBe(0);
    response.resolve({ status: 403, body: { error: "Room access denied." } });
    const thrown = await captureError(() => handlePromise);

    expect(thrown).toBeInstanceOf(WebSocketCloudSessionProviderError);
    expect(thrown).toMatchObject({
      phase: "joinRoom",
      code: "route_request_failed",
      cause: expect.objectContaining({
        name: "CloudBackendHttpClientError",
        code: "route_failed",
        status: 403,
      }),
    });
    expect(connectionFactoryCalls).toBe(0);
  });

  test("validates a delayed successful response before opening a room", async () => {
    const { mount } = createHarness();
    const response = deferred<CloudBackendResponse>();
    const client = createCloudBackendHttpClient({
      transport: { request: () => response.promise },
    });
    let connectionFactoryCalls = 0;
    const observedMount: CloudRealtimeServerMount = {
      ...mount,
      createConnectionParameters(request) {
        connectionFactoryCalls += 1;
        return mount.createConnectionParameters(request);
      },
    };
    const provider = createWebSocketCloudSessionProvider({
      endpointUrl: "wss://cloud.local",
      client,
      serverMount: observedMount,
    });

    const handlePromise = provider.createRoom({ seedMarkdown: "# Invalid ticket" });
    expect(connectionFactoryCalls).toBe(0);
    response.resolve({
      status: 201,
      body: {
        roomId: "room_invalid",
        websocketUrl: "wss://cloud.local/rooms/room_invalid/realtime",
        roomToken: "token_invalid",
        role: "superuser",
      },
    });
    const thrown = await captureError(() => handlePromise);

    expect(thrown).toBeInstanceOf(WebSocketCloudSessionProviderError);
    expect(thrown).toMatchObject({
      phase: "createRoom",
      code: "route_request_failed",
      cause: expect.objectContaining({
        name: "CloudBackendHttpClientError",
        code: "invalid_response",
      }),
    });
    expect(connectionFactoryCalls).toBe(0);
  });

  test("keeps the service adapter asynchronous", async () => {
    const { service } = createHarness();
    const transport = createCloudBackendServiceTransport(service);
    const responsePromise = transport.request({
      method: "GET",
      path: "/v1/rooms/missing-room",
    });

    expect(responsePromise).toBeInstanceOf(Promise);
    expect(await responsePromise).toMatchObject({ status: 404 });
  });

  test("turns service exceptions into transport rejections", async () => {
    const serviceFailure = new Error("Service boundary failed.");
    const service: CloudBackendService = {
      routes: [],
      handle() {
        throw serviceFailure;
      },
    };
    const transport = createCloudBackendServiceTransport(service);

    const thrown = await captureError(() =>
      transport.request({ method: "GET", path: "/v1/rooms/room_failed" }),
    );

    expect(thrown).toBe(serviceFailure);
  });

  test("keeps the in-memory provider synchronous", () => {
    const created = inMemoryCloudSessionProvider.createRoom({
      roomId: "async-contract-local-room",
      seedMarkdown: "# Still synchronous",
    });

    expect(created).not.toBeInstanceOf(Promise);
    expect(created.ytext.toString()).toContain("# Still synchronous");

    const joined = inMemoryCloudSessionProvider.joinRoom({ roomId: created.roomId });
    expect(joined).not.toBeInstanceOf(Promise);
    joined.destroy();
    created.destroy();
  });

  test("preserves request auth overrides through the async client", async () => {
    const overrideAuth: CloudAccountAuth = {
      kind: "account",
      userId: "user_override",
      tenantId: "tenant_personal",
    };
    const requests: unknown[] = [];
    const client = createCloudBackendHttpClient({
      auth: ownerAuth,
      transport: {
        async request(request) {
          requests.push(request);
          return { status: 200, body: ticketFor("room_override") };
        },
      },
    });

    await client.joinRoom({ roomId: "room/override", auth: overrideAuth });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/v1/rooms/room%2Foverride/join",
        auth: overrideAuth,
        body: {},
      },
    ]);
  });
});

function createHarness() {
  const realtime = createInMemoryCloudRealtimeBackend();
  const mount = createCloudRealtimeServerMount({ hooks: realtime.hooks });
  const service = createInMemoryCloudBackendService(createCloudRouteRealtimeBridge(realtime));
  return { mount, service };
}

function createTicket(service: ReturnType<typeof createHarness>["service"]) {
  const response = service.handle({
    method: "POST",
    path: "/v1/rooms",
    auth: ownerAuth,
    body: {
      mode: "account",
      source: "local-file",
      title: "Deferred room",
      seedMarkdown: "# Deferred",
    },
  });
  expect(response.status).toBe(201);
  return response.body as CloudBackendRoomTicket;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureError(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to fail.");
}

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
