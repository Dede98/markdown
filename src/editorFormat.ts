import type { EditorState } from "@codemirror/state";

export type ActiveFormat = {
  heading: 0 | 1 | 2 | 3;
  bold: boolean;
  italic: boolean;
  inlineCode: boolean;
  link: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  taskList: boolean;
  quote: boolean;
  codeBlock: boolean;
  rule: boolean;
};

export const emptyFormat: ActiveFormat = {
  heading: 0,
  bold: false,
  italic: false,
  inlineCode: false,
  link: false,
  unorderedList: false,
  orderedList: false,
  taskList: false,
  quote: false,
  codeBlock: false,
  rule: false,
};

export function getActiveFormat(state: EditorState): ActiveFormat {
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  const text = line.text;
  const offset = cursor - line.from;
  const heading = text.match(/^(#{1,3})\s/);
  const format: ActiveFormat = {
    ...emptyFormat,
    heading: heading ? (heading[1].length as 1 | 2 | 3) : 0,
    taskList: /^\s*[-*]\s+\[[ xX]\]\s+/.test(text),
    unorderedList: /^\s*[-*]\s+/.test(text) && !/^\s*[-*]\s+\[[ xX]\]\s+/.test(text),
    orderedList: /^\s*\d+[.)]\s+/.test(text),
    quote: /^\s*>\s+/.test(text),
    rule: /^---+$/.test(text.trim()),
    codeBlock: isInsideCodeBlock(state, cursor),
  };

  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (isOffsetInsideMatch(offset, match.index!, match[0].length)) {
      format.bold = true;
    }
  }

  for (const match of text.matchAll(/(^|[^*])\*([^*\n]+)\*/g)) {
    const markerOffset = match[1].length;
    const start = match.index! + markerOffset;
    if (isOffsetInsideMatch(offset, start, match[0].length - markerOffset)) {
      format.italic = true;
    }
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (isOffsetInsideMatch(offset, match.index!, match[0].length)) {
      format.inlineCode = true;
    }
  }

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g)) {
    if (isOffsetInsideMatch(offset, match.index!, match[0].length)) {
      format.link = true;
    }
  }

  return format;
}

function isOffsetInsideMatch(offset: number, start: number, length: number) {
  return offset > start && offset < start + length;
}

function isInsideCodeBlock(state: EditorState, cursor: number) {
  let inside = false;

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    if (/^```/.test(line.text)) {
      inside = !inside;
      if (cursor >= line.from && cursor <= line.to) {
        return true;
      }
    } else if (inside && cursor >= line.from && cursor <= line.to) {
      return true;
    }

    if (line.to >= cursor) {
      return inside;
    }
  }

  return false;
}
