import type {
  CloudAccessContext,
  CloudAccountAuth,
  CloudAiSession,
  CloudMarkdownSnapshot,
  CloudRoomCreateRequest,
  CloudRoomInvite,
  CloudRoomInviteRole,
  CloudRoomMemberRemoval,
  CloudRoomMetadata,
  CloudRoomPasswordUpdate,
  CloudRoomTicket,
} from "./backendContract";
import type {
  CloudBackendHttpMethod,
  CloudBackendRequest,
  CloudBackendResponse,
  CloudBackendRouteId,
  CloudBackendService,
} from "./backendService";

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
  createRoom: (request: CloudBackendHttpClientCreateRoomRequest) => CloudRoomTicket;
  joinRoom: (request: CloudBackendHttpClientJoinRoomRequest) => CloudRoomTicket;
  claimAnonymousRoom: (request: CloudBackendHttpClientClaimRoomRequest) => CloudRoomMetadata;
  createInvite: (request: CloudBackendHttpClientCreateInviteRequest) => CloudRoomInvite;
  updateRoomPassword: (request: CloudBackendHttpClientUpdatePasswordRequest) => CloudRoomPasswordUpdate;
  removeRoomMember: (request: CloudBackendHttpClientRemoveMemberRequest) => CloudRoomMemberRemoval;
  getMarkdownSnapshot: (request: CloudBackendHttpClientGetSnapshotRequest) => CloudMarkdownSnapshot;
  requestAiSession: (request: CloudBackendHttpClientCreateAiSessionRequest) => CloudAiSession;
  getRoomMetadata: (roomId: string, options?: { auth?: CloudAccountAuth }) => CloudRoomMetadata;
};

export type CloudBackendHttpClientErrorCode = "route_failed";

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
    );

  return {
    createRoom(request) {
      const { auth: requestAuth, ...body } = request;
      return send<CloudRoomTicket>("create-room", "POST", "/v1/rooms", requestAuth, body);
    },

    joinRoom(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send<CloudRoomTicket>(
        "join-room",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/join`,
        requestAuth,
        body,
      );
    },

    claimAnonymousRoom(request) {
      const { roomId, auth: requestAuth, ownerSecret } = request;
      return send<CloudRoomMetadata>(
        "claim-room",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/claim`,
        requestAuth,
        { ownerSecret },
      );
    },

    createInvite(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send<CloudRoomInvite>(
        "create-room-invite",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/invites`,
        requestAuth,
        body,
      );
    },

    updateRoomPassword(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send<CloudRoomPasswordUpdate>(
        "update-room-password",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/password`,
        requestAuth,
        body,
      );
    },

    removeRoomMember(request) {
      const { roomId, userId, auth: requestAuth } = request;
      return send<CloudRoomMemberRemoval>(
        "remove-room-member",
        "DELETE",
        `/v1/rooms/${routeSegment(roomId)}/members/${routeSegment(userId)}`,
        requestAuth,
      );
    },

    getMarkdownSnapshot(request) {
      const { roomId, versionId, auth: requestAuth, ...body } = request;
      return send<CloudMarkdownSnapshot>(
        "get-markdown-snapshot",
        "GET",
        `/v1/rooms/${routeSegment(roomId)}/snapshots/${routeSegment(versionId)}.md`,
        requestAuth,
        body,
      );
    },

    requestAiSession(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send<CloudAiSession>(
        "create-ai-session",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/ai-sessions`,
        requestAuth,
        body,
      );
    },

    getRoomMetadata(roomId, options) {
      return send<CloudRoomMetadata>("get-room", "GET", `/v1/rooms/${routeSegment(roomId)}`, options?.auth);
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
  response: CloudBackendResponse,
): TBody {
  if (response.status >= 200 && response.status < 300) {
    return response.body as TBody;
  }
  throw new CloudBackendHttpClientError(
    routeId,
    method,
    path,
    response.status,
    "route_failed",
    errorMessage(response),
  );
}

function errorMessage(response: CloudBackendResponse) {
  if (response.body && typeof response.body === "object" && "error" in response.body) {
    return String(response.body.error);
  }
  return "Route request failed.";
}

function routeSegment(value: string) {
  return encodeURIComponent(value);
}
