import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code2,
  FileText,
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
import { emptyFormat, type ActiveFormat } from "./editorFormat";
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
  const [activeFormat, setActiveFormat] = useState<ActiveFormat>(emptyFormat);
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
            <button className={activeFormat.codeBlock || activeFormat.inlineCode ? "isActive" : undefined} aria-pressed={activeFormat.codeBlock || activeFormat.inlineCode} title="Code block" type="button" onClick={() => withEditor((view) => insertBlock(view, "```\ncode\n```\n"))}>
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
        <MarkdownEditor value={markdown} zen={zen} onChange={setMarkdown} onFormatChange={setActiveFormat} onReady={handleReady} />
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
