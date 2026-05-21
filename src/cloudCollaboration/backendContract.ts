import * as Y from "yjs";
import { parseComments } from "../comments/storage";
import type { CommentMappingSummary } from "./session";

export type CloudRoomMode = "anonymous" | "account";
export type CloudRoomSource = "local-file";
export type CloudRoomRole = "owner" | "admin" | "editor" | "commenter" | "viewer" | "guest-owner";
export type CloudRoomInviteRole = "admin" | "editor" | "commenter" | "viewer";

export type CloudAccountAuth = {
  kind: "account";
  userId: string;
  tenantId: string;
};

export type CloudAnonymousAccess = {
  kind: "anonymous";
  guestId: string;
  ownerSecret?: string;
};

export type CloudInviteAccess = {
  kind: "invite";
  inviteSecret: string;
  auth?: CloudAccountAuth;
  guestId?: string;
};

export type CloudAccessContext = CloudAccountAuth | CloudAnonymousAccess | CloudInviteAccess;

export type CloudRoomManagementAccess =
  | { kind: "account"; auth: CloudAccountAuth }
  | { kind: "anonymous-owner"; ownerSecret: string; guestId?: string };

export type CloudRoomCreateRequest = {
  mode: CloudRoomMode;
  source: CloudRoomSource;
  seedMarkdown: string;
  title: string;
  auth?: CloudAccountAuth;
  password?: string;
};

export type CloudRoomJoinRequest = {
  roomId: string;
  access: CloudAccessContext;
  password?: string;
};

export type CloudRoomClaimRequest = {
  roomId: string;
  auth: CloudAccountAuth;
  ownerSecret: string;
};

export type CloudAiSessionRequest = {
  roomId: string;
  auth?: CloudAccountAuth;
  agentId: string;
  displayName: string;
};

export type CloudRoomInviteCreateRequest = {
  roomId: string;
  access: CloudRoomManagementAccess;
  role: CloudRoomInviteRole;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};

export type CloudRoomInvite = {
  roomId: string;
  inviteSecret: string;
  role: CloudRoomInviteRole;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};

export type CloudRoomPasswordUpdateRequest = {
  roomId: string;
  access: CloudRoomManagementAccess;
  password?: string | null;
};

export type CloudRoomPasswordUpdate = {
  roomId: string;
  hasPassword: boolean;
  action: "set" | "rotated" | "cleared";
};

export type CloudRoomMemberRemoveRequest = {
  roomId: string;
  access: Extract<CloudRoomManagementAccess, { kind: "account" }>;
  userId: string;
};

export type CloudRoomMemberRemoval = {
  roomId: string;
  userId: string;
  revoked: true;
};

export type CloudMarkdownSnapshotRequest = {
  roomId: string;
  versionId: string;
  access: CloudAccessContext;
  password?: string;
};

export type CloudMarkdownSnapshot = {
  roomId: string;
  versionId: string;
  markdown: string;
};

export type EncryptedBlobPurpose = "yjs-checkpoint" | "yjs-update-archive" | "markdown-snapshot";

export type EncryptedBlobRef = {
  purpose: EncryptedBlobPurpose;
  ref: string;
  encryption: "application-level-at-rest";
  keyScope: "room";
  byteLength: number;
  plaintextAvailable: false;
};

export type CloudPersistenceBoundary = {
  yjsCheckpoint: EncryptedBlobRef;
  yjsUpdateArchive: EncryptedBlobRef;
  markdownSnapshot: EncryptedBlobRef;
};

export type CloudRoomTicket = {
  roomId: string;
  websocketUrl: string;
  roomToken: string;
  role: CloudRoomRole;
  ownerSecret?: string;
  expiresAt?: string;
  persistence: CloudPersistenceBoundary;
  materializeMarkdown: () => string;
  getCommentMappingSummary: () => CommentMappingSummary;
};

export type CloudRoomMetadata = {
  roomId: string;
  title: string;
  mode: CloudRoomMode;
  source: CloudRoomSource;
  ownerUserId?: string;
  hasPassword: boolean;
  claimedAt?: string;
  expiresAt?: string;
};

export type CloudAiSession = {
  participantKind: "ai-agent";
  agentId: string;
  displayName: string;
  authorizedByUserId: string;
  roomId: string;
};

export type CloudRoomBackendContract = {
  createRoom: (request: CloudRoomCreateRequest) => CloudRoomTicket;
  joinRoom: (request: CloudRoomJoinRequest) => CloudRoomTicket;
  claimAnonymousRoom: (request: CloudRoomClaimRequest) => CloudRoomMetadata;
  createInvite: (request: CloudRoomInviteCreateRequest) => CloudRoomInvite;
  updateRoomPassword: (request: CloudRoomPasswordUpdateRequest) => CloudRoomPasswordUpdate;
  removeRoomMember: (request: CloudRoomMemberRemoveRequest) => CloudRoomMemberRemoval;
  getMarkdownSnapshot: (request: CloudMarkdownSnapshotRequest) => CloudMarkdownSnapshot;
  requestAiSession: (request: CloudAiSessionRequest) => CloudAiSession;
  getRoomMetadata: (roomId: string) => CloudRoomMetadata;
};

type StoredCloudInvite = {
  inviteSecretHash: string;
  role: CloudRoomInviteRole;
  expiresAt?: string;
  maxUses?: number;
  usedCount: number;
  audience?: string;
};

type StoredCloudRoom = {
  roomId: string;
  title: string;
  mode: CloudRoomMode;
  source: CloudRoomSource;
  ydoc: Y.Doc;
  ytext: Y.Text;
  ownerUserId?: string;
  tenantId?: string;
  ownerSecretHash?: string;
  passwordHash?: string;
  expiresAt?: string;
  claimedAt?: string;
  persistence: CloudPersistenceBoundary;
  memberships: Map<string, CloudRoomRole>;
  invites: StoredCloudInvite[];
};

const ANONYMOUS_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export function createInMemoryCloudRoomBackend(): CloudRoomBackendContract {
  const rooms = new Map<string, StoredCloudRoom>();
  let sequence = 0;

  return {
    createRoom(request) {
      if (request.mode === "account" && !request.auth) {
        throw new Error("Account room creation requires signed-in auth.");
      }

      sequence += 1;
      const roomId = `room_${sequence.toString().padStart(4, "0")}`;
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText("markdown");
      ytext.insert(0, normalizeMarkdown(request.seedMarkdown));

      const ownerSecret = request.mode === "anonymous" ? `owner_${roomId}_${stableHash(`${roomId}:owner`)}` : undefined;
      const expiresAt = request.mode === "anonymous" ? new Date(Date.now() + ANONYMOUS_ROOM_TTL_MS).toISOString() : undefined;
      const room: StoredCloudRoom = {
        roomId,
        title: request.title,
        mode: request.mode,
        source: request.source,
        ydoc,
        ytext,
        ownerUserId: request.auth?.userId,
        tenantId: request.auth?.tenantId,
        ownerSecretHash: ownerSecret ? hashSecret(ownerSecret) : undefined,
        passwordHash: request.password ? hashSecret(request.password) : undefined,
        expiresAt,
        persistence: createPersistenceBoundary(roomId, ytext.toString()),
        memberships: new Map(),
        invites: [],
      };
      if (request.auth) {
        room.memberships.set(request.auth.userId, "owner");
      }
      rooms.set(roomId, room);

      return createTicket(room, request.mode === "anonymous" ? "guest-owner" : "owner", ownerSecret);
    },

    joinRoom({ roomId, access, password }) {
      const room = getRoom(rooms, roomId);
      validatePassword(room, password);
      return createTicket(room, redeemAccess(room, access));
    },

    claimAnonymousRoom({ roomId, auth, ownerSecret }) {
      const room = getRoom(rooms, roomId);
      if (room.mode !== "anonymous") {
        throw new Error("Only anonymous rooms can be claimed.");
      }
      if (!room.ownerSecretHash || !constantTimeMatch(room.ownerSecretHash, hashSecret(ownerSecret))) {
        throw new Error("A valid anonymous owner secret is required to claim this room.");
      }

      room.mode = "account";
      room.ownerUserId = auth.userId;
      room.tenantId = auth.tenantId;
      room.ownerSecretHash = undefined;
      room.expiresAt = undefined;
      room.claimedAt = new Date().toISOString();
      room.memberships.set(auth.userId, "owner");
      return metadataFor(room);
    },

    createInvite({ roomId, access, role, expiresAt, maxUses, audience }) {
      const room = getRoom(rooms, roomId);
      assertCanManageRoom(room, access, "invites");
      sequence += 1;
      const inviteSecret = `invite_${roomId}_${sequence.toString().padStart(4, "0")}_${stableHash(`${roomId}:${sequence}:invite`)}`;
      room.invites.push({
        inviteSecretHash: hashSecret(inviteSecret),
        role,
        expiresAt,
        maxUses,
        usedCount: 0,
        audience,
      });
      return {
        roomId,
        inviteSecret,
        role,
        expiresAt,
        maxUses,
        audience,
      };
    },

    updateRoomPassword({ roomId, access, password }) {
      const room = getRoom(rooms, roomId);
      assertCanManageRoom(room, access, "password");
      const hadPassword = Boolean(room.passwordHash);
      if (password === null || password === undefined || password === "") {
        room.passwordHash = undefined;
        return {
          roomId,
          hasPassword: false,
          action: "cleared",
        };
      }
      room.passwordHash = hashSecret(password);
      return {
        roomId,
        hasPassword: true,
        action: hadPassword ? "rotated" : "set",
      };
    },

    removeRoomMember({ roomId, access, userId }) {
      const room = getRoom(rooms, roomId);
      assertCanManageRoom(room, access, "members");
      const targetRole = room.memberships.get(userId);
      if (!targetRole) {
        throw new Error("Room member does not exist or is already revoked.");
      }
      if (targetRole === "owner" && access.auth.userId !== userId) {
        throw new Error("Admins cannot remove the room owner.");
      }
      if (targetRole === "owner" && access.auth.userId === userId) {
        throw new Error("Room owner cannot remove themselves.");
      }
      room.memberships.delete(userId);
      return {
        roomId,
        userId,
        revoked: true,
      };
    },

    getMarkdownSnapshot({ roomId, versionId, access, password }) {
      const room = getRoom(rooms, roomId);
      validatePassword(room, password);
      roleForAccess(room, access);
      if (versionId !== "latest") {
        throw new Error(`Markdown snapshot version does not exist: ${versionId}`);
      }
      return {
        roomId,
        versionId,
        markdown: room.ytext.toString(),
      };
    },

    requestAiSession({ roomId, auth, agentId, displayName }) {
      const room = getRoom(rooms, roomId);
      if (!auth) {
        throw new Error("AI usage requires a signed-in account.");
      }
      const role = room.memberships.get(auth.userId);
      if (!role) {
        throw new Error("AI usage requires room membership.");
      }
      return {
        participantKind: "ai-agent",
        agentId,
        displayName,
        authorizedByUserId: auth.userId,
        roomId: room.roomId,
      };
    },

    getRoomMetadata(roomId) {
      return metadataFor(getRoom(rooms, roomId));
    },
  };
}

function createTicket(room: StoredCloudRoom, role: CloudRoomRole, ownerSecret?: string): CloudRoomTicket {
  return {
    roomId: room.roomId,
    websocketUrl: `wss://cloud.local/rooms/${room.roomId}/realtime`,
    roomToken: `room_token_${room.roomId}_${role}_${stableHash(`${room.roomId}:${role}`)}`,
    role,
    ownerSecret,
    expiresAt: room.expiresAt,
    persistence: room.persistence,
    materializeMarkdown: () => room.ytext.toString(),
    getCommentMappingSummary: () => summarizeCommentMapping(room.ytext.toString()),
  };
}

function metadataFor(room: StoredCloudRoom): CloudRoomMetadata {
  return {
    roomId: room.roomId,
    title: room.title,
    mode: room.mode,
    source: room.source,
    ownerUserId: room.ownerUserId,
    hasPassword: Boolean(room.passwordHash),
    claimedAt: room.claimedAt,
    expiresAt: room.expiresAt,
  };
}

function roleForAccess(room: StoredCloudRoom, access: CloudAccessContext): CloudRoomRole {
  if (access.kind === "account") {
    return room.memberships.get(access.userId) ?? "viewer";
  }
  if (access.kind === "invite") {
    return redeemInvite(room, access);
  }
  if (room.ownerSecretHash && access.ownerSecret && constantTimeMatch(room.ownerSecretHash, hashSecret(access.ownerSecret))) {
    return "guest-owner";
  }
  return "viewer";
}

function redeemAccess(room: StoredCloudRoom, access: CloudAccessContext): CloudRoomRole {
  return roleForAccess(room, access);
}

function redeemInvite(room: StoredCloudRoom, access: CloudInviteAccess): CloudRoomRole {
  const invite = room.invites.find((candidate) =>
    constantTimeMatch(candidate.inviteSecretHash, hashSecret(access.inviteSecret)),
  );
  if (!invite) {
    throw new Error("A valid room invite is required to join this room.");
  }
  if (invite.expiresAt && Date.parse(invite.expiresAt) <= Date.now()) {
    throw new Error("Room invite has expired.");
  }
  if (invite.maxUses !== undefined && invite.usedCount >= invite.maxUses) {
    throw new Error("Room invite has no remaining uses.");
  }
  if (access.auth) {
    invite.usedCount += 1;
    room.memberships.set(access.auth.userId, invite.role);
    return invite.role;
  }
  if (!access.guestId) {
    throw new Error("Joining with an invite requires account auth or anonymous guest id.");
  }
  if (invite.role === "admin" || invite.role === "editor") {
    throw new Error("Admin and editor invite access requires signed-in account auth.");
  }
  invite.usedCount += 1;
  return invite.role;
}

function assertCanManageRoom(
  room: StoredCloudRoom,
  access: CloudRoomManagementAccess,
  subject: "invites" | "password" | "members",
) {
  if (access.kind === "anonymous-owner") {
    if (
      room.mode === "anonymous" &&
      room.ownerSecretHash &&
      constantTimeMatch(room.ownerSecretHash, hashSecret(access.ownerSecret))
    ) {
      return;
    }
    throw new Error(`Managing room ${subject} requires a valid anonymous owner secret.`);
  }

  const role = room.memberships.get(access.auth.userId);
  if (role === "owner" || role === "admin") {
    return;
  }
  if (!role) {
    throw new Error(`Managing room ${subject} requires room membership.`);
  }
  throw new Error(`Role ${role} cannot manage room ${subject}; owner or admin is required.`);
}

function validatePassword(room: StoredCloudRoom, password?: string) {
  if (!room.passwordHash) {
    return;
  }
  if (!password || !constantTimeMatch(room.passwordHash, hashSecret(password))) {
    throw new Error("This room requires a valid password.");
  }
}

function getRoom(rooms: Map<string, StoredCloudRoom>, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error(`Cloud room does not exist: ${roomId}`);
  }
  return room;
}

function createPersistenceBoundary(roomId: string, markdown: string): CloudPersistenceBoundary {
  const checkpointBytes = Y.encodeStateAsUpdate(createYDocFromMarkdown(markdown)).length;
  const markdownBytes = utf8ByteLength(markdown);
  return {
    yjsCheckpoint: encryptedBlob(roomId, "yjs-checkpoint", checkpointBytes, `${roomId}:checkpoint:${markdown}`),
    yjsUpdateArchive: encryptedBlob(roomId, "yjs-update-archive", checkpointBytes, `${roomId}:updates:${markdown}`),
    markdownSnapshot: encryptedBlob(roomId, "markdown-snapshot", markdownBytes, `${roomId}:snapshot:${markdown}`),
  };
}

function createYDocFromMarkdown(markdown: string) {
  const ydoc = new Y.Doc();
  ydoc.getText("markdown").insert(0, markdown);
  return ydoc;
}

function encryptedBlob(roomId: string, purpose: EncryptedBlobPurpose, byteLength: number, material: string): EncryptedBlobRef {
  return {
    purpose,
    ref: `encrypted://${roomId}/${purpose}/${stableHash(material)}`,
    encryption: "application-level-at-rest",
    keyScope: "room",
    byteLength,
    plaintextAvailable: false,
  };
}

function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/gu, "\n");
}

function summarizeCommentMapping(markdown: string): CommentMappingSummary {
  const parsed = parseComments(markdown);
  return {
    anchors: parsed.anchors.length,
    threads: Object.keys(parsed.threads).length,
    orphaned: parsed.orphanedIds.size,
  };
}

function hashSecret(secret: string) {
  return `hash:${stableHash(secret)}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function constantTimeMatch(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}
