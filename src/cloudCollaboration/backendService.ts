import {
  createInMemoryCloudRoomBackend,
  type CloudAccessContext,
  type CloudAccountAuth,
  type CloudAiSession,
  type CloudMarkdownSnapshot,
  type CloudRoomBackendContract,
  type CloudRoomInvite,
  type CloudRoomManagementAccess,
  type CloudRoomMemberRemoval,
  type CloudRoomMetadata,
  type CloudRoomPasswordUpdate,
  type CloudRoomTicket,
} from "./backendContract";
import {
  cloudBackendRoutes,
  CloudBackendRouteRequestValidationError,
  parseAiSessionBody,
  parseClaimRoomBody,
  parseCreateInviteBody,
  parseCreateRoomBody,
  parseGetSnapshotBody,
  parseJoinRoomBody,
  parseUpdatePasswordBody,
  type CloudBackendErrorResponse,
  type CloudBackendGetSnapshotBody,
  type CloudBackendRequest,
  type CloudBackendResponse,
  type CloudBackendRoute,
  type CloudBackendRouteId,
} from "./backendRouteContracts";

export {
  cloudBackendRoutes,
  type CloudBackendErrorResponse,
  type CloudBackendHttpMethod,
  type CloudBackendRequest,
  type CloudBackendResponse,
  type CloudBackendRoute,
  type CloudBackendRouteId,
} from "./backendRouteContracts";

export type CloudBackendService = {
  routes: CloudBackendRoute[];
  handle: (request: CloudBackendRequest) => CloudBackendResponse;
};

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

function snapshotAccessFor(
  auth: CloudAccountAuth | undefined,
  body: Partial<CloudBackendGetSnapshotBody>,
): CloudAccessContext {
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
  if (error instanceof CloudBackendRouteRequestValidationError) {
    return {
      status: 400,
      body: { error: error.message },
    };
  }
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
