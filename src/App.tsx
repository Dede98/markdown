import type { EditorView } from "@codemirror/view";
import {
  BookOpenText,
  Download,
  Eye,
  FileDown,
  FilePlus,
  FileText,
  FileCode,
  FolderOpen,
  Leaf,
  MessageSquare,
  Monitor,
  Moon,
  Save,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  AUTOSAVE_AFTER_EDIT_DELAY_MS,
  AUTOSAVE_INTERVAL_OPTIONS,
  getStoredAutoSavePreference,
  storeAutoSavePreference,
  type AutoSaveInterval,
  type AutoSaveMode,
  type AutoSavePreference,
} from "./autosave";
import {
  collectEditorContributions,
  collectPanelContributions,
  collectSettingsContributions,
  collectStatusContributions,
  type AppContribution,
  type AppContributionContext,
} from "./appContributions";
import {
  createCloudCollaborationContribution,
  createCloudRoomEditorContribution,
} from "./cloudCollaboration/contribution";
import {
  inMemoryCloudSessionProvider,
  type CloudRoomHandle,
} from "./cloudCollaboration/session";
import {
  addCommentReply,
  createThreadId,
  deleteCommentThread,
  insertCommentAnchor,
  reanchorCommentThread,
  resolveCommentThread,
} from "./comments/commands";
import { CommentsSidebar } from "./comments/CommentsSidebar";
import { createCommentsContribution } from "./comments/contribution";
import { getStoredCommentAuthor, storeCommentAuthorName } from "./comments/identity";
import { parseComments } from "./comments/storage";
import type { CommentAuthor } from "./comments/types";
import { getStoredContentWidth, storeContentWidth, type ContentWidth } from "./contentWidth";
import { createLocalFileSession } from "./documentSession";
import { emptyFormat, type ActiveFormat } from "./editorFormat";
import type { EditorContribution } from "./editorContributions";
import {
  DEFAULT_NEW_FILE_NAME,
  type FileAdapter,
  type FileHandle,
  type LocalFile,
} from "./fileAdapter";
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
import { markdownToolbarItems, type ToolbarContext, type ToolbarItem } from "./toolbarRegistry";
import { checkForUpdate, installAndRelaunch, type Update, type UpdateProgress } from "./updater";
import { getStoredRaw, getStoredZen, storeRaw, storeZen } from "./viewMode";
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

type SaveStatus = "idle" | "saving" | "autosaving" | "error";
type UpdateCheckStatus = "idle" | "checking" | "available" | "current" | "error" | "web";

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

// Render the modifier key the way the host platform writes it. Mac uses ⌘ +
// composed glyphs; everywhere else falls back to "Ctrl+". Resolved once at
// module load — there is no SSR in this project, but the `typeof navigator`
// guard keeps the file safe for any future Vite SSR / test harness use.
const SHORTCUT_LABELS: { raw: string; zen: string } = (() => {
  const platform =
    typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent || "" : "";
  const isMac = /mac|iphone|ipad/i.test(platform);
  if (isMac) {
    return { raw: "⌘⇧R", zen: "⌘." };
  }
  return { raw: "Ctrl+Shift+R", zen: "Ctrl+." };
})();

function formatUpdateVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.toLowerCase().startsWith("v") ? trimmed : `v${trimmed}`;
}

function formatAutoSaveInterval(seconds: AutoSaveInterval): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function toPdfTitle(name: string): string {
  const trimmed = name.trim() || DEFAULT_NEW_FILE_NAME;
  return `${trimmed.replace(/\.(md|markdown|mdx|mdown|txt)$/i, "")}.pdf`;
}

export function App() {
  const [file, setFile] = useState<FileState>(initialFile);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [activeFormat, setActiveFormat] = useState<ActiveFormat>(emptyFormat);
  const [hasEditorSelection, setHasEditorSelection] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);
  const [activeCloudRoom, setActiveCloudRoom] = useState<CloudRoomHandle | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentAuthor, setCommentAuthor] = useState<CommentAuthor>(() => getStoredCommentAuthor());
  const [commentNameRequired, setCommentNameRequired] = useState(false);
  const [contentWidth, setContentWidth] = useState<ContentWidth>(() => getStoredContentWidth());
  const [autoSavePreference, setAutoSavePreference] = useState<AutoSavePreference>(() => getStoredAutoSavePreference());
  const [zen, setZen] = useState(() => getStoredZen());
  // Raw mode renders the document as plain monospace text — every markdown
  // mark visible. Orthogonal to zen: a user can be in raw + zen at once.
  const [raw, setRaw] = useState(() => getStoredRaw());
  const [printExporting, setPrintExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  // Read the stored pref once so the two state slots share the same source of
  // truth even if `localStorage` throws on a later read.
  const [themePref, setThemePref] = useState<ThemePref>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(themePref));
  // Auto-update state. The handle returned by `checkForUpdate` carries the
  // signed-payload context Tauri needs to install — we keep it as-is rather
  // than copying out the version, so the install path doesn't have to call
  // `check()` a second time. `installing` gates the button while a download
  // is in flight.
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<UpdateCheckStatus>("idle");
  const editorRef = useRef<EditorView | null>(null);
  // Latest editor text. Saving from a keyboard shortcut runs in the same tick
  // as `setMarkdown`, so a closure-captured `markdown` would be stale; reading
  // through the ref guarantees the on-disk content matches what the user sees.
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const savedContentsRef = useRef(file.savedContents);
  savedContentsRef.current = file.savedContents;
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;
  const commentAuthorRef = useRef(commentAuthor);
  commentAuthorRef.current = commentAuthor;
  const printRestoreRawRef = useRef(false);
  // Mirror `fileVersion` so async save callbacks can detect that the user
  // switched files mid-save (replaceFile bumps fileVersion). Without this an
  // in-flight save would clobber the freshly-opened file's name/handle/savedContents.
  const fileVersionRef = useRef(fileVersion);
  fileVersionRef.current = fileVersion;
  const activeCloudRoomRef = useRef(activeCloudRoom);
  activeCloudRoomRef.current = activeCloudRoom;

  const dirty = markdown !== file.savedContents;
  const commentsParse = useMemo(() => parseComments(markdown), [markdown]);
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

  const handleAuthorNameChange = useCallback((name: string) => {
    const next = storeCommentAuthorName(name);
    setCommentAuthor(next);
    if (next.name.trim()) {
      setCommentNameRequired(false);
    }
  }, []);

  const handleContentWidthChange = useCallback((value: ContentWidth) => {
    setContentWidth(value);
    storeContentWidth(value);
  }, []);

  const handleAutoSavePreferenceChange = useCallback((value: AutoSavePreference) => {
    setAutoSavePreference(value);
    storeAutoSavePreference(value);
  }, []);

  const ensureCommentAuthor = useCallback(() => {
    const current = commentAuthorRef.current;
    if (current.name.trim()) {
      return current;
    }
    setCommentNameRequired(true);
    setSettingsOpen(true);
    return null;
  }, []);

  const handleAddComment = useCallback(() => {
    if (!editorRef.current) {
      return false;
    }
    const author = ensureCommentAuthor();
    if (!author) {
      return false;
    }
    const threadId = createThreadId();
    const inserted = insertCommentAnchor(editorRef.current, {
      threadId,
      author,
      now: new Date().toISOString(),
    });
    if (inserted) {
      setSelectedCommentId(threadId);
      setCommentsOpen(true);
    }
    return inserted;
  }, [ensureCommentAuthor]);

  const handleAddCommentReply = useCallback((threadId: string, body: string) => {
    if (!editorRef.current) {
      return;
    }
    const author = ensureCommentAuthor();
    if (!author) {
      return;
    }
    addCommentReply(editorRef.current, {
      threadId,
      author,
      body,
      now: new Date().toISOString(),
    });
  }, [ensureCommentAuthor]);

  const handleResolveCommentThread = useCallback((threadId: string, resolved: boolean) => {
    if (!editorRef.current) {
      return;
    }
    resolveCommentThread(editorRef.current, { threadId, resolved });
  }, []);

  const handleReanchorCommentThread = useCallback((threadId: string) => {
    if (!editorRef.current) {
      return;
    }
    const repaired = reanchorCommentThread(editorRef.current, { threadId });
    if (repaired) {
      setSelectedCommentId(threadId);
    }
  }, []);

  const handleDeleteCommentThread = useCallback((threadId: string) => {
    if (!editorRef.current) {
      return;
    }
    const deleted = deleteCommentThread(editorRef.current, { threadId });
    if (deleted) {
      setSelectedCommentId((current) => (current === threadId ? null : current));
    }
  }, []);

  const handleSelectCommentThread = useCallback((threadId: string) => {
    const view = editorRef.current;
    setSelectedCommentId(threadId);
    setCommentsOpen(true);
    if (!view) {
      return;
    }
    const parsed = parseComments(view.state.doc.toString());
    const anchor = parsed.anchors.find((candidate) => candidate.id === threadId);
    if (!anchor) {
      return;
    }
    view.dispatch({
      selection: { anchor: anchor.from, head: anchor.to },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const documentSession = useMemo(() => activeCloudRoom?.session ?? createLocalFileSession(file), [activeCloudRoom, file]);
  const appContributionContext = useMemo<AppContributionContext>(
    () => ({
      session: documentSession,
      markdown,
      raw,
      zen,
      dirty,
    }),
    [dirty, documentSession, markdown, raw, zen],
  );

  const commentsContribution = useMemo<EditorContribution>(
    () => createCommentsContribution({
      onAddComment: handleAddComment,
      onOpenComments: () => setCommentsOpen(true),
      onSelectComment: handleSelectCommentThread,
    }),
    [handleAddComment, handleSelectCommentThread],
  );

  const cloudEditorContribution = useMemo<EditorContribution | null>(
    () =>
      activeCloudRoom
        ? createCloudRoomEditorContribution({
            ytext: activeCloudRoom.ytext,
            awareness: activeCloudRoom.awareness.primary,
          })
        : null,
    [activeCloudRoom],
  );

  const handleStartCloudRoom = useCallback(() => {
    if (activeCloudRoomRef.current) {
      setCloudPanelOpen(true);
      return;
    }
    const cloudRoom = inMemoryCloudSessionProvider.startRoom({
      seedMarkdown: markdownRef.current,
    });
    setActiveCloudRoom(cloudRoom);
    setMarkdown(cloudRoom.materializeMarkdown());
    setCloudPanelOpen(true);
    setFileVersion((value) => value + 1);
  }, []);

  const handleLeaveCloudRoom = useCallback(() => {
    const cloudRoom = activeCloudRoomRef.current;
    if (!cloudRoom) {
      return;
    }
    const snapshot = cloudRoom.materializeMarkdown();
    cloudRoom.destroy();
    setActiveCloudRoom(null);
    setCloudPanelOpen(false);
    setMarkdown(snapshot);
    setFileVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    return () => {
      activeCloudRoomRef.current?.destroy();
    };
  }, []);

  const cloudContribution = useMemo(
    () => createCloudCollaborationContribution({
      open: cloudPanelOpen,
      cloudRoom: activeCloudRoom,
      onClose: () => setCloudPanelOpen(false),
      onLeaveRoom: handleLeaveCloudRoom,
    }),
    [cloudPanelOpen, activeCloudRoom, handleLeaveCloudRoom],
  );
  const appContributions = useMemo<AppContribution[]>(
    () => {
      const contributions: AppContribution[] = [{ id: "comments", editor: commentsContribution }];
      if (cloudEditorContribution) {
        contributions.push({ id: "cloud-room-editor", editor: cloudEditorContribution });
      }
      contributions.push(cloudContribution);
      return contributions;
    },
    [cloudContribution, cloudEditorContribution, commentsContribution],
  );
  const editorContributions = useMemo(() => collectEditorContributions(appContributions), [appContributions]);
  const panelContributions = useMemo(() => collectPanelContributions(appContributions), [appContributions]);
  const settingsContributions = useMemo(() => collectSettingsContributions(appContributions), [appContributions]);
  const statusContributions = useMemo(() => collectStatusContributions(appContributions), [appContributions]);
  const toolbarItems = useMemo(
    () => [...markdownToolbarItems, ...editorContributions.flatMap((contribution) => contribution.toolbarItems ?? [])],
    [editorContributions],
  );
  const toolbarContext = useMemo<ToolbarContext>(
    () => ({
      activeFormat,
      hasSelection: hasEditorSelection,
      readOnly: Boolean(commentsParse.readOnlyReason),
    }),
    [activeFormat, hasEditorSelection, commentsParse.readOnlyReason],
  );

  const replaceFile = useCallback((next: LocalFile) => {
    setFile({ name: next.name, handle: next.handle, savedContents: next.contents });
    setMarkdown(next.contents);
    setSaveStatus("idle");
    setSaveError(null);
    setSelectedCommentId(null);
    setCommentsOpen(false);
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

  const performSave = useCallback(async (intent: "manual" | "autosave") => {
    const adapter = getActiveAdapter();

    if (!file.handle) {
      if (intent === "manual") {
        await handleSaveAs();
      }
      return;
    }

    setSaveStatus(intent === "autosave" ? "autosaving" : "saving");
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

  const handleSave = useCallback(async () => {
    await performSave("manual");
  }, [performSave]);

  const handleAutoSave = useCallback(async () => {
    await performSave("autosave");
  }, [performSave]);

  const finishPrintExport = useCallback((previousTitle: string) => {
    document.title = previousTitle;
    flushSync(() => {
      setPrintExporting(false);
      if (printRestoreRawRef.current) {
        setRaw(true);
        printRestoreRawRef.current = false;
      }
    });
  }, []);

  const handleExportPdf = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const previousTitle = document.title;
    document.title = toPdfTitle(file.name || DEFAULT_NEW_FILE_NAME);
    printRestoreRawRef.current = raw;

    let finished = false;
    let fallbackTimer: number | undefined;
    const preparePrint = () => {
      flushSync(() => {
        setPrintExporting(true);
        if (raw) {
          setRaw(false);
        }
      });
      editorRef.current?.requestMeasure();
    };
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
      }
      window.removeEventListener("beforeprint", preparePrint);
      window.removeEventListener("afterprint", finish);
      finishPrintExport(previousTitle);
    };

    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", finish);
    try {
      window.print();
      // Some webviews do not reliably fire `afterprint` when the user
      // cancels. By this point the print snapshot has already been handed to
      // the system dialog, so restore the live editor quickly if no event
      // arrives.
      fallbackTimer = window.setTimeout(finish, 250);
    } catch (error) {
      console.error("PDF export print failed", error);
      finish();
    }
  }, [file.name, finishPrintExport, raw]);

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

  // Web sibling of `loadPathFile`: read a `File` object dropped onto the
  // window. The Tauri build receives an absolute path through the
  // `tauri://drag-drop` IPC event; the browser receives the file's bytes
  // directly via the HTML5 drop event. Both shells funnel through the same
  // `replaceFile` so the dirty-guard prompt and downstream UI behave
  // identically regardless of how the file arrived.
  const loadDroppedFile = useCallback(
    async (droppedFile: File) => {
      if (!droppedFile || !isMarkdownPath(droppedFile.name)) {
        return;
      }
      if (!guardDirty("open")) {
        return;
      }
      try {
        const contents = await droppedFile.text();
        // `handle: null` because a DOM drop event does not surface a File
        // System Access handle. Subsequent Save will route through Save-As,
        // matching the input-fallback path in `webFileAdapter.openFile`.
        replaceFile({ name: droppedFile.name, contents, handle: null });
      } catch (error) {
        console.error("Failed to read dropped file", droppedFile.name, error);
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
        return;
      }

      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        handleExportPdf();
        return;
      }

      // Cmd/Ctrl-Shift-R toggles raw view. preventDefault also suppresses the
      // browser's hard-reload default so the shortcut works in the web build.
      if (key === "r" && event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setRaw((value) => !value);
        return;
      }

      // Cmd/Ctrl-. toggles zen mode. Captured at the window so it works while
      // CodeMirror has focus — the editor keymap does not bind this combo.
      if (key === "." && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setZen((value) => !value);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [handleExportPdf, handleNew, handleOpen, handleSave, handleSaveAs]);

  // HTML5 drag-drop for the web build: a `.md` file dropped anywhere in the
  // window opens it. Tauri ships its own native drag-drop (`tauri://drag-drop`
  // listener below), so this effect is gated to the browser runtime to avoid
  // double-handling the same drop.
  //
  // Capture phase + window scope lets us beat CodeMirror's content-area drop
  // handler to the punch. We only swallow drops that carry files —
  // `dataTransfer.types.includes("Files")` — so plain text drags into the
  // editor still flow through CodeMirror untouched.
  //
  // The matching `dragover` listener is required: without `preventDefault()`
  // on dragover, the browser refuses the drop and instead navigates the
  // window to the dropped file's `file://` URL, which would unload the app.
  useEffect(() => {
    if (typeof window === "undefined" || isTauriRuntime()) {
      return;
    }

    const isFileDrag = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes("Files"));

    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
    };

    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }
      // Single-window app: pick the first markdown file and ignore the rest.
      // Mirrors the Tauri drag-drop handler's "first match wins" policy.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file && isMarkdownPath(file.name)) {
          void loadDroppedFile(file);
          return;
        }
      }
    };

    window.addEventListener("dragover", onDragOver, { capture: true });
    window.addEventListener("drop", onDrop, { capture: true });
    return () => {
      window.removeEventListener("dragover", onDragOver, { capture: true });
      window.removeEventListener("drop", onDrop, { capture: true });
    };
  }, [loadDroppedFile]);

  // Auto-update probe: only the Tauri shell ships an updater plugin, so the
  // web build short-circuits. A failure here (no network, manifest 404,
  // signature mismatch, etc.) is logged and silently swallowed — the user
  // simply does not see an update affordance, and the editor keeps working.
  // The check runs once per launch; we deliberately do not poll, so an
  // update that lands mid-session waits for the next app start.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const update = await checkForUpdate();
        if (!cancelled && update) {
          setPendingUpdate(update);
        }
      } catch (error) {
        console.error("Update check failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    if (!pendingUpdate || installingUpdate) {
      return;
    }
    setInstallingUpdate(true);
    setUpdateProgress({ downloaded: 0, contentLength: null });
    try {
      await installAndRelaunch(pendingUpdate, setUpdateProgress);
      // `installAndRelaunch` ends in `relaunch()`, so this line normally
      // never executes — the process is replaced. Still clear the flag in
      // case the relaunch call rejects without restarting.
      setInstallingUpdate(false);
      setUpdateProgress(null);
    } catch (error) {
      console.error("Update install failed", error);
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  }, [pendingUpdate, installingUpdate]);

  const handleCheckForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) {
      setUpdateCheckStatus("web");
      return;
    }
    setUpdateCheckStatus("checking");
    try {
      const update = await checkForUpdate();
      if (update) {
        setPendingUpdate(update);
        setUpdateCheckStatus("available");
        return;
      }
      setPendingUpdate(null);
      setUpdateCheckStatus("current");
    } catch (error) {
      console.error("Update check failed", error);
      setUpdateCheckStatus("error");
    }
  }, []);

  // Tauri drag region: with `titleBarStyle: "Overlay"` the OS no longer reserves
  // a native titlebar, so dragging relies on the explicit drag region attribute
  // plus a JS bridge into `startDragging`. Bind in the capture phase on the
  // window so we run before React's synthetic-event handlers and before
  // CodeMirror/WebKit can consume the mousedown for selection or focus.
  useEffect(() => {
    if (!isTauriRuntime() || typeof window === "undefined") {
      return;
    }

    let cleanup: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) {
            return;
          }
          const target = event.target;
          if (!(target instanceof Element)) {
            return;
          }
          // Skip if the user clicked an interactive control. Mirrors Tauri's
          // built-in auto-detection so the topbar buttons keep working.
          if (target.closest("button, a, input, select, textarea, [role=button]")) {
            return;
          }
          if (!target.closest("[data-tauri-drag-region]")) {
            return;
          }
          // WebKit otherwise picks up the mousedown as the start of a text
          // selection on neighboring text nodes, which races and wins against
          // the async IPC call into Rust. Suppressing the default selection
          // gesture lets `startDragging` capture the drag cleanly.
          event.preventDefault();
          event.stopPropagation();
          if (event.detail === 2) {
            void appWindow.toggleMaximize();
          } else {
            void appWindow.startDragging();
          }
        };
        if (disposed) {
          return;
        }
        // Capture phase + window-level so we beat any inner mousedown handler
        // (CodeMirror, React synthetic events) to the punch.
        window.addEventListener("mousedown", onMouseDown, { capture: true });
        cleanup = () => window.removeEventListener("mousedown", onMouseDown, { capture: true });
      } catch (error) {
        console.error("Failed to bind window drag handler", error);
      }
    })();

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

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

  // Persist view mode prefs so they survive reload.
  useEffect(() => { storeRaw(raw); }, [raw]);
  useEffect(() => { storeZen(zen); }, [zen]);

  useEffect(() => {
    if (
      autoSavePreference.mode !== "after-edit" ||
      !dirty ||
      !file.handle ||
      saveStatusRef.current === "saving" ||
      saveStatusRef.current === "autosaving"
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const isDirty = markdownRef.current !== savedContentsRef.current;
      const isSaving = saveStatusRef.current === "saving" || saveStatusRef.current === "autosaving";
      if (isDirty && !isSaving) {
        void handleAutoSave();
      }
    }, AUTOSAVE_AFTER_EDIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoSavePreference.mode, dirty, file.handle, handleAutoSave, markdown]);

  useEffect(() => {
    if (autoSavePreference.mode !== "interval" || !file.handle) {
      return;
    }
    const timer = window.setInterval(() => {
      const isDirty = markdownRef.current !== savedContentsRef.current;
      const isSaving = saveStatusRef.current === "saving" || saveStatusRef.current === "autosaving";
      if (isDirty && !isSaving) {
        void handleAutoSave();
      }
    }, autoSavePreference.intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoSavePreference.intervalSeconds, autoSavePreference.mode, file.handle, handleAutoSave]);

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

  // Native menu bridge: when running inside Tauri, the File menu emits
  // `menu:*` events from Rust. Forward them to the same handlers used by
  // toolbar buttons and Cmd-shortcuts so there is one path.
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
          ["menu:export-pdf", () => handleExportPdf()],
          ["menu:toggle-raw", () => setRaw((value) => !value)],
          ["menu:toggle-zen", () => setZen((value) => !value)],
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
  }, [handleExportPdf, handleNew, handleOpen, handleSave, handleSaveAs]);

  const updateProgressPercent =
    updateProgress?.contentLength && updateProgress.contentLength > 0
      ? Math.min(100, Math.max(0, Math.round((updateProgress.downloaded / updateProgress.contentLength) * 100)))
      : null;
  const updateProgressStyle =
    installingUpdate
      ? ({ "--update-progress": `${updateProgressPercent ?? 0}%` } as CSSProperties)
      : undefined;
  const workspaceClass = [
    "workspace",
    commentsOpen ? "workspaceWithComments" : "",
    panelContributions.length > 0 ? "workspaceWithCloud" : "",
    commentsOpen && panelContributions.length > 0 ? "workspaceWithCommentsAndCloud" : "",
  ].filter(Boolean).join(" ");

  return (
    <main
      className={[zen ? "app appZen" : "app", printExporting ? "appPrintExporting" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <header className="topbar" data-tauri-drag-region>
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
            <button
              className="iconButton"
              type="button"
              title="Export rendered PDF"
              aria-label="Export rendered PDF"
              onClick={handleExportPdf}
            >
              <FileDown size={16} />
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
          {pendingUpdate && (
            <button
              className="iconButton updateButton"
              type="button"
              title={
                installingUpdate
                  ? updateProgressPercent === null
                    ? `Downloading ${formatUpdateVersion(pendingUpdate.version)}…`
                    : `Downloading ${formatUpdateVersion(pendingUpdate.version)}: ${updateProgressPercent}%`
                  : `Update available: ${formatUpdateVersion(pendingUpdate.version)} — install and restart`
              }
              aria-label={
                installingUpdate
                  ? updateProgressPercent === null
                    ? `Downloading update ${formatUpdateVersion(pendingUpdate.version)}`
                    : `Downloading update ${formatUpdateVersion(pendingUpdate.version)} ${updateProgressPercent}%`
                  : `Update available: ${formatUpdateVersion(pendingUpdate.version)}`
              }
              onClick={() => void handleInstallUpdate()}
              disabled={installingUpdate}
              data-installing={installingUpdate ? "true" : undefined}
              data-progress-known={installingUpdate && updateProgressPercent !== null ? "true" : undefined}
              style={updateProgressStyle}
            >
              {installingUpdate ? (
                <span className="updateProgressCircle" aria-hidden="true" />
              ) : (
                <Download size={16} />
              )}
              <span className="updateVersion">{formatUpdateVersion(pendingUpdate.version)}</span>
            </button>
          )}
          <button
            className={commentsOpen ? "iconButton isActive" : "iconButton"}
            type="button"
            title="Comments"
            aria-label="Comments"
            aria-pressed={commentsOpen}
            onClick={() => setCommentsOpen((value) => !value)}
          >
            <MessageSquare size={16} />
          </button>
          <button
            className={cloudPanelOpen ? "iconButton isActive" : "iconButton"}
            type="button"
            title={activeCloudRoom ? "Collaboration room" : "Start collaboration room"}
            aria-label={activeCloudRoom ? "Collaboration room" : "Start collaboration room"}
            aria-pressed={cloudPanelOpen}
            onClick={() => {
              if (activeCloudRoom) {
                setCloudPanelOpen((value) => !value);
              } else {
                handleStartCloudRoom();
              }
            }}
          >
            <Users size={16} />
          </button>
          <button
            className={settingsOpen ? "iconButton isActive" : "iconButton"}
            type="button"
            title="Settings"
            aria-label="Settings"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Settings size={16} />
          </button>
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
          <button
            className="modeButton modeButtonIcon"
            type="button"
            onClick={() => setRaw((value) => !value)}
            title={
              raw
                ? `Switch to rendered view (${SHORTCUT_LABELS.raw})`
                : `Switch to raw markdown view (${SHORTCUT_LABELS.raw})`
            }
            aria-label={raw ? "Rendered" : "Raw"}
            aria-pressed={raw}
          >
            {raw ? <Eye size={18} /> : <FileCode size={18} />}
          </button>
          <button
            className="modeButton modeButtonIcon"
            type="button"
            onClick={() => setZen((value) => !value)}
            title={zen ? `Normal Mode (${SHORTCUT_LABELS.zen})` : `Zen Mode (${SHORTCUT_LABELS.zen})`}
            aria-label={zen ? "Normal Mode" : "Zen Mode"}
            aria-pressed={zen}
          >
            {zen ? <BookOpenText size={18} /> : <Leaf size={18} />}
          </button>
        </div>
      </header>

      {!zen && (
        <nav className="toolbar" aria-label="Markdown formatting">
          <div className="toolbarSide toolbarSideLeft" aria-hidden="true" />

          <div className="toolbarCenter">
            {toolbarItems.map((item) => renderToolbarItem(item, toolbarContext, withEditor))}
          </div>

          <div className="toolbarSide toolbarSideRight">
            <span>{wordCount(markdown).toLocaleString()} words</span>
          </div>
        </nav>
      )}

      <section className={workspaceClass} aria-label="Editor workspace">
        <section className="editorShell" aria-label="Markdown editor">
          <MarkdownEditor
            key={fileVersion}
            value={markdown}
            zen={zen}
            raw={raw}
            contentWidth={contentWidth}
            onChange={setMarkdown}
            onFormatChange={setActiveFormat}
            onSelectionChange={setHasEditorSelection}
            onReady={handleReady}
            contributions={editorContributions}
          />
        </section>
        {commentsOpen && (
          <CommentsSidebar
            parseResult={commentsParse}
            selectedThreadId={selectedCommentId}
            raw={raw}
            onSelectThread={handleSelectCommentThread}
            onClose={() => setCommentsOpen(false)}
            onAddReply={handleAddCommentReply}
            onResolveThread={handleResolveCommentThread}
            onReanchorThread={handleReanchorCommentThread}
            onDeleteThread={handleDeleteCommentThread}
            canReanchorThread={hasEditorSelection}
          />
        )}
        {panelContributions.map((panel) => (
          <div className="contributionPanelSlot" key={panel.id}>
            {panel.render(appContributionContext)}
          </div>
        ))}
      </section>

      {settingsOpen && (
        <SettingsPanel
          commentAuthor={commentAuthor}
          commentNameRequired={commentNameRequired}
          contentWidth={contentWidth}
          autoSavePreference={autoSavePreference}
          appVersion={__APP_VERSION__}
          canCheckForUpdates={isTauriRuntime()}
          pendingUpdateVersion={pendingUpdate?.version ?? null}
          installingUpdate={installingUpdate}
          updateCheckStatus={updateCheckStatus}
          contributionContext={appContributionContext}
          settingsContributions={settingsContributions}
          onCommentAuthorNameChange={handleAuthorNameChange}
          onContentWidthChange={handleContentWidthChange}
          onAutoSavePreferenceChange={handleAutoSavePreferenceChange}
          onCheckForUpdate={handleCheckForUpdate}
          onInstallUpdate={handleInstallUpdate}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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
            {raw && <span>{lineCount(markdown).toLocaleString()} lines</span>}
            <span>{markdown.length.toLocaleString()} chars</span>
            {statusContributions.map((item) => (
              <span className="statusContribution" key={item.id}>
                {item.render(appContributionContext)}
              </span>
            ))}
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
  if (saveStatus === "autosaving") {
    return { label: "Autosaving…", tone: "saving" };
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

function renderToolbarItem(
  item: ToolbarItem,
  context: ToolbarContext,
  withEditor: (command: (view: EditorView) => void) => void,
) {
  if (item.type === "divider") {
    return <span className="toolbarDivider" key={item.id} />;
  }

  if (item.type === "select") {
    const active = Boolean(context.activeFormat.heading);
    return (
      <label className={active ? "headingMenu isActive" : "headingMenu"} key={item.id}>
        <span className="srOnly">{item.label}</span>
        <select
          aria-label={item.label}
          value={item.value(context)}
          onChange={(event) => {
            const value = event.currentTarget.value;
            withEditor((view) => {
              item.command(view, value);
            });
          }}
        >
          {item.options.map((option) => (
            <option value={option.value} disabled={option.disabled} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const Icon = item.icon;
  const active = item.isActive?.(context) ?? false;
  const disabled = item.isDisabled?.(context) ?? false;
  return (
    <button
      className={active ? "isActive" : undefined}
      aria-pressed={active}
      title={item.label}
      aria-label={item.label}
      type="button"
      disabled={disabled}
      key={item.id}
      onClick={() => withEditor((view) => {
        item.command(view);
      })}
    >
      <Icon size={14} />
    </button>
  );
}

function SettingsPanel({
  commentAuthor,
  commentNameRequired,
  contentWidth,
  autoSavePreference,
  appVersion,
  canCheckForUpdates,
  pendingUpdateVersion,
  installingUpdate,
  updateCheckStatus,
  contributionContext,
  settingsContributions,
  onCommentAuthorNameChange,
  onContentWidthChange,
  onAutoSavePreferenceChange,
  onCheckForUpdate,
  onInstallUpdate,
  onClose,
}: {
  commentAuthor: CommentAuthor;
  commentNameRequired: boolean;
  contentWidth: ContentWidth;
  autoSavePreference: AutoSavePreference;
  appVersion: string;
  canCheckForUpdates: boolean;
  pendingUpdateVersion: string | null;
  installingUpdate: boolean;
  updateCheckStatus: UpdateCheckStatus;
  contributionContext: AppContributionContext;
  settingsContributions: ReturnType<typeof collectSettingsContributions>;
  onCommentAuthorNameChange: (name: string) => void;
  onContentWidthChange: (value: ContentWidth) => void;
  onAutoSavePreferenceChange: (value: AutoSavePreference) => void;
  onCheckForUpdate: () => void;
  onInstallUpdate: () => void;
  onClose: () => void;
}) {
  const updateStatusText = getUpdateStatusText(updateCheckStatus, pendingUpdateVersion);

  return (
    <div className="settingsOverlay">
      <section className="settingsPanel" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settingsHeader">
          <div>
            <h2>Settings</h2>
            <p>Editor preferences</p>
          </div>
          <button className="iconButton" type="button" title="Close settings" aria-label="Close settings" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settingsSection">
          <h3>Editor</h3>
          <label className="settingsField">
            <span>Content width</span>
            <select
              aria-label="Content width"
              value={contentWidth}
              onChange={(event) => onContentWidthChange(event.currentTarget.value as ContentWidth)}
            >
              <option value="focused">Focused</option>
              <option value="wide">Wide</option>
              <option value="full">Full width</option>
            </select>
          </label>
          <label className="settingsField">
            <span>Autosave</span>
            <select
              aria-label="Autosave"
              value={autoSavePreference.mode}
              onChange={(event) => {
                onAutoSavePreferenceChange({
                  ...autoSavePreference,
                  mode: event.currentTarget.value as AutoSaveMode,
                });
              }}
            >
              <option value="off">Off</option>
              <option value="after-edit">After edits</option>
              <option value="interval">Every interval</option>
            </select>
          </label>
          <label className="settingsField">
            <span>Autosave interval</span>
            <select
              aria-label="Autosave interval"
              value={String(autoSavePreference.intervalSeconds)}
              disabled={autoSavePreference.mode !== "interval"}
              onChange={(event) => {
                onAutoSavePreferenceChange({
                  ...autoSavePreference,
                  intervalSeconds: Number(event.currentTarget.value) as AutoSaveInterval,
                });
              }}
            >
              {AUTOSAVE_INTERVAL_OPTIONS.map((seconds) => (
                <option value={seconds} key={seconds}>
                  {formatAutoSaveInterval(seconds)}
                </option>
              ))}
            </select>
          </label>
          <p className="settingsNotice">
            Autosave writes existing files only. New untitled documents still need Save once.
          </p>
        </div>

        <div className="settingsSection">
          <h3>Comments</h3>
          <label className="commentAuthorField">
            <span>Display name</span>
            <input
              value={commentAuthor.name}
              onChange={(event) => onCommentAuthorNameChange(event.currentTarget.value)}
              placeholder="Your name"
              aria-invalid={commentNameRequired && !commentAuthor.name.trim()}
              aria-describedby={commentNameRequired && !commentAuthor.name.trim() ? "comment-name-required" : undefined}
            />
          </label>
          {commentNameRequired && !commentAuthor.name.trim() && (
            <p className="settingsNotice settingsNoticeError" id="comment-name-required">
              Set a display name before adding a comment.
            </p>
          )}
        </div>

        {settingsContributions.map((contribution) => (
          <div className="settingsSection" key={contribution.id}>
            <h3>{contribution.title}</h3>
            {contribution.render(contributionContext)}
          </div>
        ))}

        <div className="settingsSection">
          <h3>App</h3>
          <div className="settingsInfoRow">
            <span>Version</span>
            <strong>{formatUpdateVersion(appVersion)}</strong>
          </div>
          <div className="settingsActionRow">
            <button
              type="button"
              className="settingsActionButton"
              onClick={onCheckForUpdate}
              disabled={!canCheckForUpdates || updateCheckStatus === "checking" || installingUpdate}
            >
              {updateCheckStatus === "checking" ? "Checking..." : "Check for updates"}
            </button>
            {pendingUpdateVersion && (
              <button
                type="button"
                className="settingsActionButton settingsActionButtonPrimary"
                onClick={onInstallUpdate}
                disabled={installingUpdate}
              >
                {installingUpdate ? "Installing..." : `Install ${formatUpdateVersion(pendingUpdateVersion)}`}
              </button>
            )}
          </div>
          <p className={updateCheckStatus === "error" ? "settingsNotice settingsNoticeError" : "settingsNotice"}>
            {updateStatusText}
          </p>
        </div>
      </section>
    </div>
  );
}

function getUpdateStatusText(status: UpdateCheckStatus, pendingUpdateVersion: string | null) {
  if (pendingUpdateVersion) {
    return `Update ${formatUpdateVersion(pendingUpdateVersion)} is available.`;
  }
  switch (status) {
    case "checking":
      return "Checking GitHub Releases for an update.";
    case "current":
      return "You are running the latest available version.";
    case "error":
      return "Update check failed. Try again later.";
    case "web":
      return "Update checks are available in the Mac app.";
    case "available":
    case "idle":
    default:
      return "Manual update checks are available in the Mac app.";
  }
}

function wordCount(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

// Newline-delimited line count, matching what a source-view gutter renders
// (including a phantom trailing line when the document ends in a newline).
// "" -> 1, "a\nb" -> 2, "a\nb\n" -> 3. This is intentionally different from
// CodeMirror's `EditorState.doc.lines`, which collapses the trailing-newline
// phantom — the gutter-style count is the more useful one for users editing
// raw markdown source. Used by the status bar in raw mode.
function lineCount(markdown: string) {
  return markdown.split("\n").length;
}
