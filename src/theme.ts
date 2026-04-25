// Theme preference handling. The user can choose "light", "dark", or "system".
// "system" follows the OS via `prefers-color-scheme` and updates live.
//
// The resolved theme ("light" | "dark") is applied as `data-theme` on
// `document.documentElement`. CSS reads tokens off that attribute, so theme
// switches are a CSS variable swap with no React re-render.

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "markdown.theme";
export const THEME_VALUES: ThemePref[] = ["light", "dark", "system"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePref(value: unknown): value is ThemePref {
  return value === "light" || value === "dark" || value === "system";
}

export function getStoredTheme(): ThemePref {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(pref: ThemePref): void {
  // Defense-in-depth: refuse non-conforming inputs even though the type forces
  // it for TS callers, so the read-side whitelist and the write-side stay in
  // sync if a future JS caller bypasses typing.
  if (!isThemePref(pref) || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Storage may be denied (private mode). Apply still works for the session.
  }
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "light" || pref === "dark") {
    return pref;
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
  }
  return resolved;
}

// Subscribe to OS theme changes. The callback receives the new resolved theme.
// Returns an unsubscribe function. Safe to call when matchMedia is missing.
export function subscribeToSystemTheme(onChange: (next: ResolvedTheme) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "dark" : "light");
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }
  // Safari < 14 fallback
  media.addListener(handler);
  return () => media.removeListener(handler);
}

// Cycle order shown in the topbar toggle: light -> dark -> system -> light.
export function nextTheme(pref: ThemePref): ThemePref {
  const index = THEME_VALUES.indexOf(pref);
  return THEME_VALUES[(index + 1) % THEME_VALUES.length] ?? "system";
}

export function describeTheme(pref: ThemePref, resolved: ResolvedTheme): {
  label: string;
  hint: string;
} {
  if (pref === "light") {
    return { label: "Light theme", hint: "Switch to dark theme" };
  }
  if (pref === "dark") {
    return { label: "Dark theme", hint: "Switch to system theme" };
  }
  const which = resolved === "dark" ? "dark" : "light";
  return { label: `System theme (${which})`, hint: "Switch to light theme" };
}
