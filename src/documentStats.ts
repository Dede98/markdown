export function countDocumentWords(source: string): number {
  const trimmedSource = source.trim();

  return trimmedSource === "" ? 0 : trimmedSource.split(/\s+/u).length;
}
