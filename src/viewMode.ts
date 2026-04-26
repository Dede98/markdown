// View mode preference persistence for raw and zen toggles.
// Mirrors the pattern in src/theme.ts: SSR-safe guards, try/catch on every
// localStorage call, "1"/"0" serialization for booleans.

export const RAW_STORAGE_KEY = "markdown.raw";
export const ZEN_STORAGE_KEY = "markdown.zen";

function parseBoolPref(value: unknown): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

export function getStoredRaw(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(RAW_STORAGE_KEY);
    return parseBoolPref(stored) ?? false;
  } catch {
    return false;
  }
}

export function storeRaw(value: boolean): void {
  // Defense-in-depth: refuse non-boolean inputs even though the type forces it
  // for TS callers, mirroring `storeTheme` in src/theme.ts. Keeps the read-side
  // whitelist and the write side in sync if a future JS caller bypasses typing.
  if (typeof value !== "boolean" || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RAW_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage may be denied (private mode). Apply still works for the session.
  }
}

export function getStoredZen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(ZEN_STORAGE_KEY);
    return parseBoolPref(stored) ?? false;
  } catch {
    return false;
  }
}

export function storeZen(value: boolean): void {
  // Same defense-in-depth shape as `storeRaw`: keep the boolean contract honest
  // even if a future JS caller passes a coerced truthy non-boolean.
  if (typeof value !== "boolean" || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ZEN_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage may be denied (private mode). Apply still works for the session.
  }
}
