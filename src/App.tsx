import { EditorView } from "@codemirror/view";
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
  PanelLeftOpen,
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
import { FloatingHeadings } from "./FloatingHeadings";
import { FileSidebar } from "./FileSidebar";
import {
  DEFAULT_NEW_FILE_NAME,
  type FileAdapter,
  type FileHandle,
  type LocalFile,
} from "./fileAdapter";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPrintDocument } from "./MarkdownPrintDocument";
import type { MarkdownHeading } from "./headingNavigation";
import {
  isMarkdownPath,
  openMarkdownFromPath,
  tauriFileAdapter,
  tauriSessionFileAdapter,
} from "./tauriFileAdapter";
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
import { webFileAdapter, webSessionFileAdapter } from "./webFileAdapter";
import {
  addLocalFile,
  applyLocalFileSave,
  createLocalFiles,
  removeLocalFile,
  selectLocalFile,
  updateLocalFileContents,
  updateLocalFileRecovery,
  updateLocalFileReference,
  type LocalFileEntry,
  type LocalFileRecoveryStatus,
  type LocalFilesState,
} from "./localFiles";
import {
  createLocalSessionPersistence,
  createLocalStorageSessionStorage,
  type PersistedLocalFile,
  type SessionFileAdapter,
} from "./sessionPersistence";

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

let localFileSequence = 0;

function createLocalFileId(): string {
  localFileSequence += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${localFileSequence}`;
}

const emptyLocalFiles: LocalFilesState = { entries: [], activeId: null };

function parentFolderLabel(path: string): string | undefined {
  const parts = path.replaceAll("\\", "/").split("/");
  parts.pop();
  const parent = parts.filter(Boolean).at(-1);
  if (parent) return parent;
  return path.startsWith("/") ? "/" : undefined;
}

function getSessionFileAdapter(): SessionFileAdapter {
  return isTauriRuntime() ? tauriSessionFileAdapter : webSessionFileAdapter;
}

function recoveryMessage(status: LocalFileRecoveryStatus): string | null {
  switch (status) {
    case "conflict": return "The file changed outside the editor. Saving requires confirmation.";
    case "missing": return "The original file is missing. Your recovered draft is still available.";
    case "permission-needed": return "Reconnect this browser file before saving. Your recovered draft is still available.";
    case "upload-required": return "Choose the original browser file again to reconnect this recovered draft.";
    case "denied": return "Permission to reopen this file was denied. Your recovered draft is still available.";
    case "unavailable": return "The original file could not be reopened. Your recovered draft is still available.";
    case "ready": return null;
  }
}

async function recoverPersistedFile(
  persisted: PersistedLocalFile,
  adapter: SessionFileAdapter,
): Promise<LocalFileEntry> {
  const retained = (recoveryStatus: LocalFileRecoveryStatus): LocalFileEntry => ({
    id: persisted.id,
    name: persisted.displayName,
    contents: persisted.draft,
    savedContents: persisted.savedBaseline,
    handle: null,
    reopen: persisted.reopen,
    recoveryStatus,
  });
  if (persisted.reopen.kind === "untitled") return retained("ready");
  const result = await adapter.reconnect(persisted.reopen);
  if (result.status !== "reopened") {
    const status = result.status === "unsupported" ? "unavailable" : result.status;
    return retained(status);
  }
  if (!persisted.dirty) {
    return {
      ...retained("ready"),
      name: result.file.name,
      contents: result.file.contents,
      savedContents: result.file.contents,
      handle: result.file.handle,
    };
  }
  const conflicted = result.file.contents !== persisted.savedBaseline;
  return {
    ...retained(conflicted ? "conflict" : "ready"),
    name: result.file.name,
    handle: result.file.handle,
    ...(conflicted ? { externalContents: result.file.contents } : {}),
  };
}

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

const PRINT_RESTORE_FALLBACK_MS = 30_000;
const PRINT_RESTORE_AFTER_FOCUS_MS = 500;

export function App() {
  // An absent primary snapshot is a synchronously-known fresh launch, so the
  // welcome document can mount immediately. Any present or unreadable value
  // stays behind the hydration gate and can never be overwritten by defaults.
  const [startup] = useState(() => {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("markdown.localSession.v1") === null) {
        const files = createLocalFiles(
          { name: initialFile.name, contents: initialMarkdown, handle: null },
          createLocalFileId(),
          { kind: "untitled" },
        );
        return { fresh: true, files, markdown: initialMarkdown };
      }
    } catch {
      // The async persistence read below owns the user-visible failure.
    }
    return { fresh: false, files: emptyLocalFiles, markdown: "" };
  });
  const [localFiles, setLocalFiles] = useState<LocalFilesState>(startup.files);
  const [markdown, setMarkdown] = useState(startup.markdown);
  const [fileSidebarVisible, setFileSidebarVisible] = useState(true);
  const [hydrated, setHydrated] = useState(startup.fresh);
  const [hydrationChecked, setHydrationChecked] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ActiveFormat>(emptyFormat);
  const [hasEditorSelection, setHasEditorSelection] = useState(false);
  const [headings, setHeadings] = useState<MarkdownHeading[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);
  const [activeCloudRoom, setActiveCloudRoom] = useState<CloudRoomHandle | null>(null);
  const [peerCloudRoom, setPeerCloudRoom] = useState<CloudRoomHandle | null>(null);
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
  const mountedRef = useRef(true);
  const hydratedRef = useRef(startup.fresh);
  const queuedOpenPathsRef = useRef<string[]>([]);
  const selectionVersionRef = useRef(0);
  const saveOperationSequenceRef = useRef(0);
  const latestCompletedSaveAsRef = useRef(new Map<string, number>());
  const saveTailsRef = useRef(new Map<string, Promise<void>>());
  const savedBaselineRef = useRef(new Map<string, { handle: FileHandle; contents: string }>());
  const sessionPersistenceRef = useRef(
    createLocalSessionPersistence(createLocalStorageSessionStorage()),
  );
  const localFilesRef = useRef(localFiles);
  localFilesRef.current = localFiles;
  const activeLocalFile =
    localFiles.entries.find((entry) => entry.id === localFiles.activeId) ?? null;
  const sidebarFiles = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const entry of localFiles.entries) {
      nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
    }
    return localFiles.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      dirty: entry.contents !== entry.savedContents,
      ...(nameCounts.get(entry.name)! > 1 && entry.reopen.kind === "desktop-path"
        ? { location: parentFolderLabel(entry.reopen.path) }
        : {}),
    }));
  }, [localFiles.entries]);
  const file: FileState = activeLocalFile
    ? {
        name: activeLocalFile.name,
        handle: activeLocalFile.handle,
        savedContents: activeLocalFile.savedContents,
      }
    : { name: DEFAULT_NEW_FILE_NAME, handle: null, savedContents: "" };
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
  const activeCloudRoomRef = useRef(activeCloudRoom);
  activeCloudRoomRef.current = activeCloudRoom;
  const peerCloudRoomRef = useRef(peerCloudRoom);
  peerCloudRoomRef.current = peerCloudRoom;

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      const persistence = sessionPersistenceRef.current;
      const result = await persistence.read();
      if (cancelled || !mountedRef.current) return;

      if (startup.fresh && result.status === "empty") {
        setHydrationChecked(true);
        return;
      }

      let restored = emptyLocalFiles;
      let restoredSidebarVisible = true;
      let hydrationError: string | null = null;

      if (result.status === "ok") {
        const entries = await Promise.all(
          [...result.snapshot.files]
            .sort((left, right) => left.order - right.order)
            .map((entry) => recoverPersistedFile(entry, getSessionFileAdapter())),
        );
        if (cancelled || !mountedRef.current) return;
        restored = {
          entries,
          activeId: entries.some((entry) => entry.id === result.snapshot.activeFileId)
            ? result.snapshot.activeFileId
            : entries[0]?.id ?? null,
        };
        restoredSidebarVisible = result.snapshot.sidebarVisible ?? true;
        if (result.recoveredFromBackup) {
          hydrationError = "The latest session was damaged, so the previous recovery snapshot was restored.";
        }
      } else if (result.status === "empty") {
        const id = createLocalFileId();
        restored = createLocalFiles(
          { name: initialFile.name, contents: initialMarkdown, handle: null },
          id,
          { kind: "untitled" },
        );
      } else if (result.status === "unsupported-version") {
        hydrationError = "This editor cannot safely update recovery data created by a newer version.";
      } else {
        hydrationError = "Session recovery storage is unavailable. Changes may not survive restart.";
        if (result.lastUsable) {
          const entries = await Promise.all(
            [...result.lastUsable.files]
              .sort((left, right) => left.order - right.order)
              .map((entry) => recoverPersistedFile(entry, getSessionFileAdapter())),
          );
          if (cancelled || !mountedRef.current) return;
          restored = {
            entries,
            activeId: entries.some((entry) => entry.id === result.lastUsable?.activeFileId)
              ? result.lastUsable.activeFileId
              : entries[0]?.id ?? null,
          };
          restoredSidebarVisible = result.lastUsable.sidebarVisible ?? true;
        } else {
          restored = createLocalFiles(
            { name: initialFile.name, contents: initialMarkdown, handle: null },
            createLocalFileId(),
            { kind: "untitled" },
          );
        }
      }

      const active = restored.entries.find((entry) => entry.id === restored.activeId) ?? null;
      setLocalFiles(restored);
      setMarkdown(active?.contents ?? "");
      setFileSidebarVisible(restoredSidebarVisible);
      const activeRecoveryMessage = active ? recoveryMessage(active.recoveryStatus) : null;
      if (activeRecoveryMessage || hydrationError) {
        setSaveStatus("error");
        setSaveError(activeRecoveryMessage ?? hydrationError);
      }
      hydratedRef.current = true;
      setHydrated(true);
      setHydrationChecked(true);
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [startup.fresh]);

  useEffect(() => {
    if (!hydrated || !hydrationChecked) return;
    const snapshot = {
      activeFileId: localFiles.activeId,
      sidebarVisible: fileSidebarVisible,
      files: localFiles.entries.map((entry, order) => ({
        id: entry.id,
        displayName: entry.name,
        order,
        draft: entry.contents,
        savedBaseline: entry.savedContents,
        dirty: entry.contents !== entry.savedContents,
        untitled: entry.reopen.kind === "untitled",
        reopen: entry.reopen,
      })),
    };
    void sessionPersistenceRef.current.write(snapshot).then((result) => {
      if (!mountedRef.current || result.status === "written") return;
      setSaveStatus("error");
      setSaveError(
        result.status === "stale"
          ? "Recovery data changed in another window. This window will not overwrite it."
          : "Session recovery could not be saved. Changes may not survive restart.",
      );
    });
  }, [fileSidebarVisible, hydrated, hydrationChecked, localFiles]);

  useEffect(() => {
    if (!hydrated || !hydrationChecked) return;
    const flush = () => { void sessionPersistenceRef.current.flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [hydrated, hydrationChecked]);

  useEffect(() => {
    if (!hydrated || !hydrationChecked || !isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow();
      const stop = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        const result = await sessionPersistenceRef.current.flush();
        if (result.status !== "flushed") {
          setSaveStatus("error");
          setSaveError("The editor could not flush recovery data before closing.");
          return;
        }
        await appWindow.destroy();
      });
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => {
      console.error("Failed to bind session close flush", error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hydrated, hydrationChecked]);

  const dirty = activeLocalFile ? markdown !== activeLocalFile.savedContents : false;
  const hasDirtyLocalFiles = localFiles.entries.some(
    (entry) => entry.contents !== entry.savedContents,
  );
  const commentsParse = useMemo(() => parseComments(markdown), [markdown]);
  const badge = useMemo(
    () => describeStatus({
      saveStatus,
      dirty,
      hasHandle: file.handle !== null,
      recoveryStatus: activeLocalFile?.recoveryStatus,
    }),
    [activeLocalFile?.recoveryStatus, saveStatus, dirty, file.handle],
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

  const handleNavigateToHeading = useCallback((heading: MarkdownHeading) => {
    const view = editorRef.current;
    if (!view) {
      return;
    }
    const position = Math.min(heading.contentFrom, view.state.doc.length);
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 24 }),
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
            awareness: activeCloudRoom.awareness,
          })
        : null,
    [activeCloudRoom],
  );

  const handleStartCloudRoom = useCallback(() => {
    if (activeCloudRoomRef.current) {
      setCloudPanelOpen(true);
      return;
    }
    if (!localFilesRef.current.activeId) {
      return;
    }
    const cloudRoom = inMemoryCloudSessionProvider.createRoom({
      seedMarkdown: markdownRef.current,
    });
    const peerRoom = inMemoryCloudSessionProvider.joinRoom({
      roomId: cloudRoom.roomId,
      participantId: "human-secondary",
    });
    setActiveCloudRoom(cloudRoom);
    setPeerCloudRoom(peerRoom);
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
    peerCloudRoomRef.current?.destroy();
    cloudRoom.destroy();
    setActiveCloudRoom(null);
    setPeerCloudRoom(null);
    setCloudPanelOpen(false);
    setMarkdown(snapshot);
    const activeId = localFilesRef.current.activeId;
    if (activeId) {
      setLocalFiles((current) => updateLocalFileContents(current, activeId, snapshot));
    }
    setFileVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    return () => {
      peerCloudRoomRef.current?.destroy();
      activeCloudRoomRef.current?.destroy();
    };
  }, []);

  const cloudContribution = useMemo(
    () => createCloudCollaborationContribution({
      open: cloudPanelOpen,
      cloudRoom: activeCloudRoom,
      peerRoom: peerCloudRoom,
      onClose: () => setCloudPanelOpen(false),
      onLeaveRoom: handleLeaveCloudRoom,
    }),
    [cloudPanelOpen, activeCloudRoom, peerCloudRoom, handleLeaveCloudRoom],
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

  const resetTransientFileUi = useCallback(() => {
    setSaveStatus("idle");
    setSaveError(null);
    setSelectedCommentId(null);
    setCommentsOpen(false);
    setHeadings([]);
    setActiveHeadingId(null);
    setFileVersion((value) => value + 1);
  }, []);

  const addFileSession = useCallback(async (
    next: LocalFile,
    activate = true,
    isUntitled = false,
  ) => {
    const id = createLocalFileId();
    let reopen;
    try {
      reopen = await getSessionFileAdapter().createReference(next.handle, isUntitled);
    } catch (error) {
      console.error("Could not retain the file reference", error);
      reopen = isUntitled
        ? { kind: "untitled" } as const
        : { kind: "browser-upload-only", status: "upload-only" } as const;
      setSaveStatus("error");
      setSaveError("The file is open, but its reconnect permission could not be saved.");
    }
    if (!mountedRef.current || activeCloudRoomRef.current) return;
    setLocalFiles((current) => addLocalFile(current, next, id, reopen, activate));
    if (activate) {
      selectionVersionRef.current += 1;
      setMarkdown(next.contents);
      resetTransientFileUi();
    }
  }, [resetTransientFileUi]);

  const allowLocalFileAction = useCallback(() => {
    if (!hydratedRef.current) {
      return false;
    }
    if (!activeCloudRoomRef.current) {
      return true;
    }
    if (typeof window !== "undefined") {
      window.alert("Leave the collaboration room before changing local files.");
    }
    return false;
  }, []);

  const handleNew = useCallback(() => {
    if (!allowLocalFileAction()) {
      return;
    }
    const adapter = getActiveAdapter();
    const fresh = adapter.newFile();
    void addFileSession(fresh, true, true);
  }, [addFileSession, allowLocalFileAction]);

  const handleOpen = useCallback(async () => {
    if (!allowLocalFileAction()) {
      return;
    }
    const adapter = getActiveAdapter();
    const selectionVersion = selectionVersionRef.current;

    try {
      const opened = await adapter.openFile();
      if (!opened || activeCloudRoomRef.current) {
        return;
      }
      await addFileSession(opened, selectionVersionRef.current === selectionVersion);
    } catch (error) {
      console.error("Open failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Open failed");
    }
  }, [addFileSession, allowLocalFileAction]);

  const handleSelectLocalFile = useCallback((id: string) => {
    if (!allowLocalFileAction()) {
      return;
    }
    const entry = localFilesRef.current.entries.find((candidate) => candidate.id === id);
    if (!entry || localFilesRef.current.activeId === id) {
      return;
    }
    setLocalFiles((current) => selectLocalFile(current, id));
    selectionVersionRef.current += 1;
    setMarkdown(entry.contents);
    resetTransientFileUi();
    const message = recoveryMessage(entry.recoveryStatus);
    if (message) {
      setSaveStatus("error");
      setSaveError(message);
    }
  }, [allowLocalFileAction, resetTransientFileUi]);

  const handleCloseLocalFile = useCallback((id: string) => {
    if (!allowLocalFileAction()) {
      return;
    }
    const current = localFilesRef.current;
    const entry = current.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      return;
    }
    if (
      entry.contents !== entry.savedContents &&
      typeof window !== "undefined" &&
      !window.confirm(`Discard unsaved changes to ${entry.name}?`)
    ) {
      return;
    }
    const nextState = removeLocalFile(current, id);
    selectionVersionRef.current += 1;
    setLocalFiles(nextState);
    if (current.activeId === id) {
      editorRef.current = null;
      setActiveFormat(emptyFormat);
      setHasEditorSelection(false);
      const nextEntry =
        nextState.entries.find((candidate) => candidate.id === nextState.activeId) ?? null;
      setMarkdown(nextEntry?.contents ?? "");
      resetTransientFileUi();
    }
  }, [allowLocalFileAction, resetTransientFileUi]);

  const handleMarkdownChange = useCallback((contents: string) => {
    setMarkdown(contents);
    if (activeCloudRoomRef.current) {
      return;
    }
    const activeId = localFilesRef.current.activeId;
    if (activeId) {
      setLocalFiles((current) => updateLocalFileContents(current, activeId, contents));
    }
  }, []);

  const handleSaveAs = useCallback(async () => {
    const entry = localFilesRef.current.entries.find(
      (candidate) => candidate.id === localFilesRef.current.activeId,
    );
    if (!entry || activeCloudRoomRef.current) {
      return;
    }
    const adapter = getActiveAdapter();
    setSaveStatus("saving");
    setSaveError(null);

    const contents = markdownRef.current;
    const entryId = entry.id;
    const operation = ++saveOperationSequenceRef.current;
    const isActive = () => localFilesRef.current.activeId === entryId;

    try {
      const result = await adapter.saveFileAs(entry.name || DEFAULT_NEW_FILE_NAME, contents);
      if (!result) {
        if (isActive()) {
          setSaveStatus("idle");
        }
        return;
      }
      // A cancelled picker does not supersede a prior successful destination.
      // Once bytes were actually written, however, this operation owns the
      // destination unless a later Save As also writes successfully.
      const newerCompletedSaveAs = latestCompletedSaveAsRef.current.get(entryId) ?? 0;
      if (newerCompletedSaveAs > operation) return;
      latestCompletedSaveAsRef.current.set(entryId, operation);
      let reopen;
      try {
        reopen = await getSessionFileAdapter().createReference(result.handle, false);
      } catch (error) {
        console.error("Could not retain saved file reference", error);
        if (latestCompletedSaveAsRef.current.get(entryId) !== operation) return;
        const fallback = { kind: "browser-upload-only", status: "upload-only" } as const;
        savedBaselineRef.current.set(entryId, { handle: result.handle, contents });
        setLocalFiles((current) =>
          updateLocalFileReference(
            applyLocalFileSave(current, entryId, result, contents),
            entryId,
            fallback,
          ),
        );
        if (isActive()) {
          setSaveStatus("error");
          setSaveError("The file was saved, but its reconnect permission could not be retained.");
        }
        return;
      }
      if (latestCompletedSaveAsRef.current.get(entryId) !== operation) return;
      savedBaselineRef.current.set(entryId, { handle: result.handle, contents });
      setLocalFiles((current) =>
        updateLocalFileReference(
          applyLocalFileSave(current, entryId, result, contents),
          entryId,
          reopen,
        ),
      );
      if (isActive()) {
        setSaveStatus("idle");
      }
    } catch (error) {
      if (!isActive()) {
        console.error("Save-as failed for inactive file", error);
        return;
      }
      console.error("Save-as failed", error);
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed");
    }
  }, []);

  const allowOverwriteCurrentSource = useCallback(async (
    entry: LocalFileEntry,
    intent: "manual" | "autosave",
  ): Promise<boolean> => {
    if (entry.reopen.kind !== "desktop-path" && entry.reopen.kind !== "browser-capability") {
      return true;
    }
    const reopened = await getSessionFileAdapter().reconnect(entry.reopen);
    if (reopened.status !== "reopened") {
      const status = reopened.status === "unsupported" ? "unavailable" : reopened.status;
      setLocalFiles((current) => updateLocalFileRecovery(current, entry.id, status));
      if (localFilesRef.current.activeId === entry.id) {
        setSaveStatus("error");
        setSaveError(recoveryMessage(status));
      }
      return false;
    }
    const externalChanged = reopened.file.contents !== entry.savedContents;
    if (!externalChanged) return true;
    setLocalFiles((current) =>
      updateLocalFileRecovery(current, entry.id, "conflict", reopened.file.contents),
    );
    if (intent === "autosave") {
      if (localFilesRef.current.activeId === entry.id) {
        setSaveStatus("error");
        setSaveError("Autosave stopped because the file changed outside the editor.");
      }
      return false;
    }
    return typeof window !== "undefined" && window.confirm(
      `${entry.name} changed outside the editor. Overwrite the external version with this recovered draft?`,
    );
  }, []);

  const performSave = useCallback(async (intent: "manual" | "autosave") => {
    const entry = localFilesRef.current.entries.find(
      (candidate) => candidate.id === localFilesRef.current.activeId,
    );
    if (!entry || activeCloudRoomRef.current) {
      return;
    }
    const adapter = getActiveAdapter();

    if (!entry.handle) {
      if (intent === "manual") {
        await handleSaveAs();
      }
      return;
    }

    // Capture the document bytes with the target identity before any
    // asynchronous reconnect/conflict check. Reading the global editor after
    // that await could pair a newly selected document's text with this
    // entry's handle.
    const contents = markdownRef.current;
    const entryId = entry.id;
    const handle = entry.handle;

    const run = async () => {
      // Re-read state after earlier saves for this file settle. The handle
      // identity still guards close/Save As destination changes, while the
      // baseline may legitimately have advanced because of the prior save.
      const currentEntry = localFilesRef.current.entries.find(
        (candidate) => candidate.id === entryId,
      );
      if (!currentEntry || currentEntry.handle !== handle) return;
      const immediateBaseline = savedBaselineRef.current.get(entryId);
      const entryForCheck = immediateBaseline?.handle === handle
        ? { ...currentEntry, savedContents: immediateBaseline.contents }
        : currentEntry;

      if (!(await allowOverwriteCurrentSource(entryForCheck, intent))) return;

      const checkedEntry = localFilesRef.current.entries.find(
        (candidate) => candidate.id === entryId,
      );
      if (!checkedEntry || checkedEntry.handle !== handle) return;

      setSaveStatus(intent === "autosave" ? "autosaving" : "saving");
      setSaveError(null);
      const isActive = () => localFilesRef.current.activeId === entryId;

      try {
        const result = await adapter.saveFile(handle, contents, entry.name);
        const destinationStillCurrent = localFilesRef.current.entries.some(
          (candidate) => candidate.id === entryId && candidate.handle === handle,
        );
        if (!destinationStillCurrent) return;
        savedBaselineRef.current.set(entryId, { handle, contents });
        setLocalFiles((current) => {
          const target = current.entries.find((candidate) => candidate.id === entryId);
          return !target || target.handle !== handle
            ? current
            : applyLocalFileSave(current, entryId, result, contents);
        });
        if (isActive()) setSaveStatus("idle");
      } catch (error) {
        if (!isActive()) {
          console.error("Save failed for inactive file", error);
          return;
        }
        console.error("Save failed", error);
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Save failed");
      }
    };

    const previous = saveTailsRef.current.get(entryId) ?? Promise.resolve();
    const queued = previous.then(run, run);
    saveTailsRef.current.set(entryId, queued);
    await queued;
    if (saveTailsRef.current.get(entryId) === queued) {
      saveTailsRef.current.delete(entryId);
    }
  }, [allowOverwriteCurrentSource, handleSaveAs]);

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
    });
  }, []);

  const handleExportPdf = useCallback(() => {
    if (typeof window === "undefined" || !localFilesRef.current.activeId) {
      return;
    }

    const previousTitle = document.title;
    document.title = toPdfTitle(file.name || DEFAULT_NEW_FILE_NAME);

    let finished = false;
    let fallbackTimer: number | undefined;
    const preparePrint = () => {
      flushSync(() => {
        setPrintExporting(true);
      });
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
      window.removeEventListener("focus", finishAfterFocus);
      finishPrintExport(previousTitle);
    };
    const scheduleFallback = (delay: number) => {
      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
      }
      fallbackTimer = window.setTimeout(finish, delay);
    };
    const finishAfterFocus = () => {
      scheduleFallback(PRINT_RESTORE_AFTER_FOCUS_MS);
    };

    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", finish);
    window.addEventListener("focus", finishAfterFocus);
    try {
      preparePrint();
      window.print();
      // Some webviews do not reliably fire `afterprint` when the user
      // cancels. Keep the print layout alive while the dialog/preview is open:
      // some PDF pipelines save from the live webview after preview has
      // rendered. Focus returning is the earliest safe fallback signal.
      if (!finished) {
        scheduleFallback(PRINT_RESTORE_FALLBACK_MS);
      }
    } catch (error) {
      console.error("PDF export print failed", error);
      finish();
    }
  }, [file.name, finishPrintExport]);

  // Load a file by absolute path. Shared by the OS file-open path (Finder
  // double-click, "Open With", drag onto the dock icon) and the in-window
  // drag-drop handler. Non-markdown paths are silently ignored so a stray
  // drop on the editor doesn't replace the working file.
  const loadPathFile = useCallback(
    async (path: string) => {
      if (!path || !isMarkdownPath(path)) {
        return;
      }
      if (!hydratedRef.current) {
        queuedOpenPathsRef.current.push(path);
        return;
      }
      if (!allowLocalFileAction()) {
        return;
      }
      try {
        const next = await openMarkdownFromPath(path);
        if (next && !activeCloudRoomRef.current) {
          addFileSession(next);
        }
      } catch (error) {
        console.error("Failed to open path", path, error);
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Failed to open file");
      }
    },
    [addFileSession, allowLocalFileAction],
  );

  useEffect(() => {
    if (!hydrated || queuedOpenPathsRef.current.length === 0) return;
    const queued = queuedOpenPathsRef.current.splice(0);
    for (const path of queued) {
      void loadPathFile(path);
    }
  }, [hydrated, loadPathFile]);

  // Web sibling of `loadPathFile`: read a `File` object dropped onto the
  // window. The Tauri build receives an absolute path through the
  // `tauri://drag-drop` IPC event; the browser receives the file's bytes
  // directly via the HTML5 drop event. Both shells add a new local session,
  // so an existing dirty buffer stays open regardless of how the file arrived.
  const loadDroppedFile = useCallback(
    async (droppedFile: File) => {
      if (!droppedFile || !isMarkdownPath(droppedFile.name)) {
        return;
      }
      if (!allowLocalFileAction()) {
        return;
      }
      try {
        const contents = await droppedFile.text();
        if (activeCloudRoomRef.current) {
          return;
        }
        // `handle: null` because a DOM drop event does not surface a File
        // System Access handle. Subsequent Save will route through Save-As,
        // matching the input-fallback path in `webFileAdapter.openFile`.
        addFileSession({ name: droppedFile.name, contents, handle: null });
      } catch (error) {
        console.error("Failed to read dropped file", droppedFile.name, error);
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Failed to open file");
      }
    },
    [addFileSession, allowLocalFileAction],
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

  // Warn if any open local buffer is dirty, not only the visible one.
  useEffect(() => {
    if (!hasDirtyLocalFiles) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDirtyLocalFiles]);

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
            {!fileSidebarVisible && (
              <>
                <button
                  className="iconButton"
                  type="button"
                  title="Show file sidebar"
                  aria-label="Show file sidebar"
                  onClick={() => setFileSidebarVisible(true)}
                >
                  <PanelLeftOpen size={16} />
                </button>
                <button className="iconButton" type="button" title="New file" aria-label="New file" onClick={handleNew}>
                  <FilePlus size={16} />
                </button>
                <button className="iconButton" type="button" title="Open file" aria-label="Open file" onClick={handleOpen}>
                  <FolderOpen size={16} />
                </button>
              </>
            )}
            <button
              className="iconButton"
              type="button"
              title="Save file"
              aria-label="Save file"
              onClick={() => void handleSave()}
              disabled={!activeLocalFile || saveStatus === "saving"}
            >
              <Save size={16} />
            </button>
            <button
              className="iconButton"
              type="button"
              title="Export rendered PDF"
              aria-label="Export rendered PDF"
              onClick={handleExportPdf}
              disabled={!activeLocalFile}
            >
              <FileDown size={16} />
            </button>
          </div>
        ) : (
          <div className="windowSlot" aria-hidden="true" />
        )}

        <div className="titleCluster">
          <div className="documentTitle">
            {!hydrated ? "Restoring session…" : activeLocalFile ? file.name : "No file open"}
          </div>
          {!zen && activeLocalFile && (
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
            {toolbarItems.map((item) => renderToolbarItem(item, toolbarContext, withEditor, !activeLocalFile))}
          </div>

          <div className="toolbarSide toolbarSideRight">
            <span>{wordCount(markdown).toLocaleString()} words</span>
          </div>
        </nav>
      )}

      <div className="workspaceFrame">
        {!zen && fileSidebarVisible && (
          <FileSidebar
            files={sidebarFiles}
            activeId={localFiles.activeId}
            onNew={handleNew}
            onOpen={() => void handleOpen()}
            onSelect={handleSelectLocalFile}
            onClose={handleCloseLocalFile}
            onHide={() => setFileSidebarVisible(false)}
            disabled={Boolean(activeCloudRoom)}
          />
        )}
        <section className={workspaceClass} aria-label="Editor workspace">
          <section className="editorShell" aria-label="Markdown editor">
          {activeLocalFile ? (
          <MarkdownEditor
            key={`${localFiles.activeId ?? "no-file"}-${fileVersion}`}
            value={markdown}
            zen={zen}
            raw={raw}
            contentWidth={contentWidth}
            onChange={handleMarkdownChange}
            onFormatChange={setActiveFormat}
            onSelectionChange={setHasEditorSelection}
            onHeadingsChange={setHeadings}
            onActiveHeadingChange={setActiveHeadingId}
            onReady={handleReady}
            contributions={editorContributions}
          />
          ) : !hydrated ? (
            <div className="emptyFileEditor" aria-live="polite">
              <p>Restoring your editor session…</p>
            </div>
          ) : (
            <div className="emptyFileEditor">
              <p>Open or create a Markdown file to start writing.</p>
              <button type="button" onClick={handleNew}>Create a file</button>
              <button type="button" onClick={() => void handleOpen()}>Choose a file</button>
            </div>
          )}
          {headings.length >= 2 && (
            <FloatingHeadings
              headings={headings}
              activeHeadingId={activeHeadingId}
              contentWidth={contentWidth}
              onNavigate={handleNavigateToHeading}
            />
          )}
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
      </div>

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
            <span>{activeLocalFile ? file.name : "No file open"}</span>
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

      {printExporting && (
        <section className="printExportSurface" aria-hidden="true">
          <MarkdownPrintDocument markdown={markdown} />
        </section>
      )}
    </main>
  );
}

function describeStatus({
  saveStatus,
  dirty,
  hasHandle,
  recoveryStatus,
}: {
  saveStatus: SaveStatus;
  dirty: boolean;
  hasHandle: boolean;
  recoveryStatus?: LocalFileRecoveryStatus;
}): { label: string; tone: "saved" | "unsaved" | "saving" | "error" | "new" } {
  if (saveStatus === "saving") {
    return { label: "Saving…", tone: "saving" };
  }
  if (saveStatus === "autosaving") {
    return { label: "Autosaving…", tone: "saving" };
  }
  if (recoveryStatus && recoveryStatus !== "ready") {
    return {
      label: recoveryStatus === "conflict" ? "External changes" : "Reconnect needed",
      tone: "error",
    };
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
  unavailable = false,
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
          disabled={unavailable}
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
  const disabled = unavailable || (item.isDisabled?.(context) ?? false);
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
