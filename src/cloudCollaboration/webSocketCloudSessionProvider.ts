import * as Y from "yjs";
import type { CloudRoomSession, PresenceParticipant } from "../documentSession";
import { parseComments } from "../comments/storage";
import { MockAwareness, MockAwarenessRoom, type MockAwarenessState } from "./awareness";
import type {
  CloudAccessContext,
  CloudAccountAuth,
  CloudRoomCreateRequest,
  CloudRoomTicket,
} from "./backendContract";
import {
  CloudBackendHttpClientError,
  createCloudBackendHttpClient,
  createCloudBackendServiceTransport,
  type CloudBackendHttpClient,
} from "./backendHttpClient";
import type { CloudRealtimeRoomContext, CloudRealtimeStoreResult } from "./backendHooks";
import {
  CloudRealtimeServerMountError,
  type CloudRealtimeConnectionBridgeRequest,
  type CloudRealtimeServerMount,
} from "./backendRealtimeServer";
import type { CloudBackendService } from "./backendService";
import type { CloudRoomHandle, CloudSessionProvider } from "./session";
import type { CloudRoomTransport, CloudRoomTransportConnectOptions, RealtimeRoomConnection } from "./transport";

export type WebSocketCloudSessionProviderOptions = {
  endpointUrl: string;
  client?: CloudBackendHttpClient;
  service?: CloudBackendService;
  serverMount?: CloudRealtimeServerMount;
  auth?: CloudAccountAuth;
  mode?: CloudRoomCreateRequest["mode"];
  source?: CloudRoomCreateRequest["source"];
  password?: string;
  joinAccess?: CloudAccessContext | ((roomId: string) => CloudAccessContext);
};

export type WebSocketCloudRoomTransportOptions = {
  endpointUrl: string;
  serverMount: CloudRealtimeServerMount;
  providerId?: string;
};

export type WebSocketCloudRoomTransport = CloudRoomTransport & {
  connect: (options: CloudRoomTransportConnectOptions) => WebSocketRealtimeRoomConnection;
};

export type WebSocketRealtimeRoomConnection = RealtimeRoomConnection & {
  endpointUrl: string;
  context: CloudRealtimeRoomContext;
  connectionParameters: ReturnType<CloudRealtimeServerMount["createConnectionParameters"]>;
  store: () => CloudRealtimeStoreResult;
};

export type WebSocketCloudSessionProviderErrorCode =
  | "missing_backend_boundary"
  | "route_request_failed"
  | "room_token_required"
  | "authentication_failed"
  | "load_failed"
  | "store_failed";

export class WebSocketCloudSessionProviderError extends Error {
  readonly name = "WebSocketCloudSessionProviderError";

  constructor(
    public readonly phase: "createRoom" | "joinRoom" | "connect" | "load" | "store",
    public readonly code: WebSocketCloudSessionProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`WebSocket Cloud provider ${phase} failed: ${message}`, options);
  }
}

export function createWebSocketCloudRoomTransport({
  endpointUrl,
  serverMount,
  providerId = "websocket",
}: WebSocketCloudRoomTransportOptions): WebSocketCloudRoomTransport {
  return {
    id: "websocket-room-transport",
    label: "WebSocket room transport",
    connect(options) {
      return connectThroughRealtimeMount({
        endpointUrl,
        providerId,
        serverMount,
        options,
      });
    },
  };
}

export function createWebSocketCloudSessionProvider(options: WebSocketCloudSessionProviderOptions): CloudSessionProvider {
  const transport = requireTransport(options);

  return {
    id: "websocket",
    label: "WebSocket room",
    createRoom: (roomOptions) => {
      const client = requireClient(options, "createRoom");
      const ticket = requestTicket(
        "createRoom",
        () =>
          client.createRoom({
            auth: options.auth,
            mode: options.mode ?? (options.auth ? "account" : "anonymous"),
            source: options.source ?? "local-file",
            title: roomOptions.title ?? "Cloud room",
            seedMarkdown: roomOptions.seedMarkdown ?? "",
            password: options.password,
          }),
      );
      return handleFromTicket({
        providerId: "websocket",
        title: roomOptions.title ?? "Cloud room",
        participantId: roomOptions.participantId,
        transport,
        ticket,
        password: options.password,
      });
    },
    joinRoom: (roomOptions) => {
      const client = requireClient(options, "joinRoom");
      const ticket = requestTicket(
        "joinRoom",
        () =>
          client.joinRoom({
            roomId: roomOptions.roomId,
            auth: options.auth,
            access: accessForJoin(options, roomOptions.roomId),
            password: options.password,
          }),
      );
      return handleFromTicket({
        providerId: "websocket",
        title: "Cloud room",
        participantId: roomOptions.participantId,
        transport,
        ticket,
        password: options.password,
      });
    },
  };
}

function connectThroughRealtimeMount({
  endpointUrl,
  providerId,
  serverMount,
  options,
}: {
  endpointUrl: string;
  providerId: string;
  serverMount: CloudRealtimeServerMount;
  options: CloudRoomTransportConnectOptions;
}): WebSocketRealtimeRoomConnection {
  if (!options.roomToken) {
    throw new WebSocketCloudSessionProviderError(
      "connect",
      "room_token_required",
      "A backend-issued room token is required before opening a realtime connection.",
    );
  }

  const request: CloudRealtimeConnectionBridgeRequest = {
    roomId: options.roomId,
    roomToken: options.roomToken,
    password: options.password,
  };
  const connectionParameters = serverMount.createConnectionParameters(request);
  const context = authenticate(serverMount, connectionParameters);
  const ydoc = loadDocument(serverMount, connectionParameters.documentName, context);
  const ytext = ydoc.getText("markdown");
  const awarenessRoom = new MockAwarenessRoom();
  const awareness = new MockAwareness(awarenessRoom, ydoc.clientID);
  awareness.setLocalState({ user: toAwarenessUser(options.participant) });

  let status: RealtimeRoomConnection["status"] = "connected";
  const getPresenceParticipants = () => participantsFromStates(awarenessRoom.states);
  const connection: WebSocketRealtimeRoomConnection = {
    providerId,
    transportId: "websocket-room-transport",
    endpointUrl,
    roomId: options.roomId,
    get status() {
      return status;
    },
    ydoc,
    ytext,
    awareness,
    context,
    connectionParameters,
    getPresenceParticipants,
    materializeMarkdown: () => ytext.toString(),
    store: () => storeDocument(serverMount, connectionParameters.documentName, context, ydoc),
    destroy: () => {
      if (status === "closed") {
        return;
      }
      status = "closed";
      awareness.destroy();
      ydoc.destroy();
    },
  };
  return connection;
}

function authenticate(
  serverMount: CloudRealtimeServerMount,
  connectionParameters: ReturnType<CloudRealtimeServerMount["createConnectionParameters"]>,
) {
  try {
    return serverMount.config.hooks.authenticate(connectionParameters);
  } catch (error) {
    throw mapServerError("connect", "authentication_failed", error);
  }
}

function loadDocument(
  serverMount: CloudRealtimeServerMount,
  documentName: string,
  context: CloudRealtimeRoomContext,
) {
  try {
    return serverMount.config.hooks.loadDocument({ documentName, context });
  } catch (error) {
    throw mapServerError("load", "load_failed", error);
  }
}

function storeDocument(
  serverMount: CloudRealtimeServerMount,
  documentName: string,
  context: CloudRealtimeRoomContext,
  ydoc: Y.Doc,
) {
  try {
    return serverMount.config.hooks.onStoreDocument({
      documentName,
      context,
      document: ydoc,
      state: Y.encodeStateAsUpdate(ydoc),
    });
  } catch (error) {
    throw mapServerError("store", "store_failed", error);
  }
}

function mapServerError(
  phase: WebSocketCloudSessionProviderError["phase"],
  fallbackCode: WebSocketCloudSessionProviderErrorCode,
  error: unknown,
) {
  if (error instanceof WebSocketCloudSessionProviderError) {
    return error;
  }
  if (error instanceof CloudRealtimeServerMountError) {
    return new WebSocketCloudSessionProviderError(
      phase,
      fallbackCode,
      `${error.code}: ${error.message}`,
      { cause: error },
    );
  }
  return new WebSocketCloudSessionProviderError(
    phase,
    fallbackCode,
    error instanceof Error ? error.message : "Realtime boundary request failed.",
    { cause: error },
  );
}

function requireTransport(options: WebSocketCloudSessionProviderOptions) {
  if (!options.serverMount) {
    return missingBoundaryTransport(options.endpointUrl);
  }
  return createWebSocketCloudRoomTransport({
    endpointUrl: options.endpointUrl,
    serverMount: options.serverMount,
  });
}

function missingBoundaryTransport(endpointUrl: string): WebSocketCloudRoomTransport {
  return {
    id: "websocket-room-transport",
    label: "WebSocket room transport",
    connect() {
      throw new WebSocketCloudSessionProviderError(
        "connect",
        "missing_backend_boundary",
        `No realtime server mount was supplied for ${endpointUrl}. Keep this provider non-wired until the backend boundary is available.`,
      );
    },
  };
}

function requireClient(
  options: WebSocketCloudSessionProviderOptions,
  phase: "createRoom" | "joinRoom",
) {
  if (options.client) {
    return options.client;
  }
  if (options.service) {
    return createCloudBackendHttpClient({
      transport: createCloudBackendServiceTransport(options.service),
      auth: options.auth,
    });
  }
  throw new WebSocketCloudSessionProviderError(
    phase,
    "missing_backend_boundary",
    `No backend client was supplied for ${options.endpointUrl}. Keep this provider non-wired until the route boundary is available.`,
  );
}

function requestTicket(
  phase: "createRoom" | "joinRoom",
  request: () => CloudRoomTicket,
): CloudRoomTicket {
  try {
    return request();
  } catch (error) {
    if (error instanceof WebSocketCloudSessionProviderError) {
      throw error;
    }
    if (error instanceof CloudBackendHttpClientError) {
      throw new WebSocketCloudSessionProviderError(
        phase,
        "route_request_failed",
        `${error.status} ${error.routeId}: ${error.message}`,
        { cause: error },
      );
    }
    throw new WebSocketCloudSessionProviderError(
      phase,
      "route_request_failed",
      error instanceof Error ? error.message : "Route request failed.",
      { cause: error },
    );
  }
}

function handleFromTicket({
  providerId,
  title,
  participantId,
  transport,
  ticket,
  password,
}: {
  providerId: string;
  title: string;
  participantId?: string;
  transport: WebSocketCloudRoomTransport;
  ticket: CloudRoomTicket;
  password?: string;
}): CloudRoomHandle {
  const participants = createProviderParticipants(participantId ?? ticket.role);
  const participant = participants[0];
  const connection = transport.connect({
    roomId: ticket.roomId,
    title,
    roomToken: ticket.roomToken,
    password,
    participant,
    participants,
    createIfMissing: false,
  });
  const session: CloudRoomSession = {
    kind: "cloud-room",
    roomId: ticket.roomId,
    title,
    presence: { participants },
    materializeMarkdown: connection.materializeMarkdown,
  };
  return {
    providerId,
    roomId: ticket.roomId,
    connection,
    session,
    ydoc: connection.ydoc,
    ytext: connection.ytext,
    awareness: connection.awareness,
    participant,
    participants,
    getPresenceParticipants: connection.getPresenceParticipants,
    materializeMarkdown: connection.materializeMarkdown,
    getCommentMappingSummary: () => summarizeCommentMapping(connection.materializeMarkdown()),
    destroy: connection.destroy,
  };
}

function accessForJoin(options: WebSocketCloudSessionProviderOptions, roomId: string): CloudAccessContext | undefined {
  if (typeof options.joinAccess === "function") {
    return options.joinAccess(roomId);
  }
  return options.joinAccess;
}

function createProviderParticipants(participantId: string): PresenceParticipant[] {
  return [
    {
      id: participantId,
      name: participantId,
      kind: "human",
      color: "#2d5b8c",
      colorLight: "rgba(45, 91, 140, 0.18)",
    },
  ];
}

function summarizeCommentMapping(markdown: string) {
  const parsed = parseComments(markdown);
  return {
    anchors: parsed.anchors.length,
    threads: Object.keys(parsed.threads).length,
    orphaned: parsed.orphanedIds.size,
  };
}

function toAwarenessUser(participant: PresenceParticipant) {
  return {
    id: participant.id,
    name: participant.name,
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
      name: user.name,
      kind: user.role ?? user.kind ?? "human",
      color: user.color,
      colorLight: user.colorLight,
      authorizedBy: user.authorizedBy,
    });
  }
  return participants;
}
