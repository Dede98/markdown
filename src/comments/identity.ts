import type { CommentAuthor } from "./types";

const NAME_KEY = "markdown.comments.authorName";
const UUID_KEY = "markdown.comments.authorUuid";

export function getStoredCommentAuthor(): CommentAuthor {
  return {
    name: readLocalStorage(NAME_KEY) || "",
    uuid: readLocalStorage(UUID_KEY) || createAndStoreUuid(),
  };
}

export function storeCommentAuthorName(name: string): CommentAuthor {
  const trimmed = name.trim();
  const uuid = readLocalStorage(UUID_KEY) || createAndStoreUuid();
  if (trimmed) {
    writeLocalStorage(NAME_KEY, trimmed);
  }
  return { name: trimmed, uuid };
}

function createAndStoreUuid() {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  writeLocalStorage(UUID_KEY, uuid);
  return uuid;
}

function readLocalStorage(key: string) {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {
    // Local storage can be disabled; comments still work for the session.
  }
}
