import * as Y from "yjs";
import type {
  CloudRealtimeHooks,
  CloudRealtimeRoomContext,
  CloudRealtimeStoreResult,
} from "./backendHooks";

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
  state: Uint8Array;
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

  /**
   * Maps onto `hooks.store`. Hocuspocus calls this after every debounced update cycle.
   * Throws on write-capability failure so Hocuspocus can surface the rejection.
   */
  onStoreDocument: (payload: HocuspocusStoreDocumentPayload) => CloudRealtimeStoreResult;
};

/**
 * Wraps a `CloudRealtimeHooks` instance behind a Hocuspocus-shaped hook boundary.
 * No real Hocuspocus server, WebSocket transport, or DB driver is required.
 */
export function createHocuspocusAdapterHooks(hooks: CloudRealtimeHooks): HocuspocusAdapterHooks {
  return {
    authenticate({ token, requestParameters }) {
      const password = requestParameters.get("password") ?? undefined;
      return hooks.onAuthenticate({ roomToken: token, password });
    },

    loadDocument({ documentName, context }) {
      return hooks.load(documentName, context as CloudRealtimeRoomContext | undefined);
    },

    onStoreDocument({ documentName, context, document }) {
      const update = Y.encodeStateAsUpdate(document);
      return hooks.store(documentName, update, {
        context: context as CloudRealtimeRoomContext | undefined,
      });
    },
  };
}
