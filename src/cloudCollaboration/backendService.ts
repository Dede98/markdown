import {
  createInMemoryCloudRoomBackend,
  type CloudAccessContext,
  type CloudAccountAuth,
  type CloudAiSession,
  type CloudMarkdownSnapshot,
  type CloudRoomBackendContract,
  type CloudRoomCreateRequest,
  type CloudRoomInvite,
  type CloudRoomInviteRole,
  type CloudRoomManagementAccess,
  type CloudRoomMemberRemoval,
  type CloudRoomJoinRequest,
  type CloudRoomMetadata,
  type CloudRoomPasswordUpdate,
  type CloudRoomTicket,
} from "./backendContract";

export type CloudBackendHttpMethod = "DELETE" | "GET" | "POST";

export type CloudBackendRouteId =
  | "create-room"
  | "join-room"
  | "claim-room"
  | "create-room-invite"
  | "update-room-password"
  | "remove-room-member"
  | "get-markdown-snapshot"
  | "create-ai-session"
  | "get-room";

export type CloudBackendRoute = {
  id: CloudBackendRouteId;
  method: CloudBackendHttpMethod;
  pattern: string;
};

export type CloudBackendRequest = {
  method: CloudBackendHttpMethod;
  path: string;
  auth?: CloudAccountAuth;
  body?: unknown;
};

export type CloudBackendResponse<TBody = unknown> = {
  status: number;
  body: TBody;
};

export type CloudBackendErrorResponse = {
  error: string;
};

export type CloudBackendService = {
  routes: CloudBackendRoute[];
  handle: (request: CloudBackendRequest) => CloudBackendResponse;
};

type CreateRoomBody = Omit<CloudRoomCreateRequest, "auth">;
type JoinRoomBody = Partial<Omit<CloudRoomJoinRequest, "roomId">> & {
  inviteSecret?: string;
  guestId?: string;
};
type ClaimRoomBody = { ownerSecret: string };
type CreateInviteBody = {
  role: CloudRoomInviteRole;
  ownerSecret?: string;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};
type UpdatePasswordBody = {
  password?: string | null;
  ownerSecret?: string;
};
type GetSnapshotBody = {
  access?: CloudAccessContext;
  password?: string;
  ownerSecret?: string;
  guestId?: string;
};
type AiSessionBody = Omit<Parameters<CloudRoomBackendContract["requestAiSession"]>[0], "roomId" | "auth">;

export const cloudBackendRoutes: CloudBackendRoute[] = [
  { id: "create-room", method: "POST", pattern: "/v1/rooms" },
  { id: "join-room", method: "POST", pattern: "/v1/rooms/:roomId/join" },
  { id: "claim-room", method: "POST", pattern: "/v1/rooms/:roomId/claim" },
  { id: "create-room-invite", method: "POST", pattern: "/v1/rooms/:roomId/invites" },
  { id: "update-room-password", method: "POST", pattern: "/v1/rooms/:roomId/password" },
  { id: "remove-room-member", method: "DELETE", pattern: "/v1/rooms/:roomId/members/:userId" },
  { id: "get-markdown-snapshot", method: "GET", pattern: "/v1/rooms/:roomId/snapshots/:versionId.md" },
  { id: "create-ai-session", method: "POST", pattern: "/v1/rooms/:roomId/ai-sessions" },
  { id: "get-room", method: "GET", pattern: "/v1/rooms/:roomId" },
];

export function createInMemoryCloudBackendService(
  backend: CloudRoomBackendContract = createInMemoryCloudRoomBackend(),
): CloudBackendService {
  return {
    routes: cloudBackendRoutes,
    handle(request) {
      try {
        return handleRequest(backend, request);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

function handleRequest(backend: CloudRoomBackendContract, request: CloudBackendRequest): CloudBackendResponse {
  const route = matchRoute(request);
  if (!route) {
    return {
      status: 404,
      body: { error: `No Cloud backend route for ${request.method} ${request.path}` },
    };
  }

  switch (route.id) {
    case "create-room":
      return createRoom(backend, request);
    case "join-room":
      return joinRoom(backend, route.roomId, request);
    case "claim-room":
      return claimRoom(backend, route.roomId, request);
    case "create-room-invite":
      return createRoomInvite(backend, route.roomId, request);
    case "update-room-password":
      return updateRoomPassword(backend, route.roomId, request);
    case "remove-room-member":
      return removeRoomMember(backend, route.roomId, route.userId, request);
    case "get-markdown-snapshot":
      return getMarkdownSnapshot(backend, route.roomId, route.versionId, request);
    case "create-ai-session":
      return createAiSession(backend, route.roomId, request);
    case "get-room":
      return {
        status: 200,
        body: backend.getRoomMetadata(route.roomId),
      } satisfies CloudBackendResponse<CloudRoomMetadata>;
  }
}

function createRoom(backend: CloudRoomBackendContract, request: CloudBackendRequest): CloudBackendResponse<CloudRoomTicket> {
  const body = parseCreateRoomBody(request.body);
  const ticket = backend.createRoom({
    ...body,
    auth: request.auth,
  });
  return {
    status: 201,
    body: ticket,
  };
}

function joinRoom(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudRoomTicket> {
  const body = parseJoinRoomBody(request.body);
  const access = body.inviteSecret
    ? {
        kind: "invite" as const,
        inviteSecret: body.inviteSecret,
        auth: request.auth,
        guestId: body.guestId,
      }
    : body.access ?? request.auth;
  if (!access) {
    throw new CloudBackendRouteError(401, "Joining a room requires account auth or anonymous access.");
  }
  return {
    status: 200,
    body: backend.joinRoom({
      roomId,
      access,
      password: body.password,
    }),
  };
}

function claimRoom(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudRoomMetadata> {
  if (!request.auth) {
    throw new CloudBackendRouteError(401, "Claiming an anonymous room requires signed-in auth.");
  }
  const body = parseClaimRoomBody(request.body);
  return {
    status: 200,
    body: backend.claimAnonymousRoom({
      roomId,
      auth: request.auth,
      ownerSecret: body.ownerSecret,
    }),
  };
}

function createRoomInvite(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudRoomInvite> {
  const body = parseCreateInviteBody(request.body);
  return {
    status: 201,
    body: backend.createInvite({
      roomId,
      access: managementAccessFor(request.auth, body.ownerSecret, "invites"),
      role: body.role,
      expiresAt: body.expiresAt,
      maxUses: body.maxUses,
      audience: body.audience,
    }),
  };
}

function updateRoomPassword(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudRoomPasswordUpdate> {
  const body = parseUpdatePasswordBody(request.body);
  return {
    status: 200,
    body: backend.updateRoomPassword({
      roomId,
      access: managementAccessFor(request.auth, body.ownerSecret, "password"),
      password: body.password,
    }),
  };
}

function removeRoomMember(
  backend: CloudRoomBackendContract,
  roomId: string,
  userId: string | undefined,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudRoomMemberRemoval> {
  if (!userId) {
    throw new CloudBackendRouteError(404, `No Cloud backend route for ${request.method} ${request.path}`);
  }
  if (!request.auth) {
    throw new CloudBackendRouteError(401, "Removing a room member requires owner/admin auth.");
  }
  return {
    status: 200,
    body: backend.removeRoomMember({
      roomId,
      userId,
      access: { kind: "account", auth: request.auth },
    }),
  };
}

function getMarkdownSnapshot(
  backend: CloudRoomBackendContract,
  roomId: string,
  versionId: string | undefined,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudMarkdownSnapshot> {
  if (!versionId) {
    throw new CloudBackendRouteError(404, `No Cloud backend route for ${request.method} ${request.path}`);
  }
  const body = parseGetSnapshotBody(request.body);
  return {
    status: 200,
    body: backend.getMarkdownSnapshot({
      roomId,
      versionId,
      access: snapshotAccessFor(request.auth, body),
      password: body.password,
    }),
  };
}

function createAiSession(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudAiSession> {
  const body = parseAiSessionBody(request.body);
  return {
    status: 201,
    body: backend.requestAiSession({
      roomId,
      auth: request.auth,
      agentId: body.agentId,
      displayName: body.displayName,
    }),
  };
}

type MatchedRoute = {
  id: CloudBackendRouteId;
  roomId: string;
  userId?: string;
  versionId?: string;
};

function matchRoute(request: CloudBackendRequest): MatchedRoute | null {
  const path = stripTrailingSlash(request.path);
  if (request.method === "POST" && path === "/v1/rooms") {
    return { id: "create-room", roomId: "" };
  }

  const memberMatch = path.match(/^\/v1\/rooms\/([^/]+)\/members\/([^/]+)$/u);
  if (request.method === "DELETE" && memberMatch) {
    return {
      id: "remove-room-member",
      roomId: decodeURIComponent(memberMatch[1]),
      userId: decodeURIComponent(memberMatch[2]),
    };
  }

  const snapshotMatch = path.match(/^\/v1\/rooms\/([^/]+)\/snapshots\/([^/]+)\.md$/u);
  if (request.method === "GET" && snapshotMatch) {
    return {
      id: "get-markdown-snapshot",
      roomId: decodeURIComponent(snapshotMatch[1]),
      versionId: decodeURIComponent(snapshotMatch[2]),
    };
  }

  const match = path.match(/^\/v1\/rooms\/([^/]+)(?:\/([^/]+))?$/u);
  if (!match) {
    return null;
  }

  const roomId = decodeURIComponent(match[1]);
  const action = match[2];
  if (request.method === "GET" && action === undefined) {
    return { id: "get-room", roomId };
  }
  if (request.method === "POST" && action === "join") {
    return { id: "join-room", roomId };
  }
  if (request.method === "POST" && action === "claim") {
    return { id: "claim-room", roomId };
  }
  if (request.method === "POST" && action === "invites") {
    return { id: "create-room-invite", roomId };
  }
  if (request.method === "POST" && action === "password") {
    return { id: "update-room-password", roomId };
  }
  if (request.method === "POST" && action === "ai-sessions") {
    return { id: "create-ai-session", roomId };
  }
  return null;
}

function stripTrailingSlash(path: string) {
  return path.length > 1 ? path.replace(/\/$/u, "") : path;
}

function parseCreateRoomBody(body: unknown): CreateRoomBody {
  const input = expectBody(body);
  return {
    mode: expectOneOf(input, "mode", ["anonymous", "account"]),
    source: expectOneOf(input, "source", ["local-file"]),
    title: expectRequiredString(input, "title"),
    seedMarkdown: expectRequiredString(input, "seedMarkdown"),
    password: optionalString(input, "password"),
  };
}

function parseJoinRoomBody(body: unknown): JoinRoomBody {
  const input = expectBody(body);
  return {
    access: optionalAccessContext(input, "access"),
    inviteSecret: optionalString(input, "inviteSecret"),
    guestId: optionalString(input, "guestId"),
    password: optionalString(input, "password"),
  };
}

function parseClaimRoomBody(body: unknown): ClaimRoomBody {
  const input = expectBody(body);
  return {
    ownerSecret: expectRequiredString(input, "ownerSecret"),
  };
}

function parseCreateInviteBody(body: unknown): CreateInviteBody {
  const input = expectBody(body);
  return {
    role: expectOneOf(input, "role", ["admin", "editor", "commenter", "viewer"]),
    ownerSecret: optionalString(input, "ownerSecret"),
    expiresAt: optionalString(input, "expiresAt"),
    maxUses: optionalNumber(input, "maxUses"),
    audience: optionalString(input, "audience"),
  };
}

function parseUpdatePasswordBody(body: unknown): UpdatePasswordBody {
  const input = expectBody(body);
  return {
    password: optionalNullableString(input, "password"),
    ownerSecret: optionalString(input, "ownerSecret"),
  };
}

function parseGetSnapshotBody(body: unknown): Partial<GetSnapshotBody> {
  const input = optionalBody(body);
  return {
    access: optionalAccessContext(input, "access"),
    password: optionalString(input, "password"),
    ownerSecret: optionalString(input, "ownerSecret"),
    guestId: optionalString(input, "guestId"),
  };
}

function parseAiSessionBody(body: unknown): AiSessionBody {
  const input = expectBody(body);
  return {
    agentId: expectRequiredString(input, "agentId"),
    displayName: expectRequiredString(input, "displayName"),
  };
}

function expectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudBackendRouteError(400, "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function optionalBody(body: unknown): Record<string, unknown> {
  if (body === undefined) {
    return {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudBackendRouteError(400, "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function expectRequiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be a string.`);
  }
  return value;
}

function optionalNullableString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string") {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be a string or null.`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be a finite number.`);
  }
  return value;
}

function expectOneOf<const TValues extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  values: TValues,
): TValues[number] {
  const value = input[key];
  if (typeof value === "string" && values.includes(value)) {
    return value;
  }
  throw new CloudBackendRouteError(400, `Request field "${key}" must be one of: ${values.join(", ")}.`);
}

function optionalAccessContext(input: Record<string, unknown>, key: string): CloudAccessContext | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be an access object.`);
  }
  const access = value as Record<string, unknown>;
  const kind = access.kind;
  if (kind === "account") {
    return {
      kind,
      userId: expectRequiredString(access, "userId"),
      tenantId: expectRequiredString(access, "tenantId"),
    };
  }
  if (kind === "anonymous") {
    return {
      kind,
      guestId: expectRequiredString(access, "guestId"),
      ownerSecret: optionalString(access, "ownerSecret"),
    };
  }
  if (kind === "invite") {
    return {
      kind,
      inviteSecret: expectRequiredString(access, "inviteSecret"),
      auth: optionalAccountAuth(access, "auth"),
      guestId: optionalString(access, "guestId"),
    };
  }
  throw new CloudBackendRouteError(400, `Request field "${key}.kind" must be one of: account, anonymous, invite.`);
}

function optionalAccountAuth(input: Record<string, unknown>, key: string): CloudAccountAuth | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudBackendRouteError(400, `Request field "${key}" must be an account auth object.`);
  }
  const auth = value as Record<string, unknown>;
  if (auth.kind !== "account") {
    throw new CloudBackendRouteError(400, `Request field "${key}.kind" must be account.`);
  }
  return {
    kind: "account",
    userId: expectRequiredString(auth, "userId"),
    tenantId: expectRequiredString(auth, "tenantId"),
  };
}

function managementAccessFor(
  auth: CloudAccountAuth | undefined,
  ownerSecret: string | undefined,
  subject: "invites" | "password",
): CloudRoomManagementAccess {
  if (auth) {
    return { kind: "account", auth };
  }
  if (ownerSecret) {
    return { kind: "anonymous-owner", ownerSecret };
  }
  throw new CloudBackendRouteError(
    401,
    `Managing room ${subject} requires owner/admin auth or anonymous owner capability.`,
  );
}

function snapshotAccessFor(auth: CloudAccountAuth | undefined, body: Partial<GetSnapshotBody>): CloudAccessContext {
  if (auth) {
    return auth;
  }
  if (body.access) {
    return body.access;
  }
  if (body.ownerSecret || body.guestId) {
    return {
      kind: "anonymous",
      guestId: body.guestId ?? "guest_snapshot",
      ownerSecret: body.ownerSecret,
    };
  }
  throw new CloudBackendRouteError(401, "Snapshot download requires account auth or anonymous room access.");
}

function errorResponse(error: unknown): CloudBackendResponse<CloudBackendErrorResponse> {
  if (error instanceof CloudBackendRouteError) {
    return {
      status: error.status,
      body: { error: error.message },
    };
  }
  const message = error instanceof Error ? error.message : "Cloud backend request failed.";
  return {
    status: inferErrorStatus(message),
    body: { error: message },
  };
}

function inferErrorStatus(message: string) {
  if (/does not exist|no cloud backend route/iu.test(message)) {
    return 404;
  }
  if (/requires signed-in auth|requires a signed-in account|valid anonymous owner secret/iu.test(message)) {
    return 401;
  }
  if (/requires a valid password|owner or admin|cannot manage|requires room membership|anonymous room access|valid room invite|invite has expired|no remaining uses|requires signed-in account auth|cannot remove|already revoked/iu.test(message)) {
    return 403;
  }
  return 400;
}

class CloudBackendRouteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
