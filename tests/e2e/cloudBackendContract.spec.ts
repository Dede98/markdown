import { expect, test } from "@playwright/test";
import {
  createInMemoryCloudRoomBackend,
  type CloudAccountAuth,
  type CloudPersistenceBoundary,
} from "../../src/cloudCollaboration/backendContract";
import { createLocalFileSession } from "../../src/documentSession";

const accountAuth: CloudAccountAuth = {
  kind: "account",
  userId: "user_123",
  tenantId: "tenant_personal",
};

test.describe("cloud backend room contract", () => {
  test("creates anonymous rooms without signed-in auth", () => {
    const backend = createInMemoryCloudRoomBackend();

    const room = backend.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "Anonymous room",
      seedMarkdown: "# Draft\n\nAnonymous start.",
    });

    expect(room.role).toBe("guest-owner");
    expect(room.ownerSecret).toMatch(/^owner_room_0001_/);
    expect(room.expiresAt).toBeTruthy();
    expect(room.materializeMarkdown()).toBe("# Draft\n\nAnonymous start.");
    expect(backend.getRoomMetadata(room.roomId)).toMatchObject({
      mode: "anonymous",
      source: "local-file",
      ownerUserId: undefined,
    });
  });

  test("requires signed-in auth for account-owned rooms", () => {
    const backend = createInMemoryCloudRoomBackend();

    expect(() =>
      backend.createRoom({
        mode: "account",
        source: "local-file",
        title: "Account room",
        seedMarkdown: "# Draft",
      }),
    ).toThrow(/requires signed-in auth/i);

    const room = backend.createRoom({
      mode: "account",
      source: "local-file",
      title: "Account room",
      seedMarkdown: "# Draft",
      auth: accountAuth,
    });

    expect(room.role).toBe("owner");
    expect(room.ownerSecret).toBeUndefined();
    expect(backend.getRoomMetadata(room.roomId)).toMatchObject({
      mode: "account",
      ownerUserId: accountAuth.userId,
    });
  });

  test("enforces password gates for anonymous and account rooms", () => {
    const backend = createInMemoryCloudRoomBackend();
    const anonymousRoom = backend.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "Protected anonymous room",
      seedMarkdown: "# Anonymous",
      password: "draft-pass",
    });
    const accountRoom = backend.createRoom({
      mode: "account",
      source: "local-file",
      title: "Protected account room",
      seedMarkdown: "# Account",
      auth: accountAuth,
      password: "account-pass",
    });

    expect(() =>
      backend.joinRoom({
        roomId: anonymousRoom.roomId,
        access: { kind: "anonymous", guestId: "guest_1" },
      }),
    ).toThrow(/requires a valid password/i);
    expect(() =>
      backend.joinRoom({
        roomId: accountRoom.roomId,
        access: accountAuth,
        password: "wrong-pass",
      }),
    ).toThrow(/requires a valid password/i);

    expect(
      backend.joinRoom({
        roomId: anonymousRoom.roomId,
        access: { kind: "anonymous", guestId: "guest_1" },
        password: "draft-pass",
      }).role,
    ).toBe("viewer");
    expect(
      backend.joinRoom({
        roomId: accountRoom.roomId,
        access: accountAuth,
        password: "account-pass",
      }).role,
    ).toBe("owner");
  });

  test("claims an anonymous room into an account-owned room and unlocks signed-in AI usage", () => {
    const backend = createInMemoryCloudRoomBackend();
    const anonymousRoom = backend.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "Claimable room",
      seedMarkdown: "# Claim me",
    });

    expect(() =>
      backend.claimAnonymousRoom({
        roomId: anonymousRoom.roomId,
        auth: accountAuth,
        ownerSecret: "wrong-secret",
      }),
    ).toThrow(/valid anonymous owner secret/i);
    expect(() =>
      backend.requestAiSession({
        roomId: anonymousRoom.roomId,
        agentId: "agent_review",
        displayName: "Review Agent",
      }),
    ).toThrow(/requires a signed-in account/i);

    const metadata = backend.claimAnonymousRoom({
      roomId: anonymousRoom.roomId,
      auth: accountAuth,
      ownerSecret: anonymousRoom.ownerSecret!,
    });
    expect(metadata).toMatchObject({
      mode: "account",
      ownerUserId: accountAuth.userId,
      expiresAt: undefined,
    });

    const aiSession = backend.requestAiSession({
      roomId: anonymousRoom.roomId,
      auth: accountAuth,
      agentId: "agent_review",
      displayName: "Review Agent",
    });
    expect(aiSession).toMatchObject({
      participantKind: "ai-agent",
      authorizedByUserId: accountAuth.userId,
      roomId: anonymousRoom.roomId,
    });
  });

  test("materializes deterministic Markdown and keeps encrypted persistence boundaries opaque", () => {
    const backend = createInMemoryCloudRoomBackend();
    const seedMarkdown = `# Commented

Before <!--c:01JCE7XVDQY0PVH3KQZ80V7N4G-->tracked text<!--/c:01JCE7XVDQY0PVH3KQZ80V7N4G--> after.

<!--
markdown-comments-v1
{"threads":{"01JCE7XVDQY0PVH3KQZ80V7N4G":{"id":"01JCE7XVDQY0PVH3KQZ80V7N4G","createdAt":"2026-04-29T10:00:00.000Z","resolved":false,"replies":[]}}}
-->`;

    const firstRoom = backend.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "First",
      seedMarkdown,
    });
    const secondRoom = backend.createRoom({
      mode: "anonymous",
      source: "local-file",
      title: "Second",
      seedMarkdown,
    });

    expect(firstRoom.materializeMarkdown()).toBe(seedMarkdown);
    expect(secondRoom.materializeMarkdown()).toBe(seedMarkdown);
    expect(firstRoom.materializeMarkdown()).toBe(secondRoom.materializeMarkdown());
    expect(firstRoom.getCommentMappingSummary()).toEqual({ anchors: 1, threads: 1, orphaned: 0 });
    expectEncryptedPersistenceBoundary(firstRoom.persistence, seedMarkdown);
  });

  test("local Markdown sessions remain account-free and offline-first", () => {
    const session = createLocalFileSession({
      name: "offline.md",
      handle: null,
      savedContents: "# Offline\n\nNo account required.",
    });

    expect(session).toEqual({
      kind: "local-file",
      name: "offline.md",
      handle: null,
      savedContents: "# Offline\n\nNo account required.",
    });
    expect("roomId" in session).toBe(false);
    expect("auth" in session).toBe(false);
  });
});

function expectEncryptedPersistenceBoundary(boundary: CloudPersistenceBoundary, plaintext: string) {
  const refs = [boundary.yjsCheckpoint, boundary.yjsUpdateArchive, boundary.markdownSnapshot];
  expect(refs.map((ref) => ref.purpose)).toEqual(["yjs-checkpoint", "yjs-update-archive", "markdown-snapshot"]);
  for (const ref of refs) {
    expect(ref.ref).toMatch(/^encrypted:\/\//);
    expect(ref.encryption).toBe("application-level-at-rest");
    expect(ref.keyScope).toBe("room");
    expect(ref.plaintextAvailable).toBe(false);
    expect(ref.byteLength).toBeGreaterThan(0);
    expect(ref.ref).not.toContain(plaintext);
    expect(ref).not.toHaveProperty("plaintext");
  }
}
