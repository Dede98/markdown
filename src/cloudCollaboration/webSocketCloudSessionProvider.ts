import type { CloudRoomCreateOptions, CloudRoomJoinOptions, CloudSessionProvider } from "./session";

export type WebSocketCloudSessionProviderOptions = {
  endpointUrl: string;
  getAccessToken?: () => Promise<string | null>;
};

export function createWebSocketCloudSessionProvider(options: WebSocketCloudSessionProviderOptions): CloudSessionProvider {
  return {
    id: "websocket",
    label: "WebSocket room",
    createRoom: (roomOptions) => notImplemented("createRoom", options, roomOptions),
    joinRoom: (roomOptions) => notImplemented("joinRoom", options, roomOptions),
  };
}

function notImplemented(
  method: "createRoom" | "joinRoom",
  options: WebSocketCloudSessionProviderOptions,
  roomOptions: CloudRoomCreateOptions | CloudRoomJoinOptions,
): never {
  const roomId = "roomId" in roomOptions ? roomOptions.roomId : "new room";
  throw new Error(
    `WebSocket Cloud provider ${method} is a contract stub for ${roomId} at ${options.endpointUrl}. Implement a CloudRoomTransport before wiring this provider into the app.`,
  );
}
