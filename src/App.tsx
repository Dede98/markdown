import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  Code2,
  FilePlus,
  FileText,
  FolderOpen,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Monitor,
  Moon,
  PanelTopClose,
  PanelTopOpen,
  Quote,
  Save,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyFormat, type ActiveFormat } from "./editorFormat";
import {
  DEFAULT_NEW_FILE_NAME,
  type FileAdapter,
  type FileHandle,
  type LocalFile,
} from "./fileAdapter";
import { insertBlock, insertLink, setHeading, toggleLinePrefix, wrapSelection } from "./markdownCommands";
import { MarkdownEditor } from "./MarkdownEditor";
import { isMarkdownPath, openMarkdownFromPath, tauriFileAdapter } from "./tauriFileAdapter";
import {
  applyTheme,
  describeTheme,
  getStoredTheme,
  nextTheme,
  resolveTheme,
  storeTheme,
  subscribeToSystemTheme,
  type ResolvedTheme,
  type ThemePref,
} from "./theme";
import { webFileAdapter } from "./webFileAdapter";

const initialMarkdown = `# On the Quiet Hour

There is a particular quality to the hour before everyone else wakes. The house is still speaking in the low voice it uses when no one is listening, and the windows have not yet been asked to carry any light.

## Morning light

It arrives diagonally at first, finding the spine of a book on the desk and then, as if it has remembered its manners, filling the whole room evenly. I used to write in the evening; now I wait for this.

> A sentence is a small room you build for a thought to sit quietly in.

Three things I try to keep near when I work:

- a cup of something warm, to mark the hour
- a notebook open to a clean page
- and the small discipline of not checking anything
`;

type FileState = {
  name: string;
  handle: FileHandle | null;
  savedContents: string;
};

type SaveStatus = "idle" | "saving" | "error";

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
};

type AdapterWindow = Window & {
  __markdownFileAdapter?: FileAdapter;
  __markdownFileAdapterOverride?: FileAdapter;
};

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const win = window as TauriRuntimeWindow;
  // Tauri 2 sets `__TAURI_INTERNALS__`; keep `__TAURI__` for forward/back compat
  // and so adapter swap can be forced from a test by stamping the global.
  return Boolean(win.__TAURI_INTERNALS__ ?? win.__TAURI__);
}

function getActiveAdapter(): FileAdapter {
  // Honor the test override only on dev builds. Vite tree-shakes the
  // `import.meta.env.DEV` branch in production, so a malicious page in a
  // shipped build cannot stamp `__markdownFileAdapterOverride` and intercept
  // saves through the editor's normal save path.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const win = window as AdapterWindow;
    if (win.__markdownFileAdapterOverride) {
      return win.__markdownFileAdapterOverride;
    }
  }
  if (isTauriRuntime()) {
    return tauriFileAdapter;
  }
  return webFileAdapter;
}

// Only expose the adapter global on the local Vite dev origin. Mirrors the
// gating used for `__markdownEditorView` in MarkdownEditor.tsx so production
// builds (web or Tauri) do not surface internals through `window`.
function shouldExposeAdapter(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.hostname === "127.0.0.1" && window.location.port === "5173";
}

const initialFile: FileState = {
  name: "untitled.md",
  handle: null,
  savedContents: initialMarkdown,
};

export function App() {
  const [file, setFile] = useState<FileState>(initialFile);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [activeFormat, setActiveFormat] = useState<ActiveFormat>(emptyFormat);
  const [zen, setZen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  // Read the stored pref once so the two state slots share the same source of
  // truth even if `localStorage` throws on a later read.
  const [themePref, setThemePref] = useState<ThemePref>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(themePref));
  const editorRef = useRef<EditorView | null>(null);
  // Latest editor text. Saving from a keyboard shortcut runs in the same tick
  // as `setMarkdown`, so a closure-captured `markdown` would be stale; reading
  // through the ref guarantees the on-disk content matches what the user sees.
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  // Mirror `fileVersion` so async save callbacks can detect that the user
  // switched files mid-save (replaceFile bumps fileVersion). Without this an
  // in-flight save would clobber the freshly-opened file's name/handle/savedContents.
  const fileVersionRef = useRef(fileVersion);
  fileVersionRef.current = fileVersion;

  const dirty = markdown !== file.savedContents;
  const badge = useMemo(
    () => describeStatus({ saveStatus, dirty, hasHandle: file.handle !== null }),
    [saveStatus, dirty, file.handle],
  );

  const withEditor = useCallback((command: (view: EditorView) => void) => {
    if (editorRef.current) {
      command(editorRef.current);
    }
  }, []);

  const handleReady = useCallback((view: EditorView) => {
    editorRef.current = view;
  }, []);

  const replaceFile = useCallback((next: LocalFile) => {
    setFile({ name: next.name, handle: next.handle, savedContents: next.contents });
    setMarkdown(next.contents);
    setSaveStatus("idle");
    setSaveError(null);
    setFileVersion((value) => value + 1);
  }, []);

  const guardDirty = useCallback(
    (intent: "new" | "open") => {
      if (!dirty || typeof window === "undefined") {
        return true;
      }
      const message =
        intent === "new"
          ? "Discard unsaved changes and start a new file?"
          : "Discard unsaved changes and open another file?";
      return window.confirm(message);
    },
    [dirty],
  );

  const handleNew = useCallback(() => {
    if (!guardDirty("new")) {
      return;
    }
    const adapter = getActiveAdapter();
    const fresh = adapter.newFile();
    replaceFile(fresh);
  }, [guardDirty, replaceFile]);

  const handleOpen = useCallback(async () => {
    if (!guardDirty("open")) {
      return;
    }
    const adapter = getActiveAdapter();

    try {
      const opened = await adapter.openFile();
      if (!opened) {
        return;
      }
      replaceFile(opened);
    } catch (error) {
      console.error("Open failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Open failed");
    }
  }, [guardDirty, replaceFile]);

  const handleSaveAs = useCallback(async () => {
    const adapter = getActiveAdapter();
    setSaveStatus("saving");
    setSaveError(null);

    // Snapshot the current text and file identity so a save that races a
    // file switch never clobbers the new file's state. `fileVersionRef`
    // bumps in `replaceFile`; if it has changed by the time the picker
    // resolves, the post-await commit is dropped.
    const contents = markdownRef.current;
    const startVersion = fileVersionRef.current;
    const stillCurrent = () => fileVersionRef.current === startVersion;

    try {
      const result = await adapter.saveFileAs(file.name || DEFAULT_NEW_FILE_NAME, contents);
      if (!stillCurrent()) {
        return;
      }
      if (!result) {
        setSaveStatus("idle");
        return;
      }
      setFile({ name: result.name, handle: result.handle, savedContents: contents });
      setSaveStatus("idle");
    } catch (error) {
      if (!stillCurrent()) {
        // Don't pollute the new file's badge, but never silently swallow a
        // failed write — log so the operator can see the original failure.
        console.error("Save-as failed (file switched mid-save)", error);
        return;
      }
      console.error("Save-as failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }, [file.name]);

  const handleSave = useCallback(async () => {
    const adapter = getActiveAdapter();

    if (!file.handle) {
      await handleSaveAs();
      return;
    }

    setSaveStatus("saving");
    setSaveError(null);

    const contents = markdownRef.current;
    const startVersion = fileVersionRef.current;
    const stillCurrent = () => fileVersionRef.current === startVersion;

    try {
      const result = await adapter.saveFile(file.handle, contents, file.name);
      if (!stillCurrent()) {
        return;
      }
      setFile({ name: result.name, handle: result.handle, savedContents: contents });
      setSaveStatus("idle");
    } catch (error) {
      if (!stillCurrent()) {
        console.error("Save failed (file switched mid-save)", error);
        return;
      }
      console.error("Save failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }, [file.handle, file.name, handleSaveAs]);

  // Load a file by absolute path. Shared by the OS file-open path (Finder
  // double-click, "Open With", drag onto the dock icon) and the in-window
  // drag-drop handler. Non-markdown paths are silently ignored so a stray
  // drop on the editor doesn't replace the working file.
  const loadPathFile = useCallback(
    async (path: string) => {
      if (!path || !isMarkdownPath(path)) {
        return;
      }
      if (!guardDirty("open")) {
        return;
      }
      try {
        const next = await openMarkdownFromPath(path);
        if (next) {
          replaceFile(next);
        }
      } catch (error) {
        console.error("Failed to open path", path, error);
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Failed to open file");
      }
    },
    [guardDirty, replaceFile],
  );

  // Keyboard shortcuts at the window level so they catch Cmd/Ctrl-O/N
  // before the browser uses them, and so saving works even outside the editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) {
        return;
      }
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSave();
        }
        return;
      }

      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void handleOpen();
        return;
      }

      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        handleNew();
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  // Theme: re-apply on preference change and follow the OS when in "system".
  // The bootstrap script in `index.html` sets the initial `data-theme` before
  // first paint to avoid a flash; this effect keeps it in sync afterwards.
  useEffect(() => {
    setResolvedTheme(applyTheme(themePref));
    if (themePref !== "system") {
      return;
    }
    return subscribeToSystemTheme((next) => {
      // `applyTheme("system")` re-resolves and writes `data-theme`; we then
      // commit the listener-supplied value to React state. Trusting `next`
      // here keeps the two in sync without a redundant matchMedia query.
      applyTheme("system");
      setResolvedTheme(next);
    });
  }, [themePref]);

  const cycleTheme = useCallback(() => {
    setThemePref((current) => {
      const next = nextTheme(current);
      storeTheme(next);
      return next;
    });
  }, []);

  // Beforeunload guard: warn the user if they navigate away with unsaved changes.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Expose the active adapter on window so spikes/tests can introspect or override it.
  // Gated to the local dev origin so production builds do not surface internals
  // — mirrors the gating used for `__markdownEditorView` in MarkdownEditor.tsx.
  useEffect(() => {
    if (typeof window === "undefined" || !shouldExposeAdapter()) {
      return;
    }
    const win = window as AdapterWindow;
    // Capture the exposed reference so cleanup compares the same object even
    // if `getActiveAdapter()` would later return a different instance.
    const exposed = getActiveAdapter();
    win.__markdownFileAdapter = exposed;
    return () => {
      if (win.__markdownFileAdapter === exposed) {
        delete win.__markdownFileAdapter;
      }
    };
  }, []);

  // OS-supplied paths: Finder double-click, "Open With", drag-onto-dock-icon
  // all land here. Cold starts drain `drain_pending_open_paths` (RunEvent::Opened
  // fires before the webview can listen, so paths are queued in Rust). Live
  // arrivals come through `file:open-path`. Drag-drop into the window arrives
  // via the built-in `tauri://drag-drop` event with a `paths` payload.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);

        const onOpenPath = await listen<unknown>("file:open-path", (event) => {
          if (typeof event.payload === "string" && event.payload.length > 0) {
            void loadPathFile(event.payload);
          }
        });
        // tauri://drag-drop fires *only* on the drop phase — Tauri 2 emits
        // separate events (`tauri://drag-enter`, `drag-over`, `drag-leave`)
        // for the other phases, so no `type` filter is needed here.
        const onDragDrop = await listen<{ paths?: unknown }>("tauri://drag-drop", (event) => {
          const raw = event.payload?.paths;
          if (!Array.isArray(raw)) {
            return;
          }
          // Validate each entry is a non-empty string before letting it touch
          // the filesystem — the IPC payload type is a TS-side hint only.
          const target = raw.find(
            (entry): entry is string =>
              typeof entry === "string" && entry.length > 0 && isMarkdownPath(entry),
          );
          if (target) {
            // Single-window app: load the first markdown path; the rest are
            // dropped silently for now. TODO: route extras to recent files.
            void loadPathFile(target);
          }
        });

        if (disposed) {
          onOpenPath();
          onDragDrop();
          return;
        }
        unlisteners.push(onOpenPath, onDragDrop);

        // Cold-start drain: any path the OS handed us before listeners were
        // attached lives in Rust state; pull it now and load the first match.
        try {
          const queued = await invoke<unknown>("drain_pending_open_paths");
          if (!disposed && Array.isArray(queued)) {
            const target = queued.find(
              (entry): entry is string =>
                typeof entry === "string" && entry.length > 0 && isMarkdownPath(entry),
            );
            if (target) {
              void loadPathFile(target);
            }
          }
        } catch (error) {
          console.error("Failed to drain pending open paths", error);
        }
      } catch (error) {
        console.error("Failed to bind file-open events", error);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [loadPathFile]);

  // Native menu bridge: when running inside Tauri, the File menu (New/Open/
  // Save/Save As) emits `menu:*` events from Rust. Forward them to the same
  // handlers used by toolbar buttons and Cmd-shortcuts so there is one path.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const subscribe = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const bindings: Array<[string, () => void]> = [
          ["menu:new", () => handleNew()],
          ["menu:open", () => void handleOpen()],
          ["menu:save", () => void handleSave()],
          ["menu:save-as", () => void handleSaveAs()],
        ];
        for (const [event, run] of bindings) {
          const unlisten = await listen(event, run);
          if (disposed) {
            unlisten();
            continue;
          }
          unlisteners.push(unlisten);
        }
      } catch (error) {
        console.error("Failed to bind native menu events", error);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [handleNew, handleOpen, handleSave, handleSaveAs]);

  return (
    <main className={zen ? "app appZen" : "app"}>
      <header className="topbar">
        {!zen ? (
          <div className="fileActions" role="toolbar" aria-label="File actions">
            <button className="iconButton" type="button" title="New file" aria-label="New file" onClick={handleNew}>
              <FilePlus size={16} />
            </button>
            <button className="iconButton" type="button" title="Open file" aria-label="Open file" onClick={handleOpen}>
              <FolderOpen size={16} />
            </button>
            <button
              className="iconButton"
              type="button"
              title="Save file"
              aria-label="Save file"
              onClick={() => void handleSave()}
              disabled={saveStatus === "saving"}
            >
              <Save size={16} />
            </button>
          </div>
        ) : (
          <div className="windowSlot" aria-hidden="true" />
        )}

        <div className="titleCluster">
          <div className="documentTitle">{file.name || DEFAULT_NEW_FILE_NAME}</div>
          {!zen && (
            <div
              className={`documentState documentState--${badge.tone}`}
              data-state={badge.tone}
              title={saveError ?? badge.label}
            >
              {badge.label}
            </div>
          )}
        </div>

        <div className="topbarRight">
          <button
            className="iconButton themeToggle"
            type="button"
            title={describeTheme(themePref, resolvedTheme).hint}
            aria-label={describeTheme(themePref, resolvedTheme).label}
            onClick={cycleTheme}
          >
            {themePref === "system" ? (
              <Monitor size={16} />
            ) : themePref === "dark" ? (
              <Moon size={16} />
            ) : (
              <Sun size={16} />
            )}
          </button>
          <button className="modeButton" type="button" onClick={() => setZen((value) => !value)} title={zen ? "Normal Mode" : "Zen Mode"}>
            {zen ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}
            <span>{zen ? "Normal" : "Zen"}</span>
          </button>
        </div>
      </header>

      {!zen && (
        <nav className="toolbar" aria-label="Markdown formatting">
          <div className="toolbarSide toolbarSideLeft" aria-hidden="true" />

          <div className="toolbarCenter">
            <label className={activeFormat.heading ? "headingMenu isActive" : "headingMenu"}>
              <span className="srOnly">Heading level</span>
              <select
                value={activeFormat.heading ? String(activeFormat.heading) : ""}
                onChange={(event) => {
                  const level = Number(event.currentTarget.value);
                  if (level === 1 || level === 2 || level === 3) {
                    withEditor((view) => setHeading(view, level));
                  }
                }}
              >
                <option value="" disabled>
                  Heading
                </option>
                <option value="1">Heading 1</option>
                <option value="2">Heading 2</option>
                <option value="3">Heading 3</option>
              </select>
            </label>
            <span className="toolbarDivider" />
            <button className={activeFormat.heading === 1 ? "isActive" : undefined} aria-pressed={activeFormat.heading === 1} title="Heading 1" type="button" onClick={() => withEditor((view) => setHeading(view, 1))}>
              <Heading1 size={14} />
            </button>
            <button className={activeFormat.heading === 2 ? "isActive" : undefined} aria-pressed={activeFormat.heading === 2} title="Heading 2" type="button" onClick={() => withEditor((view) => setHeading(view, 2))}>
              <Heading2 size={14} />
            </button>
            <button className={activeFormat.bold ? "isActive" : undefined} aria-pressed={activeFormat.bold} title="Bold" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "**", after: "**", placeholder: "bold" }))}>
              <Bold size={14} />
            </button>
            <button className={activeFormat.italic ? "isActive" : undefined} aria-pressed={activeFormat.italic} title="Italic" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "*", after: "*", placeholder: "italic" }))}>
              <Italic size={14} />
            </button>
            <button className={activeFormat.inlineCode ? "isActive" : undefined} aria-pressed={activeFormat.inlineCode} title="Inline code" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "`", after: "`", placeholder: "code" }))}>
              <Code size={14} />
            </button>
            <button className={activeFormat.codeBlock ? "isActive" : undefined} aria-pressed={activeFormat.codeBlock} title="Code block" type="button" onClick={() => withEditor((view) => insertBlock(view, "```js\ncode\n```\n"))}>
              <Code2 size={14} />
            </button>
            <button className={activeFormat.link ? "isActive" : undefined} aria-pressed={activeFormat.link} title="Link" type="button" onClick={() => withEditor(insertLink)}>
              <Link size={14} />
            </button>
            <span className="toolbarDivider" />
            <button className={activeFormat.unorderedList ? "isActive" : undefined} aria-pressed={activeFormat.unorderedList} title="Bulleted list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- "))}>
              <List size={14} />
            </button>
            <button className={activeFormat.orderedList ? "isActive" : undefined} aria-pressed={activeFormat.orderedList} title="Numbered list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "1. "))}>
              <ListOrdered size={14} />
            </button>
            <button className={activeFormat.taskList ? "isActive" : undefined} aria-pressed={activeFormat.taskList} title="Task list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- [ ] "))}>
              <ListChecks size={14} />
            </button>
            <button className={activeFormat.quote ? "isActive" : undefined} aria-pressed={activeFormat.quote} title="Blockquote" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "> "))}>
              <Quote size={14} />
            </button>
            <button className={activeFormat.rule ? "isActive" : undefined} aria-pressed={activeFormat.rule} title="Horizontal rule" type="button" onClick={() => withEditor((view) => insertBlock(view, "---\n"))}>
              <Minus size={14} />
            </button>
          </div>

          <div className="toolbarSide toolbarSideRight">
            <span>{wordCount(markdown).toLocaleString()} words</span>
          </div>
        </nav>
      )}

      <section className="editorShell" aria-label="Markdown editor">
        <MarkdownEditor key={fileVersion} value={file.savedContents} zen={zen} onChange={setMarkdown} onFormatChange={setActiveFormat} onReady={handleReady} />
      </section>

      {zen ? (
        <div className="zenIndicator" aria-hidden="true">
          <span />
          Zen mode
        </div>
      ) : (
        <footer className="statusbar">
          <div>
            <FileText size={12} />
            <span>{file.name || DEFAULT_NEW_FILE_NAME}</span>
          </div>
          <div>
            <span>Markdown</span>
            <span>{markdown.length.toLocaleString()} chars</span>
          </div>
        </footer>
      )}
    </main>
  );
}

function describeStatus({
  saveStatus,
  dirty,
  hasHandle,
}: {
  saveStatus: SaveStatus;
  dirty: boolean;
  hasHandle: boolean;
}): { label: string; tone: "saved" | "unsaved" | "saving" | "error" | "new" } {
  if (saveStatus === "saving") {
    return { label: "Saving…", tone: "saving" };
  }
  if (saveStatus === "error") {
    return { label: "Save failed", tone: "error" };
  }
  if (!hasHandle && !dirty) {
    return { label: "New", tone: "new" };
  }
  if (dirty) {
    return { label: "Unsaved", tone: "unsaved" };
  }
  return { label: "Saved", tone: "saved" };
}

function wordCount(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
