import type {
  CloudAccessContext,
  CloudAccountAuth,
  CloudRoomCreateRequest,
  CloudRoomInviteRole,
} from "./backendContract";
import {
  cloudBackendRouteResponseValidators,
  CloudBackendRouteResponseValidationError,
  type CloudBackendHttpMethod,
  type CloudBackendRequest,
  type CloudBackendResponse,
  type CloudBackendRouteId,
  type CloudBackendRouteResponseValidator,
  type CloudBackendRouteSuccessBodies,
} from "./backendRouteContracts";
import type { CloudBackendService } from "./backendService";

export type CloudBackendHttpTransport = {
  request: (request: CloudBackendRequest) => CloudBackendResponse;
};

export type CloudBackendHttpClientOptions = {
  transport: CloudBackendHttpTransport;
  auth?: CloudAccountAuth;
};

export type CloudBackendHttpClientCreateRoomRequest = Omit<CloudRoomCreateRequest, "auth"> & {
  auth?: CloudAccountAuth;
};

export type CloudBackendHttpClientJoinRoomRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  access?: CloudAccessContext;
  inviteSecret?: string;
  guestId?: string;
  password?: string;
};

export type CloudBackendHttpClientClaimRoomRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  ownerSecret: string;
};

export type CloudBackendHttpClientCreateInviteRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  role: CloudRoomInviteRole;
  ownerSecret?: string;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};

export type CloudBackendHttpClientUpdatePasswordRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  password?: string | null;
  ownerSecret?: string;
};

export type CloudBackendHttpClientRemoveMemberRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  userId: string;
};

export type CloudBackendHttpClientGetSnapshotRequest = {
  roomId: string;
  versionId: string;
  auth?: CloudAccountAuth;
  access?: CloudAccessContext;
  password?: string;
  ownerSecret?: string;
  guestId?: string;
};

export type CloudBackendHttpClientCreateAiSessionRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  agentId: string;
  displayName: string;
};

export type CloudBackendHttpClient = {
  createRoom: (request: CloudBackendHttpClientCreateRoomRequest) => CloudBackendRouteSuccessBodies["create-room"];
  joinRoom: (request: CloudBackendHttpClientJoinRoomRequest) => CloudBackendRouteSuccessBodies["join-room"];
  claimAnonymousRoom: (
    request: CloudBackendHttpClientClaimRoomRequest,
  ) => CloudBackendRouteSuccessBodies["claim-room"];
  createInvite: (
    request: CloudBackendHttpClientCreateInviteRequest,
  ) => CloudBackendRouteSuccessBodies["create-room-invite"];
  updateRoomPassword: (
    request: CloudBackendHttpClientUpdatePasswordRequest,
  ) => CloudBackendRouteSuccessBodies["update-room-password"];
  removeRoomMember: (
    request: CloudBackendHttpClientRemoveMemberRequest,
  ) => CloudBackendRouteSuccessBodies["remove-room-member"];
  getMarkdownSnapshot: (
    request: CloudBackendHttpClientGetSnapshotRequest,
  ) => CloudBackendRouteSuccessBodies["get-markdown-snapshot"];
  requestAiSession: (
    request: CloudBackendHttpClientCreateAiSessionRequest,
  ) => CloudBackendRouteSuccessBodies["create-ai-session"];
  getRoomMetadata: (
    roomId: string,
    options?: { auth?: CloudAccountAuth },
  ) => CloudBackendRouteSuccessBodies["get-room"];
};

export type CloudBackendHttpClientErrorCode = "invalid_response" | "route_failed";

export class CloudBackendHttpClientError extends Error {
  readonly name = "CloudBackendHttpClientError";

  constructor(
    public readonly routeId: CloudBackendRouteId,
    public readonly method: CloudBackendHttpMethod,
    public readonly path: string,
    public readonly status: number,
    public readonly code: CloudBackendHttpClientErrorCode,
    message: string,
  ) {
    super(`Cloud backend ${method} ${path} failed with HTTP ${status}: ${message}`);
  }
}

export function createCloudBackendHttpClient({
  transport,
  auth,
}: CloudBackendHttpClientOptions): CloudBackendHttpClient {
  const send = <TBody>(
    routeId: CloudBackendRouteId,
    method: CloudBackendHttpMethod,
    path: string,
    requestAuth: CloudAccountAuth | undefined,
    validate: CloudBackendRouteResponseValidator<TBody>,
    body?: unknown,
  ) =>
    expectSuccess<TBody>(
      routeId,
      method,
      path,
      transport.request({
        method,
        path,
        auth: requestAuth ?? auth,
        body,
      }),
      validate,
    );

  return {
    createRoom(request) {
      const { auth: requestAuth, ...body } = request;
      return send(
        "create-room",
        "POST",
        "/v1/rooms",
        requestAuth,
        cloudBackendRouteResponseValidators["create-room"],
        body,
      );
    },

    joinRoom(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send(
        "join-room",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/join`,
        requestAuth,
        cloudBackendRouteResponseValidators["join-room"],
        body,
      );
    },

    claimAnonymousRoom(request) {
      const { roomId, auth: requestAuth, ownerSecret } = request;
      return send(
        "claim-room",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/claim`,
        requestAuth,
        cloudBackendRouteResponseValidators["claim-room"],
        { ownerSecret },
      );
    },

    createInvite(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send(
        "create-room-invite",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/invites`,
        requestAuth,
        cloudBackendRouteResponseValidators["create-room-invite"],
        body,
      );
    },

    updateRoomPassword(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send(
        "update-room-password",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/password`,
        requestAuth,
        cloudBackendRouteResponseValidators["update-room-password"],
        body,
      );
    },

    removeRoomMember(request) {
      const { roomId, userId, auth: requestAuth } = request;
      return send(
        "remove-room-member",
        "DELETE",
        `/v1/rooms/${routeSegment(roomId)}/members/${routeSegment(userId)}`,
        requestAuth,
        cloudBackendRouteResponseValidators["remove-room-member"],
      );
    },

    getMarkdownSnapshot(request) {
      const { roomId, versionId, auth: requestAuth, ...body } = request;
      return send(
        "get-markdown-snapshot",
        "GET",
        `/v1/rooms/${routeSegment(roomId)}/snapshots/${routeSegment(versionId)}.md`,
        requestAuth,
        cloudBackendRouteResponseValidators["get-markdown-snapshot"],
        body,
      );
    },

    requestAiSession(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send(
        "create-ai-session",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/ai-sessions`,
        requestAuth,
        cloudBackendRouteResponseValidators["create-ai-session"],
        body,
      );
    },

    getRoomMetadata(roomId, options) {
      return send(
        "get-room",
        "GET",
        `/v1/rooms/${routeSegment(roomId)}`,
        options?.auth,
        cloudBackendRouteResponseValidators["get-room"],
      );
    },
  };
}

export function createCloudBackendServiceTransport(service: CloudBackendService): CloudBackendHttpTransport {
  return {
    request: (request) => service.handle(request),
  };
}

function expectSuccess<TBody>(
  routeId: CloudBackendRouteId,
  method: CloudBackendHttpMethod,
  path: string,
  response: unknown,
  validate: CloudBackendRouteResponseValidator<TBody>,
): TBody {
  const normalized = normalizeResponse(routeId, method, path, response);
  if (normalized.status >= 200 && normalized.status < 300) {
    try {
      return validate(normalized.body);
    } catch (error) {
      throw invalidResponse(
        routeId,
        method,
        path,
        normalized.status,
        error instanceof CloudBackendRouteResponseValidationError
          ? error.message
          : "Response body did not match the route contract.",
      );
    }
  }
  throw new CloudBackendHttpClientError(
    routeId,
    method,
    path,
    normalized.status,
    "route_failed",
    routeErrorMessage(routeId, method, path, normalized),
  );
}

function normalizeResponse(
  routeId: CloudBackendRouteId,
  method: CloudBackendHttpMethod,
  path: string,
  response: unknown,
): CloudBackendResponse {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw invalidResponse(routeId, method, path, 0, "Transport response must be an object.");
  }
  const input = response as Record<string, unknown>;
  if (typeof input.status !== "number" || !Number.isFinite(input.status)) {
    throw invalidResponse(routeId, method, path, 0, 'Transport response field "status" must be a finite number.');
  }
  if (!("body" in input)) {
    throw invalidResponse(routeId, method, path, input.status, 'Transport response field "body" is required.');
  }
  return {
    status: input.status,
    body: input.body,
  };
}

function routeErrorMessage(
  routeId: CloudBackendRouteId,
  method: CloudBackendHttpMethod,
  path: string,
  response: CloudBackendResponse,
) {
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
    throw invalidResponse(routeId, method, path, response.status, "Route error response body must be an object.");
  }
  const body = response.body as Record<string, unknown>;
  const error = body.error;
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  throw invalidResponse(
    routeId,
    method,
    path,
    response.status,
    'Route error response body field "error" must be a non-empty string.',
  );
}

function invalidResponse(
  routeId: CloudBackendRouteId,
  method: CloudBackendHttpMethod,
  path: string,
  status: number,
  message: string,
) {
  return new CloudBackendHttpClientError(routeId, method, path, status, "invalid_response", message);
}

function routeSegment(value: string) {
  return encodeURIComponent(value);
}
