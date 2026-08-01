import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type MarkdownHeading = {
  id: string;
  level: number;
  label: string;
  from: number;
  to: number;
  contentFrom: number;
};

const HEADING_NODE = /^(ATXHeading([1-6])|SetextHeading([12]))$/;

export function collectMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      const match = HEADING_NODE.exec(node.name);
      if (!match) {
        return;
      }

      const level = Number(match[2] ?? match[3]);
      const source = state.doc.sliceString(node.from, node.to);
      const atx = node.name.startsWith("ATXHeading");
      const extracted = atx ? extractAtxHeading(source) : extractSetextHeading(source);

      headings.push({
        id: `heading-${node.from}-${level}`,
        level,
        label: cleanHeadingLabel(extracted.label),
        from: node.from,
        to: node.to,
        contentFrom: node.from + extracted.contentOffset,
      });
    },
  });

  return headings;
}

export function headingSignature(headings: MarkdownHeading[]): string {
  return headings
    .map((heading) => `${heading.from}:${heading.to}:${heading.level}:${heading.contentFrom}:${heading.label}`)
    .join("|");
}

export function activeHeadingAt(headings: MarkdownHeading[], position: number): string | null {
  let active: string | null = null;

  for (const heading of headings) {
    if (heading.from > position) {
      break;
    }
    active = heading.id;
  }

  return active;
}

function extractAtxHeading(source: string) {
  const opening = /^ {0,3}#{1,6}(?:[\t ]+|$)/.exec(source);
  const contentOffset = opening?.[0].length ?? 0;
  const label = source
    .slice(contentOffset)
    .replace(/[\t ]+#+[\t ]*$/, "")
    .trim();

  return { label, contentOffset };
}

function extractSetextHeading(source: string) {
  const underlineStart = source.lastIndexOf("\n");
  const rawLabel = underlineStart === -1 ? source : source.slice(0, underlineStart);
  const indentation = /^ {0,3}/.exec(rawLabel)?.[0].length ?? 0;

  return {
    label: rawLabel.slice(indentation).replace(/\r?\n/g, " ").trim(),
    contentOffset: indentation,
  };
}

function cleanHeadingLabel(source: string): string {
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "Untitled heading";
}
