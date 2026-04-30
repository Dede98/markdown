import type * as Y from "yjs";
import type { YAwarenessLike } from "y-codemirror.next";
import type { PresenceParticipant } from "../documentSession";

export type RealtimeRoomConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "closed" | "error";

export type CloudRoomTransportConnectOptions = {
  roomId: string;
  title: string;
  seedMarkdown?: string;
  participant: PresenceParticipant;
  participants: PresenceParticipant[];
  createIfMissing: boolean;
};

export type RealtimeRoomConnection = {
  providerId: string;
  transportId: string;
  roomId: string;
  status: RealtimeRoomConnectionStatus;
  ydoc: Y.Doc;
  ytext: Y.Text;
  awareness: YAwarenessLike;
  getPresenceParticipants: () => PresenceParticipant[];
  materializeMarkdown: () => string;
  destroy: () => void;
};

export type CloudRoomTransport = {
  id: string;
  label: string;
  connect: (options: CloudRoomTransportConnectOptions) => RealtimeRoomConnection;
};
