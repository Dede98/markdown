export type AutoSaveMode = "off" | "after-edit" | "interval";
export type AutoSaveInterval = 15 | 30 | 60 | 300;

export type AutoSavePreference = {
  mode: AutoSaveMode;
  intervalSeconds: AutoSaveInterval;
};

const AUTOSAVE_MODE_STORAGE_KEY = "markdown.autosave.mode";
const AUTOSAVE_INTERVAL_STORAGE_KEY = "markdown.autosave.intervalSeconds";

export const DEFAULT_AUTOSAVE_PREFERENCE: AutoSavePreference = {
  mode: "off",
  intervalSeconds: 30,
};

export const AUTOSAVE_AFTER_EDIT_DELAY_MS = 2500;

export const AUTOSAVE_INTERVAL_OPTIONS: AutoSaveInterval[] = [15, 30, 60, 300];

export function getStoredAutoSavePreference(): AutoSavePreference {
  if (typeof window === "undefined") {
    return DEFAULT_AUTOSAVE_PREFERENCE;
  }
  try {
    const storedMode = window.localStorage.getItem(AUTOSAVE_MODE_STORAGE_KEY);
    const storedInterval = Number(window.localStorage.getItem(AUTOSAVE_INTERVAL_STORAGE_KEY));
    return {
      mode: isAutoSaveMode(storedMode) ? storedMode : DEFAULT_AUTOSAVE_PREFERENCE.mode,
      intervalSeconds: isAutoSaveInterval(storedInterval)
        ? storedInterval
        : DEFAULT_AUTOSAVE_PREFERENCE.intervalSeconds,
    };
  } catch {
    return DEFAULT_AUTOSAVE_PREFERENCE;
  }
}

export function storeAutoSavePreference(value: AutoSavePreference) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AUTOSAVE_MODE_STORAGE_KEY, value.mode);
    window.localStorage.setItem(AUTOSAVE_INTERVAL_STORAGE_KEY, String(value.intervalSeconds));
  } catch {
    // Storage may be unavailable; the in-memory preference still applies.
  }
}

function isAutoSaveMode(value: string | null): value is AutoSaveMode {
  return value === "off" || value === "after-edit" || value === "interval";
}

function isAutoSaveInterval(value: number): value is AutoSaveInterval {
  return AUTOSAVE_INTERVAL_OPTIONS.includes(value as AutoSaveInterval);
}
