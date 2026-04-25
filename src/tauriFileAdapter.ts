// Tauri shell adapter. Local-only file I/O via tauri-plugin-fs and
// tauri-plugin-dialog. Cloud concepts must not leak in here.
//
// FileHandle convention in Tauri: an opaque string carrying the absolute
// path on disk. The web adapter uses opaque FileSystemFileHandle objects;
// the rest of the app must never look inside either shape.

import {
  DEFAULT_NEW_FILE_NAME,
  makeEmptyFile,
  type FileAdapter,
  type FileHandle,
  type LocalFile,
  type SaveResult,
} from "./fileAdapter";

const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdx", "mdown", "txt"],
  },
];

type DialogModule = typeof import("@tauri-apps/plugin-dialog");
type FsModule = typeof import("@tauri-apps/plugin-fs");

// Lazy module loaders so importing this file in a non-Tauri build (e.g. the
// browser bundle for tests) does not crash if the bridge globals are absent.
// The plugin packages are safe to import in the browser; they only fail when
// their commands are invoked without a Tauri runtime present.
let dialogModule: Promise<DialogModule> | null = null;
let fsModule: Promise<FsModule> | null = null;

function loadDialog(): Promise<DialogModule> {
  if (!dialogModule) {
    dialogModule = import("@tauri-apps/plugin-dialog");
  }
  return dialogModule;
}

function loadFs(): Promise<FsModule> {
  if (!fsModule) {
    fsModule = import("@tauri-apps/plugin-fs");
  }
  return fsModule;
}

function basename(path: string): string {
  const trimmed = path.replace(/\\/g, "/");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) {
    return trimmed || DEFAULT_NEW_FILE_NAME;
  }
  return trimmed.slice(idx + 1) || DEFAULT_NEW_FILE_NAME;
}

function isPathHandle(handle: FileHandle): handle is string {
  return typeof handle === "string" && handle.length > 0;
}

function coercePathLike(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  // Older/newer Tauri 2 returns can be `{ path: string }` for opened files.
  // Coerce defensively so a typing change does not silently turn a real
  // selection into a "user cancelled" outcome.
  if (value && typeof value === "object" && "path" in value) {
    const candidate = (value as { path?: unknown }).path;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
  }
  return null;
}

async function pickOpenPath(): Promise<string | null> {
  const { open } = await loadDialog();
  const selected = await open({
    multiple: false,
    directory: false,
    filters: MARKDOWN_FILTERS,
    title: "Open Markdown file",
  });

  if (selected === null) {
    return null;
  }
  if (Array.isArray(selected)) {
    return coercePathLike(selected[0]);
  }
  return coercePathLike(selected);
}

async function pickSavePath(suggestedName: string): Promise<string | null> {
  const { save } = await loadDialog();
  const selected = await save({
    defaultPath: suggestedName || DEFAULT_NEW_FILE_NAME,
    filters: MARKDOWN_FILTERS,
    title: "Save Markdown file",
  });

  if (typeof selected !== "string" || selected.length === 0) {
    return null;
  }
  return selected;
}

async function readPath(path: string): Promise<string> {
  const { readTextFile } = await loadFs();
  return readTextFile(path);
}

async function writePath(path: string, contents: string): Promise<void> {
  const { writeTextFile } = await loadFs();
  await writeTextFile(path, contents);
}

export const tauriFileAdapter: FileAdapter = {
  canSaveInPlace() {
    return true;
  },

  newFile() {
    return makeEmptyFile();
  },

  async openFile(): Promise<LocalFile | null> {
    const path = await pickOpenPath();
    if (!path) {
      return null;
    }
    const contents = await readPath(path);
    return {
      name: basename(path),
      contents,
      handle: path,
    };
  },

  async saveFile(handle, contents, name): Promise<SaveResult> {
    if (!isPathHandle(handle)) {
      // Lost or never-set path; degrade to save-as so the user can pick a target.
      const result = await this.saveFileAs(name, contents);
      if (!result) {
        throw new Error("Save cancelled");
      }
      return result;
    }
    await writePath(handle, contents);
    return { name: basename(handle), handle };
  },

  async saveFileAs(name, contents): Promise<SaveResult | null> {
    const path = await pickSavePath(name);
    if (!path) {
      return null;
    }
    await writePath(path, contents);
    return { name: basename(path), handle: path };
  },
};

// Tauri-only entry: load a file by absolute path. Used when the OS hands the
// app a path through Finder double-click, "Open With", drag-onto-dock, or a
// drop into the webview. The web adapter has no equivalent because browsers
// never receive a real filesystem path from those gestures.
//
// Read errors propagate: scope violations (path outside the fs:scope allow
// list), missing files, and permission denials must reach the caller so the
// UI can surface a real reason instead of pretending nothing happened.
export async function openMarkdownFromPath(path: string): Promise<LocalFile | null> {
  if (!path) {
    return null;
  }
  const contents = await readPath(path);
  return { name: basename(path), contents, handle: path };
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx", "mdown"]);

// Path filter used by the drag-drop and file-open handlers. Accepts the same
// extensions the picker shows so a dropped file is opened iff the picker would
// have offered it.
export function isMarkdownPath(path: string): boolean {
  const trimmed = path.replace(/\\/g, "/");
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) {
    return false;
  }
  return MARKDOWN_EXTENSIONS.has(trimmed.slice(dot + 1).toLowerCase());
}
