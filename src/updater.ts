// Auto-update bridge for the Tauri build.
//
// The frontend never imports `@tauri-apps/plugin-updater` or
// `-process` at module load. Both are pulled in via `await import(...)`
// only when the user is on the Tauri shell — the web build never
// touches them at runtime, even though Vite still emits the chunks.
//
// The updater pubkey, manifest endpoint, and `createUpdaterArtifacts`
// flag all live in `src-tauri/tauri.conf.json`. The host-side capability
// `updater:default` (in `src-tauri/capabilities/default.json`) is what
// allows the JS surface to call `check()` / `downloadAndInstall()`;
// `process:allow-restart` allows the post-install `relaunch()`.
//
// A consumer of this module is expected to gate every call behind
// `isTauriRuntime()`. Calling `checkForUpdate()` from a browser tab
// will throw at the dynamic import.

import type { Update } from "@tauri-apps/plugin-updater";

export type { Update } from "@tauri-apps/plugin-updater";

export async function checkForUpdate(): Promise<Update | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

export type UpdateProgress = {
  downloaded: number;
  contentLength: number | null;
};

// Run the full download → install → relaunch loop against an `Update`
// handle previously returned by `checkForUpdate`. The handle owns the
// signed-payload state on the Tauri side; reusing it here avoids a
// redundant `check()` round-trip.
export async function installAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");

  let downloaded = 0;
  let contentLength: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        break;
      // "Finished" carries no extra data; the await resolves once the
      // installer has written the new bundle into place.
    }
    onProgress?.({ downloaded, contentLength });
  });

  await relaunch();
}
