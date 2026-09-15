import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import {
  CloudBackendFetchTransportError,
  cloudBackendFetchHeaderNames,
  createCloudBackendFetchTransport,
  type CloudBackendFetchHeaderContext,
} from "../../src/cloudCollaboration/backendFetchTransport";
import {
  CloudBackendHttpClientError,
  createCloudBackendHttpClient,
} from "../../src/cloudCollaboration/backendHttpClient";
import type { CloudBackendRequest } from "../../src/cloudCollaboration/backendRouteContracts";
import { createInMemoryCloudBackendService } from "../../src/cloudCollaboration/backendService";

const assertedOwnerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "client-asserted-owner",
  tenantId: "client-asserted-tenant",
};
const authenticatedOwner: CloudAccountAuth = {
  kind: "account",
  userId: "credential-derived-owner",
  tenantId: "credential-derived-tenant",
};
const assertedOutsiderAuth: CloudAccountAuth = {
  kind: "account",
  userId: "client-asserted-outsider",
  tenantId: "client-asserted-tenant",
};
const authenticatedOutsider: CloudAccountAuth = {
  kind: "account",
  userId: "credential-derived-outsider",
  tenantId: "credential-derived-tenant",
};

type ObservedRequest = {
  method: string;
  url: string;
  body: string;
  remoteAddress?: string;
};

test.describe("cloud backend client through native fetch and loopback HTTP", () => {
  const observed: ObservedRequest[] = [];
  const service = createInMemoryCloudBackendService();
  let server: Server;
  let baseUrl: string;

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      void handleFixtureRequest(request, response, service, observed).catch((error: unknown) => {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Fixture failed." }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  test.afterAll(async () => {
    if (!server.listening) return;
    server.close();
    await once(server, "close");
  });

  test.beforeEach(() => {
    observed.length = 0;
  });

  test("creates, joins, reads metadata, and preserves authorization errors over real HTTP", async () => {
    const ownerClient = clientFor(baseUrl, assertedOwnerAuth);
    const created = await ownerClient.createRoom({
      mode: "account",
      source: "local-file",
      title: "Native fetch room",
      seedMarkdown: "# Native fetch\n\nAcross loopback.",
      password: "account-room-password",
    });

    expect(created).toMatchObject({ role: "owner" });
    expect(created.roomId).toMatch(/^room_/);
    expect(created).not.toHaveProperty("materializeMarkdown");

    const joined = await ownerClient.joinRoom({
      roomId: created.roomId,
      password: "account-room-password",
    });
    expect(joined).toMatchObject({ roomId: created.roomId, role: "owner" });

    const metadata = await ownerClient.getRoomMetadata(created.roomId);
    expect(metadata).toEqual({
      roomId: created.roomId,
      title: "Native fetch room",
      mode: "account",
      source: "local-file",
      ownerUserId: authenticatedOwner.userId,
      hasPassword: true,
      claimedAt: undefined,
      expiresAt: undefined,
    });

    const denied = await captureError(() =>
      clientFor(baseUrl).joinRoom({
        roomId: created.roomId,
        access: { kind: "anonymous", guestId: "guest-denied" },
      }),
    );
    expect(denied).toBeInstanceOf(CloudBackendHttpClientError);
    expect(denied).toMatchObject({
      routeId: "join-room",
      status: 403,
      code: "route_failed",
    });

    expect(observed.length).toBe(4);
    expect(observed.every((request) => request.remoteAddress === "127.0.0.1")).toBe(true);
    expect(observed.map((request) => request.method)).toEqual(["POST", "POST", "GET", "POST"]);
    expect(observed.filter((request) => request.method === "GET").every((request) => request.body === "")).toBe(true);
    expect(observed.map((request) => request.url).join(" ")).not.toContain(assertedOwnerAuth.userId);
    expect(observed.map((request) => request.url).join(" ")).not.toContain(assertedOwnerAuth.tenantId);
    expect(observed.map((request) => request.url).join(" ")).not.toContain("account-room-password");
  });

  test("maps snapshot access and password without a GET body or secret-bearing URL", async () => {
    const client = clientFor(baseUrl);
    const created = await client.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "Protected snapshot",
      seedMarkdown: "# Protected\n\nSnapshot body.",
      password: "room-password-secret",
    });
    expect(created.ownerSecret).toBeTruthy();

    const snapshot = await client.getMarkdownSnapshot({
      roomId: created.roomId,
      versionId: "latest",
      access: {
        kind: "anonymous",
        guestId: "guest-loopback",
        ownerSecret: created.ownerSecret,
      },
      password: "room-password-secret",
    });

    expect(snapshot).toEqual({
      roomId: created.roomId,
      versionId: "latest",
      markdown: "# Protected\n\nSnapshot body.",
    });
    const request = observed.find((entry) => entry.url.includes("/snapshots/latest.md"));
    expect(request).toBeTruthy();
    expect(request).toMatchObject({ method: "GET", body: "", remoteAddress: "127.0.0.1" });
    expect(request!.url).toContain("access=anonymous");
    expect(request!.url).toContain("guestId=guest-loopback");
    expect(request!.url).not.toContain(created.ownerSecret!);
    expect(request!.url).not.toContain("room-password-secret");
  });

  test("awaits a delayed response and classifies malformed JSON", async () => {
    const client = clientFor(baseUrl);
    let settled = false;
    const delayed = client.getRoomMetadata("fixture-delayed").then((metadata) => {
      settled = true;
      return metadata;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(delayed).resolves.toMatchObject({
      roomId: "fixture-delayed",
      title: "Delayed fixture room",
    });

    const malformed = await captureError(() => client.getRoomMetadata("fixture-malformed"));
    expect(malformed).toBeInstanceOf(CloudBackendFetchTransportError);
    expect(malformed).toMatchObject({ code: "invalid_json" });
    expect(observed.map((request) => request.url)).toEqual([
      "/api/v1/rooms/fixture-delayed",
      "/api/v1/rooms/fixture-malformed",
    ]);
  });

  test("resolves nested account and invite identities from credentials over HTTP", async () => {
    const owner = clientFor(baseUrl, assertedOwnerAuth);
    const room = await owner.createRoom({ mode: "account", source: "local-file", title: "Nested credentials", seedMarkdown: "# Credentials" });
    const nestedOwner = await clientFor(baseUrl).joinRoom({ roomId: room.roomId, access: assertedOwnerAuth });
    expect(nestedOwner.role).toBe("owner");

    const outsiderWithOwnerAssertion = createCloudBackendHttpClient({ transport: createCloudBackendFetchTransport({
      baseUrl,
      headers: () => ({ authorization: "Bearer fixture-outsider" }),
    }) });
    // The in-memory backend permits a non-member account to join as a viewer.
    // Its asserted owner identity must never upgrade that credential's role.
    expect((await outsiderWithOwnerAssertion.joinRoom({ roomId: room.roomId, access: authenticatedOwner })).role).toBe("viewer");
    await expect(outsiderWithOwnerAssertion.createInvite({ roomId: room.roomId, role: "admin", auth: authenticatedOwner })).rejects.toMatchObject({ status: 403, code: "route_failed" });

    const invite = await owner.createInvite({ roomId: room.roomId, role: "editor" });
    const joined = await clientFor(baseUrl).joinRoom({ roomId: room.roomId, access: { kind: "invite", inviteSecret: invite.inviteSecret, auth: assertedOutsiderAuth } });
    expect(joined.role).toBe("editor");
    expect((await clientFor(baseUrl, assertedOutsiderAuth).joinRoom({ roomId: room.roomId })).role).toBe("editor");
    expect((await owner.joinRoom({ roomId: room.roomId })).role).toBe("owner");
    const bodies = observed.map(request => request.body).join(" ");
    expect(bodies).not.toContain(assertedOwnerAuth.userId);
    expect(bodies).not.toContain(assertedOutsiderAuth.userId);
    expect(bodies).not.toContain(authenticatedOwner.userId);
  });

  test("never forwards password headers through an HTTP redirect", async () => {
    let redirectedRequests = 0;
    const target = createServer((_request, response) => {
      redirectedRequests += 1;
      sendJson(response, 200, { roomId: "redirect", versionId: "latest", markdown: "# Unexpected" });
    });
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const targetPort = (target.address() as AddressInfo).port;
    const redirector = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/redirected` });
      response.end();
    });
    redirector.listen(0, "127.0.0.1");
    await once(redirector, "listening");
    const port = (redirector.address() as AddressInfo).port;
    try {
      await expect(clientFor(`http://127.0.0.1:${port}`).getMarkdownSnapshot({ roomId: "redirect", versionId: "latest", password: "private-room-password" })).rejects.toMatchObject({ code: "network_failure" });
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([
        new Promise<void>((resolve, reject) => redirector.close(error => error ? reject(error) : resolve())),
        new Promise<void>((resolve, reject) => target.close(error => error ? reject(error) : resolve())),
      ]);
    }
  });

  test("classifies a genuine connection failure against a closed fixture endpoint", async () => {
    const closedBaseUrl = await closedLoopbackBaseUrl();
    const error = await captureError(() => clientFor(closedBaseUrl).getRoomMetadata("unreachable"));

    expect(error).toBeInstanceOf(CloudBackendFetchTransportError);
    expect(error).toMatchObject({ code: "network_failure" });
  });
});

function clientFor(baseUrl: string, auth?: CloudAccountAuth) {
  return createCloudBackendHttpClient({
    auth,
    transport: createCloudBackendFetchTransport({
      baseUrl,
      headers: fixtureHeaders,
    }),
  });
}

function fixtureHeaders({ sensitive }: CloudBackendFetchHeaderContext) {
  const headers: Record<string, string> = {};
  if (sensitive.accountAuth) {
    headers[cloudBackendFetchHeaderNames.accountCredential] = sensitive.accountAuth.userId === assertedOutsiderAuth.userId
      ? "Bearer fixture-outsider"
      : "Bearer fixture-owner";
  }
  if (sensitive.inviteSecret) headers[cloudBackendFetchHeaderNames.inviteCapability] = sensitive.inviteSecret;
  if (sensitive.ownerSecret) headers[cloudBackendFetchHeaderNames.ownerCapability] = sensitive.ownerSecret;
  if (sensitive.password) headers[cloudBackendFetchHeaderNames.roomPassword] = sensitive.password;
  return headers;
}

async function handleFixtureRequest(
  incoming: IncomingMessage,
  response: ServerResponse,
  service: ReturnType<typeof createInMemoryCloudBackendService>,
  observed: ObservedRequest[],
) {
  const rawBody = await readBody(incoming);
  observed.push({
    method: incoming.method ?? "",
    url: incoming.url ?? "",
    body: rawBody,
    remoteAddress: incoming.socket.remoteAddress,
  });
  const url = new URL(incoming.url ?? "/", "http://fixture.invalid");
  const path = url.pathname.replace(/^\/api/u, "");

  if (path === "/v1/rooms/fixture-delayed") {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return sendJson(response, 200, {
      roomId: "fixture-delayed",
      title: "Delayed fixture room",
      mode: "anonymous",
      source: "local-file",
      hasPassword: false,
    });
  }
  if (path === "/v1/rooms/fixture-malformed") {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end("{not-json");
    return;
  }

  const auth = authenticatedAccount(incoming.headers.authorization);
  const body = decodeBody(rawBody);
  if (requiresAccountCredential(body) && !auth) {
    return sendJson(response, 401, { error: "A valid account credential is required." });
  }
  const serviceRequest: CloudBackendRequest = {
    method: incoming.method as CloudBackendRequest["method"],
    path,
    auth,
    body: snapshotBody(url, incoming, auth) ?? sanitizeAccountAccess(body, auth),
  };
  const result = service.handle(serviceRequest);
  sendJson(response, result.status, result.body);
}

function authenticatedAccount(authorization: string | undefined) {
  if (authorization === "Bearer fixture-owner") return authenticatedOwner;
  if (authorization === "Bearer fixture-outsider") return authenticatedOutsider;
  return undefined;
}

function sanitizeAccountAccess(body: unknown, auth: CloudAccountAuth | undefined) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const sanitized = { ...body } as Record<string, unknown>;
  const access = sanitized.access;
  if (access && typeof access === "object" && !Array.isArray(access)) {
    const value = access as Record<string, unknown>;
    if (value.kind === "account") {
      sanitized.access = auth;
    } else if (value.kind === "invite" && value.auth !== undefined) {
      // The wire marker selects account-backed invite redemption. Only the
      // fixture credential supplies an identity, including for nested auth.
      sanitized.access = { ...value, auth };
    }
  }
  return sanitized;
}

function requiresAccountCredential(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const access = (body as Record<string, unknown>).access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return false;
  const value = access as Record<string, unknown>;
  return value.kind === "account" || (value.kind === "invite" && value.auth !== undefined);
}

function snapshotBody(url: URL, incoming: IncomingMessage, auth: CloudAccountAuth | undefined) {
  if (incoming.method !== "GET" || !/\/snapshots\/[^/]+\.md$/u.test(url.pathname)) return undefined;
  const accessKind = url.searchParams.get("access");
  const guestId = url.searchParams.get("guestId") ?? undefined;
  const ownerSecret = header(incoming, cloudBackendFetchHeaderNames.ownerCapability);
  const inviteSecret = header(incoming, cloudBackendFetchHeaderNames.inviteCapability);
  const password = header(incoming, cloudBackendFetchHeaderNames.roomPassword);
  const access = accessKind === "anonymous"
    ? { kind: "anonymous" as const, guestId: guestId ?? "guest_snapshot", ownerSecret }
    : accessKind === "invite" && inviteSecret
      ? { kind: "invite" as const, inviteSecret, guestId, auth }
      : accessKind === "account"
        ? auth
        : undefined;
  return { access, guestId, ownerSecret, password };
}

function header(incoming: IncomingMessage, name: string) {
  const value = incoming.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function decodeBody(rawBody: string) {
  return rawBody.length > 0 ? JSON.parse(rawBody) : undefined;
}

async function readBody(incoming: IncomingMessage) {
  let body = "";
  for await (const chunk of incoming) body += chunk.toString();
  return body;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function closedLoopbackBaseUrl() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return `http://127.0.0.1:${address.port}/api`;
}

async function captureError(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to throw.");
}
