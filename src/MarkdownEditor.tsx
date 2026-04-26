import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { getActiveFormat, type ActiveFormat } from "./editorFormat";
import { autoPairExtension, linkPasteExtension } from "./editorInputs";
import { handleBackspace, handleEnter, handleListShiftTab, handleListTab } from "./listEditing";
import { insertLink, wrapSelection } from "./markdownCommands";
import { htmlCommentBlockState, lineContextField, markdownPreview, tableBlockState } from "./markdownPreview";

type MarkdownEditorProps = {
  value: string;
  zen: boolean;
  onChange: (value: string) => void;
  onFormatChange: (format: ActiveFormat) => void;
  onReady: (view: EditorView) => void;
};

export function MarkdownEditor({ value, zen, onChange, onFormatChange, onReady }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onFormatChangeRef = useRef(onFormatChange);
  const initialValueRef = useRef(value);

  onChangeRef.current = onChange;
  onFormatChangeRef.current = onFormatChange;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const extensions: Extension[] = [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      markdown(),
      // `lineContextField` precomputes per-line "is this position inside a
      // code fence / HTML comment" data over the full doc. It must be
      // registered before `markdownPreview` because the ViewPlugin reads
      // it via `state.field()` to seed its visible-range loop.
      lineContextField,
      markdownPreview,
      tableBlockState,
      htmlCommentBlockState,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      Prec.highest(
        keymap.of([
          { key: "Enter", run: handleEnter },
          { key: "Backspace", run: handleBackspace },
          { key: "Tab", run: handleListTab },
          { key: "Shift-Tab", run: handleListShiftTab },
          { key: "Tab", run: insertTab, preventDefault: true },
          { key: "Shift-Tab", run: indentLess, preventDefault: true },
          ...buildFormattingKeymap(),
        ]),
      ),
      autoPairExtension,
      linkPasteExtension,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      // Cmd/Ctrl + click on a rendered link opens it externally. Without the
      // modifier, clicks fall through to position the caret so the URL stays
      // editable. macOS uses Cmd, Linux/Windows use Ctrl.
      EditorView.domEventHandlers({
        click: (event, view) => {
          if (!event.metaKey && !event.ctrlKey) {
            return false;
          }
          const target = event.target as HTMLElement | null;
          const linkEl = target?.closest(".cm-md-link");
          if (!linkEl) {
            return false;
          }
          const pos = view.posAtDOM(linkEl);
          const line = view.state.doc.lineAt(pos);
          const offset = pos - line.from;
          for (const match of line.text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
            const start = match.index!;
            const end = start + match[0].length;
            if (offset >= start && offset <= end) {
              const url = match[2];
              event.preventDefault();
              void openExternalUrl(url);
              return true;
            }
          }
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          onFormatChangeRef.current(getActiveFormat(update.state));
        }
      }),
      // Theme values are CSS custom properties so the editor switches with
      // the rest of the app on `data-theme` change without rebuilding the view.
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "transparent",
          color: "var(--fg-body)",
          fontSize: "18px",
        },
        ".cm-scroller": {
          fontFamily: 'Charter, "Iowan Old Style", "New York", Georgia, serif',
          lineHeight: "1.65",
          padding: "0",
        },
        ".cm-content": {
          maxWidth: "700px",
          width: "100%",
          margin: "0 auto",
          padding: "0 32px",
          caretColor: "var(--accent)",
        },
        ".cm-line": {
          padding: "0 2px",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "transparent",
        },
        ".cm-activeLine": {
          backgroundColor: "transparent",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent",
          color: "transparent",
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
          background: "var(--selection-bg)",
        },
      }),
    ];

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        selection: { anchor: initialValueRef.current.length },
        extensions,
      }),
    });

    viewRef.current = view;
    onReady(view);
    onFormatChangeRef.current(getActiveFormat(view.state));
    if (shouldExposeTestEditor()) {
      getWindowWithEditor().__markdownEditorView = view;
    }

    return () => {
      if (shouldExposeTestEditor() && getWindowWithEditor().__markdownEditorView === view) {
        delete getWindowWithEditor().__markdownEditorView;
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [onReady]);

  return <div className={zen ? "editorMount editorMountZen" : "editorMount"} ref={containerRef} />;
}

function getWindowWithEditor() {
  return window as Window & { __markdownEditorView?: EditorView };
}

function shouldExposeTestEditor() {
  return window.location.hostname === "127.0.0.1" && window.location.port === "5173";
}

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
};

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const win = window as TauriRuntimeWindow;
  return Boolean(win.__TAURI_INTERNALS__ ?? win.__TAURI__);
}

// Open a URL in the user's default browser. In the Tauri shell this goes
// through `tauri-plugin-shell` (capability-gated to http/https/mailto in
// `capabilities/default.json`); on the web build we use `window.open` with
// `noopener` so the new tab can't reach back into our origin.
async function openExternalUrl(url: string) {
  if (!url) {
    return;
  }
  if (isTauriRuntime()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch (error) {
      console.error("Failed to open URL via shell plugin", error);
      // Fall through to window.open so the user is not silently dropped.
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function buildFormattingKeymap() {
  const bold = (view: EditorView) => {
    wrapSelection(view, { before: "**", after: "**", placeholder: "bold" });
    return true;
  };
  const italic = (view: EditorView) => {
    wrapSelection(view, { before: "*", after: "*", placeholder: "italic" });
    return true;
  };
  const link = (view: EditorView) => {
    insertLink(view);
    return true;
  };

  return [
    { key: "Mod-b", preventDefault: true, run: bold },
    { key: "Ctrl-b", preventDefault: true, run: bold },
    { key: "Mod-i", preventDefault: true, run: italic },
    { key: "Ctrl-i", preventDefault: true, run: italic },
    { key: "Mod-k", preventDefault: true, run: link },
    { key: "Ctrl-k", preventDefault: true, run: link },
  ];
}
