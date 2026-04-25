import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { getActiveFormat, type ActiveFormat } from "./editorFormat";
import { handleBackspace, handleEnter, handleListShiftTab, handleListTab } from "./listEditing";
import { markdownPreview } from "./markdownPreview";

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
      markdownPreview,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      Prec.highest(
        keymap.of([
          { key: "Enter", run: handleEnter },
          { key: "Backspace", run: handleBackspace },
          { key: "Tab", run: handleListTab },
          { key: "Shift-Tab", run: handleListShiftTab },
          { key: "Tab", run: insertTab, preventDefault: true },
          { key: "Shift-Tab", run: indentLess, preventDefault: true },
        ]),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.docChanged || update.selectionSet) {
          onFormatChangeRef.current(getActiveFormat(update.state));
        }
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "transparent",
          color: "#2a2a2e",
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
          caretColor: "#2d5b8c",
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
