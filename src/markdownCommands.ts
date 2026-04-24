import type { EditorView } from "@codemirror/view";

type WrapPair = {
  before: string;
  after: string;
  placeholder: string;
};

export function wrapSelection(view: EditorView, pair: WrapPair) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to) || pair.placeholder;
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
}

export function setHeading(view: EditorView, level: 1 | 2 | 3) {
  const { state } = view;
  const prefix = `${"#".repeat(level)} `;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const text = line.text.replace(/^#{1,6}\s+/, "");
    const insert = `${prefix}${text}`;
    const delta = insert.length - line.text.length;

    return {
      changes: { from: line.from, to: line.to, insert },
      range: EditorSelection.range(range.from + delta, range.to + delta),
    };
  });

  view.dispatch(changes);
  view.focus();
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const startLine = state.doc.lineAt(range.from);
    const endLine = state.doc.lineAt(range.to);
    const edits = [];
    let selectionShift = 0;

    for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
      const line = state.doc.line(lineNo);
      if (line.text.startsWith(prefix)) {
        edits.push({ from: line.from, to: line.from + prefix.length, insert: "" });
        selectionShift -= prefix.length;
      } else {
        edits.push({ from: line.from, insert: prefix });
        selectionShift += prefix.length;
      }
    }

    return {
      changes: edits,
      range: EditorSelection.range(range.from, range.to + selectionShift),
    };
  });

  view.dispatch(changes);
  view.focus();
}

export function insertBlock(view: EditorView, markdown: string) {
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
}

export function insertLink(view: EditorView) {
  const { state } = view;
  const selection = state.selection.main;
  const selected = state.sliceDoc(selection.from, selection.to) || "link";
  const insert = `[${selected}](https://example.com)`;
  const from = selection.from + 1;
  const to = from + selected.length;

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: from, head: to },
  });
  view.focus();
}

import { EditorSelection } from "@codemirror/state";
