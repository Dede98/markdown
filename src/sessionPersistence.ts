import type { FileHandle, LocalFile } from "./fileAdapter.ts";
import {
  deserializeVirtualFolderState,
  type SerializedVirtualFolderStateV1,
} from "./virtualFolders.ts";

export const LOCAL_SESSION_VERSION = 1 as const;

export type BrowserReopenStatus = "granted" | "permission-needed" | "upload-only";

export type PersistedFileReference =
  | { kind: "desktop-path"; path: string }
  | {
      kind: "browser-capability";
      capabilityId: string;
      status: Exclude<BrowserReopenStatus, "upload-only">;
    }
  | { kind: "browser-upload-only"; status: "upload-only" }
  | { kind: "untitled" };

export type PersistedLocalFile = {
  /** Stable session identity; deliberately independent from name/path. */
  id: string;
  displayName: string;
  order: number;
  draft: string;
  savedBaseline: string;
  dirty: boolean;
  untitled: boolean;
  /** False keeps the remembered reference and draft without an open editor. */
  open?: boolean;
  reopen: PersistedFileReference;
};

export type PersistedLocalSessionV1 = {
  version: typeof LOCAL_SESSION_VERSION;
  generation: number;
  /** Identifies the runtime that last committed this generation. */
  writerId?: string;
  activeFileId: string | null;
  /** Optional for snapshots written before sidebar persistence shipped. */
  sidebarVisible?: boolean;
  /** Optional for legacy flat sessions; those migrate to ungrouped on read. */
  virtualFolders?: SerializedVirtualFolderStateV1;
  files: PersistedLocalFile[];
};

export type LocalSessionSnapshot = Omit<PersistedLocalSessionV1, "version" | "generation" | "writerId">;

export type SessionReadResult =
  | { status: "ok"; snapshot: PersistedLocalSessionV1; recoveredFromBackup: boolean }
  | { status: "empty" }
  | { status: "unavailable"; error: unknown; lastUsable?: PersistedLocalSessionV1 }
  | { status: "malformed"; error: unknown; lastUsable?: PersistedLocalSessionV1 }
  | { status: "unsupported-version"; version: number; future: boolean };

export type SessionWriteResult =
  | { status: "written"; generation: number }
  | { status: "stale"; generation: number }
  | { status: "unavailable"; error: unknown }
  | { status: "failed"; error: unknown }
  | { status: "unsupported-version"; version: number; future: boolean };

export type SessionFlushResult =
  | { status: "flushed"; generation: number }
  | Exclude<SessionWriteResult, { status: "written" }>;

/** String storage only. Platform capability objects must never enter this API. */
export type SessionStringStorage = {
  readCurrent(): Promise<string | null>;
  readBackup(): Promise<string | null>;
  writeBackup(value: string): Promise<void>;
  writeCurrent(value: string): Promise<void>;
  /** Serialize a complete read/compare/backup/publish transaction. */
  runExclusive?<T>(operation: () => Promise<T>): Promise<T>;
};

export type ReconnectResult =
  | { status: "reopened"; file: LocalFile }
  | { status: "permission-needed" }
  | { status: "upload-required" }
  | { status: "missing"; error?: unknown }
  | { status: "denied"; error?: unknown }
  | { status: "unavailable"; error?: unknown }
  | { status: "unsupported" };

export type SessionFileAdapter = {
  createReference(handle: FileHandle | null, untitled: boolean): Promise<PersistedFileReference>;
  reconnect(
    reference: PersistedFileReference,
    options?: { requestPermission?: boolean },
  ): Promise<ReconnectResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validReference(value: unknown): value is PersistedFileReference {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "desktop-path") return typeof value.path === "string" && value.path.length > 0;
  if (value.kind === "browser-capability") {
    return (
      typeof value.capabilityId === "string" &&
      value.capabilityId.length > 0 &&
      (value.status === "granted" || value.status === "permission-needed")
    );
  }
  if (value.kind === "browser-upload-only") return value.status === "upload-only";
  return value.kind === "untitled";
}

function validFile(value: unknown): value is PersistedLocalFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.displayName === "string" &&
    Number.isSafeInteger(value.order) &&
    (value.order as number) >= 0 &&
    typeof value.draft === "string" &&
    typeof value.savedBaseline === "string" &&
    typeof value.dirty === "boolean" &&
    value.dirty === (value.draft !== value.savedBaseline) &&
    typeof value.untitled === "boolean" &&
    (value.open === undefined || typeof value.open === "boolean") &&
    validReference(value.reopen) &&
    value.untitled === (value.reopen.kind === "untitled")
  );
}

export function validatePersistedLocalSession(value: unknown): PersistedLocalSessionV1 {
  if (!isRecord(value)) throw new Error("Session snapshot must be an object");
  let validatedVirtualFolders: SerializedVirtualFolderStateV1 | undefined;
  if (value.version !== LOCAL_SESSION_VERSION) {
    throw new Error(`Unsupported session version: ${String(value.version)}`);
  }
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new Error("Session generation must be a non-negative safe integer");
  }
  if (value.writerId !== undefined && (typeof value.writerId !== "string" || value.writerId.length === 0)) {
    throw new Error("Session writer identity is malformed");
  }
  if (value.sidebarVisible !== undefined && typeof value.sidebarVisible !== "boolean") {
    throw new Error("Session sidebar visibility is malformed");
  }
  if (value.virtualFolders !== undefined) {
    const folders = value.virtualFolders;
    if (
      !isRecord(folders) ||
      folders.schema !== "markdown-virtual-folders" ||
      folders.version !== 1 ||
      !Array.isArray(folders.folders) ||
      !Array.isArray(folders.files) ||
      !Array.isArray(folders.memberships)
    ) {
      throw new Error("Session virtual folders are malformed");
    }
    const decoded = deserializeVirtualFolderState(folders);
    if (decoded.issues.length > 0) {
      throw new Error("Session virtual folders are malformed");
    }
    validatedVirtualFolders = folders as SerializedVirtualFolderStateV1;
  }
  if (!Array.isArray(value.files) || !value.files.every(validFile)) {
    throw new Error("Session files are malformed");
  }
  const ids = new Set(value.files.map((file) => file.id));
  const orders = new Set(value.files.map((file) => file.order));
  if (ids.size !== value.files.length || orders.size !== value.files.length) {
    throw new Error("Session file identities and ordering must be unique");
  }
  if (validatedVirtualFolders) {
    const folderFileIds = new Set(validatedVirtualFolders.files.map((file) => file.id));
    if (folderFileIds.size !== ids.size || [...ids].some((id) => !folderFileIds.has(id))) {
      throw new Error("Session virtual-folder references must match persisted files");
    }
  }
  if (
    value.activeFileId !== null &&
    (typeof value.activeFileId !== "string" || !ids.has(value.activeFileId))
  ) {
    throw new Error("Active file must identify a persisted file");
  }
  if (value.files.length === 0 && value.activeFileId !== null) {
    throw new Error("An empty session cannot have an active file");
  }
  return value as PersistedLocalSessionV1;
}

type Parsed =
  | { status: "ok"; snapshot: PersistedLocalSessionV1 }
  | { status: "empty" }
  | { status: "malformed"; error: unknown }
  | { status: "unsupported-version"; version: number; future: boolean };

function parseStored(value: string | null): Parsed {
  if (value === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    return { status: "malformed", error };
  }
  if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version !== LOCAL_SESSION_VERSION) {
    return {
      status: "unsupported-version",
      version: parsed.version,
      future: parsed.version > LOCAL_SESSION_VERSION,
    };
  }
  try {
    return { status: "ok", snapshot: validatePersistedLocalSession(parsed) };
  } catch (error) {
    return { status: "malformed", error };
  }
}

const storageWriteTails = new WeakMap<SessionStringStorage, Promise<void>>();

async function runStorageTransaction<T>(
  storage: SessionStringStorage,
  operation: () => Promise<T>,
): Promise<T> {
  if (storage.runExclusive) return storage.runExclusive(operation);

  // Non-browser adapters commonly share one storage object in a process. Keep
  // those instances atomic too; browser localStorage additionally supplies an
  // origin-wide Web Lock below for separate windows/workers.
  const previous = storageWriteTails.get(storage) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => { release = resolve; });
  storageWriteTails.set(storage, previous.then(() => turn));
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function createLocalSessionPersistence(storage: SessionStringStorage) {
  const writerId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `writer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let lastUsable: PersistedLocalSessionV1 | undefined;
  let nextGeneration = 0;
  let durableGeneration = 0;
  let hasRead = false;
  let writeTail: Promise<SessionWriteResult> = Promise.resolve({ status: "stale", generation: 0 });

  async function read(): Promise<SessionReadResult> {
    hasRead = true;
    let currentRaw: string | null;
    try {
      currentRaw = await storage.readCurrent();
    } catch (error) {
      return { status: "unavailable", error, ...(lastUsable ? { lastUsable } : {}) };
    }
    const current = parseStored(currentRaw);
    if (current.status === "ok") {
      lastUsable = current.snapshot;
      nextGeneration = Math.max(nextGeneration, current.snapshot.generation);
      durableGeneration = Math.max(durableGeneration, current.snapshot.generation);
      return { status: "ok", snapshot: current.snapshot, recoveredFromBackup: false };
    }
    if (current.status === "unsupported-version") return current;
    if (current.status === "empty") return current;

    try {
      const backup = parseStored(await storage.readBackup());
      if (backup.status === "ok") {
        lastUsable = backup.snapshot;
        nextGeneration = Math.max(nextGeneration, backup.snapshot.generation);
        durableGeneration = Math.max(durableGeneration, backup.snapshot.generation);
        return { status: "ok", snapshot: backup.snapshot, recoveredFromBackup: true };
      }
    } catch {
      // The primary parse error is the useful failure to report.
    }
    return { status: "malformed", error: current.error, ...(lastUsable ? { lastUsable } : {}) };
  }

  function write(snapshot: LocalSessionSnapshot): Promise<SessionWriteResult> {
    const requestedGeneration = ++nextGeneration;
    let candidate: PersistedLocalSessionV1 = {
      version: LOCAL_SESSION_VERSION,
      generation: requestedGeneration,
      writerId,
      activeFileId: snapshot.activeFileId,
      ...(snapshot.sidebarVisible === undefined ? {} : { sidebarVisible: snapshot.sidebarVisible }),
      ...(snapshot.virtualFolders === undefined
        ? {}
        : { virtualFolders: structuredClone(snapshot.virtualFolders) }),
      // Capture an immutable point-in-time value before entering the async
      // queue. A later editor update must not alter an already queued write.
      files: snapshot.files.map((file) => ({
        ...file,
        reopen: { ...file.reopen },
      })),
    };
    try {
      validatePersistedLocalSession(candidate);
    } catch (error) {
      return Promise.resolve({ status: "failed", error });
    }

    const commit = async (): Promise<SessionWriteResult> => {
      let oldRaw: string | null;
      try {
        oldRaw = await storage.readCurrent();
      } catch (error) {
        return { status: "unavailable", error };
      }
      const old = parseStored(oldRaw);
      if (old.status === "unsupported-version") return old;
      const storedGeneration = old.status === "ok" ? old.snapshot.generation : 0;
      if (
        hasRead &&
        old.status === "ok" &&
        old.snapshot.writerId !== writerId &&
        storedGeneration > durableGeneration
      ) {
        return { status: "stale", generation: storedGeneration };
      }
      const generation = Math.max(requestedGeneration, durableGeneration + 1, storedGeneration + 1);
      candidate = { ...candidate, generation };
      nextGeneration = Math.max(nextGeneration, generation);
      try {
        // Keep only a validated current value as recovery material. A corrupt
        // interrupted value must not replace the last usable backup.
        if (old.status === "ok") await storage.writeBackup(oldRaw as string);
        await storage.writeCurrent(JSON.stringify(candidate));
        durableGeneration = generation;
        lastUsable = candidate;
        return { status: "written", generation };
      } catch (error) {
        return { status: "failed", error };
      }
    };
    const run = async (): Promise<SessionWriteResult> => {
      try {
        return await runStorageTransaction(storage, commit);
      } catch (error) {
        // Publishing without the adapter's required cross-context lock would
        // risk losing a draft, so lock unavailability is a safe hard failure.
        return { status: "unavailable", error };
      }
    };
    const queued = writeTail.then(run, run);
    writeTail = queued;
    return queued;
  }

  async function flush(): Promise<SessionFlushResult> {
    const result = await writeTail;
    if (result.status === "written") {
      return { status: "flushed", generation: durableGeneration };
    }
    return result;
  }

  return { read, write, flush };
}

export function createLocalStorageSessionStorage(
  currentKey = "markdown.localSession.v1",
  backupKey = "markdown.localSession.v1.backup",
): SessionStringStorage {
  const getStorage = () => {
    if (typeof localStorage === "undefined") throw new Error("Local storage is unavailable");
    return localStorage;
  };
  return {
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      if (typeof navigator === "undefined" || !navigator.locks?.request) {
        throw new Error("Origin-wide recovery locking is unavailable");
      }
      return navigator.locks.request(`markdown-local-session:${currentKey}`, { mode: "exclusive" }, operation);
    },
    async readCurrent() { return getStorage().getItem(currentKey); },
    async readBackup() { return getStorage().getItem(backupKey); },
    async writeBackup(value) { getStorage().setItem(backupKey, value); },
    async writeCurrent(value) { getStorage().setItem(currentKey, value); },
  };
}
