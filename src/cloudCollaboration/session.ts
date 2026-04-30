import * as Y from "yjs";
import type { CloudRoomSession, PresenceParticipant } from "../documentSession";
import { parseComments } from "../comments/storage";
import { MockAwareness, MockAwarenessRoom, type MockAwarenessState } from "./awareness";

const DEFAULT_CLOUD_MARKDOWN = `# Cloud Collaboration Spike

This bundled first-party spike binds two editor clients to the same Markdown text through Yjs.

<!--c:01JCE7XVDQY0PVH3KQZ80V7N4G-->Comments stay anchored to Markdown ranges.<!--/c:01JCE7XVDQY0PVH3KQZ80V7N4G-->

<!--
markdown-comments-v1
{"threads":{"01JCE7XVDQY0PVH3KQZ80V7N4G":{"id":"01JCE7XVDQY0PVH3KQZ80V7N4G","createdAt":"2026-04-29T10:00:00.000Z","resolved":false,"replies":[{"id":"01JCE7XVF4G2YBT32D1EWGVEJ5","author":{"name":"Ava","uuid":"local-human"},"ts":"2026-04-29T10:00:00.000Z","body":"This maps to a cloud thread via the same hidden markers."}]}}}
-->
`;

const COMMENT_MAPPING_SNIPPET = `
## Cloud comment mapping

<!--c:01JCE7XVDQY0PVH3KQZ80V7N4G-->Comments stay anchored to Markdown ranges.<!--/c:01JCE7XVDQY0PVH3KQZ80V7N4G-->

<!--
markdown-comments-v1
{"threads":{"01JCE7XVDQY0PVH3KQZ80V7N4G":{"id":"01JCE7XVDQY0PVH3KQZ80V7N4G","createdAt":"2026-04-29T10:00:00.000Z","resolved":false,"replies":[{"id":"01JCE7XVF4G2YBT32D1EWGVEJ5","author":{"name":"Ava","uuid":"local-human"},"ts":"2026-04-29T10:00:00.000Z","body":"This maps to a cloud thread via the same hidden markers."}]}}}
-->
`;

export type CloudRoomHandle = {
  providerId: string;
  roomId: string;
  connection: RealtimeRoomConnection;
  session: CloudRoomSession;
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: MockAwareness;
  participant: PresenceParticipant;
  participants: PresenceParticipant[];
  getPresenceParticipants: () => PresenceParticipant[];
  materializeMarkdown: () => string;
  getCommentMappingSummary: () => CommentMappingSummary;
  destroy: () => void;
};

export type RealtimeRoomConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "closed" | "error";

export type RealtimeRoomConnection = {
  providerId: string;
  roomId: string;
  status: RealtimeRoomConnectionStatus;
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: MockAwareness;
  getPresenceParticipants: () => PresenceParticipant[];
  materializeMarkdown: () => string;
  destroy: () => void;
};

export type CloudRoomCreateOptions = {
  roomId?: string;
  title?: string;
  seedMarkdown?: string;
  participantId?: string;
};

export type CloudRoomJoinOptions = {
  roomId: string;
  participantId?: string;
};

export type CloudSessionProvider = {
  id: string;
  label: string;
  createRoom: (options: CloudRoomCreateOptions) => CloudRoomHandle;
  joinRoom: (options: CloudRoomJoinOptions) => CloudRoomHandle;
};

export type CommentMappingSummary = {
  anchors: number;
  threads: number;
  orphaned: number;
};

export const inMemoryCloudSessionProvider: CloudSessionProvider = {
  id: "in-memory",
  label: "In-memory room",
  createRoom: (options) => inMemoryCloudRooms.createRoom(options),
  joinRoom: (options) => inMemoryCloudRooms.joinRoom(options),
};

type InMemoryRoomEntry = {
  roomId: string;
  title: string;
  ydoc: Y.Doc;
  ytext: Y.Text;
  awarenessRoom: MockAwarenessRoom;
  participants: PresenceParticipant[];
  nextClientId: number;
  handles: Set<CloudRoomHandle>;
};

const inMemoryCloudRooms = createInMemoryRoomRegistry();

function createInMemoryRoomRegistry() {
  const rooms = new Map<string, InMemoryRoomEntry>();

  return {
    createRoom({ roomId = "mock-cloud-room", title = "Cloud room spike", seedMarkdown, participantId }: CloudRoomCreateOptions) {
      if (rooms.has(roomId)) {
        throw new Error(`Cloud room already exists: ${roomId}`);
      }

      const ydoc = new Y.Doc();
      const ytext = ydoc.getText("markdown");
      const initial = normalizeSeedMarkdown(seedMarkdown);
      ytext.insert(0, initial);

      const participants = createMockParticipants();
      const entry: InMemoryRoomEntry = {
        roomId,
        title,
        ydoc,
        ytext,
        awarenessRoom: new MockAwarenessRoom(),
        participants,
        nextClientId: ydoc.clientID * 10,
        handles: new Set(),
      };

      seedAgentPresence(entry, initial);
      rooms.set(roomId, entry);
      return joinEntry(entry, participantId ?? "human-primary");
    },

    joinRoom({ roomId, participantId }: CloudRoomJoinOptions) {
      const entry = rooms.get(roomId);
      if (!entry) {
        throw new Error(`Cloud room does not exist: ${roomId}`);
      }
      return joinEntry(entry, participantId ?? "human-secondary");
    },
  };

  function joinEntry(entry: InMemoryRoomEntry, participantId: string): CloudRoomHandle {
    const participant = findParticipant(entry.participants, participantId);
    const awareness = new MockAwareness(entry.awarenessRoom, nextClientId(entry));
    awareness.setLocalState({
      user: toAwarenessUser(participant),
      cursor: cursorForParticipant(entry.ytext, participant.id),
    });

    const materializeMarkdown = () => entry.ytext.toString();
    const getPresenceParticipants = () => participantsFromStates(entry.awarenessRoom.states);
    let handle: CloudRoomHandle | null = null;
    const connection: RealtimeRoomConnection = {
      providerId: inMemoryCloudSessionProvider.id,
      roomId: entry.roomId,
      status: "connected",
      ydoc: entry.ydoc,
      ytext: entry.ytext,
      awareness,
      getPresenceParticipants,
      materializeMarkdown,
      destroy: () => handle?.destroy(),
    };
    const session: CloudRoomSession = {
      kind: "cloud-room",
      roomId: entry.roomId,
      title: entry.title,
      presence: { participants: entry.participants },
      materializeMarkdown,
    };
    handle = {
      providerId: inMemoryCloudSessionProvider.id,
      roomId: entry.roomId,
      connection,
      session,
      ydoc: entry.ydoc,
      ytext: entry.ytext,
      awareness,
      participant,
      participants: entry.participants,
      getPresenceParticipants,
      materializeMarkdown,
      getCommentMappingSummary: () => summarizeCommentMapping(materializeMarkdown()),
      destroy: () => {
        if (!handle || !entry.handles.delete(handle)) {
          return;
        }
        connection.status = "closed";
        awareness.destroy();
        if (entry.handles.size === 0) {
          rooms.delete(entry.roomId);
          entry.ydoc.destroy();
        }
      },
    };
    entry.handles.add(handle);
    return handle;
  }
}

function createMockParticipants(): PresenceParticipant[] {
  return [
    {
      id: "human-primary",
      name: "Ava",
      kind: "human",
      color: "#2d5b8c",
      colorLight: "rgba(45, 91, 140, 0.18)",
    },
    {
      id: "human-secondary",
      name: "Mina",
      kind: "human",
      color: "#8f3f71",
      colorLight: "rgba(143, 63, 113, 0.18)",
    },
    {
      id: "ai-review-agent",
      name: "Review Agent",
      kind: "ai-agent",
      color: "#5d742f",
      colorLight: "rgba(93, 116, 47, 0.2)",
      authorizedBy: "Ava",
    },
  ];
}

function findParticipant(participants: PresenceParticipant[], participantId: string) {
  const participant = participants.find((candidate) => candidate.id === participantId);
  if (!participant) {
    throw new Error(`Cloud room participant does not exist: ${participantId}`);
  }
  return participant;
}

function nextClientId(entry: InMemoryRoomEntry) {
  entry.nextClientId += 1;
  return entry.nextClientId;
}

function seedAgentPresence(entry: InMemoryRoomEntry, markdown: string) {
  const agent = findParticipant(entry.participants, "ai-review-agent");
  entry.awarenessRoom.setState(nextClientId(entry), {
    user: toAwarenessUser(agent),
    cursor: relativeCursor(entry.ytext, firstTextIndex(markdown, "Comments"), firstTextIndex(markdown, "Comments") + "Comments".length),
  });
}

function cursorForParticipant(ytext: Y.Text, participantId: string) {
  const markdown = ytext.toString();
  if (participantId === "human-secondary") {
    return relativeCursor(ytext, firstTextIndex(markdown, "Markdown"), firstTextIndex(markdown, "Markdown") + "Markdown".length);
  }
  return relativeCursor(ytext, 0, 0);
}

function normalizeSeedMarkdown(seedMarkdown?: string) {
  const candidate = seedMarkdown?.trim() ? seedMarkdown : DEFAULT_CLOUD_MARKDOWN;
  const normalized = candidate.endsWith("\n") ? candidate : `${candidate}\n`;
  const comments = parseComments(normalized);
  if (comments.anchors.length > 0 || Object.keys(comments.threads).length > 0) {
    return normalized;
  }
  return `${normalized.trimEnd()}\n\n${COMMENT_MAPPING_SNIPPET.trim()}\n`;
}

function firstTextIndex(markdown: string, needle: string) {
  const index = markdown.indexOf(needle);
  return index >= 0 ? index : 0;
}

function relativeCursor(ytext: Y.Text, anchor: number, head: number) {
  const max = ytext.length;
  return {
    anchor: Y.createRelativePositionFromTypeIndex(ytext, clamp(anchor, 0, max)),
    head: Y.createRelativePositionFromTypeIndex(ytext, clamp(head, 0, max)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toAwarenessUser(participant: PresenceParticipant) {
  return {
    id: participant.id,
    name: participant.kind === "ai-agent" ? `${participant.name} · AI` : participant.name,
    role: participant.kind,
    color: participant.color,
    colorLight: participant.colorLight,
    authorizedBy: participant.authorizedBy,
  };
}

function participantsFromStates(states: Map<number, MockAwarenessState>): PresenceParticipant[] {
  const participants: PresenceParticipant[] = [];
  for (const state of states.values()) {
    const user = state.user as Partial<PresenceParticipant & { role: PresenceParticipant["kind"] }> | undefined;
    if (!user?.id || !user.name || !user.color || !user.colorLight) {
      continue;
    }
    participants.push({
      id: user.id,
      name: user.name.replace(/\s·\sAI$/u, ""),
      kind: user.role === "ai-agent" ? "ai-agent" : "human",
      color: user.color,
      colorLight: user.colorLight,
      authorizedBy: user.authorizedBy,
    });
  }
  return participants;
}

function summarizeCommentMapping(markdown: string): CommentMappingSummary {
  const parsed = parseComments(markdown);
  return {
    anchors: parsed.anchors.length,
    threads: Object.keys(parsed.threads).length,
    orphaned: parsed.orphanedIds.size,
  };
}
