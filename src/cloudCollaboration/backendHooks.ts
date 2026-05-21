import * as Y from "yjs";
import {
  cloudBackendSchema,
  getTable,
  type CloudSchemaTable,
} from "./backendSchema";
import type {
  CloudAccountAuth,
  CloudRoomInvite,
  CloudRoomInviteRole,
  CloudRoomManagementAccess,
  CloudRoomPasswordUpdate,
  CloudRoomRole,
} from "./backendContract";

export type CloudRealtimeMaterializationReason = "manual" | "autosnapshot" | "before_ai_edit" | "restore" | "room_close";

export type CloudRealtimeRoomContext = {
  tenantId: string;
  roomId: string;
  documentId: string;
  role: CloudRoomRole;
  canWrite: boolean;
  userId?: string;
  guestId?: string;
};

export type CloudRealtimeAuthenticateRequest = {
  roomToken: string;
  password?: string;
};

export type CloudRealtimeStoreOptions = {
  context?: CloudRealtimeRoomContext;
  compact?: boolean;
  compactAfterUpdates?: number;
  materializeSnapshotReason?: CloudRealtimeMaterializationReason;
  createdByUserId?: string;
  createdByAgentId?: string;
};

export type CloudRealtimeStoreResult = {
  updateArchive: DocumentYjsUpdateArchiveRow;
  checkpoint?: DocumentYjsCheckpointRow;
  markdownSnapshot?: DocumentMarkdownSnapshotRow;
  version?: DocumentVersionRow;
};

export type CloudRealtimeAiSessionRequest = {
  roomToken: string;
  password?: string;
  agentId: string;
  displayName: string;
};

export type CloudRealtimeAiSession = {
  participantKind: "ai-agent";
  agentId: string;
  displayName: string;
  authorizedByUserId: string;
  tenantId: string;
  roomId: string;
  documentId: string;
  role: CloudRoomRole;
};

export type TenantRow = {
  id: string;
  name: string;
  kind: "personal" | "org";
  created_at: string;
};

export type UserRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  email: string | null;
  local_uuid: string | null;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  tenant_id: string;
  title: string;
  source: "local-file";
  mode: "anonymous" | "account";
  owner_user_id: string | null;
  anonymous_owner_capability_hash: string | null;
  expires_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentMembershipRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  user_id: string;
  role: "owner" | "admin" | "editor" | "commenter" | "viewer";
  created_at: string;
  revoked_at: string | null;
};

export type DocumentInviteRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  invite_secret_hash: string;
  role: "admin" | "editor" | "commenter" | "viewer";
  created_by_user_id: string | null;
  audience: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type DocumentPasswordVerifierRow = {
  document_id: string;
  tenant_id: string;
  algorithm: "argon2id";
  params_version: number;
  salt: Uint8Array;
  verifier_hash: Uint8Array;
  rotated_at: string;
};

export type DocumentYjsCheckpointRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  blob_ref: string;
  state_vector: Uint8Array;
  wrapped_key_id: string;
  byte_length: number;
  encryption: "application-level-at-rest";
  created_at: string;
};

export type DocumentYjsUpdateArchiveRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  blob_ref: string;
  range_start: number;
  range_end: number;
  wrapped_key_id: string;
  byte_length: number;
  encryption: "application-level-at-rest";
  created_at: string;
};

export type DocumentMarkdownSnapshotRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  blob_ref: string;
  wrapped_key_id: string;
  byte_length: number;
  encryption: "application-level-at-rest";
  materialization_reason: CloudRealtimeMaterializationReason;
  created_at: string;
};

export type DocumentVersionRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  checkpoint_id: string;
  snapshot_id: string;
  reason: CloudRealtimeMaterializationReason;
  created_by_user_id: string | null;
  created_by_agent_id: string | null;
  label: string | null;
  created_at: string;
};

export type DocumentAuditEventRow = {
  id: string;
  tenant_id: string;
  document_id: string;
  kind:
    | "room_created"
    | "room_joined"
    | "room_left"
    | "room_claimed"
    | "room_password_set"
    | "room_password_rotated"
    | "room_password_cleared"
    | "invite_created"
    | "invite_redeemed"
    | "invite_revoked"
    | "member_added"
    | "member_role_changed"
    | "member_removed"
    | "ai_session_started"
    | "ai_session_ended"
    | "snapshot_materialized"
    | "version_created"
    | "version_restored";
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_guest_id: string | null;
  authorized_by_user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type CloudRealtimeRepositoryTables = {
  tenants: TenantRow[];
  users: UserRow[];
  documents: DocumentRow[];
  document_memberships: DocumentMembershipRow[];
  document_invites: DocumentInviteRow[];
  document_password_verifiers: DocumentPasswordVerifierRow[];
  document_yjs_checkpoints: DocumentYjsCheckpointRow[];
  document_yjs_update_archives: DocumentYjsUpdateArchiveRow[];
  document_markdown_snapshots: DocumentMarkdownSnapshotRow[];
  document_versions: DocumentVersionRow[];
  document_audit_events: DocumentAuditEventRow[];
};

export type CloudRealtimeRepository = CloudRealtimeRepositoryTables & {
  issueRoomToken: (request: CloudRealtimeTokenRequest) => string;
  createAnonymousRoom: (request: CloudRealtimeAnonymousRoomRequest) => CloudRealtimeCreatedRoom;
  createAccountRoom: (request: CloudRealtimeAccountRoomRequest) => CloudRealtimeCreatedRoom;
  claimAnonymousRoom: (request: CloudRealtimeClaimRequest) => DocumentRow;
  addMembership: (request: CloudRealtimeMembershipRequest) => DocumentMembershipRow;
  createInvite: (request: CloudRealtimeInviteCreateRequest) => CloudRoomInvite;
  redeemInvite: (request: CloudRealtimeInviteRedeemRequest) => CloudRealtimeInviteRedemption;
  updateRoomPassword: (request: CloudRealtimePasswordUpdateRequest) => CloudRoomPasswordUpdate;
};

export type CloudRealtimeHooks = {
  onAuthenticate: (request: CloudRealtimeAuthenticateRequest) => CloudRealtimeRoomContext;
  load: (roomId: string, context?: CloudRealtimeRoomContext) => Y.Doc;
  store: (roomId: string, update: Uint8Array, options?: CloudRealtimeStoreOptions) => CloudRealtimeStoreResult;
  authorizeAiSession: (request: CloudRealtimeAiSessionRequest) => CloudRealtimeAiSession;
};

export type CloudRealtimeBackend = {
  repository: CloudRealtimeRepository;
  hooks: CloudRealtimeHooks;
};

type CloudRealtimeTokenRequest = {
  documentId: string;
  access:
    | { kind: "account"; userId: string }
    | { kind: "anonymous"; guestId: string; ownerSecret?: string; role?: CloudRoomRole };
};

type CloudRealtimeAnonymousRoomRequest = {
  tenantId: string;
  title: string;
  seedMarkdown: string;
  password?: string;
};

type CloudRealtimeAccountRoomRequest = {
  auth: CloudAccountAuth;
  title: string;
  seedMarkdown: string;
  password?: string;
};

type CloudRealtimeClaimRequest = {
  documentId: string;
  auth: CloudAccountAuth;
  ownerSecret: string;
};

type CloudRealtimeMembershipRequest = {
  documentId: string;
  userId: string;
  tenantId: string;
  role: DocumentMembershipRow["role"];
};

type CloudRealtimeInviteCreateRequest = {
  documentId: string;
  access: CloudRoomManagementAccess;
  role: CloudRoomInviteRole;
  expiresAt?: string;
  maxUses?: number;
  audience?: string;
};

type CloudRealtimeInviteRedeemRequest = {
  documentId: string;
  inviteSecret: string;
  auth?: CloudAccountAuth;
  guestId?: string;
};

type CloudRealtimeInviteRedemption = {
  document: DocumentRow;
  role: CloudRoomRole;
  tokenAccess:
    | { kind: "account"; userId: string }
    | { kind: "anonymous"; guestId: string; role: CloudRoomRole };
};

type CloudRealtimePasswordUpdateRequest = {
  documentId: string;
  access: CloudRoomManagementAccess;
  password?: string | null;
};

type CloudRealtimeCreatedRoom = {
  document: DocumentRow;
  roomToken: string;
  ownerSecret?: string;
};

type RoomTokenClaims = {
  tokenId: string;
  tenantId: string;
  roomId: string;
  documentId: string;
  userId?: string;
  guestId?: string;
  guestRole?: CloudRoomRole;
  ownerSecretHash?: string;
};

type EncryptedBlob = {
  blob_ref: string;
  wrapped_key_id: string;
  byte_length: number;
  ciphertext: Uint8Array;
  purpose: "yjs-checkpoint" | "yjs-update-archive" | "markdown-snapshot";
};

const WRITE_ROLES = new Set<CloudRoomRole>(["owner", "admin", "editor", "guest-owner"]);
const DEFAULT_TENANT_NAME = "Personal workspace";
const DEFAULT_COMPACT_AFTER_UPDATES = 3;
const ANONYMOUS_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export function createInMemoryCloudRealtimeBackend(): CloudRealtimeBackend {
  let sequence = 0;
  const tokenClaims = new Map<string, RoomTokenClaims>();
  const encryptedBlobs = new Map<string, EncryptedBlob>();

  const now = () => new Date(1700000000000 + sequence * 1000).toISOString();
  const nextId = (prefix: string) => {
    sequence += 1;
    return `${prefix}_${sequence.toString().padStart(4, "0")}`;
  };

  const repository: CloudRealtimeRepository = {
    tenants: [],
    users: [],
    documents: [],
    document_memberships: [],
    document_invites: [],
    document_password_verifiers: [],
    document_yjs_checkpoints: [],
    document_yjs_update_archives: [],
    document_markdown_snapshots: [],
    document_versions: [],
    document_audit_events: [],

    issueRoomToken({ documentId, access }) {
      const document = getDocument(repository, documentId);
      const tokenId = nextId("room_token");
      const claims: RoomTokenClaims = {
        tokenId,
        tenantId: document.tenant_id,
        roomId: document.id,
        documentId: document.id,
      };
      if (access.kind === "account") {
        claims.userId = access.userId;
      } else {
        claims.guestId = access.guestId;
        claims.guestRole = access.role;
        claims.ownerSecretHash = access.ownerSecret ? hashSecret(access.ownerSecret) : undefined;
      }
      const token = `${tokenId}.${stableHash(JSON.stringify(claims))}`;
      tokenClaims.set(token, claims);
      return token;
    },

    createAnonymousRoom({ tenantId, title, seedMarkdown, password }) {
      ensureTenant(repository, tenantId);
      const documentId = nextId("doc");
      const ownerSecret = `owner_${documentId}_${stableHash(`${documentId}:owner`)}`;
      const document = insertDocument(repository, {
        id: documentId,
        tenant_id: tenantId,
        title,
        source: "local-file",
        mode: "anonymous",
        owner_user_id: null,
        anonymous_owner_capability_hash: hashSecret(ownerSecret),
        expires_at: new Date(Date.parse(now()) + ANONYMOUS_ROOM_TTL_MS).toISOString(),
        claimed_at: null,
        created_at: now(),
        updated_at: now(),
      });
      seedPersistence(repository, encryptedBlobs, document, seedMarkdown, nextId, now);
      if (password) {
        upsertPasswordVerifier(repository, document, password, nextId, now);
      }
      audit(repository, document, nextId, now, {
        kind: "room_created",
        actor_guest_id: "anonymous-owner",
      });
      return {
        document,
        ownerSecret,
        roomToken: repository.issueRoomToken({
          documentId: document.id,
          access: { kind: "anonymous", guestId: "guest_owner", ownerSecret },
        }),
      };
    },

    createAccountRoom({ auth, title, seedMarkdown, password }) {
      ensureTenant(repository, auth.tenantId);
      ensureUser(repository, auth);
      const documentId = nextId("doc");
      const document = insertDocument(repository, {
        id: documentId,
        tenant_id: auth.tenantId,
        title,
        source: "local-file",
        mode: "account",
        owner_user_id: auth.userId,
        anonymous_owner_capability_hash: null,
        expires_at: null,
        claimed_at: now(),
        created_at: now(),
        updated_at: now(),
      });
      repository.addMembership({
        documentId: document.id,
        tenantId: auth.tenantId,
        userId: auth.userId,
        role: "owner",
      });
      seedPersistence(repository, encryptedBlobs, document, seedMarkdown, nextId, now);
      if (password) {
        upsertPasswordVerifier(repository, document, password, nextId, now);
      }
      audit(repository, document, nextId, now, {
        kind: "room_created",
        actor_user_id: auth.userId,
      });
      return {
        document,
        roomToken: repository.issueRoomToken({
          documentId: document.id,
          access: { kind: "account", userId: auth.userId },
        }),
      };
    },

    claimAnonymousRoom({ documentId, auth, ownerSecret }) {
      const document = getDocument(repository, documentId);
      if (document.mode !== "anonymous") {
        throw new Error("Only anonymous rooms can be claimed.");
      }
      if (document.tenant_id !== auth.tenantId) {
        throw new Error("Tenant mismatch while claiming room.");
      }
      if (!document.anonymous_owner_capability_hash || !constantTimeMatch(document.anonymous_owner_capability_hash, hashSecret(ownerSecret))) {
        throw new Error("A valid anonymous owner secret is required to claim this room.");
      }
      ensureUser(repository, auth);
      document.mode = "account";
      document.owner_user_id = auth.userId;
      document.anonymous_owner_capability_hash = null;
      document.expires_at = null;
      document.claimed_at = now();
      document.updated_at = now();
      repository.addMembership({
        documentId: document.id,
        tenantId: auth.tenantId,
        userId: auth.userId,
        role: "owner",
      });
      audit(repository, document, nextId, now, {
        kind: "room_claimed",
        actor_user_id: auth.userId,
      });
      return document;
    },

    addMembership({ documentId, tenantId, userId, role }) {
      const document = getDocument(repository, documentId);
      if (document.tenant_id !== tenantId) {
        throw new Error("Tenant mismatch while adding membership.");
      }
      ensureUser(repository, { kind: "account", userId, tenantId });
      const existing = activeMembership(repository, document, userId);
      if (existing) {
        existing.role = role;
        return existing;
      }
      const membership: DocumentMembershipRow = {
        id: nextId("membership"),
        tenant_id: tenantId,
        document_id: document.id,
        user_id: userId,
        role,
        created_at: now(),
        revoked_at: null,
      };
      repository.document_memberships.push(membership);
      audit(repository, document, nextId, now, {
        kind: "member_added",
        actor_user_id: userId,
      });
      return membership;
    },

    createInvite({ documentId, access, role, expiresAt, maxUses, audience }) {
      const document = getDocument(repository, documentId);
      const actor = assertCanManageRoom(repository, document, access, "invites");
      const inviteSecret = `invite_${document.id}_${nextId("secret")}_${stableHash(`${document.id}:invite:${now()}`)}`;
      const invite: DocumentInviteRow = {
        id: nextId("invite"),
        tenant_id: document.tenant_id,
        document_id: document.id,
        invite_secret_hash: hashSecret(inviteSecret),
        role,
        created_by_user_id: actor.userId ?? null,
        audience: audience ?? null,
        max_uses: maxUses ?? null,
        used_count: 0,
        expires_at: expiresAt ?? null,
        revoked_at: null,
        created_at: now(),
      };
      repository.document_invites.push(invite);
      audit(repository, document, nextId, now, {
        kind: "invite_created",
        actor_user_id: actor.userId,
        actor_guest_id: actor.guestId,
      });
      return {
        roomId: document.id,
        inviteSecret,
        role,
        expiresAt,
        maxUses,
        audience,
      };
    },

    redeemInvite({ documentId, inviteSecret, auth, guestId }) {
      const document = getDocument(repository, documentId);
      const invite = findUsableInvite(repository, document, inviteSecret);

      if (auth) {
        if (auth.tenantId !== document.tenant_id) {
          throw new Error("Tenant mismatch while redeeming room invite.");
        }
        invite.used_count += 1;
        repository.addMembership({
          documentId: document.id,
          tenantId: auth.tenantId,
          userId: auth.userId,
          role: invite.role,
        });
        audit(repository, document, nextId, now, {
          kind: "invite_redeemed",
          actor_user_id: auth.userId,
        });
        return {
          document,
          role: invite.role,
          tokenAccess: { kind: "account", userId: auth.userId },
        };
      }

      if (!guestId) {
        throw new Error("Joining with an invite requires account auth or anonymous guest id.");
      }
      if (invite.role === "admin" || invite.role === "editor") {
        throw new Error("Admin and editor invite access requires signed-in account auth.");
      }
      invite.used_count += 1;
      audit(repository, document, nextId, now, {
        kind: "invite_redeemed",
        actor_guest_id: guestId,
      });
      return {
        document,
        role: invite.role,
        tokenAccess: { kind: "anonymous", guestId, role: invite.role },
      };
    },

    updateRoomPassword({ documentId, access, password }) {
      const document = getDocument(repository, documentId);
      const actor = assertCanManageRoom(repository, document, access, "password");
      const existing = repository.document_password_verifiers.find((row) => row.document_id === document.id);
      if (password === null || password === undefined || password === "") {
        if (existing) {
          repository.document_password_verifiers.splice(repository.document_password_verifiers.indexOf(existing), 1);
        }
        audit(repository, document, nextId, now, {
          kind: "room_password_cleared",
          actor_user_id: actor.userId,
          actor_guest_id: actor.guestId,
        });
        return {
          roomId: document.id,
          hasPassword: false,
          action: "cleared",
        };
      }

      upsertPasswordVerifier(repository, document, password, nextId, now);
      audit(repository, document, nextId, now, {
        kind: existing ? "room_password_rotated" : "room_password_set",
        actor_user_id: actor.userId,
        actor_guest_id: actor.guestId,
      });
      return {
        roomId: document.id,
        hasPassword: true,
        action: existing ? "rotated" : "set",
      };
    },
  };

  const hooks: CloudRealtimeHooks = {
    onAuthenticate({ roomToken, password }) {
      const claims = tokenClaims.get(roomToken);
      if (!claims) {
        throw new Error("Invalid room token.");
      }
      const document = getDocument(repository, claims.documentId);
      if (document.id !== claims.roomId || document.tenant_id !== claims.tenantId) {
        throw new Error("Room token is not scoped to this tenant and room.");
      }
      validatePassword(repository, document, password);
      const context = contextForClaims(repository, document, claims);
      if (!context.canWrite) {
        return context;
      }
      return context;
    },

    load(roomId, context) {
      const document = getDocument(repository, roomId);
      validateContext(document, context, false);
      const latestCheckpoint = latestByCreatedAt(repository.document_yjs_checkpoints.filter((row) => row.document_id === document.id));
      if (!latestCheckpoint) {
        throw new Error(`Cloud room has no Yjs checkpoint: ${roomId}`);
      }

      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, decryptBlob(encryptedBlobs, latestCheckpoint.blob_ref));
      for (const archive of updatesAfterCheckpoint(repository, document, latestCheckpoint)) {
        Y.applyUpdate(ydoc, decryptBlob(encryptedBlobs, archive.blob_ref));
      }
      return ydoc;
    },

    store(roomId, update, options = {}) {
      const document = getDocument(repository, roomId);
      validateContext(document, options.context, true);

      const beforeDoc = hooks.load(roomId, options.context);
      Y.applyUpdate(beforeDoc, update);
      const archive = appendUpdateArchive(repository, encryptedBlobs, document, update, nextId, now);
      const updatesSinceCheckpoint = updatesAfterCheckpoint(
        repository,
        document,
        latestByCreatedAt(repository.document_yjs_checkpoints.filter((row) => row.document_id === document.id)),
      ).length;
      const shouldCompact =
        options.compact === true || updatesSinceCheckpoint >= (options.compactAfterUpdates ?? DEFAULT_COMPACT_AFTER_UPDATES);
      const checkpoint = shouldCompact ? appendCheckpoint(repository, encryptedBlobs, document, beforeDoc, nextId, now) : undefined;
      const markdownSnapshot = options.materializeSnapshotReason
        ? appendMarkdownSnapshot(repository, encryptedBlobs, document, beforeDoc, options.materializeSnapshotReason, nextId, now)
        : undefined;
      const version =
        checkpoint && markdownSnapshot
          ? appendVersion(repository, document, checkpoint, markdownSnapshot, options, nextId, now)
          : undefined;

      if (markdownSnapshot) {
        audit(repository, document, nextId, now, {
          kind: "snapshot_materialized",
          actor_user_id: options.createdByUserId ?? null,
          actor_agent_id: options.createdByAgentId ?? null,
          authorized_by_user_id: options.createdByAgentId ? options.createdByUserId ?? null : null,
        });
      }

      return { updateArchive: archive, checkpoint, markdownSnapshot, version };
    },

    authorizeAiSession({ roomToken, password, agentId, displayName }) {
      const context = hooks.onAuthenticate({ roomToken, password });
      if (!context.userId) {
        throw new Error("AI usage requires a signed-in account.");
      }
      if (!activeMembership(repository, getDocument(repository, context.documentId), context.userId)) {
        throw new Error("AI usage requires room membership.");
      }
      audit(repository, getDocument(repository, context.documentId), nextId, now, {
        kind: "ai_session_started",
        actor_agent_id: agentId,
        authorized_by_user_id: context.userId,
      });
      return {
        participantKind: "ai-agent",
        agentId,
        displayName,
        authorizedByUserId: context.userId,
        tenantId: context.tenantId,
        roomId: context.roomId,
        documentId: context.documentId,
        role: context.role,
      };
    },
  };

  return { repository, hooks };
}

export function wrapKey(documentId: string) {
  return `wrapped_key_${stableHash(`document-key:${documentId}`)}`;
}

export function encryptBlob(
  encryptedBlobs: Map<string, EncryptedBlob>,
  document: DocumentRow,
  purpose: EncryptedBlob["purpose"],
  plaintext: Uint8Array,
  nextId: (prefix: string) => string,
) {
  const wrapped_key_id = wrapKey(document.id);
  const blob_ref = `encrypted://${document.tenant_id}/${document.id}/${purpose}/${nextId("blob")}`;
  const ciphertext = xorBytes(plaintext, wrapped_key_id);
  const blob: EncryptedBlob = {
    blob_ref,
    wrapped_key_id,
    byte_length: plaintext.byteLength,
    ciphertext,
    purpose,
  };
  encryptedBlobs.set(blob_ref, blob);
  return blob;
}

export function decryptBlob(encryptedBlobs: Map<string, EncryptedBlob>, blobRef: string) {
  const blob = encryptedBlobs.get(blobRef);
  if (!blob) {
    throw new Error(`Encrypted blob does not exist: ${blobRef}`);
  }
  return xorBytes(blob.ciphertext, blob.wrapped_key_id);
}

export function assertRowMatchesSchemaTable(tableName: keyof CloudRealtimeRepositoryTables, row: Record<string, unknown>) {
  const table = getTable(cloudBackendSchema, tableName);
  const expected = columnNames(table);
  const actual = Object.keys(row).sort();
  if (actual.join("|") !== expected.join("|")) {
    throw new Error(`Row for ${tableName} has keys ${actual.join(", ")} but schema expects ${expected.join(", ")}`);
  }
}

function ensureTenant(repository: CloudRealtimeRepositoryTables, tenantId: string) {
  if (repository.tenants.some((tenant) => tenant.id === tenantId)) {
    return;
  }
  repository.tenants.push({
    id: tenantId,
    name: DEFAULT_TENANT_NAME,
    kind: "personal",
    created_at: new Date(1700000000000).toISOString(),
  });
}

function ensureUser(repository: CloudRealtimeRepositoryTables, auth: CloudAccountAuth) {
  if (repository.users.some((user) => user.id === auth.userId && user.tenant_id === auth.tenantId)) {
    return;
  }
  ensureTenant(repository, auth.tenantId);
  repository.users.push({
    id: auth.userId,
    tenant_id: auth.tenantId,
    display_name: auth.userId,
    email: null,
    local_uuid: null,
    created_at: new Date(1700000000000).toISOString(),
  });
}

function insertDocument(repository: CloudRealtimeRepositoryTables, document: DocumentRow) {
  repository.documents.push(document);
  return document;
}

function seedPersistence(
  repository: CloudRealtimeRepositoryTables,
  encryptedBlobs: Map<string, EncryptedBlob>,
  document: DocumentRow,
  seedMarkdown: string,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const ydoc = createYDocFromMarkdown(seedMarkdown);
  appendCheckpoint(repository, encryptedBlobs, document, ydoc, nextId, now);
  appendMarkdownSnapshot(repository, encryptedBlobs, document, ydoc, "manual", nextId, now);
}

function appendCheckpoint(
  repository: CloudRealtimeRepositoryTables,
  encryptedBlobs: Map<string, EncryptedBlob>,
  document: DocumentRow,
  ydoc: Y.Doc,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const update = Y.encodeStateAsUpdate(ydoc);
  const blob = encryptBlob(encryptedBlobs, document, "yjs-checkpoint", update, nextId);
  const checkpoint: DocumentYjsCheckpointRow = {
    id: nextId("checkpoint"),
    tenant_id: document.tenant_id,
    document_id: document.id,
    blob_ref: blob.blob_ref,
    state_vector: Y.encodeStateVector(ydoc),
    wrapped_key_id: blob.wrapped_key_id,
    byte_length: blob.byte_length,
    encryption: "application-level-at-rest",
    created_at: now(),
  };
  repository.document_yjs_checkpoints.push(checkpoint);
  return checkpoint;
}

function appendUpdateArchive(
  repository: CloudRealtimeRepositoryTables,
  encryptedBlobs: Map<string, EncryptedBlob>,
  document: DocumentRow,
  update: Uint8Array,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const previous = latestByCreatedAt(repository.document_yjs_update_archives.filter((row) => row.document_id === document.id));
  const rangeStart = previous ? previous.range_end + 1 : 1;
  const blob = encryptBlob(encryptedBlobs, document, "yjs-update-archive", update, nextId);
  const archive: DocumentYjsUpdateArchiveRow = {
    id: nextId("update"),
    tenant_id: document.tenant_id,
    document_id: document.id,
    blob_ref: blob.blob_ref,
    range_start: rangeStart,
    range_end: rangeStart,
    wrapped_key_id: blob.wrapped_key_id,
    byte_length: blob.byte_length,
    encryption: "application-level-at-rest",
    created_at: now(),
  };
  repository.document_yjs_update_archives.push(archive);
  return archive;
}

function appendMarkdownSnapshot(
  repository: CloudRealtimeRepositoryTables,
  encryptedBlobs: Map<string, EncryptedBlob>,
  document: DocumentRow,
  ydoc: Y.Doc,
  reason: CloudRealtimeMaterializationReason,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const markdown = ydoc.getText("markdown").toString();
  const blob = encryptBlob(encryptedBlobs, document, "markdown-snapshot", new TextEncoder().encode(markdown), nextId);
  const snapshot: DocumentMarkdownSnapshotRow = {
    id: nextId("snapshot"),
    tenant_id: document.tenant_id,
    document_id: document.id,
    blob_ref: blob.blob_ref,
    wrapped_key_id: blob.wrapped_key_id,
    byte_length: blob.byte_length,
    encryption: "application-level-at-rest",
    materialization_reason: reason,
    created_at: now(),
  };
  repository.document_markdown_snapshots.push(snapshot);
  return snapshot;
}

function appendVersion(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  checkpoint: DocumentYjsCheckpointRow,
  snapshot: DocumentMarkdownSnapshotRow,
  options: CloudRealtimeStoreOptions,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const version: DocumentVersionRow = {
    id: nextId("version"),
    tenant_id: document.tenant_id,
    document_id: document.id,
    checkpoint_id: checkpoint.id,
    snapshot_id: snapshot.id,
    reason: snapshot.materialization_reason,
    created_by_user_id: options.createdByUserId ?? null,
    created_by_agent_id: options.createdByAgentId ?? null,
    label: null,
    created_at: now(),
  };
  repository.document_versions.push(version);
  return version;
}

function upsertPasswordVerifier(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  password: string,
  nextId: (prefix: string) => string,
  now: () => string,
) {
  const salt = new TextEncoder().encode(nextId("salt"));
  const verifier_hash = new TextEncoder().encode(hashSecret(`${password}:${bytesToText(salt)}`));
  const existing = repository.document_password_verifiers.find((row) => row.document_id === document.id);
  if (existing) {
    existing.salt = salt;
    existing.verifier_hash = verifier_hash;
    existing.rotated_at = now();
    return existing;
  }
  const row: DocumentPasswordVerifierRow = {
    document_id: document.id,
    tenant_id: document.tenant_id,
    algorithm: "argon2id",
    params_version: 1,
    salt,
    verifier_hash,
    rotated_at: now(),
  };
  repository.document_password_verifiers.push(row);
  return row;
}

function validatePassword(repository: CloudRealtimeRepositoryTables, document: DocumentRow, password?: string) {
  const verifier = repository.document_password_verifiers.find(
    (row) => row.tenant_id === document.tenant_id && row.document_id === document.id,
  );
  if (!verifier) {
    return;
  }
  const candidate = new TextEncoder().encode(hashSecret(`${password ?? ""}:${bytesToText(verifier.salt)}`));
  if (!byteMatch(candidate, verifier.verifier_hash)) {
    throw new Error("This room requires a valid password.");
  }
}

function contextForClaims(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  claims: RoomTokenClaims,
): CloudRealtimeRoomContext {
  if (claims.userId) {
    const membership = activeMembership(repository, document, claims.userId);
    if (!membership) {
      throw new Error("Room token user is not an active room member.");
    }
    return {
      tenantId: document.tenant_id,
      roomId: document.id,
      documentId: document.id,
      userId: claims.userId,
      role: membership.role,
      canWrite: WRITE_ROLES.has(membership.role),
    };
  }

  if (!claims.guestId) {
    throw new Error("Room token is missing a subject.");
  }
  const guestOwner =
    document.mode === "anonymous" &&
    document.anonymous_owner_capability_hash &&
    claims.ownerSecretHash &&
    constantTimeMatch(document.anonymous_owner_capability_hash, claims.ownerSecretHash);
  const role: CloudRoomRole = guestOwner ? "guest-owner" : claims.guestRole ?? "viewer";
  return {
    tenantId: document.tenant_id,
    roomId: document.id,
    documentId: document.id,
    guestId: claims.guestId,
    role,
    canWrite: WRITE_ROLES.has(role),
  };
}

function validateContext(document: DocumentRow, context: CloudRealtimeRoomContext | undefined, requireWrite: boolean) {
  if (!context) {
    return;
  }
  if (context.tenantId !== document.tenant_id || context.documentId !== document.id || context.roomId !== document.id) {
    throw new Error("Room context is not scoped to this tenant and room.");
  }
  if (requireWrite && !context.canWrite) {
    throw new Error("Room context does not grant write capability.");
  }
}

function assertCanManageRoom(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  access: CloudRoomManagementAccess,
  subject: "invites" | "password",
) {
  if (access.kind === "anonymous-owner") {
    if (
      document.mode === "anonymous" &&
      document.anonymous_owner_capability_hash &&
      constantTimeMatch(document.anonymous_owner_capability_hash, hashSecret(access.ownerSecret))
    ) {
      return { guestId: access.guestId ?? "anonymous-owner" };
    }
    throw new Error(`Managing room ${subject} requires a valid anonymous owner secret.`);
  }

  if (access.auth.tenantId !== document.tenant_id) {
    throw new Error(`Managing room ${subject} requires room membership in the room tenant.`);
  }
  const membership = activeMembership(repository, document, access.auth.userId);
  if (membership?.role === "owner" || membership?.role === "admin") {
    return { userId: access.auth.userId };
  }
  if (!membership) {
    throw new Error(`Managing room ${subject} requires room membership.`);
  }
  throw new Error(`Role ${membership.role} cannot manage room ${subject}; owner or admin is required.`);
}

function findUsableInvite(repository: CloudRealtimeRepositoryTables, document: DocumentRow, inviteSecret: string) {
  const invite = repository.document_invites.find(
    (row) =>
      row.tenant_id === document.tenant_id &&
      row.document_id === document.id &&
      row.revoked_at === null &&
      constantTimeMatch(row.invite_secret_hash, hashSecret(inviteSecret)),
  );
  if (!invite) {
    throw new Error("A valid room invite is required to join this room.");
  }
  if (invite.expires_at && Date.parse(invite.expires_at) <= Date.parse(new Date(1700000000000).toISOString())) {
    throw new Error("Room invite has expired.");
  }
  if (invite.max_uses !== null && invite.used_count >= invite.max_uses) {
    throw new Error("Room invite has no remaining uses.");
  }
  return invite;
}

function updatesAfterCheckpoint(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  checkpoint: DocumentYjsCheckpointRow | undefined,
) {
  return repository.document_yjs_update_archives
    .filter((row) => row.document_id === document.id && (!checkpoint || row.created_at > checkpoint.created_at))
    .sort(compareCreatedAt);
}

function activeMembership(repository: CloudRealtimeRepositoryTables, document: DocumentRow, userId: string) {
  return repository.document_memberships.find(
    (row) =>
      row.tenant_id === document.tenant_id &&
      row.document_id === document.id &&
      row.user_id === userId &&
      row.revoked_at === null,
  );
}

function getDocument(repository: CloudRealtimeRepositoryTables, documentId: string) {
  const document = repository.documents.find((row) => row.id === documentId);
  if (!document) {
    throw new Error(`Cloud room does not exist: ${documentId}`);
  }
  return document;
}

function latestByCreatedAt<TRow extends { created_at: string }>(rows: TRow[]) {
  return [...rows].sort(compareCreatedAt).at(-1);
}

function compareCreatedAt(a: { created_at: string }, b: { created_at: string }) {
  return a.created_at.localeCompare(b.created_at);
}

function createYDocFromMarkdown(markdown: string) {
  const ydoc = new Y.Doc();
  ydoc.getText("markdown").insert(0, normalizeMarkdown(markdown));
  return ydoc;
}

function audit(
  repository: CloudRealtimeRepositoryTables,
  document: DocumentRow,
  nextId: (prefix: string) => string,
  now: () => string,
  fields: Pick<DocumentAuditEventRow, "kind"> &
    Partial<Pick<DocumentAuditEventRow, "actor_user_id" | "actor_agent_id" | "actor_guest_id" | "authorized_by_user_id">>,
) {
  repository.document_audit_events.push({
    id: nextId("audit"),
    tenant_id: document.tenant_id,
    document_id: document.id,
    kind: fields.kind,
    actor_user_id: fields.actor_user_id ?? null,
    actor_agent_id: fields.actor_agent_id ?? null,
    actor_guest_id: fields.actor_guest_id ?? null,
    authorized_by_user_id: fields.authorized_by_user_id ?? null,
    payload: {},
    created_at: now(),
  });
}

function columnNames(table: CloudSchemaTable) {
  return table.columns.map((column) => column.name).sort();
}

function normalizeMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/gu, "\n");
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

function xorBytes(bytes: Uint8Array, key: string) {
  const keyBytes = new TextEncoder().encode(key);
  return bytes.map((byte, index) => byte ^ keyBytes[index % keyBytes.length]);
}

function byteMatch(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
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
