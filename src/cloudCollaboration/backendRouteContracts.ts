import type {
  CloudAiSession,
  CloudAccountAuth,
  CloudAccessContext,
  CloudMarkdownSnapshot,
  CloudRoomCreateRequest,
  CloudRoomInvite,
  CloudRoomMemberRemoval,
  CloudRoomMetadata,
  CloudRoomPasswordUpdate,
  CloudRoomInviteRole,
  CloudRoomJoinRequest,
  CloudRoomTicket,
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

export type CloudBackendCreateRoomBody = Omit<CloudRoomCreateRequest, "auth">;
export type CloudBackendJoinRoomBody = Partial<Omit<CloudRoomJoinRequest, "roomId">> & {
  inviteSecret?: string;
  guestId?: string;
};
export type CloudBackendClaimRoomBody = { ownerSecret: string };
export type CloudBackendCreateInviteBody = {
  role: CloudRoomInviteRole;
  ownerSecret?: string;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};
export type CloudBackendUpdatePasswordBody = {
  password?: string | null;
  ownerSecret?: string;
};
export type CloudBackendGetSnapshotBody = {
  access?: CloudAccessContext;
  password?: string;
  ownerSecret?: string;
  guestId?: string;
};
export type CloudBackendAiSessionBody = {
  agentId: string;
  displayName: string;
};

export type CloudBackendRouteSuccessBodies = {
  "create-room": CloudRoomTicket;
  "join-room": CloudRoomTicket;
  "claim-room": CloudRoomMetadata;
  "create-room-invite": CloudRoomInvite;
  "update-room-password": CloudRoomPasswordUpdate;
  "remove-room-member": CloudRoomMemberRemoval;
  "get-markdown-snapshot": CloudMarkdownSnapshot;
  "create-ai-session": CloudAiSession;
  "get-room": CloudRoomMetadata;
};

export type CloudBackendRouteResponseValidator<TBody> = (body: unknown) => TBody;

export type CloudBackendRouteResponseValidators = {
  [TRouteId in CloudBackendRouteId]: CloudBackendRouteResponseValidator<CloudBackendRouteSuccessBodies[TRouteId]>;
};

export class CloudBackendRouteResponseValidationError extends Error {}

export class CloudBackendRouteRequestValidationError extends Error {}

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

export const cloudBackendRouteResponseValidators: CloudBackendRouteResponseValidators = {
  "create-room": validateRoomTicket,
  "join-room": validateRoomTicket,
  "claim-room": validateRoomMetadata,
  "create-room-invite": validateRoomInvite,
  "update-room-password": validatePasswordUpdate,
  "remove-room-member": validateMemberRemoval,
  "get-markdown-snapshot": validateMarkdownSnapshot,
  "create-ai-session": validateAiSession,
  "get-room": validateRoomMetadata,
};

export function parseCreateRoomBody(body: unknown): CloudBackendCreateRoomBody {
  const input = expectRequestBody(body);
  return {
    mode: expectRequestOneOf(input, "mode", ["anonymous", "account"]),
    source: expectRequestOneOf(input, "source", ["local-file"]),
    title: expectRequiredRequestString(input, "title"),
    seedMarkdown: expectRequiredRequestString(input, "seedMarkdown"),
    password: optionalRequestString(input, "password"),
  };
}

export function parseJoinRoomBody(body: unknown): CloudBackendJoinRoomBody {
  const input = expectRequestBody(body);
  return {
    access: optionalRequestAccessContext(input, "access"),
    inviteSecret: optionalRequestString(input, "inviteSecret"),
    guestId: optionalRequestString(input, "guestId"),
    password: optionalRequestString(input, "password"),
  };
}

export function parseClaimRoomBody(body: unknown): CloudBackendClaimRoomBody {
  const input = expectRequestBody(body);
  return {
    ownerSecret: expectRequiredRequestString(input, "ownerSecret"),
  };
}

export function parseCreateInviteBody(body: unknown): CloudBackendCreateInviteBody {
  const input = expectRequestBody(body);
  return {
    role: expectRequestOneOf(input, "role", ["admin", "editor", "commenter", "viewer"]),
    ownerSecret: optionalRequestString(input, "ownerSecret"),
    expiresAt: optionalRequestString(input, "expiresAt"),
    maxUses: optionalRequestNumber(input, "maxUses"),
    audience: optionalRequestString(input, "audience"),
  };
}

export function parseUpdatePasswordBody(body: unknown): CloudBackendUpdatePasswordBody {
  const input = expectRequestBody(body);
  return {
    password: optionalNullableRequestString(input, "password"),
    ownerSecret: optionalRequestString(input, "ownerSecret"),
  };
}

export function parseGetSnapshotBody(body: unknown): Partial<CloudBackendGetSnapshotBody> {
  const input = optionalRequestBody(body);
  return {
    access: optionalRequestAccessContext(input, "access"),
    password: optionalRequestString(input, "password"),
    ownerSecret: optionalRequestString(input, "ownerSecret"),
    guestId: optionalRequestString(input, "guestId"),
  };
}

export function parseAiSessionBody(body: unknown): CloudBackendAiSessionBody {
  const input = expectRequestBody(body);
  return {
    agentId: expectRequiredRequestString(input, "agentId"),
    displayName: expectRequiredRequestString(input, "displayName"),
  };
}

function expectRequestBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudBackendRouteRequestValidationError("Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function optionalRequestBody(body: unknown): Record<string, unknown> {
  if (body === undefined) {
    return {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudBackendRouteRequestValidationError("Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function expectRequiredRequestString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalRequestString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be a string.`);
  }
  return value;
}

function optionalNullableRequestString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string") {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be a string or null.`);
  }
  return value;
}

function optionalRequestNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be a finite number.`);
  }
  return value;
}

function expectRequestOneOf<const TValues extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  values: TValues,
): TValues[number] {
  const value = input[key];
  if (typeof value === "string" && values.includes(value)) {
    return value;
  }
  throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be one of: ${values.join(", ")}.`);
}

function optionalRequestAccessContext(input: Record<string, unknown>, key: string): CloudAccessContext | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be an access object.`);
  }
  const access = value as Record<string, unknown>;
  const kind = access.kind;
  if (kind === "account") {
    return {
      kind,
      userId: expectRequiredRequestString(access, "userId"),
      tenantId: expectRequiredRequestString(access, "tenantId"),
    };
  }
  if (kind === "anonymous") {
    return {
      kind,
      guestId: expectRequiredRequestString(access, "guestId"),
      ownerSecret: optionalRequestString(access, "ownerSecret"),
    };
  }
  if (kind === "invite") {
    return {
      kind,
      inviteSecret: expectRequiredRequestString(access, "inviteSecret"),
      auth: optionalRequestAccountAuth(access, "auth"),
      guestId: optionalRequestString(access, "guestId"),
    };
  }
  throw new CloudBackendRouteRequestValidationError(
    `Request field "${key}.kind" must be one of: account, anonymous, invite.`,
  );
}

function optionalRequestAccountAuth(input: Record<string, unknown>, key: string): CloudAccountAuth | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}" must be an account auth object.`);
  }
  const auth = value as Record<string, unknown>;
  if (auth.kind !== "account") {
    throw new CloudBackendRouteRequestValidationError(`Request field "${key}.kind" must be account.`);
  }
  return {
    kind: "account",
    userId: expectRequiredRequestString(auth, "userId"),
    tenantId: expectRequiredRequestString(auth, "tenantId"),
  };
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
    throw new CloudBackendRouteResponseValidationError('Response field "revoked" must be true.');
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
    throw new CloudBackendRouteResponseValidationError('Response field "participantKind" must be ai-agent.');
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
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}.plaintextAvailable" must be false.`);
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
    throw new CloudBackendRouteResponseValidationError(`${label} must be an object.`);
  }
  return body as Record<string, unknown>;
}

function expectString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a string.`);
  }
  return value;
}

function expectBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "boolean") {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a boolean.`);
  }
  return value;
}

function expectNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a finite number.`);
  }
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a finite number.`);
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
  throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be one of: ${values.join(", ")}.`);
}

function expectFunction<TFunction extends (...args: never[]) => unknown>(
  input: Record<string, unknown>,
  key: string,
): TFunction {
  const value = input[key];
  if (typeof value !== "function") {
    throw new CloudBackendRouteResponseValidationError(`Response field "${key}" must be a function.`);
  }
  return value as TFunction;
}
