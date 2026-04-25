import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let inCodeFence = false;
  let codeFenceLanguage: string | null = null;

  for (const { from, to } of view.visibleRanges) {
    let position = from;

    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const text = line.text;
      const heading = text.match(/^(#{1,6})\s/);
      const tableRow = /^\|.*\|\s*$/.test(text);
      const tableSeparator = /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/.test(text);
      const taskList = text.match(/^(\s*)[-*]\s+\[([ xX])\]\s+/);
      const unorderedList = text.match(/^(\s*)[-*]\s+/);
      const orderedList = text.match(/^(\s*)\d+[.)]\s+/);
      const fence = text.match(/^```\s*([A-Za-z0-9_-]+)?\s*$/);
      const lineActive = isLineActive(view, line.from, line.to);
      const codeLine = inCodeFence && !fence;

      if (codeLine) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-line" }));
        decorateCodeLine(decorations, line, codeFenceLanguage);
        if (line.to + 1 > to) {
          break;
        }
        position = line.to + 1;
        continue;
      }

      if (heading) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: `cm-md-heading cm-md-heading-${heading[1].length}` }));
        decorateSyntax(decorations, line.from, line.from + heading[0].length, lineActive);
      }

      if (taskList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list cm-md-task-list" }));
        decorateSyntax(
          decorations,
          line.from,
          line.from + taskList[0].length,
          lineActive,
          "cm-md-syntax cm-md-task-marker",
          new TaskMarkerWidget(taskList[2].toLowerCase() === "x", line.from, line.from + taskList[0].length),
        );
      } else if (unorderedList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        decorateSyntax(decorations, line.from, line.from + unorderedList[0].length, lineActive, "cm-md-syntax cm-md-list-marker", new BulletMarkerWidget());
      } else if (orderedList) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-list" }));
        addDecoration(decorations, line.from, line.from + orderedList[0].length, Decoration.mark({ class: "cm-md-syntax cm-md-list-marker" }));
      }

      for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 2, activeSyntax);
        addDecoration(decorations, start + 2, start + match[0].length - 2, Decoration.mark({ class: "cm-md-bold" }));
        decorateSyntax(decorations, start + match[0].length - 2, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
        const markerOffset = match[1].length;
        const start = line.from + match.index! + markerOffset;
        const activeSyntax = isRangeActive(view, start, start + match[0].length - markerOffset);
        decorateSyntax(decorations, start, start + 1, activeSyntax);
        addDecoration(decorations, start + 1, start + match[0].length - markerOffset - 1, Decoration.mark({ class: "cm-md-italic" }));
        decorateSyntax(decorations, start + match[0].length - markerOffset - 1, start + match[0].length - markerOffset, activeSyntax);
      }

      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 1, activeSyntax);
        addDecoration(decorations, start + 1, start + match[0].length - 1, Decoration.mark({ class: "cm-md-inline-code" }));
        decorateSyntax(decorations, start + match[0].length - 1, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/~~([^~\n]+)~~/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 2, activeSyntax);
        addDecoration(decorations, start + 2, start + match[0].length - 2, Decoration.mark({ class: "cm-md-strike" }));
        decorateSyntax(decorations, start + match[0].length - 2, start + match[0].length, activeSyntax);
      }

      for (const match of text.matchAll(/<u>([^<\n]+)<\/u>/gi)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 3, activeSyntax);
        addDecoration(decorations, start + 3, start + match[0].length - 4, Decoration.mark({ class: "cm-md-underline" }));
        decorateSyntax(decorations, start + match[0].length - 4, start + match[0].length, activeSyntax);
      }

      // HTML comments — single-line only. When the cursor is inside the
      // comment we show the markup as muted syntax; otherwise the comment is
      // hidden entirely so the rendered document stays clean.
      for (const match of text.matchAll(/<!--[\s\S]*?-->/g)) {
        const start = line.from + match.index!;
        const end = start + match[0].length;
        const activeSyntax = isRangeActive(view, start, end);
        if (activeSyntax) {
          addDecoration(decorations, start, end, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, start, end, Decoration.replace({}));
        }
      }

      for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
        const start = line.from + match.index!;
        const labelStart = start + 1;
        const labelEnd = labelStart + match[1].length;
        const urlStart = labelEnd + 2;
        const urlEnd = urlStart + match[2].length;
        const activeSyntax = isRangeActive(view, start, urlEnd + 1);
        decorateSyntax(decorations, start, labelStart, activeSyntax);
        addDecoration(decorations, labelStart, labelEnd, Decoration.mark({ class: "cm-md-link" }));
        if (activeSyntax) {
          addDecoration(decorations, labelEnd, urlStart, Decoration.mark({ class: "cm-md-syntax" }));
          addDecoration(decorations, urlStart, urlEnd, Decoration.mark({ class: "cm-md-link-url" }));
          addDecoration(decorations, urlEnd, urlEnd + 1, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, labelEnd, urlEnd + 1, Decoration.replace({}));
        }
      }

      if (/^>\s/.test(text)) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-quote" }));
        decorateSyntax(decorations, line.from, line.from + 2, lineActive);
      }

      if (/^---+$/.test(text.trim())) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-rule" }));
        if (lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.mark({ class: "cm-md-syntax" }));
        } else {
          addDecoration(decorations, line.from, line.to, Decoration.replace({ widget: new RuleWidget() }));
        }
      }

      // GFM tables: when a pipe-bordered line is followed by a separator
      // row, treat the run of pipe-lines as a single table block. While the
      // cursor is anywhere inside the block we keep the source visible and
      // mark each line with `cm-md-table-row` so the source still reads as a
      // grid; otherwise the whole block is replaced with a real <table>.
      if (tableRow && !tableSeparator) {
        const block = collectTableBlock(view, line);
        if (block) {
          const blockActive = isBlockActive(view, block.fromLine, block.toLine);
          if (!blockActive) {
            addDecoration(
              decorations,
              block.from,
              block.to,
              Decoration.replace({ widget: new TableWidget(block.rows, block.alignments), block: true }),
            );
            if (block.to + 1 > to) {
              break;
            }
            position = block.to + 1;
            continue;
          }
          // Cursor is inside the block; render each pipe-line as source rows.
          for (const num of block.lineNumbers) {
            const blockLine = view.state.doc.line(num);
            const isSep = TABLE_SEPARATOR.test(blockLine.text);
            const cls = isSep ? "cm-md-table-row cm-md-table-separator" : "cm-md-table-row";
            addDecoration(decorations, blockLine.from, blockLine.from, Decoration.line({ class: cls }));
          }
        }
      }

      if (fence) {
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: "cm-md-code-fence" }));
        if (!lineActive) {
          addDecoration(decorations, line.from, line.to, Decoration.replace({}));
        }
        if (inCodeFence) {
          inCodeFence = false;
          codeFenceLanguage = null;
        } else {
          inCodeFence = true;
          codeFenceLanguage = fence[1]?.toLowerCase() ?? null;
        }
      }

      if (line.to + 1 > to) {
        break;
      }
      position = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

function isRangeActive(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from > from && range.from < to;
    }

    return range.from < to && range.to > from;
  });
}

function isLineActive(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }

    return range.from <= to && range.to >= from;
  });
}

function decorateSyntax(decorations: Range<Decoration>[], from: number, to: number, activeSyntax: boolean, className = "cm-md-syntax", widget?: WidgetType) {
  if (from >= to) {
    return;
  }

  if (activeSyntax) {
    addDecoration(decorations, from, to, Decoration.mark({ class: className }));
    return;
  }

  addDecoration(decorations, from, to, Decoration.replace(widget ? { widget } : {}));
}

function addDecoration(decorations: Range<Decoration>[], from: number, to: number, decoration: Decoration) {
  decorations.push(decoration.range(from, to));
}

function decorateCodeLine(decorations: Range<Decoration>[], line: { from: number; text: string }, language: string | null) {
  if (language && !["js", "jsx", "javascript", "ts", "tsx", "typescript"].includes(language)) {
    return;
  }

  const tokenPattern =
    /\/\/.*|\/\*.*?\*\/|(["'`])(?:\\.|(?!\1).)*\1|\b(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*(?=\s*\()|=>|[{}()[\].,;=]/g;

  for (const match of line.text.matchAll(tokenPattern)) {
    const text = match[0];
    const from = line.from + match.index!;
    const to = from + text.length;

    addDecoration(decorations, from, to, Decoration.mark({ class: `cm-md-code-${getCodeTokenClass(text)}` }));
  }
}

function getCodeTokenClass(token: string) {
  if (token.startsWith("//") || token.startsWith("/*")) {
    return "comment";
  }

  if (/^["'`]/.test(token)) {
    return "string";
  }

  if (/^\d/.test(token)) {
    return "number";
  }

  if (/^(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|false|finally|for|from|function|if|import|interface|let|new|null|return|switch|throw|true|try|type|undefined|var|while)$/.test(token)) {
    return "keyword";
  }

  if (/^(?:=>|[{}()[\].,;=])$/.test(token)) {
    return "operator";
  }

  return "function";
}

class BulletMarkerWidget extends WidgetType {
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-bullet-widget";
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskMarkerWidget) {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView) {
    const marker = document.createElement("span");
    marker.className = this.checked ? "cm-md-task-widget cm-md-task-widget-checked" : "cm-md-task-widget";
    marker.setAttribute("role", "checkbox");
    marker.setAttribute("aria-checked", String(this.checked));
    marker.tabIndex = 0;
    marker.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.toggle(view);
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.toggle(view);
      }
    });
    return marker;
  }

  ignoreEvent() {
    return false;
  }

  private toggle(view: EditorView) {
    const text = view.state.doc.sliceString(this.from, this.to);
    const replaced = this.checked ? text.replace(/\[[xX]\]/, "[ ]") : text.replace(/\[ \]/, "[x]");

    if (replaced === text) {
      return;
    }

    view.dispatch({
      changes: { from: this.from, to: this.to, insert: replaced },
      userEvent: "input.toggle",
    });
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-md-rule-widget";
    return rule;
  }
}

type CellAlignment = "left" | "center" | "right";

const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/;

function splitTableCells(text: string): string[] {
  let trimmed = text.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseAlignments(text: string): CellAlignment[] {
  return splitTableCells(text).map((cell) => {
    const startColon = cell.startsWith(":");
    const endColon = cell.endsWith(":");
    if (startColon && endColon) return "center";
    if (endColon) return "right";
    return "left";
  });
}

function collectTableBlock(
  view: EditorView,
  startLine: { number: number; from: number; to: number; text: string },
): {
  from: number;
  to: number;
  fromLine: number;
  toLine: number;
  rows: string[][];
  alignments: CellAlignment[];
  lineNumbers: number[];
} | null {
  const totalLines = view.state.doc.lines;
  if (startLine.number >= totalLines) {
    return null;
  }
  const separator = view.state.doc.line(startLine.number + 1);
  if (!TABLE_SEPARATOR.test(separator.text)) {
    return null;
  }
  const headerCells = splitTableCells(startLine.text);
  const alignments = parseAlignments(separator.text);
  const rows: string[][] = [headerCells];
  const lineNumbers: number[] = [startLine.number, separator.number];
  let lastLineEnd = separator.to;
  let toLine = separator.number;
  for (let n = separator.number + 1; n <= totalLines; n += 1) {
    const candidate = view.state.doc.line(n);
    if (!TABLE_ROW.test(candidate.text) || TABLE_SEPARATOR.test(candidate.text)) {
      break;
    }
    rows.push(splitTableCells(candidate.text));
    lineNumbers.push(n);
    lastLineEnd = candidate.to;
    toLine = n;
  }
  return {
    from: startLine.from,
    to: lastLineEnd,
    fromLine: startLine.number,
    toLine,
    rows,
    alignments,
    lineNumbers,
  };
}

function isBlockActive(view: EditorView, fromLine: number, toLine: number): boolean {
  for (let n = fromLine; n <= toLine; n += 1) {
    const line = view.state.doc.line(n);
    if (isLineActive(view, line.from, line.to)) {
      return true;
    }
  }
  return false;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly rows: string[][],
    private readonly alignments: CellAlignment[],
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    if (this.rows.length !== other.rows.length) return false;
    if (this.alignments.length !== other.alignments.length) return false;
    for (let i = 0; i < this.alignments.length; i += 1) {
      if (this.alignments[i] !== other.alignments[i]) return false;
    }
    for (let i = 0; i < this.rows.length; i += 1) {
      const a = this.rows[i];
      const b = other.rows[i];
      if (a.length !== b.length) return false;
      for (let j = 0; j < a.length; j += 1) {
        if (a[j] !== b[j]) return false;
      }
    }
    return true;
  }

  toDOM(): HTMLElement {
    const table = document.createElement("table");
    table.className = "cm-md-table";

    const [header, ...body] = this.rows;

    if (header) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      header.forEach((cell, idx) => {
        const th = document.createElement("th");
        th.textContent = cell;
        const align = this.alignments[idx];
        if (align && align !== "left") {
          th.style.textAlign = align;
        }
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    if (body.length > 0) {
      const tbody = document.createElement("tbody");
      for (const row of body) {
        const tr = document.createElement("tr");
        row.forEach((cell, idx) => {
          const td = document.createElement("td");
          td.textContent = cell;
          const align = this.alignments[idx];
          if (align && align !== "left") {
            td.style.textAlign = align;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    return table;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export const markdownPreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
