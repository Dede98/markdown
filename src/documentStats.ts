export function countDocumentWords(source: string): number {
  const trimmedSource = source.trim();

  return trimmedSource === "" ? 0 : trimmedSource.split(/\s+/u).length;
}

export function estimateReadingMinutes(source: string): number {
  const wordCount = countDocumentWords(source);

  return wordCount === 0 ? 0 : Math.ceil(wordCount / 200);
}
