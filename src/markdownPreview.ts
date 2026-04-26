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

// Per-line "what's open at the START of this line" snapshot for the entire
// document. The decoration ViewPlugin only sees `view.visibleRanges`, so
// without this, multi-line constructs (code fences, HTML comments) opened
// above the viewport are invisible to the per-line scan — the inline
// regexes then fire on what should be code, and the user sees raw markdown
// flicker into view as they scroll. Computed once per doc change in a
// StateField; the ViewPlugin reads it to seed its loop variables when it
// enters a visible range.
type LineContext = {
  inFence: boolean;
  fenceLanguage: string | null;
  inHtmlComment: boolean;
};

function buildLineContextMap(doc: Text): LineContext[] {
  const map: LineContext[] = new Array(doc.lines);
  let inFence = false;
  let fenceLanguage: string | null = null;
  let inHtmlComment = false;

  for (let n = 1; n <= doc.lines; n += 1) {
    // Snapshot the state AS IT STANDS at the start of this line, then
    // update it based on this line's content for the next iteration.
    map[n - 1] = { inFence, fenceLanguage, inHtmlComment };

    const text = doc.line(n).text;

    const fence = text.match(/^```\s*([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      if (inFence) {
        inFence = false;
        fenceLanguage = null;
      } else {
        inFence = true;
        fenceLanguage = fence[1]?.toLowerCase() ?? null;
      }
      continue;
    }

    // HTML comments are suppressed inside code fences (the `<!--` is just
    // text there), so only walk the comment state machine when not fenced.
    if (!inFence) {
      let scanPos = 0;
      let openInProgress = inHtmlComment;
      while (scanPos <= text.length) {
        if (openInProgress) {
          const closeIdx = text.indexOf("-->", scanPos);
          if (closeIdx === -1) {
            break;
          }
          scanPos = closeIdx + 3;
          openInProgress = false;
        } else {
          const openIdx = text.indexOf("<!--", scanPos);
          if (openIdx === -1) {
            break;
          }
          scanPos = openIdx + 4;
          openInProgress = true;
        }
      }
      inHtmlComment = openInProgress;
    }
  }

  return map;
}

export const lineContextField = StateField.define<LineContext[]>({
  create: (state) => buildLineContextMap(state.doc),
  update: (value, tr) => (tr.docChanged ? buildLineContextMap(tr.state.doc) : value),
});

function getLineContext(map: LineContext[], lineNumber: number): LineContext {
  // 1-based line number → 0-based index. Defensive fallback for any edge
  // where the field hasn't caught up with the doc yet (shouldn't happen
  // because StateField updates run before ViewPlugin updates).
  return (
    map[lineNumber - 1] ?? { inFence: false, fenceLanguage: null, inHtmlComment: false }
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const contextMap = view.state.field(lineContextField);

  for (const { from, to } of view.visibleRanges) {
    let position = from;
    // Seed the multi-line state from the precomputed map so the loop
    // doesn't start with `inCodeFence = false` when the viewport opens
    // mid-fence.
    const startCtx = getLineContext(contextMap, view.state.doc.lineAt(position).number);
    let inCodeFence = startCtx.inFence;
    let codeFenceLanguage = startCtx.fenceLanguage;
    let inHtmlComment = startCtx.inHtmlComment;

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
    // Strict deep-compare. CodeMirror still keeps the DOM mounted during
    // typing because `updateDOM` below patches cells in place, leaving the
    // focused cell untouched so the contenteditable cursor is preserved.
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

  toDOM(view: EditorView): HTMLElement {
    // Block widgets must present as `display: block` so CM6's height map
    // can measure them with predictable box geometry. A bare `<table>` has
    // intrinsic `display: table`, and any margin set on the widget root
    // collapses outside the wrapper CM6 puts it in — the height map then
    // disagrees with the rendered height by ~one line, and clicks below
    // the table land one source line too low. Wrapping the table in a
    // plain `<div>` lets the wrapper own the block-level margin and gives
    // CM6 the box model it expects.
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrapper";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    wrapper.appendChild(table);
    const colCount = this.alignments.length;
    const rowCount = this.rows.length;

    // Look up the widget's CURRENT source range via the rendered DOM. The
    // widget instance's positions go stale as the doc changes; reading them
    // from the live state on every commit keeps the dispatch correct even
    // after upstream edits have shifted the table around.
    const commitFromDOM = () => {
      const tablePos = view.posAtDOM(table);
      if (tablePos < 0) {
        return;
      }
      const line = view.state.doc.lineAt(tablePos);
      const block = collectTableBlock(view.state.doc, line);
      if (!block) {
        return;
      }

      const cells = table.querySelectorAll<HTMLTableCellElement>("th, td");
      const newRows: string[][] = [];
      let idx = 0;
      for (let r = 0; r < rowCount; r += 1) {
        const row: string[] = [];
        for (let c = 0; c < colCount; c += 1) {
          const cell = cells[idx];
          idx += 1;
          row.push(readCellSource(cell));
        }
        newRows.push(row);
      }

      const newSource = serializeTableSource(newRows, this.alignments);
      const oldSource = view.state.sliceDoc(block.firstLine.from, block.lastLine.to);
      if (oldSource === newSource) {
        return;
      }
      view.dispatch({
        changes: { from: block.firstLine.from, to: block.lastLine.to, insert: newSource },
        userEvent: "input.table",
      });
    };

    // Click on a cell swaps in a real <input> element so the user gets a
    // browser-native text field with its own selection model. CodeMirror's
    // selection handling and the input's selection handling don't fight
    // because the input is opaque to CM6 (the widget reports
    // `ignoreEvent: true` so CM6 never tries to interpret events that
    // originate inside it).
    const enterEditMode = (cell: HTMLTableCellElement) => {
      if (cell.querySelector("input")) {
        return;
      }
      const source = cell.dataset.mdSource ?? "";
      cell.replaceChildren();
      cell.classList.add("cm-md-table-cell--editing");
      const input = cell.ownerDocument.createElement("input");
      input.type = "text";
      input.value = source;
      input.spellcheck = false;
      input.className = "cm-md-table-cell-input";

      input.addEventListener("input", () => {
        cell.dataset.mdSource = normalizeCellText(input.value);
        input.value = cell.dataset.mdSource;
        commitFromDOM();
      });

      input.addEventListener("blur", () => {
        cell.classList.remove("cm-md-table-cell--editing");
        renderCellRendered(cell, cell.dataset.mdSource ?? "");
      });

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          input.blur();
        }
      });

      cell.appendChild(input);
      // Defer focus so the click that triggered edit mode doesn't end up
      // moving the caret immediately on a freshly-mounted element.
      requestAnimationFrame(() => {
        if (input.isConnected) {
          input.focus();
          input.select();
        }
      });
    };

    const onCellMouseDown = (event: MouseEvent) => {
      const cell = event.currentTarget as HTMLTableCellElement;
      if (cell.classList.contains("cm-md-table-cell--editing")) {
        return;
      }
      // Block CM6's own pointer handling and the editor's selection update;
      // we'll move focus into the input ourselves.
      event.preventDefault();
      event.stopPropagation();
      enterEditMode(cell);
    };

    const buildCell = (tag: "th" | "td", text: string, align: TableAlign) => {
      const cell = document.createElement(tag);
      cell.className = "cm-md-table-cell";
      cell.dataset.mdSource = text;
      if (align) {
        cell.style.textAlign = align;
      }
      renderCellRendered(cell, text);
      cell.addEventListener("mousedown", onCellMouseDown);
      return cell;
    };

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const header = this.rows[0] ?? [];
    for (let c = 0; c < colCount; c += 1) {
      headerRow.appendChild(buildCell("th", header[c] ?? "", this.alignments[c]));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let r = 1; r < rowCount; r += 1) {
      const tr = document.createElement("tr");
      const cells = this.rows[r];
      for (let c = 0; c < colCount; c += 1) {
        tr.appendChild(buildCell("td", cells[c] ?? "", this.alignments[c]));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // Ask CodeMirror to remeasure right after the widget mounts. Without
    // this, CM6 keeps the height it estimated from the source-line count
    // (lines 1.6em-ish each) which can be quite a bit shorter than the
    // rendered table (cell min-height + padding + borders + margin), and
    // the height map drifts by that delta — once per widget — affecting
    // every cursor calculation downstream.
    view.requestMeasure();

    return wrapper;
  }

  // Help CM6's height map land on a value much closer to the rendered
  // table. Each visible row contributes the cell `min-height: 1.6em`
  // (1.6 * 0.95em font * 16px ≈ 24px), plus top + bottom padding of
  // 0.32em (≈ 5px each side ≈ 10px) and a border. ~36px per row plus a
  // small margin per table block keeps the estimate in the right ballpark
  // even before the measure pass runs.
  get estimatedHeight(): number {
    return this.rows.length * 36 + 12;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // Patch the existing widget DOM in place to reflect this widget's rows.
    // The cell currently in edit mode (containing the focused <input>) is
    // intentionally left alone so the user's caret and selection inside the
    // input are preserved across the dispatch round-trip that fires on
    // every keystroke.
    if (!dom.classList.contains("cm-md-table-wrapper")) {
      return false;
    }
    const table = dom.querySelector<HTMLTableElement>("table.cm-md-table");
    if (!table) {
      return false;
    }
    const cells = table.querySelectorAll<HTMLTableCellElement>("th, td");
    const colCount = this.alignments.length;
    const rowCount = this.rows.length;
    if (cells.length !== rowCount * colCount) {
      return false;
    }
    let idx = 0;
    let touched = false;
    for (let r = 0; r < rowCount; r += 1) {
      const row = this.rows[r];
      if (row.length !== colCount) {
        return false;
      }
      for (let c = 0; c < colCount; c += 1) {
        const cell = cells[idx];
        idx += 1;
        const newSource = row[c] ?? "";
        if (cell.dataset.mdSource === newSource) {
          continue;
        }
        touched = true;
        cell.dataset.mdSource = newSource;
        const input = cell.querySelector<HTMLInputElement>("input.cm-md-table-cell-input");
        if (input) {
          // Active editor cell: only sync the input value if it really
          // diverged (e.g. external doc change while editing).
          if (input.value !== newSource) {
            input.value = newSource;
          }
          continue;
        }
        renderCellRendered(cell, newSource);
      }
    }
    if (touched) {
      // Cell content can change rendered cell height (an empty cell drops
      // back to `min-height`, a wrapped value extends taller). Force a
      // re-measure so CM6's height map keeps up with the visible widget
      // size — without this, the click-target drift compounds per table
      // as edits accumulate across the doc.
      view.requestMeasure();
    }
    return true;
  }

  // Returning `true` keeps CodeMirror from intercepting clicks and key
  // events on the widget. With `false` CM6 calls `posAtCoords` on every
  // click and dispatches a selection update at the block edge, which would
  // yank focus from the cell input the user just clicked into and push the
  // selection model into a confused state.
  ignoreEvent(): boolean {
    return true;
  }
}

function readCellSource(cell: HTMLTableCellElement | undefined): string {
  if (!cell) {
    return "";
  }
  // The cell stores its raw markdown on `data-md-source`. Reading from the
  // data attribute lets us serialize non-editing cells (which display
  // rendered HTML) without losing markdown syntax characters that wouldn't
  // survive a textContent round-trip.
  if (cell.dataset.mdSource !== undefined) {
    return cell.dataset.mdSource;
  }
  const input = cell.querySelector<HTMLInputElement>("input.cm-md-table-cell-input");
  if (input) {
    return normalizeCellText(input.value);
  }
  return normalizeCellText(cell.textContent);
}

// Inline markdown rendered for table cells. The cell holds the raw markdown
// in `dataset.mdSource` and shows this rendered HTML when not focused;
// `onCellFocus` swaps back to plain text for editing. Mirrors the inline
// patterns the main editor recognizes so a bold cell stays bold, links look
// like links, etc. — without requiring a full CM instance per cell.
const CELL_INLINE_TOKEN_RE =
  /\*\*([^*\n]+)\*\*|(?:^|[^*])\*([^*\n]+)\*|~~([^~\n]+)~~|<u>([^<\n]+)<\/u>|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\n]+)\)/g;

function renderCellRendered(cell: HTMLElement, source: string): void {
  cell.replaceChildren();
  if (!source) {
    return;
  }
  let lastIndex = 0;
  // Reset regex state because RegExp objects with the `g` flag carry it.
  CELL_INLINE_TOKEN_RE.lastIndex = 0;
  for (let match = CELL_INLINE_TOKEN_RE.exec(source); match; match = CELL_INLINE_TOKEN_RE.exec(source)) {
    const tokenStart = match.index + (match[2] !== undefined ? match[0].indexOf("*") : 0);
    if (tokenStart > lastIndex) {
      cell.appendChild(document.createTextNode(source.slice(lastIndex, tokenStart)));
    }
    if (match[1] !== undefined) {
      const el = document.createElement("strong");
      el.textContent = match[1];
      cell.appendChild(el);
    } else if (match[2] !== undefined) {
      const el = document.createElement("em");
      el.textContent = match[2];
      cell.appendChild(el);
    } else if (match[3] !== undefined) {
      const el = document.createElement("span");
      el.className = "cm-md-strike";
      el.textContent = match[3];
      cell.appendChild(el);
    } else if (match[4] !== undefined) {
      const el = document.createElement("span");
      el.className = "cm-md-underline";
      el.textContent = match[4];
      cell.appendChild(el);
    } else if (match[5] !== undefined) {
      const el = document.createElement("code");
      el.className = "cm-md-inline-code";
      el.textContent = match[5];
      cell.appendChild(el);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const el = document.createElement("a");
      el.className = "cm-md-link";
      el.textContent = match[6];
      el.setAttribute("href", match[7]);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      cell.appendChild(el);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    cell.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function normalizeCellText(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  // Newlines inside a GFM cell break the row; collapse any that slip in via
  // paste into single spaces and trim surrounding whitespace.
  return raw.replace(/\s*\r?\n\s*/g, " ");
}

function serializeTableSource(rows: string[][], alignments: TableAlign[]): string {
  const renderRow = (cells: string[]) => {
    const padded = alignments.map((_, i) => (cells[i] ?? "").trim());
    return `| ${padded.join(" | ")} |`;
  };
  const renderSeparator = () =>
    `| ${alignments
      .map((a) => {
        if (a === "center") {
          return ":---:";
        }
        if (a === "left") {
          return ":---";
        }
        if (a === "right") {
          return "---:";
        }
        return "---";
      })
      .join(" | ")} |`;

  const lines: string[] = [];
  lines.push(renderRow(rows[0] ?? []));
  lines.push(renderSeparator());
  for (let r = 1; r < rows.length; r += 1) {
    lines.push(renderRow(rows[r] ?? []));
  }
  return lines.join("\n");
}

// Table blocks always render as a real `<table>` widget regardless of cursor
// position. A previous design toggled to a per-line source view when the
// cursor entered the block range, but that caused jarring layout shifts (the
// widget's rendered height differs from the source view's height) and made
// arrow-key navigation feel like the cursor was jumping. Cells are not
// directly editable; structural edits (add/delete row/column, change
// alignment) will arrive as a separate context-menu surface.
//
// Block decorations must live in a StateField because CodeMirror rejects
// them from a ViewPlugin. Per-line `cm-md-table-row` source decorations
// emitted by the ViewPlugin still apply to lines covered by the widget but
// have no visual effect — the block replace hides those lines wholesale.
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

export const tableBlockState = StateField.define<DecorationSet>({
  create: (state) => buildTableBlockDecorations(state),
  // Selection-only changes can't affect the widget output anymore (no cursor
  // toggle), so skip rebuild on `tr.selection` for free perf.
  update: (value, tr) => {
    if (tr.docChanged) {
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
