/** A stable identity. File names are deliberately not identities. */
export type FileId = string & { readonly __fileId: unique symbol };
export type FolderId = string & { readonly __folderId: unique symbol };
export type EditingSessionId = string & { readonly __editingSessionId: unique symbol };

export type FileReference = {
  id: FileId;
  displayName: string;
  /** Global display position. Filtering into a folder never changes it. */
  order: number;
};

export type VirtualFolder = {
  id: FolderId;
  name: string;
  order: number;
  collapsed: boolean;
};

export type EditingSession = {
  id: EditingSessionId;
  fileId: FileId;
  dirty: boolean;
};

export type VirtualFolderState = {
  folders: readonly VirtualFolder[];
  files: readonly FileReference[];
  /** A null value is the explicit ungrouped membership. */
  memberships: Readonly<Record<string, FolderId | null>>;
  /** Runtime-only: serialization intentionally omits this collection. */
  sessions: readonly EditingSession[];
};

export type ModelErrorCode =
  | "invalid-id"
  | "invalid-name"
  | "duplicate-folder-name"
  | "duplicate-folder-id"
  | "duplicate-file-id"
  | "duplicate-session-id"
  | "unknown-folder"
  | "unknown-file"
  | "unknown-session";

export type ModelError = { code: ModelErrorCode; message: string };
export type TransitionResult =
  | { ok: true; state: VirtualFolderState }
  | { ok: false; state: VirtualFolderState; error: ModelError };

export const VIRTUAL_FOLDER_SCHEMA = "markdown-virtual-folders" as const;
export const VIRTUAL_FOLDER_VERSION = 1 as const;

export type SerializedVirtualFolderStateV1 = {
  schema: typeof VIRTUAL_FOLDER_SCHEMA;
  version: typeof VIRTUAL_FOLDER_VERSION;
  folders: Array<{ id: string; name: string; order: number; collapsed: boolean }>;
  files: Array<{ id: string; displayName: string; order: number }>;
  memberships: Array<{ fileId: string; folderId: string | null }>;
};

export type ValidationIssue = {
  code:
    | "invalid-root"
    | "unsupported-schema"
    | "unsupported-version"
    | "invalid-folder"
    | "invalid-file"
    | "duplicate-folder"
    | "duplicate-file"
    | "invalid-order"
    | "invalid-membership"
    | "duplicate-membership"
    | "dangling-file"
    | "dangling-folder"
    | "invalid-legacy-entry";
  path: string;
  message: string;
};

export type DecodeResult = { state: VirtualFolderState; issues: ValidationIssue[] };

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFolderName(value: string): string {
  return value.trim();
}

function folderNameKey(value: string): string {
  return normalizeFolderName(value).toLocaleLowerCase("en-US");
}

function byOrderThenId<T extends { order: number; id: string }>(left: T, right: T): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function canonicalize<T extends { order: number; id: string }>(values: readonly T[]): T[] {
  return [...values]
    .sort(byOrderThenId)
    .map((value, order) => ({ ...value, order }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(state: VirtualFolderState, code: ModelErrorCode, message: string): TransitionResult {
  return { ok: false, state, error: { code, message } };
}

function success(state: VirtualFolderState): TransitionResult {
  return { ok: true, state };
}

export function fileId(value: string): FileId {
  if (!validId(value)) throw new Error("File id must be a non-empty string");
  return value as FileId;
}

export function folderId(value: string): FolderId {
  if (!validId(value)) throw new Error("Folder id must be a non-empty string");
  return value as FolderId;
}

export function editingSessionId(value: string): EditingSessionId {
  if (!validId(value)) throw new Error("Editing session id must be a non-empty string");
  return value as EditingSessionId;
}

export function createVirtualFolderState(): VirtualFolderState {
  return { folders: [], files: [], memberships: {}, sessions: [] };
}

export function createFolder(
  state: VirtualFolderState,
  input: { id: FolderId; name: string; collapsed?: boolean },
): TransitionResult {
  if (!validId(input.id)) return failure(state, "invalid-id", "Folder id must be non-empty");
  const name = normalizeFolderName(input.name);
  if (!name) return failure(state, "invalid-name", "Folder name must not be blank");
  if (state.folders.some((folder) => folder.id === input.id)) {
    return failure(state, "duplicate-folder-id", `Folder id already exists: ${input.id}`);
  }
  if (state.folders.some((folder) => folderNameKey(folder.name) === folderNameKey(name))) {
    return failure(state, "duplicate-folder-name", `Folder name already exists: ${name}`);
  }
  return success({
    ...state,
    folders: [
      ...state.folders,
      { id: input.id, name, order: state.folders.length, collapsed: input.collapsed ?? false },
    ],
  });
}

export function renameFolder(
  state: VirtualFolderState,
  id: FolderId,
  nameValue: string,
): TransitionResult {
  const index = state.folders.findIndex((folder) => folder.id === id);
  if (index < 0) return failure(state, "unknown-folder", `Unknown folder: ${id}`);
  const name = normalizeFolderName(nameValue);
  if (!name) return failure(state, "invalid-name", "Folder name must not be blank");
  if (state.folders.some((folder) => folder.id !== id && folderNameKey(folder.name) === folderNameKey(name))) {
    return failure(state, "duplicate-folder-name", `Folder name already exists: ${name}`);
  }
  const folders = [...state.folders];
  folders[index] = { ...folders[index], name };
  return success({ ...state, folders });
}

export function setFolderCollapsed(
  state: VirtualFolderState,
  id: FolderId,
  collapsed: boolean,
): TransitionResult {
  const index = state.folders.findIndex((folder) => folder.id === id);
  if (index < 0) return failure(state, "unknown-folder", `Unknown folder: ${id}`);
  if (state.folders[index].collapsed === collapsed) return success(state);
  const folders = [...state.folders];
  folders[index] = { ...folders[index], collapsed };
  return success({ ...state, folders });
}

export function removeFolder(state: VirtualFolderState, id: FolderId): TransitionResult {
  if (!state.folders.some((folder) => folder.id === id)) {
    return failure(state, "unknown-folder", `Unknown folder: ${id}`);
  }
  const memberships = { ...state.memberships };
  for (const [file, folder] of Object.entries(memberships)) {
    if (folder === id) memberships[file] = null;
  }
  return success({
    ...state,
    folders: canonicalize(state.folders.filter((folder) => folder.id !== id)),
    memberships,
  });
}

export function addFileReference(
  state: VirtualFolderState,
  input: { id: FileId; displayName: string },
): TransitionResult {
  if (!validId(input.id)) return failure(state, "invalid-id", "File id must be non-empty");
  const displayName = input.displayName.trim();
  if (!displayName) return failure(state, "invalid-name", "File display name must not be blank");
  if (state.files.some((file) => file.id === input.id)) {
    return failure(state, "duplicate-file-id", `File id already exists: ${input.id}`);
  }
  return success({
    ...state,
    files: [...state.files, { id: input.id, displayName, order: state.files.length }],
    memberships: { ...state.memberships, [input.id]: null },
  });
}

export function updateFileReference(
  state: VirtualFolderState,
  id: FileId,
  update: { displayName: string },
): TransitionResult {
  const index = state.files.findIndex((file) => file.id === id);
  if (index < 0) return failure(state, "unknown-file", `Unknown file: ${id}`);
  const displayName = update.displayName.trim();
  if (!displayName) return failure(state, "invalid-name", "File display name must not be blank");
  const files = [...state.files];
  files[index] = { ...files[index], displayName };
  return success({ ...state, files });
}

/** Removes only the remembered reference and membership. Sessions are a separate lifecycle. */
export function removeFileReference(state: VirtualFolderState, id: FileId): TransitionResult {
  if (!state.files.some((file) => file.id === id)) {
    return failure(state, "unknown-file", `Unknown file: ${id}`);
  }
  const memberships = { ...state.memberships };
  delete memberships[id];
  return success({
    ...state,
    files: canonicalize(state.files.filter((file) => file.id !== id)),
    memberships,
  });
}

export function assignFile(
  state: VirtualFolderState,
  file: FileId,
  folder: FolderId,
): TransitionResult {
  if (!state.files.some((reference) => reference.id === file)) {
    return failure(state, "unknown-file", `Unknown file: ${file}`);
  }
  if (!state.folders.some((candidate) => candidate.id === folder)) {
    return failure(state, "unknown-folder", `Unknown folder: ${folder}`);
  }
  return success({ ...state, memberships: { ...state.memberships, [file]: folder } });
}

export function unassignFile(state: VirtualFolderState, file: FileId): TransitionResult {
  if (!state.files.some((reference) => reference.id === file)) {
    return failure(state, "unknown-file", `Unknown file: ${file}`);
  }
  return success({ ...state, memberships: { ...state.memberships, [file]: null } });
}

export function openEditingSession(
  state: VirtualFolderState,
  input: { id: EditingSessionId; fileId: FileId; dirty?: boolean },
): TransitionResult {
  if (!state.files.some((file) => file.id === input.fileId)) {
    return failure(state, "unknown-file", `Unknown file: ${input.fileId}`);
  }
  if (state.sessions.some((session) => session.id === input.id)) {
    return failure(state, "duplicate-session-id", `Session id already exists: ${input.id}`);
  }
  return success({
    ...state,
    sessions: [...state.sessions, { id: input.id, fileId: input.fileId, dirty: input.dirty ?? false }],
  });
}

export function closeEditingSession(state: VirtualFolderState, id: EditingSessionId): TransitionResult {
  if (!state.sessions.some((session) => session.id === id)) {
    return failure(state, "unknown-session", `Unknown session: ${id}`);
  }
  return success({ ...state, sessions: state.sessions.filter((session) => session.id !== id) });
}

export function setEditingSessionDirty(
  state: VirtualFolderState,
  id: EditingSessionId,
  dirty: boolean,
): TransitionResult {
  const index = state.sessions.findIndex((session) => session.id === id);
  if (index < 0) return failure(state, "unknown-session", `Unknown session: ${id}`);
  const sessions = [...state.sessions];
  sessions[index] = { ...sessions[index], dirty };
  return success({ ...state, sessions });
}

export function orderedFolders(state: VirtualFolderState): VirtualFolder[] {
  return [...state.folders].sort(byOrderThenId);
}

export function orderedFiles(
  state: VirtualFolderState,
  folder: FolderId | null,
): FileReference[] {
  return state.files
    .filter((file) => (state.memberships[file.id] ?? null) === folder)
    .sort(byOrderThenId);
}

export function serializeVirtualFolderState(state: VirtualFolderState): SerializedVirtualFolderStateV1 {
  const folders = canonicalize(state.folders);
  const files = canonicalize(state.files);
  const knownFolders = new Set(folders.map((folder) => folder.id));
  return {
    schema: VIRTUAL_FOLDER_SCHEMA,
    version: VIRTUAL_FOLDER_VERSION,
    folders: folders.map(({ id, name, order, collapsed }) => ({ id, name, order, collapsed })),
    files: files.map(({ id, displayName, order }) => ({ id, displayName, order })),
    memberships: files.map(({ id }) => {
      const candidate = state.memberships[id];
      return { fileId: id, folderId: candidate && knownFolders.has(candidate) ? candidate : null };
    }),
  };
}

function readOrder(
  value: unknown,
  fallback: number,
  path: string,
  issues: ValidationIssue[],
): number {
  if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
  issues.push({ code: "invalid-order", path, message: "Order must be a non-negative safe integer" });
  return Number.MAX_SAFE_INTEGER - 1 + fallback / 1_000_000;
}

export function deserializeVirtualFolderState(value: unknown): DecodeResult {
  const empty = createVirtualFolderState();
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { state: empty, issues: [{ code: "invalid-root", path: "$", message: "Value must be an object" }] };
  }
  if (value.schema !== VIRTUAL_FOLDER_SCHEMA) {
    return {
      state: empty,
      issues: [{ code: "unsupported-schema", path: "$.schema", message: "Unknown virtual-folder schema" }],
    };
  }
  if (value.version !== VIRTUAL_FOLDER_VERSION) {
    return {
      state: empty,
      issues: [{ code: "unsupported-version", path: "$.version", message: "Unsupported virtual-folder version" }],
    };
  }

  const folders: VirtualFolder[] = [];
  const folderIds = new Set<string>();
  const folderNames = new Set<string>();
  const rawFolders = Array.isArray(value.folders) ? value.folders : [];
  if (!Array.isArray(value.folders)) {
    issues.push({ code: "invalid-folder", path: "$.folders", message: "Folders must be an array" });
  }
  rawFolders.forEach((raw, index) => {
    const path = `$.folders[${index}]`;
    if (!isRecord(raw) || !validId(raw.id) || !validDisplayName(raw.name) || typeof raw.collapsed !== "boolean") {
      issues.push({ code: "invalid-folder", path, message: "Folder record is malformed" });
      return;
    }
    const name = normalizeFolderName(raw.name);
    if (folderIds.has(raw.id) || folderNames.has(folderNameKey(name))) {
      issues.push({ code: "duplicate-folder", path, message: "Folder id or normalized name is duplicated" });
      return;
    }
    folderIds.add(raw.id);
    folderNames.add(folderNameKey(name));
    folders.push({
      id: raw.id as FolderId,
      name,
      collapsed: raw.collapsed,
      order: readOrder(raw.order, index, `${path}.order`, issues),
    });
  });

  const files: FileReference[] = [];
  const fileIds = new Set<string>();
  const rawFiles = Array.isArray(value.files) ? value.files : [];
  if (!Array.isArray(value.files)) {
    issues.push({ code: "invalid-file", path: "$.files", message: "Files must be an array" });
  }
  rawFiles.forEach((raw, index) => {
    const path = `$.files[${index}]`;
    if (!isRecord(raw) || !validId(raw.id) || !validDisplayName(raw.displayName)) {
      issues.push({ code: "invalid-file", path, message: "File reference is malformed" });
      return;
    }
    if (fileIds.has(raw.id)) {
      issues.push({ code: "duplicate-file", path, message: "File id is duplicated" });
      return;
    }
    fileIds.add(raw.id);
    files.push({
      id: raw.id as FileId,
      displayName: raw.displayName.trim(),
      order: readOrder(raw.order, index, `${path}.order`, issues),
    });
  });

  const memberships: Record<string, FolderId | null> = {};
  for (const file of files) memberships[file.id] = null;
  const seenMemberships = new Set<string>();
  const rawMemberships = Array.isArray(value.memberships) ? value.memberships : [];
  if (!Array.isArray(value.memberships)) {
    issues.push({ code: "invalid-membership", path: "$.memberships", message: "Memberships must be an array" });
  }
  rawMemberships.forEach((raw, index) => {
    const path = `$.memberships[${index}]`;
    if (!isRecord(raw) || !validId(raw.fileId) || !(raw.folderId === null || validId(raw.folderId))) {
      issues.push({ code: "invalid-membership", path, message: "Membership record is malformed" });
      return;
    }
    if (seenMemberships.has(raw.fileId)) {
      issues.push({ code: "duplicate-membership", path, message: "Only the first membership for a file is used" });
      return;
    }
    seenMemberships.add(raw.fileId);
    if (!fileIds.has(raw.fileId)) {
      issues.push({ code: "dangling-file", path, message: "Membership references an unknown file" });
      return;
    }
    if (raw.folderId !== null && !folderIds.has(raw.folderId)) {
      issues.push({ code: "dangling-folder", path, message: "Unknown folder; file was placed in ungrouped" });
      return;
    }
    memberships[raw.fileId] = raw.folderId as FolderId | null;
  });

  return {
    state: { folders: canonicalize(folders), files: canonicalize(files), memberships, sessions: [] },
    issues,
  };
}

function stableStringify(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (seen.has(value as object)) return '"[circular]"';
  seen.add(value as object);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  } else {
    result = `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key], seen)}`
    ).join(",")}}`;
  }
  seen.delete(value as object);
  return result;
}

function deterministicHash(value: string): string {
  // Two independent 32-bit FNV-1a passes make accidental migration collisions
  // much less likely without depending on a platform crypto API.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

/**
 * Converts the previous flat array (or its `{ files }` snapshot wrapper).
 * Passing v1 virtual-folder data is idempotent and simply validates it.
 */
export function migrateFlatFileCollection(value: unknown): DecodeResult {
  if (isRecord(value) && value.schema === VIRTUAL_FOLDER_SCHEMA) {
    return deserializeVirtualFolderState(value);
  }
  const rawFiles = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.files)
      ? value.files
      : null;
  if (!rawFiles) {
    return {
      state: createVirtualFolderState(),
      issues: [{ code: "invalid-root", path: "$", message: "Legacy collection must be an array or contain a files array" }],
    };
  }

  const issues: ValidationIssue[] = [];
  const files: FileReference[] = [];
  const memberships: Record<string, null> = {};
  const usedIds = new Set<string>();
  rawFiles.forEach((raw, index) => {
    const path = `$${Array.isArray(value) ? "" : ".files"}[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ code: "invalid-legacy-entry", path, message: "Legacy file must be an object" });
      return;
    }
    const displayNameValue = validDisplayName(raw.displayName)
      ? raw.displayName
      : validDisplayName(raw.name)
        ? raw.name
        : null;
    if (!displayNameValue) {
      issues.push({ code: "invalid-legacy-entry", path, message: "Legacy file has no display name" });
      return;
    }
    const suppliedId = validId(raw.id) ? raw.id : null;
    const baseId = suppliedId ?? `migrated-${deterministicHash(stableStringify(raw))}`;
    let uniqueId = baseId;
    let suffix = 2;
    while (usedIds.has(uniqueId)) uniqueId = `${baseId}~${suffix++}`;
    if (uniqueId !== baseId) {
      issues.push({ code: "duplicate-file", path, message: "Duplicate legacy identity was retained under a deterministic suffix" });
    }
    usedIds.add(uniqueId);
    files.push({ id: uniqueId as FileId, displayName: displayNameValue.trim(), order: files.length });
    memberships[uniqueId] = null;
  });

  return {
    state: { folders: [], files, memberships, sessions: [] },
    issues,
  };
}
