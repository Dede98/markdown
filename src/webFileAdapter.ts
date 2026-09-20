import {
  DEFAULT_NEW_FILE_NAME,
  makeEmptyFile,
  type FileAdapter,
  type FileHandle,
  type LocalFile,
  type SaveResult,
} from "./fileAdapter.ts";
import type {
  BrowserReopenStatus,
  PersistedFileReference,
  SessionFileAdapter,
} from "./sessionPersistence.ts";

// Minimal FSA shape so we don't need DOM lib types beyond what we use.
type FileSystemWritableFileStream = {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
};

type FileSystemFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
  queryPermission?: (descriptor?: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

type FilePickerOptions = {
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  suggestedName?: string;
};

type FSAWindow = Window & {
  showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
};

const MARKDOWN_TYPES = [
  {
    description: "Markdown",
    accept: {
      "text/markdown": [".md", ".markdown", ".mdx", ".mdown", ".txt"],
    },
  },
];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function fsaWindow(): FSAWindow | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window as FSAWindow;
}

function hasFsa(): boolean {
  const win = fsaWindow();
  return Boolean(win?.showOpenFilePicker && win.showSaveFilePicker);
}

async function openWithFsa(): Promise<LocalFile | null> {
  const win = fsaWindow();

  if (!win?.showOpenFilePicker) {
    return null;
  }

  try {
    const [handle] = await win.showOpenFilePicker({
      types: MARKDOWN_TYPES,
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const file = await handle.getFile();
    const contents = await file.text();

    return {
      name: handle.name,
      contents,
      handle,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    throw error;
  }
}

async function openWithInputFallback(): Promise<LocalFile | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.mdx,.mdown,.txt,text/markdown,text/plain";
    input.style.display = "none";

    let settled = false;
    const finish = (value: LocalFile | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", async () => {
      const file = input.files?.[0];

      if (!file) {
        finish(null);
        return;
      }

      try {
        const contents = await file.text();
        finish({ name: file.name, contents, handle: null });
      } catch (error) {
        input.remove();
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });

    // Some browsers do not fire `change` when the dialog is dismissed.
    // We can't detect cancel reliably here; the picker stays pending and
    // the promise will only resolve once a file is chosen or the page navigates.
    document.body.appendChild(input);
    input.click();
  });
}

async function writeWithFsa(handle: FileSystemFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    await writable.close();
  }
}

async function saveAsWithFsa(name: string, contents: string): Promise<SaveResult | null> {
  const win = fsaWindow();

  if (!win?.showSaveFilePicker) {
    return null;
  }

  try {
    const handle = await win.showSaveFilePicker({
      types: MARKDOWN_TYPES,
      suggestedName: name || DEFAULT_NEW_FILE_NAME,
    });
    await writeWithFsa(handle, contents);

    return { name: handle.name, handle };
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    throw error;
  }
}

function downloadFallback(name: string, contents: string): SaveResult | null {
  if (typeof document === "undefined") {
    return null;
  }

  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name || DEFAULT_NEW_FILE_NAME;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Defer revoke so Safari has a chance to read the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { name: anchor.download, handle: null };
}

function isFsaHandle(handle: FileHandle): handle is FileSystemFileHandle {
  if (!handle || typeof handle !== "object") {
    return false;
  }
  const candidate = handle as { createWritable?: unknown; kind?: unknown };
  return typeof candidate.createWritable === "function" && candidate.kind === "file";
}

export const webFileAdapter: FileAdapter = {
  canSaveInPlace() {
    return hasFsa();
  },

  newFile() {
    return makeEmptyFile();
  },

  async openFile() {
    if (hasFsa()) {
      return openWithFsa();
    }
    return openWithInputFallback();
  },

  async saveFile(handle, contents, name) {
    if (isFsaHandle(handle)) {
      await writeWithFsa(handle, contents);
      return { name: handle.name, handle };
    }

    // Adapter cannot save in place (no FSA handle). Fall through to save-as.
    const result = await this.saveFileAs(name, contents);

    if (!result) {
      throw new Error("Save cancelled");
    }

    return result;
  },

  async saveFileAs(name, contents) {
    if (hasFsa()) {
      return saveAsWithFsa(name, contents);
    }
    return downloadFallback(name, contents);
  },
};

export type BrowserCapabilityStore = {
  get(id: string): Promise<FileSystemFileHandle | undefined>;
  put(id: string, handle: FileSystemFileHandle): Promise<void>;
};

const CAPABILITY_DATABASE = "markdown-local-capabilities";
const CAPABILITY_STORE = "file-handles";

function openCapabilityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(CAPABILITY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CAPABILITY_STORE)) {
        request.result.createObjectStore(CAPABILITY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open capability storage"));
  });
}

export const indexedDbBrowserCapabilityStore: BrowserCapabilityStore = {
  async get(id) {
    const database = await openCapabilityDatabase();
    try {
      return await new Promise<FileSystemFileHandle | undefined>((resolve, reject) => {
        const request = database.transaction(CAPABILITY_STORE, "readonly").objectStore(CAPABILITY_STORE).get(id);
        request.onsuccess = () => resolve(request.result as FileSystemFileHandle | undefined);
        request.onerror = () => reject(request.error ?? new Error("Could not read file capability"));
      });
    } finally {
      database.close();
    }
  },
  async put(id, handle) {
    const database = await openCapabilityDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(CAPABILITY_STORE, "readwrite");
        transaction.objectStore(CAPABILITY_STORE).put(handle, id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not store file capability"));
        transaction.onabort = () => reject(transaction.error ?? new Error("File capability write was aborted"));
      });
    } finally {
      database.close();
    }
  },
};

async function browserPermissionStatus(
  handle: FileSystemFileHandle,
): Promise<Exclude<BrowserReopenStatus, "upload-only">> {
  if (!handle.queryPermission) return "permission-needed";
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted"
    ? "granted"
    : "permission-needed";
}

function newCapabilityId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * IndexedDB stores the structured-cloneable File System Access handle. The
 * persisted JSON receives only its random capability id and permission state.
 */
export function createWebSessionFileAdapter(
  capabilities: BrowserCapabilityStore = indexedDbBrowserCapabilityStore,
): SessionFileAdapter {
  return {
    async createReference(handle, untitled): Promise<PersistedFileReference> {
      if (untitled) return { kind: "untitled" };
      if (!isFsaHandle(handle)) return { kind: "browser-upload-only", status: "upload-only" };
      const capabilityId = newCapabilityId();
      await capabilities.put(capabilityId, handle);
      return {
        kind: "browser-capability",
        capabilityId,
        status: await browserPermissionStatus(handle),
      };
    },

    async reconnect(reference, options) {
      if (reference.kind === "browser-upload-only") return { status: "upload-required" };
      if (reference.kind !== "browser-capability") return { status: "unsupported" };
      let handle: FileSystemFileHandle | undefined;
      try {
        handle = await capabilities.get(reference.capabilityId);
      } catch (error) {
        return { status: "unavailable", error };
      }
      if (!handle) return { status: "unavailable" };
      try {
        if (!handle.queryPermission) return { status: "permission-needed" };
        let permission = await handle.queryPermission({ mode: "readwrite" });
        if (permission === "prompt" && options?.requestPermission && handle.requestPermission) {
          permission = await handle.requestPermission({ mode: "readwrite" });
        }
        if (permission === "prompt") return { status: "permission-needed" };
        if (permission === "denied") return { status: "denied" };
        const file = await handle.getFile();
        return {
          status: "reopened",
          file: { name: handle.name, contents: await file.text(), handle },
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          return { status: "missing", error };
        }
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
          return { status: "denied", error };
        }
        return { status: "unavailable", error };
      }
    },
  };
}

export const webSessionFileAdapter = createWebSessionFileAdapter();
