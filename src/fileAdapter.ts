// Local-only file I/O adapter. Cloud concepts must not leak in here.
// "file", "handle", "save" only. No "document", "doc id", "sync".

export type FileHandle = unknown;

type ComparableFileHandle = {
  isSameEntry(other: unknown): Promise<boolean>;
};

export type LocalFile = {
  name: string;
  contents: string;
  handle: FileHandle | null;
};

export type SaveResult = {
  name: string;
  handle: FileHandle | null;
};

export type FileAdapter = {
  /**
   * Whether the adapter has full read/write support for an existing file
   * (i.e. can save back to a previously opened file without prompting).
   * Adapters that only support download/upload return false.
   */
  canSaveInPlace(): boolean;
  /**
   * Build a fresh empty in-memory file. Does not touch the file system.
   */
  newFile(): LocalFile;
  /**
   * Prompt the user to open a `.md` file. Returns null if the user cancels.
   */
  openFile(): Promise<LocalFile | null>;
  /**
   * Save `contents` back to the existing handle, if the adapter supports it.
   * Throws if the handle cannot be written (use `saveFileAs` instead).
   */
  saveFile(handle: FileHandle, contents: string, name: string): Promise<SaveResult>;
  /**
   * Prompt the user for a target file. Returns null if the user cancels.
   */
  saveFileAs(name: string, contents: string): Promise<SaveResult | null>;
};

export const DEFAULT_NEW_FILE_NAME = "untitled.md";

export const DEFAULT_NEW_FILE_CONTENTS = "";

export function makeEmptyFile(name = DEFAULT_NEW_FILE_NAME): LocalFile {
  return {
    name,
    contents: DEFAULT_NEW_FILE_CONTENTS,
    handle: null,
  };
}

function isComparableFileHandle(handle: FileHandle): handle is ComparableFileHandle {
  return Boolean(
    handle &&
    typeof handle === "object" &&
    typeof (handle as { isSameEntry?: unknown }).isSameEntry === "function",
  );
}

/**
 * Compare opaque adapter handles without assuming object identity. Browser
 * pickers may return a fresh FileSystemFileHandle object for an already-known
 * file; `isSameEntry` is the platform identity check for that case. Native
 * adapters use the canonical absolute path string as their opaque handle.
 */
export async function fileHandlesReferToSameEntry(
  left: FileHandle | null,
  right: FileHandle | null,
): Promise<boolean> {
  if (left === null || right === null) return false;
  if (left === right) return true;
  if (typeof left === "string" && typeof right === "string") return left === right;

  if (isComparableFileHandle(left)) {
    try {
      if (await left.isSameEntry(right)) return true;
    } catch {
      // The other handle may still be able to compare a revoked capability.
    }
  }
  if (isComparableFileHandle(right)) {
    try {
      if (await right.isSameEntry(left)) return true;
    } catch {
      // A revoked or incompatible capability is not evidence of identity.
    }
  }
  return false;
}
