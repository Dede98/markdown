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

export type CloudCollaborationSpikeSession = {
  session: CloudRoomSession;
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: {
    primary: MockAwareness;
    secondary: MockAwareness;
  };
  participants: PresenceParticipant[];
  getPresenceParticipants: () => PresenceParticipant[];
  materializeMarkdown: () => string;
  getCommentMappingSummary: () => CommentMappingSummary;
  destroy: () => void;
};

export type CommentMappingSummary = {
  anchors: number;
  threads: number;
  orphaned: number;
};

export function createCloudCollaborationSpikeSession(seedMarkdown?: string): CloudCollaborationSpikeSession {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("markdown");
  const initial = normalizeSeedMarkdown(seedMarkdown);
  ytext.insert(0, initial);

  const room = new MockAwarenessRoom();
  const baseClientId = ydoc.clientID * 10;
  const primary = new MockAwareness(room, baseClientId + 1);
  const secondary = new MockAwareness(room, baseClientId + 2);
  const agentClientId = baseClientId + 3;

  const participants: PresenceParticipant[] = [
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

  primary.setLocalState({
    user: toAwarenessUser(participants[0]),
    cursor: relativeCursor(ytext, 0, 0),
  });
  secondary.setLocalState({
    user: toAwarenessUser(participants[1]),
    cursor: relativeCursor(ytext, firstTextIndex(initial, "Markdown"), firstTextIndex(initial, "Markdown") + "Markdown".length),
  });
  room.setState(agentClientId, {
    user: toAwarenessUser(participants[2]),
    cursor: relativeCursor(ytext, firstTextIndex(initial, "Comments"), firstTextIndex(initial, "Comments") + "Comments".length),
  });

  const materializeMarkdown = () => ytext.toString();
  const session: CloudRoomSession = {
    kind: "cloud-room",
    roomId: "mock-cloud-room",
    title: "Cloud room spike",
    presence: { participants },
    materializeMarkdown,
  };

  return {
    session,
    ydoc,
    ytext,
    awareness: { primary, secondary },
    participants,
    getPresenceParticipants: () => participantsFromStates(room.states),
    materializeMarkdown,
    getCommentMappingSummary: () => summarizeCommentMapping(materializeMarkdown()),
    destroy: () => {
      primary.destroy();
      secondary.destroy();
      ydoc.destroy();
    },
  };
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
