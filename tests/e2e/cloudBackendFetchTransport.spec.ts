import { expect, test } from "@playwright/test";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";
import {
  CloudBackendFetchTransportError,
  cloudBackendFetchHeaderNames,
  createCloudBackendFetchTransport,
  type CloudBackendFetch,
} from "../../src/cloudCollaboration/backendFetchTransport";
import {
  CloudBackendHttpClientError,
  createCloudBackendHttpClient,
} from "../../src/cloudCollaboration/backendHttpClient";
import type { CloudBackendGetSnapshotBody } from "../../src/cloudCollaboration/backendRouteContracts";

const accountAuth: CloudAccountAuth = {
  kind: "account",
  userId: "asserted-user-not-a-credential",
  tenantId: "asserted-tenant-not-a-credential",
};

test.describe("cloud backend fetch transport", () => {
  test("preserves the base path and already encoded route segments", async () => {
    const requests: Request[] = [];
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example/editor%20api/",
      fetch: captureFetch(requests, { status: 200, body: { ok: true } }),
    });

    await transport.request({
      method: "GET",
      path: "/v1/rooms/space%20slash%2Funicode-%E2%9C%93-percent-%252F",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      "https://cloud.example/editor%20api/v1/rooms/space%20slash%2Funicode-%E2%9C%93-percent-%252F",
    );
  });

  test("rejects origin overrides and traversal before fetch", async () => {
    let sends = 0;
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example/api",
      fetch: async () => {
        sends += 1;
        return Response.json({ ok: true });
      },
    });

    for (const path of ["https://evil.example/v1/rooms", "//evil.example/v1/rooms", "/../rooms", "/%2e%2e/rooms"]) {
      const error = await captureError(() => transport.request({ method: "GET", path }));
      expect(error).toMatchObject({ code: "invalid_route" });
    }
    expect(sends).toBe(0);
  });

  test("maps snapshot GET inputs through safe query values and explicit sensitive headers", async () => {
    const requests: Request[] = [];
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example/base",
      fetch: captureFetch(requests, { status: 200, body: { markdown: "# Snapshot" } }),
      headers({ sensitive }) {
        expect(sensitive.accountAuth).toEqual(accountAuth);
        return {
          authorization: "Bearer test-credential-for-derived-user",
          [cloudBackendFetchHeaderNames.ownerCapability]: sensitive.ownerSecret!,
          [cloudBackendFetchHeaderNames.roomPassword]: sensitive.password!,
          "x-caller-header": "preserved",
        };
      },
    });

    await transport.request({
      method: "GET",
      path: "/v1/rooms/room_1/snapshots/latest.md",
      auth: accountAuth,
      body: {
        access: { kind: "anonymous", guestId: "guest with spaces", ownerSecret: "owner-secret" },
        password: "room-password",
      } satisfies CloudBackendGetSnapshotBody,
    });

    const request = requests[0];
    const decoded = await decodeSnapshotRequest(request);
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    expect(decoded).toEqual({
      credential: "Bearer test-credential-for-derived-user",
      access: { kind: "anonymous", guestId: "guest with spaces", ownerSecret: "owner-secret" },
      password: "room-password",
    });
    expect(request.headers.get("x-caller-header")).toBe("preserved");
    expect(request.url).not.toContain("owner-secret");
    expect(request.url).not.toContain("room-password");
    expect(request.url).not.toContain(accountAuth.userId);
    expect(request.url).not.toContain(accountAuth.tenantId);
  });

  test("maps invite capability through a header and never through the URL", async () => {
    const requests: Request[] = [];
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example",
      fetch: captureFetch(requests, { status: 200, body: {} }),
      headers: ({ sensitive }) => ({
        [cloudBackendFetchHeaderNames.inviteCapability]: sensitive.inviteSecret!,
      }),
    });

    await transport.request({
      method: "GET",
      path: "/v1/rooms/room/snapshots/latest.md",
      body: { access: { kind: "invite", inviteSecret: "invite-secret", guestId: "guest_1" } },
    });

    const decoded = await decodeSnapshotRequest(requests[0]);
    expect(decoded.access).toEqual({ kind: "invite", inviteSecret: "invite-secret", guestId: "guest_1" });
    expect(requests[0].url).not.toContain("invite-secret");
  });

  test("fails before sending when a required credential or sensitive mapping is missing", async () => {
    let sends = 0;
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example",
      fetch: async () => {
        sends += 1;
        return Response.json({});
      },
      headers: () => ({ "x-unrelated": "value" }),
    });

    const error = await captureError(() =>
      transport.request({
        method: "GET",
        path: "/v1/rooms/room/snapshots/latest.md",
        auth: accountAuth,
        body: { password: "never-send-this" },
      }),
    );

    expect(error).toBeInstanceOf(CloudBackendFetchTransportError);
    expect(error).toMatchObject({ code: "missing_header_mapping" });
    expect((error as Error).message).not.toContain("never-send-this");
    expect((error as Error).message).not.toContain(accountAuth.userId);
    expect(sends).toBe(0);
  });

  test("allows anonymous requests without a header adapter", async () => {
    const requests: Request[] = [];
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example/api",
      fetch: captureFetch(requests, { status: 200, body: { roomId: "room_1" } }),
    });

    const response = await transport.request({ method: "GET", path: "/v1/rooms/room_1" });
    expect(response).toEqual({ status: 200, body: { roomId: "room_1" } });
    expect(requests[0].headers.get("authorization")).toBeNull();
  });

  test("derives trusted account identity from the adapted credential", async () => {
    const credentialDirectory = new Map([
      ["Bearer credential-123", { userId: "server-derived-user", tenantId: "server-derived-tenant" }],
    ]);
    const client = createCloudBackendHttpClient({
      auth: accountAuth,
      transport: createCloudBackendFetchTransport({
        baseUrl: "https://cloud.example/api",
        headers: ({ sensitive }) => {
          expect(sensitive.accountAuth).toEqual(accountAuth);
          return { authorization: "Bearer credential-123" };
        },
        fetch: async (input, init) => {
          const request = input instanceof Request && init === undefined ? input : new Request(input, init);
          const identity = credentialDirectory.get(request.headers.get("authorization") ?? "");
          expect(identity).toEqual({ userId: "server-derived-user", tenantId: "server-derived-tenant" });
          expect(request.url).not.toContain(accountAuth.userId);
          expect(request.url).not.toContain(accountAuth.tenantId);
          return Response.json({
            roomId: "room_1",
            title: "Credential-derived room",
            mode: "account",
            source: "local-file",
            ownerUserId: identity!.userId,
            hasPassword: false,
          });
        },
      }),
    });

    const metadata = await client.getRoomMetadata("room_1");
    expect(metadata.ownerUserId).toBe("server-derived-user");
  });

  test("sends JSON mutation bodies once and preserves adapter content headers", async () => {
    const requests: Request[] = [];
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example",
      fetch: captureFetch(requests, { status: 201, body: { created: true } }),
      headers: () => ({ "content-type": "application/vnd.cloud+json" }),
    });

    await transport.request({ method: "POST", path: "/v1/rooms", body: { title: "Once" } });

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get("content-type")).toBe("application/vnd.cloud+json");
    expect(await requests[0].json()).toEqual({ title: "Once" });
  });

  test("preserves parsed non-2xx responses for shared client validation", async () => {
    const transport = createCloudBackendFetchTransport({
      baseUrl: "https://cloud.example",
      fetch: async () => Response.json({ error: "Denied by route" }, { status: 403 }),
    });
    const direct = await transport.request({ method: "GET", path: "/v1/rooms/room_1" });
    expect(direct).toEqual({ status: 403, body: { error: "Denied by route" } });

    const client = createCloudBackendHttpClient({ transport });
    const error = await captureError(() => client.getRoomMetadata("room_1"));
    expect(error).toBeInstanceOf(CloudBackendHttpClientError);
    expect(error).toMatchObject({ status: 403, code: "route_failed" });
  });

  test("distinguishes malformed JSON, network rejection, and abort without retries", async () => {
    const cases: Array<{ response: () => Promise<Response>; code: string }> = [
      { response: async () => new Response("not-json", { status: 502 }), code: "invalid_json" },
      { response: async () => { throw new Error("https://secret.example?password=leaked"); }, code: "network_failure" },
      { response: async () => { throw new DOMException("secret abort reason", "AbortError"); }, code: "aborted" },
    ];

    for (const entry of cases) {
      let sends = 0;
      const transport = createCloudBackendFetchTransport({
        baseUrl: "https://cloud.example",
        fetch: async () => {
          sends += 1;
          return entry.response();
        },
      });
      const error = await captureError(() => transport.request({ method: "GET", path: "/v1/rooms/room_1" }));
      expect(error).toMatchObject({ code: entry.code });
      expect((error as Error).message).not.toContain("secret");
      expect(sends).toBe(1);
    }
  });
});

function captureFetch(
  requests: Request[],
  result: { status: number; body: unknown },
): CloudBackendFetch {
  return async (input, init) => {
    requests.push(input instanceof Request && init === undefined ? input : new Request(input, init));
    return Response.json(result.body, { status: result.status });
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

async function decodeSnapshotRequest(request: Request) {
  const url = new URL(request.url);
  const accessKind = url.searchParams.get("access");
  const guestId = url.searchParams.get("guestId") ?? undefined;
  const ownerSecret = request.headers.get(cloudBackendFetchHeaderNames.ownerCapability) ?? undefined;
  const inviteSecret = request.headers.get(cloudBackendFetchHeaderNames.inviteCapability) ?? undefined;
  const password = request.headers.get(cloudBackendFetchHeaderNames.roomPassword) ?? undefined;

  const access = accessKind === "anonymous"
    ? { kind: "anonymous" as const, guestId: guestId ?? "guest_snapshot", ownerSecret }
    : accessKind === "invite" && inviteSecret
      ? { kind: "invite" as const, inviteSecret, guestId }
      : undefined;
  return {
    credential: request.headers.get(cloudBackendFetchHeaderNames.accountCredential) ?? undefined,
    access,
    password,
  };
}
