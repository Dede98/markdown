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

const LIST_RE = /^(\s*)([-*]|(\d+)([.)]))(\s+\[[ xX]\])?\s+/;
const EMPTY_LIST_RE = /^(\s*)([-*]|\d+[.)])(\s+\[[ xX]\])?\s*$/;
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
  const kind: ListKind = taskBox ? "task" : marker === "-" || marker === "*" ? "unordered" : "ordered";

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

  view.dispatch({
    changes: { from: line.from, insert: "  " },
    selection: { anchor: cursor + 2 },
    userEvent: "input",
  });

  return true;
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

  let removeLen: number;

  if (info.indent.startsWith("\t")) {
    removeLen = 1;
  } else if (info.indent.startsWith("  ")) {
    removeLen = 2;
  } else {
    removeLen = info.indent.length;
  }

  view.dispatch({
    changes: { from: line.from, to: line.from + removeLen, insert: "" },
    selection: { anchor: Math.max(line.from, cursor - removeLen) },
    userEvent: "delete",
  });

  return true;
}
