import * as Y from "yjs";
import {
  createHocuspocusAdapterHooks,
  HocuspocusAdapterError,
  type HocuspocusAdapterErrorCode,
  type HocuspocusAdapterHookName,
  type HocuspocusAdapterHooks,
  type HocuspocusAuthenticatePayload,
  type HocuspocusLoadDocumentPayload,
  type HocuspocusStoreDocumentPayload,
} from "./backendHocuspocusAdapter";
import type {
  CloudRealtimeHooks,
  CloudRealtimeRoomContext,
  CloudRealtimeStoreResult,
} from "./backendHooks";

export type CloudRealtimeServerMountOptions = {
  hooks: CloudRealtimeHooks;
  id?: string;
  name?: string;
  pathPattern?: string;
};

export type CloudRealtimeServerAuthenticatePayload = {
  documentName: string;
  token?: string;
  requestParameters?: URLSearchParams | Record<string, string | undefined> | string;
};

export type CloudRealtimeServerLoadDocumentPayload = {
  documentName: string;
  context: unknown;
  document?: Y.Doc;
};

export type CloudRealtimeServerStoreDocumentPayload = {
  documentName: string;
  context: unknown;
  document: Y.Doc;
  state?: Uint8Array;
};

export type CloudRealtimeServerHooks = {
  authenticate: (payload: CloudRealtimeServerAuthenticatePayload) => CloudRealtimeRoomContext;
  loadDocument: (payload: CloudRealtimeServerLoadDocumentPayload) => Y.Doc;
  load: (payload: CloudRealtimeServerLoadDocumentPayload) => Y.Doc;
  onStoreDocument: (payload: CloudRealtimeServerStoreDocumentPayload) => CloudRealtimeStoreResult;
  store: (payload: CloudRealtimeServerStoreDocumentPayload) => CloudRealtimeStoreResult;
};

export type CloudRealtimeServerConfiguration = {
  name: string;
  /**
   * Hocuspocus-shaped hook bag. A future real server should pass these functions
   * to its extension/configuration layer without changing the auth/load/store contract.
   */
  hooks: CloudRealtimeServerHooks;
};

export type CloudRealtimeServerMount = {
  id: string;
  transport: "hocuspocus";
  pathPattern: string;
  adapter: HocuspocusAdapterHooks;
  config: CloudRealtimeServerConfiguration;
  documentNameForRoomId: (roomId: string) => string;
  roomIdFromDocumentName: (documentName: string) => string;
  createConnectionParameters: (request: CloudRealtimeConnectionBridgeRequest) => HocuspocusAuthenticatePayload;
};

export type CloudRealtimeConnectionBridgeRequest = {
  roomId: string;
  roomToken: string;
  password?: string;
};

export type CloudRealtimeServerErrorCode =
  | HocuspocusAdapterErrorCode
  | "token_required"
  | "document_name_required";

export class CloudRealtimeServerMountError extends Error {
  readonly name = "CloudRealtimeServerMountError";

  constructor(
    public readonly hook: HocuspocusAdapterHookName,
    public readonly code: CloudRealtimeServerErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Cloud realtime server ${hook} failed: ${message}`, options);
  }
}

export function createCloudRealtimeServerMount({
  hooks,
  id = "cloud-hocuspocus-realtime",
  name = "Markdown Cloud realtime",
  pathPattern = "/rooms/:roomId/realtime",
}: CloudRealtimeServerMountOptions): CloudRealtimeServerMount {
  const adapter = createHocuspocusAdapterHooks(hooks);

  const authenticate = (payload: CloudRealtimeServerAuthenticatePayload) => {
    try {
      const documentName = requireDocumentName("authenticate", payload.documentName);
      const requestParameters = normalizeRequestParameters(payload.requestParameters);
      const token = payload.token ?? requestParameters.get("token") ?? undefined;
      if (!token) {
        throw new CloudRealtimeServerMountError("authenticate", "token_required", "Room token is required.");
      }
      return adapter.authenticate({
        token,
        documentName,
        requestParameters,
      });
    } catch (error) {
      throwServerError("authenticate", error);
    }
  };

  const loadDocument = (payload: CloudRealtimeServerLoadDocumentPayload) => {
    try {
      return adapter.loadDocument({
        documentName: requireDocumentName("loadDocument", payload.documentName),
        context: payload.context,
        document: payload.document ?? new Y.Doc(),
      });
    } catch (error) {
      throwServerError("loadDocument", error);
    }
  };

  const onStoreDocument = (payload: CloudRealtimeServerStoreDocumentPayload) => {
    try {
      return adapter.onStoreDocument({
        documentName: requireDocumentName("onStoreDocument", payload.documentName),
        context: payload.context,
        document: payload.document,
        state: payload.state,
      });
    } catch (error) {
      throwServerError("onStoreDocument", error);
    }
  };

  const serverHooks: CloudRealtimeServerHooks = {
    authenticate,
    loadDocument,
    load: loadDocument,
    onStoreDocument,
    store: onStoreDocument,
  };

  return {
    id,
    transport: "hocuspocus",
    pathPattern,
    adapter,
    config: {
      name,
      hooks: serverHooks,
    },
    documentNameForRoomId: identityRoomName,
    roomIdFromDocumentName: identityRoomName,
    createConnectionParameters({ roomId, roomToken, password }) {
      return {
        token: roomToken,
        documentName: identityRoomName(roomId),
        requestParameters: password ? new URLSearchParams({ password }) : new URLSearchParams(),
      };
    },
  };
}

function identityRoomName(roomId: string) {
  return roomId;
}

function requireDocumentName(hook: HocuspocusAdapterHookName, documentName: string) {
  if (!documentName) {
    throw new CloudRealtimeServerMountError(hook, "document_name_required", "Hocuspocus documentName is required.");
  }
  return documentName;
}

function normalizeRequestParameters(
  requestParameters: CloudRealtimeServerAuthenticatePayload["requestParameters"],
) {
  if (requestParameters instanceof URLSearchParams) {
    return requestParameters;
  }
  if (typeof requestParameters === "string") {
    return new URLSearchParams(requestParameters);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParameters ?? {})) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

function throwServerError(hook: HocuspocusAdapterHookName, error: unknown): never {
  if (error instanceof CloudRealtimeServerMountError) {
    throw error;
  }
  if (error instanceof HocuspocusAdapterError) {
    throw new CloudRealtimeServerMountError(hook, error.code, error.message, { cause: error });
  }
  throw new CloudRealtimeServerMountError(
    hook,
    hook === "authenticate" ? "authentication_failed" : hook === "loadDocument" ? "load_failed" : "store_failed",
    error instanceof Error ? error.message : "Server hook execution failed.",
    { cause: error },
  );
}
