import * as Y from "yjs";
import type {
  CloudRealtimeHooks,
  CloudRealtimeRoomContext,
  CloudRealtimeStoreResult,
} from "./backendHooks";
import type { CloudRoomRole } from "./backendContract";

// Minimal Hocuspocus-shaped hook payload types — no dependency on the actual library.
// These mirror the shapes Hocuspocus server passes to extension hooks.

export type HocuspocusAuthenticatePayload = {
  /** JWT or opaque token supplied by the client via HocuspocusProvider `token` option. */
  token: string;
  documentName: string;
  /** URL query parameters from the WebSocket connection request. */
  requestParameters: URLSearchParams;
};

export type HocuspocusLoadDocumentPayload = {
  documentName: string;
  /** Context returned from `authenticate`; typed as `unknown` to match Hocuspocus's own generics. */
  context: unknown;
  document: Y.Doc;
};

export type HocuspocusStoreDocumentPayload = {
  documentName: string;
  context: unknown;
  document: Y.Doc;
  /** Pre-encoded full state as returned by Y.encodeStateAsUpdate. */
  state?: Uint8Array;
};

export type HocuspocusAdapterHooks = {
  /**
   * Maps onto `hooks.onAuthenticate`. Returns a `CloudRealtimeRoomContext` that
   * Hocuspocus stores as the connection context and passes to later hooks.
   * Throws on token/password failure — Hocuspocus treats thrown errors as auth rejections.
   */
  authenticate: (payload: HocuspocusAuthenticatePayload) => CloudRealtimeRoomContext;

  /**
   * Maps onto `hooks.load`. Hocuspocus calls this once per document to retrieve the
   * initial Y.Doc state from persistence.
   */
  loadDocument: (payload: HocuspocusLoadDocumentPayload) => Y.Doc;
  load: (payload: HocuspocusLoadDocumentPayload) => Y.Doc;

  /**
   * Maps onto `hooks.store`. Hocuspocus calls this after every debounced update cycle.
   * Throws on write-capability failure so Hocuspocus can surface the rejection.
   */
  onStoreDocument: (payload: HocuspocusStoreDocumentPayload) => CloudRealtimeStoreResult;
  store: (payload: HocuspocusStoreDocumentPayload) => CloudRealtimeStoreResult;
};

export type HocuspocusAdapterHookName = "authenticate" | "loadDocument" | "onStoreDocument";

export type HocuspocusAdapterErrorCode =
  | "authentication_failed"
  | "load_failed"
  | "store_failed"
  | "context_required"
  | "context_invalid"
  | "context_scope_mismatch";

export class HocuspocusAdapterError extends Error {
  readonly name = "HocuspocusAdapterError";

  constructor(
    public readonly hook: HocuspocusAdapterHookName,
    public readonly code: HocuspocusAdapterErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Hocuspocus ${hook} failed: ${message}`, options);
  }
}

/**
 * Wraps a `CloudRealtimeHooks` instance behind a Hocuspocus-shaped hook boundary.
 * No real Hocuspocus server, WebSocket transport, or DB driver is required.
 */
export function createHocuspocusAdapterHooks(hooks: CloudRealtimeHooks): HocuspocusAdapterHooks {
  const authenticate = ({ token, documentName, requestParameters }: HocuspocusAuthenticatePayload) => {
    try {
      const password = requestParameters.get("password") ?? undefined;
      const context = hooks.onAuthenticate({ roomToken: token, password });
      ensureContextScope("authenticate", documentName, context);
      return context;
    } catch (error) {
      throwAdapterError("authenticate", "authentication_failed", error);
    }
  };

  const loadDocument = ({ documentName, context }: HocuspocusLoadDocumentPayload) => {
    try {
      const roomContext = requireRoomContext("loadDocument", context);
      ensureContextScope("loadDocument", documentName, roomContext);
      return hooks.load(documentName, roomContext);
    } catch (error) {
      throwAdapterError("loadDocument", "load_failed", error);
    }
  };

  const onStoreDocument = ({ documentName, context, document, state }: HocuspocusStoreDocumentPayload) => {
    try {
      const roomContext = requireRoomContext("onStoreDocument", context);
      ensureContextScope("onStoreDocument", documentName, roomContext);
      const update = state ?? Y.encodeStateAsUpdate(document);
      return hooks.store(documentName, update, {
        context: roomContext,
      });
    } catch (error) {
      throwAdapterError("onStoreDocument", "store_failed", error);
    }
  };

  return {
    authenticate,
    loadDocument,
    load: loadDocument,
    onStoreDocument,
    store: onStoreDocument,
  };
}

const ROOM_ROLES = new Set<CloudRoomRole>(["owner", "admin", "editor", "commenter", "viewer", "guest-owner"]);

function requireRoomContext(hook: HocuspocusAdapterHookName, context: unknown): CloudRealtimeRoomContext {
  if (!context) {
    throw new HocuspocusAdapterError(hook, "context_required", "Room context is required.");
  }
  if (!isRecord(context)) {
    throw new HocuspocusAdapterError(hook, "context_invalid", "Room context must be an object.");
  }
  const { tenantId, roomId, documentId, role, canWrite, userId, guestId } = context;
  if (
    typeof tenantId !== "string" ||
    typeof roomId !== "string" ||
    typeof documentId !== "string" ||
    typeof role !== "string" ||
    !ROOM_ROLES.has(role as CloudRoomRole) ||
    typeof canWrite !== "boolean"
  ) {
    throw new HocuspocusAdapterError(hook, "context_invalid", "Room context shape is invalid.");
  }
  if (userId !== undefined && typeof userId !== "string") {
    throw new HocuspocusAdapterError(hook, "context_invalid", "Room context userId must be a string.");
  }
  if (guestId !== undefined && typeof guestId !== "string") {
    throw new HocuspocusAdapterError(hook, "context_invalid", "Room context guestId must be a string.");
  }
  return {
    tenantId,
    roomId,
    documentId,
    role: role as CloudRoomRole,
    canWrite,
    userId,
    guestId,
  };
}

function ensureContextScope(
  hook: HocuspocusAdapterHookName,
  documentName: string,
  context: CloudRealtimeRoomContext,
) {
  if (context.roomId !== documentName || context.documentId !== documentName) {
    throw new HocuspocusAdapterError(
      hook,
      "context_scope_mismatch",
      "Room context is not scoped to this Hocuspocus document.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwAdapterError(
  hook: HocuspocusAdapterHookName,
  code: HocuspocusAdapterErrorCode,
  error: unknown,
): never {
  if (error instanceof HocuspocusAdapterError) {
    throw error;
  }
  throw new HocuspocusAdapterError(hook, code, error instanceof Error ? error.message : "Hook execution failed.", {
    cause: error,
  });
}
