export function normalizeMarkdownLineEndings(source) {
  return source.replace(/\r\n?/g, "\n");
}

export function countMarkdownParagraphs(source) {
  const lines = normalizeMarkdownLineEndings(source).split("\n");
  let paragraphCount = 0;
  let inParagraph = false;

  for (const line of lines) {
    const isBlank = /^\s*$/.test(line);

    if (isBlank) {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphCount += 1;
      inParagraph = true;
    }
  }

  return paragraphCount;
}
