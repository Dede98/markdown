import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isInsideCodeBlock } from "./editorFormat";

type ListKind = "unordered" | "ordered" | "task";

type ListInfo = {
  indent: string;
  marker: string;
  taskBox: string;
  body: string;
  fullPrefix: string;
  kind: ListKind;
  orderedNumber: number;
  orderedSeparator: "." | ")";
};

type ListLine = {
  from: number;
};

const LIST_RE = /^(\s*)([-*+]|(\d+)([.)]))(\s+\[[ xX]\])?\s+/;
const EMPTY_LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s*$/;
const QUOTE_CONTINUE_RE = /^(\s*>\s+)/;
const QUOTE_EMPTY_RE = /^(\s*)>\s*$/;

function parseListLine(text: string): ListInfo | null {
  const match = text.match(LIST_RE);

  if (!match) {
    return null;
  }

  const indent = match[1];
  const marker = match[2];
  const taskBoxRaw = match[5] ?? "";
  const fullPrefix = match[0];
  const body = text.slice(fullPrefix.length);
  const orderedDigits = match[3];
  const orderedSeparator = (match[4] as "." | ")" | undefined) ?? ".";
  const taskBox = taskBoxRaw.trim();
  const orderedNumber = orderedDigits ? Number.parseInt(orderedDigits, 10) : Number.NaN;
  const kind: ListKind = taskBox ? "task" : marker === "-" || marker === "*" || marker === "+" ? "unordered" : "ordered";

  return { indent, marker, taskBox, body, fullPrefix, kind, orderedNumber, orderedSeparator };
}

function isEmptyListLine(text: string): boolean {
  return EMPTY_LIST_RE.test(text);
}

function buildContinuationPrefix(info: ListInfo): string {
  if (info.kind === "task") {
    return `${info.indent}${info.marker} [ ] `;
  }

  if (info.kind === "ordered") {
    const next = Number.isFinite(info.orderedNumber) ? info.orderedNumber + 1 : 1;
    return `${info.indent}${next}${info.orderedSeparator} `;
  }

  return `${info.indent}${info.marker} `;
}

function indentationWidth(indent: string): number {
  let width = 0;

  for (const character of indent) {
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
  }

  return width;
}

function findPreviousSibling(state: EditorState, lineNumber: number, indentWidth: number): ListInfo | null {
  for (let number = lineNumber - 1; number >= 1; number -= 1) {
    const line = state.doc.line(number);

    if (line.text.trim().length === 0) {
      return null;
    }

    const info = parseListLine(line.text);

    if (!info) {
      return null;
    }

    const candidateWidth = indentationWidth(info.indent);

    if (candidateWidth === indentWidth) {
      return info;
    }

    if (candidateWidth < indentWidth) {
      return null;
    }
  }

  return null;
}

function nextOrderedNumberAtIndent(
  state: EditorState,
  beforeLineNumber: number,
  targetIndentWidth: number,
  separator: "." | ")",
): number {
  for (let number = beforeLineNumber - 1; number >= 1; number -= 1) {
    const line = state.doc.line(number);
    const info = parseListLine(line.text);

    if (!info || line.text.trim().length === 0) {
      break;
    }

    const candidateWidth = indentationWidth(info.indent);

    if (candidateWidth < targetIndentWidth) {
      break;
    }

    if (candidateWidth === targetIndentWidth) {
      return info.kind === "ordered" && info.orderedSeparator === separator
        ? info.orderedNumber + 1
        : 1;
    }
  }

  return 1;
}

function collectListSubtree(state: EditorState, lineNumber: number, rootIndentWidth: number): ListLine[] {
  const root = state.doc.line(lineNumber);
  const rootInfo = parseListLine(root.text);

  if (!rootInfo) {
    return [];
  }

  const lines: ListLine[] = [{ from: root.from }];

  for (let number = lineNumber + 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const info = parseListLine(line.text);

    if (!info || indentationWidth(info.indent) <= rootIndentWidth) {
      break;
    }

    lines.push({ from: line.from });
  }

  return lines;
}

function appendFollowingOrderedRenumberChanges(
  state: EditorState,
  fromLineNumber: number,
  indentWidth: number,
  separator: "." | ")",
  firstNumber: number,
  changes: Array<{ from: number; to?: number; insert: string }>,
) {
  let nextNumber = Math.max(1, firstNumber);

  for (let number = fromLineNumber; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const info = parseListLine(line.text);

    if (!info || line.text.trim().length === 0) {
      break;
    }

    const candidateWidth = indentationWidth(info.indent);

    if (candidateWidth < indentWidth) {
      break;
    }

    if (candidateWidth > indentWidth) {
      continue;
    }

    if (info.kind !== "ordered" || info.orderedSeparator !== separator) {
      break;
    }

    const marker = `${nextNumber}${separator}`;

    if (marker !== info.marker) {
      changes.push({
        from: line.from + info.indent.length,
        to: line.from + info.indent.length + info.marker.length,
        insert: marker,
      });
    }

    nextNumber += 1;
  }
}

function indentListItem(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;

  if (!range.empty) {
    return false;
  }

  const cursor = range.head;
  const line = state.doc.lineAt(cursor);

  if (isInsideCodeBlock(state, cursor)) {
    return false;
  }

  const info = parseListLine(line.text);

  if (!info) {
    return false;
  }

  const currentIndentWidth = indentationWidth(info.indent);
  const previousSibling = findPreviousSibling(state, line.number, currentIndentWidth);

  // A nested item needs a preceding item at the same level to become its
  // parent. Consume Tab on the first item instead of inserting a stray tab
  // that only looks indented while remaining an invalid list hierarchy.
  if (!previousSibling) {
    return true;
  }

  // Use a conventional four-space Markdown tab stop so nesting is visually
  // clear in the editor. Wider ordered markers still require their full
  // content-column width (`100. ` needs five spaces, for example).
  const indent = " ".repeat(Math.max(4, previousSibling.marker.length + 1));
  const subtree = collectListSubtree(state, line.number, currentIndentWidth);
  const changes: Array<{ from: number; to?: number; insert: string }> = subtree.map((item) => ({ from: item.from, insert: indent }));
  let markerLengthDelta = 0;

  if (info.kind === "ordered") {
    const nestedNumber = nextOrderedNumberAtIndent(
      state,
      line.number,
      currentIndentWidth + indent.length,
      info.orderedSeparator,
    );
    const marker = `${nestedNumber}${info.orderedSeparator}`;
    markerLengthDelta = marker.length - info.marker.length;
    changes.push({
      from: line.from + info.indent.length,
      to: line.from + info.indent.length + info.marker.length,
      insert: marker,
    });
    appendFollowingOrderedRenumberChanges(
      state,
      line.number + subtree.length,
      currentIndentWidth,
      info.orderedSeparator,
      info.orderedNumber,
      changes,
    );
  }

  view.dispatch({
    changes,
    selection: { anchor: cursor + indent.length + markerLengthDelta },
    userEvent: "input",
  });

  return true;
}

export function handleEnter(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;

  if (!range.empty) {
    return false;
  }

  const cursor = range.head;
  const line = state.doc.lineAt(cursor);

  if (isInsideCodeBlock(state, cursor)) {
    const indent = line.text.match(/^[\t ]*/)?.[0] ?? "";

    if (indent.length === 0) {
      return false;
    }

    const insert = `\n${indent}`;

    view.dispatch({
      changes: { from: cursor, insert },
      selection: { anchor: cursor + insert.length },
      userEvent: "input",
    });

    return true;
  }

  const emptyQuote = line.text.match(QUOTE_EMPTY_RE);

  if (emptyQuote) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "\n" },
      selection: { anchor: line.from + 1 },
      userEvent: "input",
    });

    return true;
  }

  const quoteContinue = line.text.match(QUOTE_CONTINUE_RE);

  if (quoteContinue) {
    const insert = `\n${quoteContinue[1]}`;

    view.dispatch({
      changes: { from: cursor, insert },
      selection: { anchor: cursor + insert.length },
      userEvent: "input",
    });

    return true;
  }

  if (isEmptyListLine(line.text) && cursor === line.to) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "\n" },
      selection: { anchor: line.from + 1 },
      userEvent: "input",
    });

    return true;
  }

  const info = parseListLine(line.text);

  if (info) {
    const prefixEnd = line.from + info.fullPrefix.length;

    if (cursor < prefixEnd) {
      return false;
    }

    const insert = `\n${buildContinuationPrefix(info)}`;

    view.dispatch({
      changes: { from: cursor, insert },
      selection: { anchor: cursor + insert.length },
      userEvent: "input",
    });

    return true;
  }

  return false;
}

export function handleBackspace(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;

  if (!range.empty) {
    return false;
  }

  const cursor = range.head;
  const line = state.doc.lineAt(cursor);

  if (isInsideCodeBlock(state, cursor)) {
    return false;
  }

  const info = parseListLine(line.text);

  if (info && cursor === line.from + info.fullPrefix.length) {
    view.dispatch({
      changes: { from: line.from, to: line.from + info.fullPrefix.length, insert: info.indent },
      selection: { anchor: line.from + info.indent.length },
      userEvent: "delete",
    });

    return true;
  }

  const quotePrefix = line.text.match(QUOTE_CONTINUE_RE);

  if (quotePrefix && cursor === line.from + quotePrefix[1].length) {
    view.dispatch({
      changes: { from: line.from, to: line.from + quotePrefix[1].length, insert: "" },
      selection: { anchor: line.from },
      userEvent: "delete",
    });

    return true;
  }

  const headingPrefix = line.text.match(/^(#{1,6}\s+)/);

  if (headingPrefix && cursor === line.from + headingPrefix[1].length) {
    view.dispatch({
      changes: { from: line.from, to: line.from + headingPrefix[1].length, insert: "" },
      selection: { anchor: line.from },
      userEvent: "delete",
    });

    return true;
  }

  return false;
}

export function handleListTab(view: EditorView): boolean {
  return indentListItem(view);
}

export function handleListSpace(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;

  if (!range.empty) {
    return false;
  }

  const line = state.doc.lineAt(range.head);
  const info = parseListLine(line.text);

  if (!info || range.head > line.from + info.fullPrefix.length) {
    return false;
  }

  return indentListItem(view);
}

export function handleListShiftTab(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;

  if (!range.empty) {
    return false;
  }

  const cursor = range.head;
  const line = state.doc.lineAt(cursor);

  if (isInsideCodeBlock(state, cursor)) {
    return false;
  }

  const info = parseListLine(line.text);

  if (!info || info.indent.length === 0) {
    return false;
  }

  const currentIndentWidth = indentationWidth(info.indent);
  let parentIndent = "";

  for (let number = line.number - 1; number >= 1; number -= 1) {
    const candidateLine = state.doc.line(number);
    const candidate = parseListLine(candidateLine.text);

    if (!candidate || candidateLine.text.trim().length === 0) {
      break;
    }

    if (indentationWidth(candidate.indent) < currentIndentWidth) {
      parentIndent = info.indent.startsWith(candidate.indent) ? candidate.indent : "";
      break;
    }
  }

  const removeLen = info.indent.length - parentIndent.length;
  const subtree = collectListSubtree(state, line.number, currentIndentWidth);
  const changes: Array<{ from: number; to?: number; insert: string }> = subtree.map((item) => ({
    from: item.from + parentIndent.length,
    to: item.from + parentIndent.length + removeLen,
    insert: "",
  }));
  let markerLengthDelta = 0;

  if (info.kind === "ordered") {
    const parentNumber = nextOrderedNumberAtIndent(
      state,
      line.number,
      indentationWidth(parentIndent),
      info.orderedSeparator,
    );
    const marker = `${parentNumber}${info.orderedSeparator}`;
    markerLengthDelta = marker.length - info.marker.length;
    changes.push({
      from: line.from + info.indent.length,
      to: line.from + info.indent.length + info.marker.length,
      insert: marker,
    });
    const followingLineNumber = line.number + subtree.length;
    appendFollowingOrderedRenumberChanges(
      state,
      followingLineNumber,
      currentIndentWidth,
      info.orderedSeparator,
      info.orderedNumber,
      changes,
    );
    appendFollowingOrderedRenumberChanges(
      state,
      followingLineNumber,
      indentationWidth(parentIndent),
      info.orderedSeparator,
      parentNumber + 1,
      changes,
    );
  }

  view.dispatch({
    changes,
    selection: { anchor: Math.max(line.from, cursor - removeLen + markerLengthDelta) },
    userEvent: "delete",
  });

  return true;
}
