import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type MarkdownCommand<Args = void> = Args extends void
  ? (view: EditorView) => boolean
  : (view: EditorView, args: Args) => boolean;

type WrapPair = {
  before: string;
  after: string;
  placeholder: string;
};

export function wrapSelection(view: EditorView, pair: WrapPair): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    if (range.empty) {
      const insert = `${pair.before}${pair.placeholder}${pair.after}`;
      const anchor = range.from + pair.before.length;
      const head = anchor + pair.placeholder.length;

      return {
        changes: { from: range.from, insert },
        range: EditorSelection.range(anchor, head),
      };
    }

    const selected = state.sliceDoc(range.from, range.to);

    if (selected.startsWith(pair.before) && selected.endsWith(pair.after)) {
      const unwrapped = selected.slice(pair.before.length, selected.length - pair.after.length);

      return {
        changes: { from: range.from, to: range.to, insert: unwrapped },
        range: EditorSelection.range(range.from, range.from + unwrapped.length),
      };
    }

    const beforeFrom = Math.max(0, range.from - pair.before.length);
    const beforeSelection = state.sliceDoc(beforeFrom, range.from);
    const afterSelection = state.sliceDoc(range.to, range.to + pair.after.length);

    if (beforeSelection === pair.before && afterSelection === pair.after) {
      return {
        changes: [
          { from: range.from - pair.before.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + pair.after.length, insert: "" },
        ],
        range: EditorSelection.range(range.from - pair.before.length, range.to - pair.before.length),
      };
    }

    const insert = `${pair.before}${selected}${pair.after}`;
    const anchor = range.from + pair.before.length;
    const head = anchor + selected.length;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  });

  view.dispatch(changes);
  view.focus();
  return true;
}

export function setHeading(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
  const { state } = view;
  const prefix = `${"#".repeat(level)} `;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const existing = line.text.match(/^(#{1,6})\s+/);
    const text = line.text.replace(/^#{1,6}\s+/, "");
    const insert = existing?.[1].length === level ? text : `${prefix}${text}`;
    const delta = insert.length - line.text.length;

    return {
      changes: { from: line.from, to: line.to, insert },
      range: EditorSelection.range(range.from + delta, range.to + delta),
    };
  });

  view.dispatch(changes);
  view.focus();
  return true;
}

export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(getSelectionEnd(state, range));
    const edits = [];
    let selectionShift = 0;

    for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
      const line = state.doc.line(lineNo);
      const existingPrefix = getCompatibleLinePrefix(line.text, prefix);

      if (existingPrefix === prefix) {
        edits.push({ from: line.from, to: line.from + existingPrefix.length, insert: "" });
        selectionShift -= existingPrefix.length;
      } else {
        const from = existingPrefix ? line.from : line.from + line.text.match(/^\s*/u)![0].length;
        const to = existingPrefix ? line.from + existingPrefix.length : from;

        edits.push({ from, to, insert: prefix });
        selectionShift += prefix.length - (existingPrefix?.length ?? 0);
      }
    }

    return {
      changes: edits,
      range: EditorSelection.range(range.from, range.to + selectionShift),
    };
  });

  view.dispatch(changes);
  view.focus();
  return true;
}

export function insertBlock(view: EditorView, markdown: string): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.from);
  const prefix = line.from === selection.from ? "" : "\n";
  const insert = `${prefix}${markdown}`;
  const cursor = selection.from + insert.length;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: cursor },
  });
  view.focus();
  return true;
}

export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const selected = state.sliceDoc(selection.from, selection.to) || "link";
  const url = "https://example.com";
  const insert = `[${selected}](${url})`;
  const from = selection.from + selected.length + 3;
  const to = from + url.length;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: from, head: to },
  });
  view.focus();
  return true;
}

function getSelectionEnd(state: EditorView["state"], range: SelectionRange) {
  if (range.to > range.from && state.sliceDoc(range.to - 1, range.to) === "\n") {
    return range.to - 1;
  }

  return range.to;
}

function getCompatibleLinePrefix(text: string, targetPrefix: string) {
  if (targetPrefix === "> ") {
    return text.match(/^\s*>\s+/)?.[0];
  }

  if (targetPrefix === "- " || targetPrefix === "1. " || targetPrefix === "- [ ] ") {
    return text.match(/^\s*(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+)/)?.[0];
  }

  return text.startsWith(targetPrefix) ? targetPrefix : null;
}
