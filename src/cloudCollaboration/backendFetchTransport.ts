import type { CloudAccessContext, CloudAccountAuth } from "./backendContract";
import {
  parseJoinRoomBody,
  type CloudBackendGetSnapshotBody,
  type CloudBackendJoinRoomBody,
  type CloudBackendRequest,
} from "./backendRouteContracts";
import type { CloudBackendHttpTransport } from "./backendHttpClient";

export const cloudBackendFetchHeaderNames = {
  accountCredential: "authorization",
  inviteCapability: "x-cloud-invite-capability",
  ownerCapability: "x-cloud-owner-capability",
  roomPassword: "x-cloud-room-password",
} as const;

export type CloudBackendFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CloudBackendFetchSensitiveInputs = {
  accountAuth?: CloudAccountAuth;
  inviteSecret?: string;
  ownerSecret?: string;
  password?: string;
};

export type CloudBackendFetchHeaderContext = {
  method: CloudBackendRequest["method"];
  path: string;
  /**
   * Identity assertions select a credential; they are never serialized as
   * network proof. Sensitive values are exposed only to this adapter so it
   * can place them in the documented headers.
   */
  sensitive: Readonly<CloudBackendFetchSensitiveInputs>;
};

export type CloudBackendFetchHeaderAdapter = (
  context: CloudBackendFetchHeaderContext,
) => HeadersInit | Promise<HeadersInit>;

export type CloudBackendFetchTransportOptions = {
  baseUrl: string;
  fetch?: CloudBackendFetch;
  headers?: CloudBackendFetchHeaderAdapter;
};

export type CloudBackendFetchTransportErrorCode =
  | "aborted"
  | "header_adapter_failed"
  | "invalid_base_url"
  | "invalid_json"
  | "invalid_route"
  | "missing_fetch"
  | "missing_header_mapping"
  | "network_failure";

export class CloudBackendFetchTransportError extends Error {
  readonly name = "CloudBackendFetchTransportError";

  constructor(
    public readonly code: CloudBackendFetchTransportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Adapts the backend client's HTTP-shaped request contract to one native
 * fetch invocation. Creating the transport does not resolve global fetch or
 * perform network work.
 */
export function createCloudBackendFetchTransport({
  baseUrl,
  fetch: injectedFetch,
  headers: adaptHeaders,
}: CloudBackendFetchTransportOptions): CloudBackendHttpTransport {
  const base = parseBaseUrl(baseUrl);

  return {
    async request(request) {
      const url = routeUrl(base, request.path);
      const snapshot = snapshotInputs(request);
      const join = request.method === "POST" && /^\/v1\/rooms\/[^/]+\/join\/?$/u.test(request.path)
        ? parseJoinRoomBody(request.body)
        : undefined;
      const auth = join && !join.inviteSecret
        ? accountAuthFor(join.access) ?? request.auth
        : request.auth;
      const sensitive = collectSensitiveInputs(auth, snapshot);
      const headers = await requestHeaders(request, sensitive, adaptHeaders);
      addSnapshotQuery(url, snapshot);

      const init: RequestInit = {
        method: request.method,
        headers,
        redirect: "error",
      };
      if (request.method !== "GET" && request.body !== undefined) {
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
        init.body = JSON.stringify(join ? joinWireBody(join) : request.body);
      }

      const nativeRequest = new Request(url, init);
      const fetchImplementation = injectedFetch ?? resolveGlobalFetch();
      let response: Response;
      try {
        response = await fetchImplementation(nativeRequest);
      } catch (error) {
        if (isAbortError(error)) {
          throw transportError("aborted", "Cloud backend request was aborted.");
        }
        throw transportError("network_failure", "Cloud backend network request failed.");
      }

      let responseText: string;
      try {
        responseText = await response.text();
      } catch (error) {
        if (isAbortError(error)) {
          throw transportError("aborted", "Cloud backend request was aborted.");
        }
        throw transportError("network_failure", "Cloud backend response could not be read.");
      }
      let body: unknown;
      try {
        body = JSON.parse(responseText);
      } catch {
        throw transportError("invalid_json", "Cloud backend response was not valid JSON.");
      }
      return { status: response.status, body };
    },
  };
}

function parseBaseUrl(value: string) {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    throw transportError("invalid_base_url", "Cloud backend base URL is invalid.");
  }
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username.length > 0 ||
    base.password.length > 0 ||
    base.search.length > 0 ||
    base.hash.length > 0
  ) {
    throw transportError("invalid_base_url", "Cloud backend base URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  return base;
}

function routeUrl(base: URL, path: string) {
  validateRoute(path);
  const url = new URL(base.toString());
  const basePath = url.pathname.replace(/\/$/u, "");
  url.pathname = `${basePath}${path}`;
  return url;
}

function validateRoute(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw transportError("invalid_route", "Cloud backend route must be a safe relative path.");
  }
  for (const segment of path.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw transportError("invalid_route", "Cloud backend route contains invalid encoding.");
    }
    if (decoded === "." || decoded === "..") {
      throw transportError("invalid_route", "Cloud backend route cannot traverse the configured base path.");
    }
  }
}

function snapshotInputs(request: CloudBackendRequest): Partial<CloudBackendGetSnapshotBody> | undefined {
  if (request.method !== "GET" || request.body === undefined) {
    return undefined;
  }
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    throw transportError("invalid_route", "Cloud backend GET adapter received an invalid snapshot request.");
  }
  return request.body as Partial<CloudBackendGetSnapshotBody>;
}

function collectSensitiveInputs(
  auth: CloudAccountAuth | undefined,
  snapshot: Partial<CloudBackendGetSnapshotBody> | undefined,
): CloudBackendFetchSensitiveInputs {
  const access = snapshot?.access;
  return compactSensitive({
    accountAuth: accountAuthFor(access) ?? auth,
    inviteSecret: access?.kind === "invite" ? access.inviteSecret : undefined,
    ownerSecret:
      snapshot?.ownerSecret ?? (access?.kind === "anonymous" ? access.ownerSecret : undefined),
    password: snapshot?.password,
  });
}

function accountAuthFor(access: CloudAccessContext | undefined) {
  if (access?.kind === "account") {
    return access;
  }
  return access?.kind === "invite" ? access.auth : undefined;
}

function joinWireBody(body: CloudBackendJoinRoomBody) {
  const access = body.access;
  // The HTTP boundary resolves these markers from the credential. Account
  // identifiers select that credential locally and never become wire proof.
  if (access?.kind === "account") {
    return { ...body, access: { kind: "account" } };
  }
  if (access?.kind === "invite" && access.auth) {
    return { ...body, access: { ...access, auth: { kind: "account" } } };
  }
  return body;
}

function compactSensitive(input: CloudBackendFetchSensitiveInputs) {
  return Object.fromEntries(
    Object.entries(input).filter((entry) => entry[1] !== undefined),
  ) as CloudBackendFetchSensitiveInputs;
}

async function requestHeaders(
  request: CloudBackendRequest,
  sensitive: CloudBackendFetchSensitiveInputs,
  adapter: CloudBackendFetchHeaderAdapter | undefined,
) {
  let headers: Headers;
  try {
    headers = new Headers(adapter ? await adapter({ method: request.method, path: request.path, sensitive }) : undefined);
  } catch {
    throw transportError("header_adapter_failed", "Cloud backend request header adapter failed.");
  }

  const required = requiredHeaderNames(sensitive);
  if (required.some((name) => !headers.get(name)?.trim())) {
    throw transportError(
      "missing_header_mapping",
      "Cloud backend request requires a credential or sensitive header mapping.",
    );
  }
  return headers;
}

function requiredHeaderNames(sensitive: CloudBackendFetchSensitiveInputs) {
  const names: string[] = [];
  if (sensitive.accountAuth !== undefined) names.push(cloudBackendFetchHeaderNames.accountCredential);
  if (sensitive.inviteSecret !== undefined) names.push(cloudBackendFetchHeaderNames.inviteCapability);
  if (sensitive.ownerSecret !== undefined) names.push(cloudBackendFetchHeaderNames.ownerCapability);
  if (sensitive.password !== undefined) names.push(cloudBackendFetchHeaderNames.roomPassword);
  return names;
}

function addSnapshotQuery(url: URL, snapshot: Partial<CloudBackendGetSnapshotBody> | undefined) {
  if (!snapshot) return;
  const access = snapshot.access;
  if (access) {
    url.searchParams.set("access", access.kind);
  }
  const guestId =
    snapshot.guestId ??
    (access?.kind === "anonymous" || access?.kind === "invite" ? access.guestId : undefined);
  if (guestId !== undefined) {
    url.searchParams.set("guestId", guestId);
  }
}

function resolveGlobalFetch(): CloudBackendFetch {
  if (typeof globalThis.fetch !== "function") {
    throw transportError("missing_fetch", "Cloud backend fetch is unavailable; inject a compatible fetch implementation.");
  }
  return globalThis.fetch.bind(globalThis);
}

function isAbortError(error: unknown) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}

function transportError(code: CloudBackendFetchTransportErrorCode, message: string) {
  return new CloudBackendFetchTransportError(code, message);
}
