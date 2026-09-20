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
  if (state.activeId === id || !state.entries.some((entry) => entry.id === id)) {
    return state;
  }

  return {
    entries: [...state.entries],
    activeId: id,
  };
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
    activeId: entries[index]?.id ?? entries[index - 1]?.id ?? null,
  };
}
