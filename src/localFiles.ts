import type { FileHandle, LocalFile, SaveResult } from "./fileAdapter";
import type { PersistedFileReference } from "./sessionPersistence";

export type LocalFileRecoveryStatus =
  | "ready"
  | "conflict"
  | "missing"
  | "permission-needed"
  | "upload-required"
  | "denied"
  | "unavailable";

export type LocalFileEntry = {
  id: string;
  name: string;
  contents: string;
  savedContents: string;
  handle: FileHandle | null;
  reopen: PersistedFileReference;
  recoveryStatus: LocalFileRecoveryStatus;
  externalContents?: string;
  /** A closed grouped entry remains remembered and can reuse this buffer. */
  open?: boolean;
};

export type LocalFilesState = {
  entries: LocalFileEntry[];
  activeId: string | null;
};

function createEntry(
  file: LocalFile,
  id: string,
  reopen: PersistedFileReference = { kind: "untitled" },
): LocalFileEntry {
  return {
    id,
    name: file.name,
    contents: file.contents,
    savedContents: file.contents,
    handle: file.handle,
    reopen,
    recoveryStatus: "ready",
  };
}

export function createLocalFiles(
  file: LocalFile,
  id: string,
  reopen?: PersistedFileReference,
): LocalFilesState {
  return {
    entries: [createEntry(file, id, reopen)],
    activeId: id,
  };
}

export function addLocalFile(
  state: LocalFilesState,
  file: LocalFile,
  id: string,
  reopen?: PersistedFileReference,
  activate = true,
): LocalFilesState {
  if (state.entries.some((entry) => entry.id === id)) {
    throw new Error(`Local file id already exists: ${id}`);
  }

  return {
    entries: [...state.entries, createEntry(file, id, reopen)],
    activeId: activate ? id : state.activeId,
  };
}

export function selectLocalFile(state: LocalFilesState, id: string): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return state;
  }

  const entries = [...state.entries];
  if (entries[index].open === false) entries[index] = { ...entries[index], open: true };
  if (state.activeId === id && entries[index] === state.entries[index]) return state;

  return {
    entries,
    activeId: id,
  };
}

export function closeLocalFile(state: LocalFilesState, id: string): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1 || state.entries[index].open === false) return state;
  const entries = [...state.entries];
  entries[index] = { ...entries[index], open: false };
  if (state.activeId !== id) return { entries, activeId: state.activeId };
  const next = entries.slice(index + 1).find((entry) => entry.open !== false)
    ?? entries.slice(0, index).reverse().find((entry) => entry.open !== false);
  return { entries, activeId: next?.id ?? null };
}

/** Replace only the physical reference after the user reconnects a file. */
export function reconnectLocalFile(
  state: LocalFilesState,
  id: string,
  file: LocalFile,
  reopen: PersistedFileReference,
): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) return state;
  const entries = [...state.entries];
  entries[index] = {
    ...entries[index],
    name: file.name,
    handle: file.handle,
    reopen,
    recoveryStatus: "ready",
  };
  return { entries, activeId: state.activeId };
}

export function updateLocalFileContents(
  state: LocalFilesState,
  id: string,
  contents: string,
): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1 || state.entries[index].contents === contents) {
    return state;
  }

  const entries = [...state.entries];
  entries[index] = { ...entries[index], contents };

  return { ...state, entries };
}

export function applyLocalFileSave(
  state: LocalFilesState,
  id: string,
  result: SaveResult,
  savedContents: string,
): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return state;
  }

  const current = state.entries[index];
  const entries = [...state.entries];
  entries[index] = {
    ...current,
    name: result.name,
    contents: current.contents === savedContents ? savedContents : current.contents,
    savedContents,
    handle: result.handle,
    recoveryStatus: "ready",
    externalContents: undefined,
  };

  return { ...state, entries };
}

export function updateLocalFileReference(
  state: LocalFilesState,
  id: string,
  reopen: PersistedFileReference,
): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) return state;
  const entries = [...state.entries];
  entries[index] = { ...entries[index], reopen };
  return { ...state, entries };
}

export function updateLocalFileRecovery(
  state: LocalFilesState,
  id: string,
  recoveryStatus: LocalFileRecoveryStatus,
  externalContents?: string,
): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) return state;
  const entries = [...state.entries];
  entries[index] = { ...entries[index], recoveryStatus, externalContents };
  return { ...state, entries };
}

export function removeLocalFile(state: LocalFilesState, id: string): LocalFilesState {
  const index = state.entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return state;
  }

  const entries = state.entries.filter((entry) => entry.id !== id);
  if (state.activeId !== id) {
    return { entries, activeId: state.activeId };
  }

  return {
    entries,
    activeId: entries.slice(index).find((entry) => entry.open !== false)?.id
      ?? entries.slice(0, index).reverse().find((entry) => entry.open !== false)?.id
      ?? null,
  };
}
