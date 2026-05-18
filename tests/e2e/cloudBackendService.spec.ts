import { expect, test } from "@playwright/test";
import { createInMemoryCloudBackendService } from "../../src/cloudCollaboration/backendService";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";

const accountAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_123",
  tenantId: "tenant_personal",
};

test.describe("cloud backend service skeleton", () => {
  test("publishes the initial HTTP-shaped room route surface", () => {
    const service = createInMemoryCloudBackendService();

    expect(service.routes).toEqual([
      { id: "create-room", method: "POST", pattern: "/v1/rooms" },
      { id: "join-room", method: "POST", pattern: "/v1/rooms/:roomId/join" },
      { id: "claim-room", method: "POST", pattern: "/v1/rooms/:roomId/claim" },
      { id: "create-ai-session", method: "POST", pattern: "/v1/rooms/:roomId/ai-sessions" },
      { id: "get-room", method: "GET", pattern: "/v1/rooms/:roomId" },
    ]);
  });

  test("creates and reads an anonymous room through service routes", () => {
    const service = createInMemoryCloudBackendService();

    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      body: {
        mode: "anonymous",
        source: "local-file",
        title: "Anonymous route room",
        seedMarkdown: "# Route seed",
        password: "route-pass",
      },
    });

    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      role: "guest-owner",
      ownerSecret: expect.stringMatching(/^owner_room_0001_/),
    });
    const roomId = String((create.body as { roomId: string }).roomId);

    const metadata = service.handle({ method: "GET", path: `/v1/rooms/${roomId}` });
    expect(metadata).toMatchObject({
      status: 200,
      body: {
        roomId,
        mode: "anonymous",
        hasPassword: true,
        source: "local-file",
      },
    });
  });

  test("maps account auth at the service boundary for create claim and AI routes", () => {
    const service = createInMemoryCloudBackendService();
    const anonymousCreate = service.handle({
      method: "POST",
      path: "/v1/rooms",
      body: {
        mode: "anonymous",
        source: "local-file",
        title: "Claim route room",
        seedMarkdown: "# Claim route",
      },
    });
    const room = anonymousCreate.body as { roomId: string; ownerSecret: string };

    const missingAuthClaim = service.handle({
      method: "POST",
      path: `/v1/rooms/${room.roomId}/claim`,
      body: { ownerSecret: room.ownerSecret },
    });
    expect(missingAuthClaim).toMatchObject({
      status: 401,
      body: { error: expect.stringMatching(/requires signed-in auth/i) },
    });

    const claim = service.handle({
      method: "POST",
      path: `/v1/rooms/${room.roomId}/claim`,
      auth: accountAuth,
      body: { ownerSecret: room.ownerSecret },
    });
    expect(claim).toMatchObject({
      status: 200,
      body: {
        roomId: room.roomId,
        mode: "account",
        ownerUserId: accountAuth.userId,
      },
    });

    const ai = service.handle({
      method: "POST",
      path: `/v1/rooms/${room.roomId}/ai-sessions`,
      auth: accountAuth,
      body: {
        agentId: "agent_review",
        displayName: "Review Agent",
      },
    });
    expect(ai).toMatchObject({
      status: 201,
      body: {
        participantKind: "ai-agent",
        authorizedByUserId: accountAuth.userId,
      },
    });
  });

  test("uses route-level statuses for password and missing-room failures", () => {
    const service = createInMemoryCloudBackendService();
    const create = service.handle({
      method: "POST",
      path: "/v1/rooms",
      body: {
        mode: "account",
        source: "local-file",
        title: "Protected account route",
        seedMarkdown: "# Protected",
        password: "account-pass",
      },
      auth: accountAuth,
    });
    const roomId = String((create.body as { roomId: string }).roomId);

    expect(
      service.handle({
        method: "POST",
        path: `/v1/rooms/${roomId}/join`,
        auth: accountAuth,
        body: {},
      }),
    ).toMatchObject({
      status: 403,
      body: { error: expect.stringMatching(/requires a valid password/i) },
    });
    expect(
      service.handle({
        method: "GET",
        path: "/v1/rooms/missing-room",
      }),
    ).toMatchObject({
      status: 404,
      body: { error: expect.stringMatching(/does not exist/i) },
    });
  });
});
