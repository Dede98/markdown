export type ContentWidth = "focused" | "wide" | "full";

const CONTENT_WIDTH_STORAGE_KEY = "markdown.contentWidth";
const DEFAULT_CONTENT_WIDTH: ContentWidth = "wide";

export function getStoredContentWidth(): ContentWidth {
  if (typeof window === "undefined") {
    return DEFAULT_CONTENT_WIDTH;
  }
  try {
    const stored = window.localStorage.getItem(CONTENT_WIDTH_STORAGE_KEY);
    return isContentWidth(stored) ? stored : DEFAULT_CONTENT_WIDTH;
  } catch {
    return DEFAULT_CONTENT_WIDTH;
  }
}

export function storeContentWidth(value: ContentWidth) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CONTENT_WIDTH_STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable; the in-memory preference still applies.
  }
}

function isContentWidth(value: string | null): value is ContentWidth {
  return value === "focused" || value === "wide" || value === "full";
}
