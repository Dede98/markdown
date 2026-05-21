import type {
  CloudAccessContext,
  CloudAccountAuth,
  CloudAiSession,
  CloudPersistenceBoundary,
  CloudRoomInvite,
  CloudRoomBackendContract,
  CloudRoomCreateRequest,
  CloudRoomMemberRemoval,
  CloudRoomMetadata,
  CloudRoomPasswordUpdate,
  CloudRoomRole,
  CloudRoomTicket,
  EncryptedBlobPurpose,
  EncryptedBlobRef,
} from "./backendContract";
import {
  createInMemoryCloudRealtimeBackend,
  type CloudRealtimeBackend,
  type DocumentMarkdownSnapshotRow,
  type DocumentRow,
  type DocumentYjsCheckpointRow,
  type DocumentYjsUpdateArchiveRow,
} from "./backendHooks";
import {
  createCloudRealtimeServerMount,
  type CloudRealtimeServerMount,
} from "./backendRealtimeServer";
import { parseComments } from "../comments/storage";

export type CloudTokenBridgeCreateRequest = {
  mode: "anonymous" | "account";
  title: string;
  seedMarkdown: string;
  /** Required for account mode. Used as tenantId source for anonymous mode when no tenantId is supplied. */
  auth?: CloudAccountAuth;
  /** Explicit tenant for anonymous rooms when no auth is provided. */
  tenantId?: string;
  password?: string;
};

export type CloudTokenBridgeJoinRequest = {
  roomId: string;
  /** Account user joining. Adds membership on first join. */
  auth?: CloudAccountAuth;
  /** Anonymous guest joining. Used with or without ownerSecret. */
  guestId?: string;
  /** Anonymous owner capability — elevates guest to guest-owner role. */
  ownerSecret?: string;
  /** Role granted to the account user. Defaults to "editor". */
  role?: "admin" | "editor" | "commenter" | "viewer";
};

export type CloudTokenBridgeTicket = {
  roomId: string;
  roomToken: string;
  role: CloudRoomRole;
  /** Present only for anonymous room creators. */
  ownerSecret?: string;
};

export type CloudTokenBridgeRouteId = "create-room" | "join-room";

export type CloudTokenBridgeErrorCode =
  | "auth_required"
  | "access_required";

export class CloudTokenBridgeError extends Error {
  readonly name = "CloudTokenBridgeError";

  constructor(
    public readonly route: CloudTokenBridgeRouteId,
    public readonly code: CloudTokenBridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type CloudTokenBridge = {
  realtimeBackend: CloudRealtimeBackend;
  serverMount: CloudRealtimeServerMount;
  /** Creates a room via the shared repository and returns a roomToken the realtime mount can authenticate. */
  createRoom(request: CloudTokenBridgeCreateRequest): CloudTokenBridgeTicket;
  /** Adds membership (for account users) and issues a roomToken the realtime mount can authenticate. */
  joinRoom(request: CloudTokenBridgeJoinRequest): CloudTokenBridgeTicket;
};

export function createCloudTokenBridge(
  realtimeBackend: CloudRealtimeBackend = createInMemoryCloudRealtimeBackend(),
): CloudTokenBridge {
  const serverMount = createCloudRealtimeServerMount({ hooks: realtimeBackend.hooks });
  const { repository } = realtimeBackend;

  return {
    realtimeBackend,
    serverMount,

    createRoom({ mode, title, seedMarkdown, auth, tenantId, password }) {
      if (mode === "account") {
        if (!auth) {
          throw new CloudTokenBridgeError(
            "create-room",
            "auth_required",
            "Account room creation requires auth.",
          );
        }
        const { document, roomToken } = repository.createAccountRoom({
          auth,
          title,
          seedMarkdown,
          password,
        });
        return { roomId: document.id, roomToken, role: "owner" };
      }

      const resolvedTenantId = auth?.tenantId ?? tenantId ?? "tenant_default";
      const { document, roomToken, ownerSecret } = repository.createAnonymousRoom({
        tenantId: resolvedTenantId,
        title,
        seedMarkdown,
        password,
      });
      return { roomId: document.id, roomToken, ownerSecret, role: "guest-owner" };
    },

    joinRoom({ roomId, auth, guestId, ownerSecret, role = "editor" }) {
      if (auth) {
        repository.addMembership({
          documentId: roomId,
          tenantId: auth.tenantId,
          userId: auth.userId,
          role,
        });
        const roomToken = repository.issueRoomToken({
          documentId: roomId,
          access: { kind: "account", userId: auth.userId },
        });
        return { roomId, roomToken, role };
      }

      if (guestId) {
        const roomToken = repository.issueRoomToken({
          documentId: roomId,
          access: { kind: "anonymous", guestId, ownerSecret },
        });
        return {
          roomId,
          roomToken,
          role: ownerSecret ? "guest-owner" : "viewer",
        };
      }

      throw new CloudTokenBridgeError(
        "join-room",
        "access_required",
        "joinRoom requires auth or guestId.",
      );
    },
  };
}

/**
 * Adapts the HTTP-shaped backend service contract onto the realtime hook
 * repository so route-issued room tokens are the same tokens accepted by the
 * Hocuspocus mount.
 */
export function createCloudRouteRealtimeBridge(realtime: CloudRealtimeBackend): CloudRoomBackendContract {
  return {
    createRoom(request) {
      const created =
        request.mode === "account"
          ? createAccountRoom(realtime, request)
          : realtime.repository.createAnonymousRoom({
              tenantId: request.auth?.tenantId ?? "tenant_anonymous",
              title: request.title,
              seedMarkdown: request.seedMarkdown,
              password: request.password,
            });
      const context = realtime.hooks.onAuthenticate({
        roomToken: created.roomToken,
        password: request.password,
      });
      return ticketFor(realtime, created.document, created.roomToken, context.role, created.ownerSecret);
    },

    joinRoom({ roomId, access, password }) {
      const document = getDocument(realtime, roomId);
      const redeemedInvite =
        access.kind === "invite"
          ? realtime.repository.redeemInvite({
              documentId: document.id,
              inviteSecret: access.inviteSecret,
              auth: access.auth,
              guestId: access.guestId,
            })
          : undefined;
      const tokenAccess = redeemedInvite?.tokenAccess ?? realtimeAccess(access);
      const roomToken = realtime.repository.issueRoomToken({
        documentId: document.id,
        access: tokenAccess,
      });
      const context = realtime.hooks.onAuthenticate({ roomToken, password });
      return ticketFor(realtime, document, roomToken, context.role);
    },

    claimAnonymousRoom({ roomId, auth, ownerSecret }) {
      return metadataFor(
        realtime.repository.claimAnonymousRoom({
          documentId: roomId,
          auth,
          ownerSecret,
        }),
        realtime,
      );
    },

    createInvite({ roomId, access, role, expiresAt, maxUses, audience }) {
      return realtime.repository.createInvite({
        documentId: roomId,
        access,
        role,
        expiresAt,
        maxUses,
        audience,
      }) satisfies CloudRoomInvite;
    },

    updateRoomPassword({ roomId, access, password }) {
      return realtime.repository.updateRoomPassword({
        documentId: roomId,
        access,
        password,
      }) satisfies CloudRoomPasswordUpdate;
    },

    removeRoomMember({ roomId, access, userId }) {
      return realtime.repository.removeMember({
        documentId: roomId,
        access,
        userId,
      }) satisfies CloudRoomMemberRemoval;
    },

    requestAiSession({ roomId, auth, agentId, displayName }) {
      if (!auth) {
        throw new Error("AI usage requires a signed-in account.");
      }
      const roomToken = realtime.repository.issueRoomToken({
        documentId: roomId,
        access: { kind: "account", userId: auth.userId },
      });
      const aiSession = realtime.hooks.authorizeAiSession({
        roomToken,
        agentId,
        displayName,
      });
      return {
        participantKind: "ai-agent",
        agentId: aiSession.agentId,
        displayName: aiSession.displayName,
        authorizedByUserId: aiSession.authorizedByUserId,
        roomId: aiSession.roomId,
      } satisfies CloudAiSession;
    },

    getRoomMetadata(roomId) {
      return metadataFor(getDocument(realtime, roomId), realtime);
    },
  };
}

function createAccountRoom(realtime: CloudRealtimeBackend, request: CloudRoomCreateRequest) {
  if (!request.auth) {
    throw new Error("Account room creation requires signed-in auth.");
  }
  return realtime.repository.createAccountRoom({
    auth: request.auth,
    title: request.title,
    seedMarkdown: request.seedMarkdown,
    password: request.password,
  });
}

function realtimeAccess(access: CloudAccessContext) {
  if (access.kind === "account") {
    return {
      kind: "account" as const,
      userId: access.userId,
    };
  }
  if (access.kind === "invite") {
    throw new Error("Invite access must be redeemed before issuing realtime room tokens.");
  }
  return {
    kind: "anonymous" as const,
    guestId: access.guestId,
    ownerSecret: access.ownerSecret,
  };
}

function ticketFor(
  realtime: CloudRealtimeBackend,
  document: DocumentRow,
  roomToken: string,
  role: CloudRoomRole,
  ownerSecret?: string,
): CloudRoomTicket {
  return {
    roomId: document.id,
    websocketUrl: `wss://cloud.local/rooms/${document.id}/realtime`,
    roomToken,
    role,
    ownerSecret,
    expiresAt: document.expires_at ?? undefined,
    persistence: persistenceFor(realtime, document),
    materializeMarkdown: () => realtime.hooks.load(document.id).getText("markdown").toString(),
    getCommentMappingSummary: () => summarizeCommentMapping(realtime.hooks.load(document.id).getText("markdown").toString()),
  };
}

function metadataFor(document: DocumentRow, realtime: CloudRealtimeBackend): CloudRoomMetadata {
  return {
    roomId: document.id,
    title: document.title,
    mode: document.mode,
    source: document.source,
    ownerUserId: document.owner_user_id ?? undefined,
    hasPassword: realtime.repository.document_password_verifiers.some((row) => row.document_id === document.id),
    claimedAt: document.claimed_at ?? undefined,
    expiresAt: document.expires_at ?? undefined,
  };
}

function persistenceFor(realtime: CloudRealtimeBackend, document: DocumentRow): CloudPersistenceBoundary {
  const checkpoint = latestByCreatedAt(
    realtime.repository.document_yjs_checkpoints.filter((row) => row.document_id === document.id),
  );
  const updateArchive = latestByCreatedAt(
    realtime.repository.document_yjs_update_archives.filter((row) => row.document_id === document.id),
  );
  const markdownSnapshot = latestByCreatedAt(
    realtime.repository.document_markdown_snapshots.filter((row) => row.document_id === document.id),
  );
  if (!checkpoint || !markdownSnapshot) {
    throw new Error(`Cloud room persistence refs are incomplete: ${document.id}`);
  }
  return {
    yjsCheckpoint: checkpointRef(checkpoint),
    yjsUpdateArchive: updateArchive ? updateArchiveRef(updateArchive) : emptyUpdateArchiveRef(document),
    markdownSnapshot: markdownSnapshotRef(markdownSnapshot),
  };
}

function checkpointRef(row: DocumentYjsCheckpointRow): EncryptedBlobRef {
  return encryptedRef("yjs-checkpoint", row.blob_ref, row.byte_length);
}

function updateArchiveRef(row: DocumentYjsUpdateArchiveRow): EncryptedBlobRef {
  return encryptedRef("yjs-update-archive", row.blob_ref, row.byte_length);
}

function markdownSnapshotRef(row: DocumentMarkdownSnapshotRow): EncryptedBlobRef {
  return encryptedRef("markdown-snapshot", row.blob_ref, row.byte_length);
}

function emptyUpdateArchiveRef(document: DocumentRow): EncryptedBlobRef {
  return encryptedRef("yjs-update-archive", `encrypted://${document.tenant_id}/${document.id}/yjs-update-archive/empty`, 0);
}

function encryptedRef(purpose: EncryptedBlobPurpose, ref: string, byteLength: number): EncryptedBlobRef {
  return {
    purpose,
    ref,
    encryption: "application-level-at-rest",
    keyScope: "room",
    byteLength,
    plaintextAvailable: false,
  };
}

function getDocument(realtime: CloudRealtimeBackend, roomId: string) {
  const document = realtime.repository.documents.find((row) => row.id === roomId);
  if (!document) {
    throw new Error(`Cloud room does not exist: ${roomId}`);
  }
  return document;
}

function latestByCreatedAt<TRow extends { created_at: string }>(rows: TRow[]) {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
}

function summarizeCommentMapping(markdown: string) {
  const parsed = parseComments(markdown);
  return {
    anchors: parsed.anchors.length,
    threads: Object.keys(parsed.threads).length,
    orphaned: parsed.orphanedIds.size,
  };
}
