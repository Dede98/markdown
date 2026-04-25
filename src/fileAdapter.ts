// Local-only file I/O adapter. Cloud concepts must not leak in here.
// "file", "handle", "save" only. No "document", "doc id", "sync".

export type FileHandle = unknown;

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
