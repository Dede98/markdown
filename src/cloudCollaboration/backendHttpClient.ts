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
    validate: ResponseValidator<TBody>,
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
      return send<CloudRoomTicket>("create-room", "POST", "/v1/rooms", requestAuth, validateRoomTicket, body);
    },

    joinRoom(request) {
      const { roomId, auth: requestAuth, ...body } = request;
      return send<CloudRoomTicket>(
        "join-room",
        "POST",
        `/v1/rooms/${routeSegment(roomId)}/join`,
        requestAuth,
        validateRoomTicket,
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
        validateRoomMetadata,
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
        validateRoomInvite,
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
        validatePasswordUpdate,
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
        validateMemberRemoval,
      );
    },

    getMarkdownSnapshot(request) {
      const { roomId, versionId, auth: requestAuth, ...body } = request;
      return send<CloudMarkdownSnapshot>(
        "get-markdown-snapshot",
        "GET",
        `/v1/rooms/${routeSegment(roomId)}/snapshots/${routeSegment(versionId)}.md`,
        requestAuth,
        validateMarkdownSnapshot,
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
        validateAiSession,
        body,
      );
    },

    getRoomMetadata(roomId, options) {
      return send<CloudRoomMetadata>(
        "get-room",
        "GET",
        `/v1/rooms/${routeSegment(roomId)}`,
        options?.auth,
        validateRoomMetadata,
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
  validate: ResponseValidator<TBody>,
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
        error instanceof ResponseValidationError ? error.message : "Response body did not match the route contract.",
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

type ResponseValidator<TBody> = (body: unknown) => TBody;

class ResponseValidationError extends Error {}

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

function validateRoomTicket(body: unknown): CloudRoomTicket {
  const input = expectObject(body, "Room ticket response body");
  return {
    roomId: expectString(input, "roomId"),
    websocketUrl: expectString(input, "websocketUrl"),
    roomToken: expectString(input, "roomToken"),
    role: expectOneOf(input, "role", ["owner", "admin", "editor", "commenter", "viewer", "guest-owner"]),
    ownerSecret: optionalString(input, "ownerSecret"),
    expiresAt: optionalString(input, "expiresAt"),
    persistence: validatePersistenceBoundary(input.persistence),
    materializeMarkdown: expectFunction(input, "materializeMarkdown"),
    getCommentMappingSummary: expectFunction(input, "getCommentMappingSummary"),
  };
}

function validateRoomMetadata(body: unknown): CloudRoomMetadata {
  const input = expectObject(body, "Room metadata response body");
  return {
    roomId: expectString(input, "roomId"),
    title: expectString(input, "title"),
    mode: expectOneOf(input, "mode", ["anonymous", "account"]),
    source: expectOneOf(input, "source", ["local-file"]),
    ownerUserId: optionalString(input, "ownerUserId"),
    hasPassword: expectBoolean(input, "hasPassword"),
    claimedAt: optionalString(input, "claimedAt"),
    expiresAt: optionalString(input, "expiresAt"),
  };
}

function validateRoomInvite(body: unknown): CloudRoomInvite {
  const input = expectObject(body, "Room invite response body");
  return {
    roomId: expectString(input, "roomId"),
    inviteSecret: expectString(input, "inviteSecret"),
    role: expectOneOf(input, "role", ["admin", "editor", "commenter", "viewer"]),
    expiresAt: optionalString(input, "expiresAt"),
    maxUses: optionalNumber(input, "maxUses"),
    audience: optionalString(input, "audience"),
  };
}

function validatePasswordUpdate(body: unknown): CloudRoomPasswordUpdate {
  const input = expectObject(body, "Room password response body");
  return {
    roomId: expectString(input, "roomId"),
    hasPassword: expectBoolean(input, "hasPassword"),
    action: expectOneOf(input, "action", ["set", "rotated", "cleared"]),
  };
}

function validateMemberRemoval(body: unknown): CloudRoomMemberRemoval {
  const input = expectObject(body, "Room member removal response body");
  const revoked = input.revoked;
  if (revoked !== true) {
    throw new ResponseValidationError('Response field "revoked" must be true.');
  }
  return {
    roomId: expectString(input, "roomId"),
    userId: expectString(input, "userId"),
    revoked,
  };
}

function validateMarkdownSnapshot(body: unknown): CloudMarkdownSnapshot {
  const input = expectObject(body, "Markdown snapshot response body");
  return {
    roomId: expectString(input, "roomId"),
    versionId: expectString(input, "versionId"),
    markdown: expectString(input, "markdown"),
  };
}

function validateAiSession(body: unknown): CloudAiSession {
  const input = expectObject(body, "AI session response body");
  const participantKind = input.participantKind;
  if (participantKind !== "ai-agent") {
    throw new ResponseValidationError('Response field "participantKind" must be ai-agent.');
  }
  return {
    participantKind,
    agentId: expectString(input, "agentId"),
    displayName: expectString(input, "displayName"),
    authorizedByUserId: expectString(input, "authorizedByUserId"),
    roomId: expectString(input, "roomId"),
  };
}

function validatePersistenceBoundary(body: unknown): CloudRoomTicket["persistence"] {
  const input = expectObject(body, "Persistence response body");
  return {
    yjsCheckpoint: validateEncryptedBlobRef(input.yjsCheckpoint, "yjsCheckpoint", "yjs-checkpoint"),
    yjsUpdateArchive: validateEncryptedBlobRef(input.yjsUpdateArchive, "yjsUpdateArchive", "yjs-update-archive"),
    markdownSnapshot: validateEncryptedBlobRef(input.markdownSnapshot, "markdownSnapshot", "markdown-snapshot"),
  };
}

function validateEncryptedBlobRef(
  body: unknown,
  key: string,
  purpose: CloudRoomTicket["persistence"]["yjsCheckpoint"]["purpose"],
): CloudRoomTicket["persistence"]["yjsCheckpoint"] {
  const input = expectObject(body, `Encrypted blob response body "${key}"`);
  const plaintextAvailable = input.plaintextAvailable;
  if (plaintextAvailable !== false) {
    throw new ResponseValidationError(`Response field "${key}.plaintextAvailable" must be false.`);
  }
  return {
    purpose: expectOneOf(input, "purpose", [purpose]),
    ref: expectString(input, "ref"),
    encryption: expectOneOf(input, "encryption", ["application-level-at-rest"]),
    keyScope: expectOneOf(input, "keyScope", ["room"]),
    byteLength: expectNumber(input, "byteLength"),
    plaintextAvailable,
  };
}

function expectObject(body: unknown, label: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ResponseValidationError(`${label} must be an object.`);
  }
  return body as Record<string, unknown>;
}

function expectString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ResponseValidationError(`Response field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ResponseValidationError(`Response field "${key}" must be a string.`);
  }
  return value;
}

function expectBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "boolean") {
    throw new ResponseValidationError(`Response field "${key}" must be a boolean.`);
  }
  return value;
}

function expectNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResponseValidationError(`Response field "${key}" must be a finite number.`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResponseValidationError(`Response field "${key}" must be a finite number.`);
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
  throw new ResponseValidationError(`Response field "${key}" must be one of: ${values.join(", ")}.`);
}

function expectFunction<TFunction extends (...args: never[]) => unknown>(
  input: Record<string, unknown>,
  key: string,
): TFunction {
  const value = input[key];
  if (typeof value !== "function") {
    throw new ResponseValidationError(`Response field "${key}" must be a function.`);
  }
  return value as TFunction;
}

function routeSegment(value: string) {
  return encodeURIComponent(value);
}
