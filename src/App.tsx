import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code2,
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
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { insertBlock, insertLink, setHeading, toggleLinePrefix, wrapSelection } from "./markdownCommands";
import { MarkdownEditor } from "./MarkdownEditor";

const initialMarkdown = `# Product Notes

This is a **local-first Markdown editor** spike.

Type Markdown directly, or use the toolbar in Normal Mode.

## Goals

- Keep .md as the source of truth
- Make formatting feel rendered while writing
- Keep Zen Mode quiet

> Collaboration, comments, history, and MCP come later.

\`\`\`ts
type DocumentSource = ".md";
\`\`\`
`;

export function App() {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [zen, setZen] = useState(false);
  const editorRef = useRef<EditorView | null>(null);

  const withEditor = useCallback((command: (view: EditorView) => void) => {
    if (editorRef.current) {
      command(editorRef.current);
    }
  }, []);

  const handleReady = useCallback((view: EditorView) => {
    editorRef.current = view;
  }, []);

  return (
    <main className={zen ? "app appZen" : "app"}>
      <header className="topbar">
        <div className="documentMeta">
          <span className="trafficLight" />
          <div>
            <div className="documentTitle">Product Notes.md</div>
            <div className="documentState">{markdown.length.toLocaleString()} chars · local spike</div>
          </div>
        </div>

        <button className="modeButton" type="button" onClick={() => setZen((value) => !value)}>
          {zen ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}
          <span>{zen ? "Normal" : "Zen"}</span>
        </button>
      </header>

      {!zen && (
        <nav className="toolbar" aria-label="Markdown formatting">
          <button title="Heading 1" type="button" onClick={() => withEditor((view) => setHeading(view, 1))}>
            <Heading1 size={18} />
          </button>
          <button title="Heading 2" type="button" onClick={() => withEditor((view) => setHeading(view, 2))}>
            <Heading2 size={18} />
          </button>
          <span className="toolbarDivider" />
          <button title="Bold" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "**", after: "**", placeholder: "bold" }))}>
            <Bold size={18} />
          </button>
          <button title="Italic" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "*", after: "*", placeholder: "italic" }))}>
            <Italic size={18} />
          </button>
          <button title="Link" type="button" onClick={() => withEditor(insertLink)}>
            <Link size={18} />
          </button>
          <span className="toolbarDivider" />
          <button title="Bulleted list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- "))}>
            <List size={18} />
          </button>
          <button title="Numbered list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "1. "))}>
            <ListOrdered size={18} />
          </button>
          <button title="Task list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- [ ] "))}>
            <ListChecks size={18} />
          </button>
          <button title="Blockquote" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "> "))}>
            <Quote size={18} />
          </button>
          <span className="toolbarDivider" />
          <button title="Code block" type="button" onClick={() => withEditor((view) => insertBlock(view, "```\\ncode\\n```\\n"))}>
            <Code2 size={18} />
          </button>
          <button title="Horizontal rule" type="button" onClick={() => withEditor((view) => insertBlock(view, "---\\n"))}>
            <Minus size={18} />
          </button>
        </nav>
      )}

      <section className="editorShell" aria-label="Markdown editor">
        <MarkdownEditor value={initialMarkdown} zen={zen} onChange={setMarkdown} onReady={handleReady} />
      </section>
    </main>
  );
}
