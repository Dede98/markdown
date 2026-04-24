import type { EditorView } from "@codemirror/view";
import {
  Bold,
  ChevronDown,
  Code2,
  Ellipsis,
  FileText,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PanelLeft,
  PanelRight,
  PanelTopClose,
  PanelTopOpen,
  Quote,
  Search,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { insertBlock, insertLink, setHeading, toggleLinePrefix, wrapSelection } from "./markdownCommands";
import { MarkdownEditor } from "./MarkdownEditor";

const initialMarkdown = `# On the Quiet Hour

Draft - 1,420 words - Saved locally

There is a particular quality to the hour before everyone else wakes. The house is still speaking in the low voice it uses when no one is listening, and the windows have not yet been asked to carry any light.

## Morning light

It arrives diagonally at first, finding the spine of a book on the desk and then, as if it has remembered its manners, filling the whole room evenly. I used to write in the evening; now I wait for this.

> A sentence is a small room you build for a thought to sit quietly in.

Three things I try to keep near when I work:

- a cup of something warm, to mark the hour
- a notebook open to a clean page
- and the small discipline of not checking anything
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
        <div className="windowSlot" aria-hidden="true" />

        <div className="titleCluster">
          <div className="documentTitle">on-the-quiet-hour.md</div>
          {!zen && <div className="documentState">saved</div>}
        </div>

        <button className="modeButton" type="button" onClick={() => setZen((value) => !value)} title={zen ? "Normal Mode" : "Zen Mode"}>
          {zen ? <PanelTopOpen size={18} /> : <PanelTopClose size={18} />}
          <span>{zen ? "Normal" : "Zen"}</span>
        </button>
      </header>

      {!zen && (
        <nav className="toolbar" aria-label="Markdown formatting">
          <div className="toolbarSide toolbarSideLeft">
            <button title="Outline" type="button">
              <PanelLeft size={14} />
            </button>
            <button title="Search" type="button">
              <Search size={14} />
            </button>
          </div>

          <div className="toolbarCenter">
            <button className="headingMenu" title="Heading 2" type="button" onClick={() => withEditor((view) => setHeading(view, 2))}>
              <span>Heading 2</span>
              <ChevronDown size={12} />
            </button>
            <span className="toolbarDivider" />
            <button title="Heading 1" type="button" onClick={() => withEditor((view) => setHeading(view, 1))}>
              <Heading1 size={14} />
            </button>
            <button title="Heading 2" type="button" onClick={() => withEditor((view) => setHeading(view, 2))}>
              <Heading2 size={14} />
            </button>
            <button title="Bold" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "**", after: "**", placeholder: "bold" }))}>
              <Bold size={14} />
            </button>
            <button title="Italic" type="button" onClick={() => withEditor((view) => wrapSelection(view, { before: "*", after: "*", placeholder: "italic" }))}>
              <Italic size={14} />
            </button>
            <button title="Code block" type="button" onClick={() => withEditor((view) => insertBlock(view, "```\\ncode\\n```\\n"))}>
              <Code2 size={14} />
            </button>
            <button title="Link" type="button" onClick={() => withEditor(insertLink)}>
              <Link size={14} />
            </button>
            <span className="toolbarDivider" />
            <button title="Bulleted list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- "))}>
              <List size={14} />
            </button>
            <button title="Numbered list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "1. "))}>
              <ListOrdered size={14} />
            </button>
            <button title="Task list" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "- [ ] "))}>
              <ListChecks size={14} />
            </button>
            <button title="Blockquote" type="button" onClick={() => withEditor((view) => toggleLinePrefix(view, "> "))}>
              <Quote size={14} />
            </button>
            <button title="Horizontal rule" type="button" onClick={() => withEditor((view) => insertBlock(view, "---\\n"))}>
              <Minus size={14} />
            </button>
          </div>

          <div className="toolbarSide toolbarSideRight">
            <span>{wordCount(markdown).toLocaleString()} words</span>
            <button title="Inspector" type="button">
              <PanelRight size={14} />
            </button>
            <button title="More" type="button">
              <Ellipsis size={14} />
            </button>
          </div>
        </nav>
      )}

      <section className="editorShell" aria-label="Markdown editor">
        <MarkdownEditor value={markdown} zen={zen} onChange={setMarkdown} onReady={handleReady} />
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
            <span>~/Documents/Writing/on-the-quiet-hour.md</span>
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

function wordCount(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
