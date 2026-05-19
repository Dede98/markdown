import { expect, test } from "@playwright/test";
import * as Y from "yjs";
import {
  assertRowMatchesSchemaTable,
  createInMemoryCloudRealtimeBackend,
  type CloudRealtimeRepositoryTables,
  type CloudRealtimeRoomContext,
} from "../../src/cloudCollaboration/backendHooks";
import type { CloudAccountAuth } from "../../src/cloudCollaboration/backendContract";

const ownerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_owner",
  tenantId: "tenant_personal",
};

const peerAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_peer",
  tenantId: "tenant_personal",
};

test.describe("cloud backend Hocuspocus-shaped hook contract", () => {
  test("authenticates anonymous and account rooms through token membership and password gates", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const anonymous = backend.repository.createAnonymousRoom({
      tenantId: "tenant_personal",
      title: "Protected anonymous room",
      seedMarkdown: "# Anonymous",
      password: "room-pass",
    });
    const account = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Protected account room",
      seedMarkdown: "# Account",
      password: "account-pass",
    });

    expect(() =>
      backend.hooks.onAuthenticate({
        roomToken: anonymous.roomToken,
        password: "wrong",
      }),
    ).toThrow(/valid password/i);
    expect(() =>
      backend.hooks.onAuthenticate({
        roomToken: "missing-token",
        password: "room-pass",
      }),
    ).toThrow(/invalid room token/i);

    expect(
      backend.hooks.onAuthenticate({
        roomToken: anonymous.roomToken,
        password: "room-pass",
      }),
    ).toMatchObject({
      tenantId: "tenant_personal",
      roomId: anonymous.document.id,
      documentId: anonymous.document.id,
      guestId: "guest_owner",
      role: "guest-owner",
      canWrite: true,
    });
    expect(
      backend.hooks.onAuthenticate({
        roomToken: account.roomToken,
        password: "account-pass",
      }),
    ).toMatchObject({
      userId: ownerAuth.userId,
      role: "owner",
      canWrite: true,
    });

    const viewerToken = backend.repository.issueRoomToken({
      documentId: anonymous.document.id,
      access: { kind: "anonymous", guestId: "guest_viewer" },
    });
    expect(backend.hooks.onAuthenticate({ roomToken: viewerToken, password: "room-pass" })).toMatchObject({
      guestId: "guest_viewer",
      role: "viewer",
      canWrite: false,
    });
  });

  test("honors anonymous claim transition and signed-in-only AI authorization", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const anonymous = backend.repository.createAnonymousRoom({
      tenantId: ownerAuth.tenantId,
      title: "Claimable",
      seedMarkdown: "# Claim",
    });

    expect(() =>
      backend.hooks.authorizeAiSession({
        roomToken: anonymous.roomToken,
        agentId: "agent_review",
        displayName: "Review Agent",
      }),
    ).toThrow(/signed-in account/i);

    backend.repository.claimAnonymousRoom({
      documentId: anonymous.document.id,
      auth: ownerAuth,
      ownerSecret: anonymous.ownerSecret!,
    });
    const claimedOwnerToken = backend.repository.issueRoomToken({
      documentId: anonymous.document.id,
      access: { kind: "account", userId: ownerAuth.userId },
    });

    expect(backend.hooks.onAuthenticate({ roomToken: anonymous.roomToken })).toMatchObject({
      guestId: "guest_owner",
      role: "viewer",
      canWrite: false,
    });
    expect(backend.hooks.authorizeAiSession({
      roomToken: claimedOwnerToken,
      agentId: "agent_review",
      displayName: "Review Agent",
    })).toMatchObject({
      participantKind: "ai-agent",
      authorizedByUserId: ownerAuth.userId,
      documentId: anonymous.document.id,
      role: "owner",
    });

    const nonMemberToken = backend.repository.issueRoomToken({
      documentId: anonymous.document.id,
      access: { kind: "account", userId: "user_not_member" },
    });
    expect(() =>
      backend.hooks.authorizeAiSession({
        roomToken: nonMemberToken,
        agentId: "agent_review",
        displayName: "Review Agent",
      }),
    ).toThrow(/active room member/i);
  });

  test("loads from encrypted checkpoint plus update archives and stores encrypted rows only", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Persistent room",
      seedMarkdown: "# Draft\n\nInitial.",
    });
    const context = backend.hooks.onAuthenticate({ roomToken: room.roomToken });
    const archivedMarkdown = "# Draft\n\nArchived update.";
    const compactedMarkdown = "# Draft\n\nCompacted update.";

    const archiveOnlyUpdate = replaceMarkdownUpdate(backend.hooks.load(room.document.id, context), archivedMarkdown);
    const archiveOnlyResult = backend.hooks.store(room.document.id, archiveOnlyUpdate, { context });
    expect(archiveOnlyResult.checkpoint).toBeUndefined();
    expect(backend.hooks.load(room.document.id, context).getText("markdown").toString()).toBe(archivedMarkdown);

    const compactedUpdate = replaceMarkdownUpdate(backend.hooks.load(room.document.id, context), compactedMarkdown);
    const result = backend.hooks.store(room.document.id, compactedUpdate, {
      context,
      compact: true,
      materializeSnapshotReason: "before_ai_edit",
      createdByUserId: ownerAuth.userId,
      createdByAgentId: "agent_review",
    });

    expect(result.updateArchive).toMatchObject({
      document_id: room.document.id,
      encryption: "application-level-at-rest",
    });
    expect(result.checkpoint).toMatchObject({
      document_id: room.document.id,
      encryption: "application-level-at-rest",
    });
    expect(result.markdownSnapshot).toMatchObject({
      document_id: room.document.id,
      materialization_reason: "before_ai_edit",
      encryption: "application-level-at-rest",
    });
    expect(result.version).toMatchObject({
      checkpoint_id: result.checkpoint!.id,
      snapshot_id: result.markdownSnapshot!.id,
      created_by_user_id: ownerAuth.userId,
      created_by_agent_id: "agent_review",
    });

    const loaded = backend.hooks.load(room.document.id, context);
    expect(loaded.getText("markdown").toString()).toBe(compactedMarkdown);
    expect(JSON.stringify(backend.repository.document_yjs_update_archives)).not.toContain(compactedMarkdown);
    expect(JSON.stringify(backend.repository.document_markdown_snapshots)).not.toContain(compactedMarkdown);
    expect(JSON.stringify(backend.repository.document_yjs_checkpoints)).not.toContain(compactedMarkdown);
    assertRepositoryRowsMatchSchema(backend.repository);
  });

  test("periodically compacts and supports lifecycle Markdown snapshot reasons", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const room = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Lifecycle room",
      seedMarkdown: "# Lifecycle",
    });
    const context = backend.hooks.onAuthenticate({ roomToken: room.roomToken });
    const reasons = ["manual", "autosnapshot", "before_ai_edit", "restore", "room_close"] as const;

    for (const [index, reason] of reasons.entries()) {
      const update = replaceMarkdownUpdate(
        backend.hooks.load(room.document.id, context),
        `# Lifecycle\n\nSnapshot ${index + 1}: ${reason}`,
      );
      const result = backend.hooks.store(room.document.id, update, {
        context,
        compactAfterUpdates: 1,
        materializeSnapshotReason: reason,
        createdByUserId: ownerAuth.userId,
      });
      expect(result.checkpoint).toBeDefined();
      expect(result.markdownSnapshot?.materialization_reason).toBe(reason);
    }

    expect(backend.repository.document_markdown_snapshots.map((row) => row.materialization_reason)).toEqual([
      "manual",
      ...reasons,
    ]);
    expect(backend.hooks.load(room.document.id, context).getText("markdown").toString()).toContain("room_close");
  });

  test("enforces tenant scoping and write capability at load and store boundaries", () => {
    const backend = createInMemoryCloudRealtimeBackend();
    const firstRoom = backend.repository.createAccountRoom({
      auth: ownerAuth,
      title: "Tenant one",
      seedMarkdown: "# One",
    });
    const secondRoom = backend.repository.createAccountRoom({
      auth: { ...ownerAuth, userId: "tenant_two_owner", tenantId: "tenant_two" },
      title: "Tenant two",
      seedMarkdown: "# Two",
    });
    const firstContext = backend.hooks.onAuthenticate({ roomToken: firstRoom.roomToken });

    expect(() => backend.hooks.load(secondRoom.document.id, firstContext)).toThrow(/not scoped/i);
    expect(() =>
      backend.hooks.store(secondRoom.document.id, replaceMarkdownUpdate(backend.hooks.load(secondRoom.document.id), "# Bad"), {
        context: firstContext,
      }),
    ).toThrow(/not scoped/i);

    backend.repository.addMembership({
      tenantId: peerAuth.tenantId,
      documentId: firstRoom.document.id,
      userId: peerAuth.userId,
      role: "viewer",
    });
    const viewerToken = backend.repository.issueRoomToken({
      documentId: firstRoom.document.id,
      access: { kind: "account", userId: peerAuth.userId },
    });
    const viewerContext = backend.hooks.onAuthenticate({ roomToken: viewerToken });
    expect(viewerContext).toMatchObject({ role: "viewer", canWrite: false });
    expect(() =>
      backend.hooks.store(firstRoom.document.id, replaceMarkdownUpdate(backend.hooks.load(firstRoom.document.id), "# Bad"), {
        context: viewerContext,
      }),
    ).toThrow(/write capability/i);
  });
});

function replaceMarkdownUpdate(ydoc: Y.Doc, markdown: string) {
  const ytext = ydoc.getText("markdown");
  ytext.delete(0, ytext.length);
  ytext.insert(0, markdown);
  return Y.encodeStateAsUpdate(ydoc);
}

function assertRepositoryRowsMatchSchema(repository: CloudRealtimeRepositoryTables) {
  const tableNames = [
    "tenants",
    "users",
    "documents",
    "document_memberships",
    "document_invites",
    "document_password_verifiers",
    "document_yjs_checkpoints",
    "document_yjs_update_archives",
    "document_markdown_snapshots",
    "document_versions",
    "document_audit_events",
  ] as const;

  for (const tableName of tableNames) {
    for (const row of repository[tableName]) {
      assertRowMatchesSchemaTable(tableName, row as unknown as Record<string, unknown>);
    }
  }
}
