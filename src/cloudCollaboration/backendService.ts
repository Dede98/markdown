import {
  createInMemoryCloudRoomBackend,
  type CloudAccessContext,
  type CloudAccountAuth,
  type CloudAiSession,
  type CloudRoomBackendContract,
  type CloudRoomCreateRequest,
  type CloudRoomJoinRequest,
  type CloudRoomMetadata,
  type CloudRoomTicket,
} from "./backendContract";

export type CloudBackendHttpMethod = "GET" | "POST";

export type CloudBackendRouteId =
  | "create-room"
  | "join-room"
  | "claim-room"
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
type JoinRoomBody = Partial<Omit<CloudRoomJoinRequest, "roomId">>;
type ClaimRoomBody = { ownerSecret: string };
type AiSessionBody = Omit<Parameters<CloudRoomBackendContract["requestAiSession"]>[0], "roomId" | "auth">;

export const cloudBackendRoutes: CloudBackendRoute[] = [
  { id: "create-room", method: "POST", pattern: "/v1/rooms" },
  { id: "join-room", method: "POST", pattern: "/v1/rooms/:roomId/join" },
  { id: "claim-room", method: "POST", pattern: "/v1/rooms/:roomId/claim" },
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
  const body = expectBody<CreateRoomBody>(request.body);
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
  const body = expectBody<JoinRoomBody>(request.body);
  const access = body.access ?? request.auth;
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
  const body = expectBody<ClaimRoomBody>(request.body);
  return {
    status: 200,
    body: backend.claimAnonymousRoom({
      roomId,
      auth: request.auth,
      ownerSecret: body.ownerSecret,
    }),
  };
}

function createAiSession(
  backend: CloudRoomBackendContract,
  roomId: string,
  request: CloudBackendRequest,
): CloudBackendResponse<CloudAiSession> {
  const body = expectBody<AiSessionBody>(request.body);
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
};

function matchRoute(request: CloudBackendRequest): MatchedRoute | null {
  const path = stripTrailingSlash(request.path);
  if (request.method === "POST" && path === "/v1/rooms") {
    return { id: "create-room", roomId: "" };
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
  if (request.method === "POST" && action === "ai-sessions") {
    return { id: "create-ai-session", roomId };
  }
  return null;
}

function stripTrailingSlash(path: string) {
  return path.length > 1 ? path.replace(/\/$/u, "") : path;
}

function expectBody<T>(body: unknown): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudBackendRouteError(400, "Request body must be an object.");
  }
  return body as T;
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
  if (/requires signed-in auth|requires a signed-in account|requires room membership|valid anonymous owner secret/iu.test(message)) {
    return 401;
  }
  if (/requires a valid password/iu.test(message)) {
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
