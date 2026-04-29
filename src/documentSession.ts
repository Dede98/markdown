import type { FileHandle } from "./fileAdapter";

export type PresenceParticipantKind = "human" | "ai-agent";

export type PresenceParticipant = {
  id: string;
  name: string;
  kind: PresenceParticipantKind;
  color: string;
  colorLight: string;
  authorizedBy?: string;
};

export type PresenceState = {
  participants: PresenceParticipant[];
};

export type LocalFileSession = {
  kind: "local-file";
  name: string;
  handle: FileHandle | null;
  savedContents: string;
};

export type CloudRoomSession = {
  kind: "cloud-room";
  roomId: string;
  title: string;
  presence: PresenceState;
  materializeMarkdown: () => string;
};

export type DocumentSession = LocalFileSession | CloudRoomSession;

export function createLocalFileSession(file: {
  name: string;
  handle: FileHandle | null;
  savedContents: string;
}): LocalFileSession {
  return {
    kind: "local-file",
    name: file.name,
    handle: file.handle,
    savedContents: file.savedContents,
  };
}

