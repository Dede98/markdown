export function normalizeMarkdownLineEndings(source) {
  return source.replace(/\r\n?/g, "\n");
}
