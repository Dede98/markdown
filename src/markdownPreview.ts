import { type EditorState, type Line, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

type TableAlign = "left" | "center" | "right" | null;

type TableBlock = {
  firstLine: Line;
  lastLine: Line;
  // [header, ...body]; the separator row is consumed for `alignments`.
  rows: string[][];
  alignments: TableAlign[];
};

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let inCodeFence = false;
  let codeFenceLanguage: string | null = null;
  // Multi-line `<!--` … `-->` carries across lines like a fenced code block.
  // Tracked at the visible-range scope so the loop can hide every line that
  // sits between the open and close markers.
  let inHtmlComment = false;

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

      // HTML comments: walk the line to find every `<!--` / `-->` range and
      // carry an "open across newlines" flag. A line whose content is entirely
      // inside a comment is hidden via line-range replace (off-cursor) or
      // dimmed via `cm-md-syntax` (on-cursor); partial comments decorate the
      // matched span and fall through to normal markdown processing for the
      // surrounding text.
      const commentRanges: Array<{ from: number; to: number }> = [];
      {
        let scanPos = 0;
        let openInProgress: boolean = inHtmlComment;
        while (scanPos <= text.length) {
          if (openInProgress) {
            const closeIdx = text.indexOf("-->", scanPos);
            if (closeIdx === -1) {
              commentRanges.push({ from: scanPos, to: text.length });
              break;
            }
            commentRanges.push({ from: scanPos, to: closeIdx + 3 });
            scanPos = closeIdx + 3;
            openInProgress = false;
          } else {
            const openIdx = text.indexOf("<!--", scanPos);
            if (openIdx === -1) {
              break;
            }
            scanPos = openIdx;
            openInProgress = true;
          }
        }
        inHtmlComment = openInProgress;
      }

      if (commentRanges.length > 0) {
        const first = commentRanges[0];
        const last = commentRanges[commentRanges.length - 1];
        // "Full" means the comment range(s) cover the entire visible line.
        // For the multi-line interior case, an empty line still counts so the
        // empty line is treated as fully-comment (no markdown processing).
        const fullyComment =
          first.from === 0 && (last.to >= text.length || text.length === 0);

        if (fullyComment) {
          // Fully-comment lines collapse via the `htmlCommentBlockState`
          // StateField (block-level replace). Block decorations cannot live
          // in a ViewPlugin, so the only thing this branch does is skip the
          // rest of the per-line markdown processing and advance.
          if (line.to + 1 > to) {
            break;
          }
          position = line.to + 1;
          continue;
        }

        // Partial-comment line: hide the comment span via inline replace.
        // Falling through to the markdown branches would let bold / italic /
        // link emit their own `Decoration.replace` ranges that overlap the
        // comment replace, which CodeMirror rejects (the exact failure class
        // that broke the prior attempt). Surrounding prose therefore renders
        // as plain text on a comment line — comments are always invisible,
        // independent of cursor position.
        for (const range of commentRanges) {
          const fromAbs = line.from + range.from;
          const toAbs = line.from + range.to;
          if (fromAbs >= toAbs) {
            continue;
          }
          addDecoration(decorations, fromAbs, toAbs, Decoration.replace({}));
        }
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

      // HTML underline `<u>…</u>`. Markdown has no native underline syntax, so
      // the `<u>` tag is the de-facto convention. The opening tag is 3 chars
      // and the closing is 4; otherwise this mirrors the strike branch above.
      for (const match of text.matchAll(/<u>([^<\n]+)<\/u>/g)) {
        const start = line.from + match.index!;
        const activeSyntax = isRangeActive(view, start, start + match[0].length);
        decorateSyntax(decorations, start, start + 3, activeSyntax);
        addDecoration(decorations, start + 3, start + match[0].length - 4, Decoration.mark({ class: "cm-md-underline" }));
        decorateSyntax(decorations, start + match[0].length - 4, start + match[0].length, activeSyntax);
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

      // GFM tables, source mode: decorate any pipe-bordered line. The
      // separator row (`| --- | --- |`) gets its own class so we can hide
      // it visually when the cursor is elsewhere; the pipe syntax itself
      // fades out off-cursor. The block-level <table> widget that replaces
      // an inactive block lives in `tableBlockState` (a StateField) below,
      // because CodeMirror requires block decorations to come from a
      // state field rather than a ViewPlugin.
      if (tableRow || tableSeparator) {
        const cls = tableSeparator ? "cm-md-table-row cm-md-table-separator" : "cm-md-table-row";
        addDecoration(decorations, line.from, line.from, Decoration.line({ class: cls }));
        if (!lineActive) {
          for (const match of text.matchAll(/\|/g)) {
            const start = line.from + match.index!;
            addDecoration(decorations, start, start + 1, Decoration.mark({ class: "cm-md-syntax cm-md-table-pipe" }));
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

const TABLE_SEPARATOR_REGEX = /^\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/;
const TABLE_ROW_REGEX = /^\|.*\|\s*$/;

// Walk forward from a candidate header line to collect a complete GFM table:
// header + separator + zero or more body rows. Returns null if the second
// line doesn't match the separator pattern (i.e. this is not really a table,
// just a one-off pipe-bordered line). The separator row is consumed for
// `alignments` and not included in `rows`.
function collectTableBlock(textBuf: Text, headerLine: Line): TableBlock | null {
  if (headerLine.number + 1 > textBuf.lines) {
    return null;
  }
  const sepLine = textBuf.line(headerLine.number + 1);
  if (!TABLE_SEPARATOR_REGEX.test(sepLine.text)) {
    return null;
  }

  const alignments = splitTableRow(sepLine.text).map(parseAlignment);
  const header = splitTableRow(headerLine.text);
  const body: string[][] = [];
  let lastLine: Line = sepLine;

  for (let n = sepLine.number + 1; n <= textBuf.lines; n += 1) {
    const candidate = textBuf.line(n);
    if (!TABLE_ROW_REGEX.test(candidate.text) || TABLE_SEPARATOR_REGEX.test(candidate.text)) {
      break;
    }
    body.push(splitTableRow(candidate.text));
    lastLine = candidate;
  }

  return {
    firstLine: headerLine,
    lastLine,
    rows: [header, ...body],
    alignments,
  };
}

function splitTableRow(text: string): string[] {
  let stripped = text.trim();
  if (stripped.startsWith("|")) {
    stripped = stripped.slice(1);
  }
  if (stripped.endsWith("|")) {
    stripped = stripped.slice(0, -1);
  }
  return stripped.split("|").map((cell) => cell.trim());
}

function parseAlignment(cell: string): TableAlign {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  if (left) {
    return "left";
  }
  return null;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly rows: string[][],
    private readonly alignments: TableAlign[],
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    if (this.rows.length !== other.rows.length) {
      return false;
    }
    if (this.alignments.length !== other.alignments.length) {
      return false;
    }
    for (let i = 0; i < this.alignments.length; i += 1) {
      if (this.alignments[i] !== other.alignments[i]) {
        return false;
      }
    }
    for (let r = 0; r < this.rows.length; r += 1) {
      const a = this.rows[r];
      const b = other.rows[r];
      if (a.length !== b.length) {
        return false;
      }
      for (let c = 0; c < a.length; c += 1) {
        if (a[c] !== b[c]) {
          return false;
        }
      }
    }
    return true;
  }

  toDOM(): HTMLElement {
    const table = document.createElement("table");
    table.className = "cm-md-table";
    const colCount = this.alignments.length;

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const header = this.rows[0] ?? [];
    for (let c = 0; c < colCount; c += 1) {
      const th = document.createElement("th");
      th.textContent = header[c] ?? "";
      const align = this.alignments[c];
      if (align) {
        th.style.textAlign = align;
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let r = 1; r < this.rows.length; r += 1) {
      const tr = document.createElement("tr");
      const cells = this.rows[r];
      for (let c = 0; c < colCount; c += 1) {
        const td = document.createElement("td");
        td.textContent = cells[c] ?? "";
        const align = this.alignments[c];
        if (align) {
          td.style.textAlign = align;
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return table;
  }

  // Returning `false` lets CodeMirror handle pointer events on the widget:
  // a click positions the cursor at the nearest valid offset (the block
  // edge), which flips `isStateTableBlockActive` true on the next render so
  // the source view appears for editing. With `true` here CM6 swallows the
  // click entirely and the user cannot enter the block.
  ignoreEvent(): boolean {
    return false;
  }
}

// CodeMirror requires block-level decorations to live in a state field, not
// a ViewPlugin (the layout pass needs to know about line replacements before
// the viewport renders). Per-line / inline marks for tables stay in the
// ViewPlugin above; this field handles ONLY the block-level <table> widget
// that replaces a complete inactive table block.
function buildTableBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const textBuf = state.doc;
  let inCodeFence = false;

  for (let n = 1; n <= textBuf.lines; n += 1) {
    const line = textBuf.line(n);
    const lineText = line.text;

    if (/^```/.test(lineText)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    if (!TABLE_ROW_REGEX.test(lineText) || TABLE_SEPARATOR_REGEX.test(lineText)) {
      continue;
    }

    const block = collectTableBlock(textBuf, line);
    if (!block) {
      continue;
    }
    if (isStateTableBlockActive(state, block)) {
      // Block is being edited; the ViewPlugin's per-line source view shows.
      // Skip past the block so we don't re-detect interior rows.
      n = block.lastLine.number;
      continue;
    }

    decorations.push(
      Decoration.replace({
        widget: new TableWidget(block.rows, block.alignments),
        block: true,
      }).range(block.firstLine.from, block.lastLine.to),
    );
    n = block.lastLine.number;
  }

  return Decoration.set(decorations, true);
}

function isStateTableBlockActive(state: EditorState, block: TableBlock): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= block.lastLine.to && range.to >= block.firstLine.from,
  );
}

export const tableBlockState = StateField.define<DecorationSet>({
  create: (state) => buildTableBlockDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged || tr.selection) {
      return buildTableBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// HTML comments fully collapse: any line that is entirely covered by one or
// more `<!-- … -->` ranges (single-line, multi-line interior, multi-line
// open, or multi-line close) is replaced with a block-level decoration so
// the line disappears from layout entirely — no empty placeholder remains.
// Lives in a StateField because block-level replacements cannot come from a
// ViewPlugin. Comments are always invisible regardless of cursor position;
// a future "raw markdown" mode will expose them for editing.
function buildHtmlCommentBlockDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const textBuf = state.doc;
  let inHtmlComment = false;
  let inCodeFence = false;

  for (let n = 1; n <= textBuf.lines; n += 1) {
    const line = textBuf.line(n);
    const text = line.text;

    if (/^```/.test(text)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    const ranges: Array<{ from: number; to: number }> = [];
    let scanPos = 0;
    let openInProgress: boolean = inHtmlComment;
    while (scanPos <= text.length) {
      if (openInProgress) {
        const closeIdx = text.indexOf("-->", scanPos);
        if (closeIdx === -1) {
          ranges.push({ from: scanPos, to: text.length });
          break;
        }
        ranges.push({ from: scanPos, to: closeIdx + 3 });
        scanPos = closeIdx + 3;
        openInProgress = false;
      } else {
        const openIdx = text.indexOf("<!--", scanPos);
        if (openIdx === -1) {
          break;
        }
        scanPos = openIdx;
        openInProgress = true;
      }
    }
    inHtmlComment = openInProgress;

    if (ranges.length === 0) {
      continue;
    }

    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const fullyComment =
      first.from === 0 && (last.to >= text.length || text.length === 0);
    if (!fullyComment) {
      continue;
    }

    // Span the line including its trailing newline so the line disappears
    // from layout. For the last line of the doc there is no trailing
    // newline; clamp to doc length to keep the range valid.
    const fromAbs = line.from;
    const toAbs = Math.min(line.to + 1, textBuf.length);
    decorations.push(
      Decoration.replace({ block: true }).range(fromAbs, toAbs),
    );
  }

  return Decoration.set(decorations, true);
}

export const htmlCommentBlockState = StateField.define<DecorationSet>({
  create: (state) => buildHtmlCommentBlockDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged) {
      return buildHtmlCommentBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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
