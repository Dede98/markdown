import { normalizeMarkdownLineEndings } from "./markdownText.mjs";

export function extractMarkdownHeadings(source) {
  const headings = [];
  let fence = null;

  for (const line of normalizeMarkdownLineEndings(source).split("\n")) {
    const content = line.match(/^ {0,3}(.*)$/)?.[1];

    if (fence) {
      if (content !== undefined) {
        const fenceRun = content.match(/^(`+|~+)[ \t]*$/)?.[1];

        if (
          fenceRun &&
          fenceRun[0] === fence.character &&
          fenceRun.length >= fence.length
        ) {
          fence = null;
        }
      }

      continue;
    }

    if (content === undefined) {
      continue;
    }

    const openingFence = content.match(/^(`{3,}|~{3,})/)?.[1];

    if (openingFence) {
      fence = {
        character: openingFence[0],
        length: openingFence.length,
      };
      continue;
    }

    const heading = content.match(/^(#{1,6})(?=[ \t])([\s\S]*)$/);

    if (!heading) {
      continue;
    }

    const text = heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim();

    if (text) {
      headings.push({ level: heading[1].length, text });
    }
  }

  return headings;
}

export function createMarkdownOutline(source) {
  const usedIds = new Set();

  return extractMarkdownHeadings(source).map(({ level, text }) => {
    const baseId =
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);

    return { level, text, id };
  });
}
