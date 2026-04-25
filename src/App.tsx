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
  PanelTopClose,
  PanelTopOpen,
  Quote,
  Save,
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

type AdapterWindow = Window & {
  __markdownFileAdapter?: FileAdapter;
  __markdownFileAdapterOverride?: FileAdapter;
};

function getActiveAdapter(): FileAdapter {
  if (typeof window !== "undefined") {
    const win = window as AdapterWindow;
    if (win.__markdownFileAdapterOverride) {
      return win.__markdownFileAdapterOverride;
    }
  }
  return webFileAdapter;
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
  const editorRef = useRef<EditorView | null>(null);

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

    try {
      const result = await adapter.saveFileAs(file.name || DEFAULT_NEW_FILE_NAME, markdown);
      if (!result) {
        setSaveStatus("idle");
        return;
      }
      setFile({ name: result.name, handle: result.handle, savedContents: markdown });
      setSaveStatus("idle");
    } catch (error) {
      console.error("Save-as failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }, [file.name, markdown]);

  const handleSave = useCallback(async () => {
    const adapter = getActiveAdapter();

    if (!file.handle) {
      await handleSaveAs();
      return;
    }

    setSaveStatus("saving");
    setSaveError(null);

    try {
      const result = await adapter.saveFile(file.handle, markdown, file.name);
      setFile({ name: result.name, handle: result.handle, savedContents: markdown });
      setSaveStatus("idle");
    } catch (error) {
      console.error("Save failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }, [file.handle, file.name, handleSaveAs, markdown]);

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
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const win = window as AdapterWindow;
    win.__markdownFileAdapter = getActiveAdapter();
    return () => {
      if (win.__markdownFileAdapter === getActiveAdapter()) {
        delete win.__markdownFileAdapter;
      }
    };
  }, []);

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

        <button className="modeButton" type="button" onClick={() => setZen((value) => !value)} title={zen ? "Normal Mode" : "Zen Mode"}>
          {zen ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}
          <span>{zen ? "Normal" : "Zen"}</span>
        </button>
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
