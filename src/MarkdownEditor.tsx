import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { markdownPreview } from "./markdownPreview";

type MarkdownEditorProps = {
  value: string;
  zen: boolean;
  onChange: (value: string) => void;
  onReady: (view: EditorView) => void;
};

export function MarkdownEditor({ value, zen, onChange, onReady }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      markdown(),
      markdownPreview,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "transparent",
          color: "#202124",
          fontSize: zen ? "18px" : "16px",
        },
        ".cm-scroller": {
          fontFamily: '"Avenir Next", Inter, ui-sans-serif, system-ui, sans-serif',
          lineHeight: "1.72",
          padding: zen ? "10vh 0 14vh" : "48px 0 72px",
        },
        ".cm-content": {
          maxWidth: zen ? "760px" : "900px",
          width: "100%",
          margin: "0 auto",
          padding: zen ? "0 32px" : "0 44px",
          caretColor: "#1b5e55",
        },
        ".cm-line": {
          padding: "0 2px",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: zen ? "transparent" : "#a4aaa7",
        },
        ".cm-activeLine": {
          backgroundColor: "rgba(34, 91, 80, 0.055)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent",
          color: "#6f7772",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ];

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions,
      }),
    });

    viewRef.current = view;
    onReady(view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [onReady, value, zen]);

  return <div className="editorMount" ref={containerRef} />;
}
