import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isInsideCodeBlock } from "./editorFormat";

const WRAP_PAIRS: Record<string, { open: string; close: string }> = {
  "*": { open: "*", close: "*" },
  _: { open: "_", close: "_" },
  "`": { open: "`", close: "`" },
  "[": { open: "[", close: "]" },
  "(": { open: "(", close: ")" },
};

export const autoPairExtension = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (text.length !== 1) {
    return false;
  }

  const pair = WRAP_PAIRS[text];

  if (!pair) {
    return false;
  }

  const ranges = view.state.selection.ranges;

  if (ranges.every((range) => range.empty)) {
    return false;
  }

  if (ranges.some((range) => !range.empty && isInsideCodeBlock(view.state, range.from))) {
    return false;
  }

  const changes = view.state.changeByRange((range) => {
    if (range.empty) {
      const insertChange: ChangeSpec = { from: range.from, insert: text };

      return {
        changes: insertChange,
        range: EditorSelection.cursor(range.from + text.length),
      };
    }

    const selected = view.state.sliceDoc(range.from, range.to);

    return {
      changes: { from: range.from, to: range.to, insert: `${pair.open}${selected}${pair.close}` },
      range: EditorSelection.range(range.from + pair.open.length, range.to + pair.open.length),
    };
  });

  view.dispatch(changes, { userEvent: "input.type" });

  return true;
});

const URL_RE = /^(https?:\/\/|mailto:)\S+$/;

export const linkPasteExtension = EditorView.domEventHandlers({
  paste(event, view) {
    const clipboard = event.clipboardData?.getData("text/plain")?.trim();

    if (!clipboard || !URL_RE.test(clipboard)) {
      return false;
    }

    const ranges = view.state.selection.ranges;

    if (ranges.every((range) => range.empty)) {
      return false;
    }

    if (ranges.some((range) => isInsideCodeBlock(view.state, range.from))) {
      return false;
    }

    event.preventDefault();

    const changes = view.state.changeByRange((range) => {
      if (range.empty) {
        return {
          changes: { from: range.from, insert: clipboard },
          range: EditorSelection.cursor(range.from + clipboard.length),
        };
      }

      const label = view.state.sliceDoc(range.from, range.to);
      const insert = `[${label}](${clipboard})`;

      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    });

    view.dispatch(changes, { userEvent: "input.paste" });

    return true;
  },
});
