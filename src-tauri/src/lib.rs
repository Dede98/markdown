// Tauri 2 shell for the local-first Markdown editor.
//
// Responsibilities of this module:
// 1. Wire the `fs` and `dialog` plugins so the TauriFileAdapter can read/write
//    `.md` files and prompt the user for paths via native pickers.
// 2. Build a native desktop menu with file, edit, view, and about actions,
//    then forward menu clicks to the frontend as `menu:*` events.
// 3. Carry OS-supplied file paths into the webview when the app is launched
//    via Finder double-click or "Open With" — `RunEvent::Opened` fires before
//    JS can mount listeners, so paths are queued and the frontend drains them
//    on startup via `drain_pending_open_paths`. Live arrivals (already-running
//    app gets a new file) are forwarded as `file:open-path` events.
//
// Naming rule: this is a *file* shell. No "document", "doc id", or "sync"
// concepts leak into menu ids or event names.

use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

const MENU_NEW: &str = "menu_new";
const MENU_OPEN: &str = "menu_open";
const MENU_SAVE: &str = "menu_save";
const MENU_SAVE_AS: &str = "menu_save_as";
const MENU_EXPORT_PDF: &str = "menu_export_pdf";
const MENU_TOGGLE_RAW: &str = "menu_toggle_raw";
const MENU_TOGGLE_ZEN: &str = "menu_toggle_zen";

const EVENT_NEW: &str = "menu:new";
const EVENT_OPEN: &str = "menu:open";
const EVENT_SAVE: &str = "menu:save";
const EVENT_SAVE_AS: &str = "menu:save-as";
const EVENT_EXPORT_PDF: &str = "menu:export-pdf";
const EVENT_TOGGLE_RAW: &str = "menu:toggle-raw";
const EVENT_TOGGLE_ZEN: &str = "menu:toggle-zen";

const EVENT_OPEN_PATH: &str = "file:open-path";

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

impl PendingOpenPaths {
    // Always recover from a poisoned lock — the queue holds OS-supplied paths
    // that must not be lost just because another thread panicked elsewhere.
    fn lock_recover(&self) -> std::sync::MutexGuard<'_, Vec<String>> {
        match self.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[tauri::command]
fn drain_pending_open_paths<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    state: tauri::State<'_, PendingOpenPaths>,
) -> Vec<String> {
    // Defense in depth: only the main webview can drain the queue. If a future
    // change adds a second webview window, paths intended for the editor are
    // not handed to it accidentally.
    if webview.label() != "main" {
        return Vec::new();
    }
    state.lock_recover().drain(..).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // `process` powers the post-install relaunch the updater needs;
        // `updater` itself reads the manifest, verifies the signature, and
        // swaps the binary. Both are gated behind capability permissions in
        // `capabilities/default.json` so the JS side cannot invoke them
        // outside the main editor window.
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingOpenPaths::default())
        .invoke_handler(tauri::generate_handler![drain_pending_open_paths])
        .setup(|app| {
            let handle = app.handle();
            let menu = build_app_menu(handle)?;
            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                let event_name = match event.id.0.as_str() {
                    MENU_NEW => Some(EVENT_NEW),
                    MENU_OPEN => Some(EVENT_OPEN),
                    MENU_SAVE => Some(EVENT_SAVE),
                    MENU_SAVE_AS => Some(EVENT_SAVE_AS),
                    MENU_EXPORT_PDF => Some(EVENT_EXPORT_PDF),
                    MENU_TOGGLE_RAW => Some(EVENT_TOGGLE_RAW),
                    MENU_TOGGLE_ZEN => Some(EVENT_TOGGLE_ZEN),
                    _ => None,
                };
                if let Some(name) = event_name {
                    if let Err(err) = app_handle.emit(name, ()) {
                        eprintln!("failed to emit {name}: {err}");
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS file association / "Open With" / drag-onto-dock-icon all land
        // here. The webview may or may not exist yet:
        //   - cold start: no webview → queue the path, JS drains on mount
        //   - warm: webview exists → emit live and skip the queue, otherwise
        //     a stale entry from a previous run would also be re-loaded
        if let tauri::RunEvent::Opened { urls } = event {
            let state = app_handle.state::<PendingOpenPaths>();
            let has_webview = !app_handle.webview_windows().is_empty();
            for url in urls {
                let Ok(path) = url.to_file_path() else { continue };
                // Skip non-UTF-8 paths instead of mangling them with U+FFFD;
                // a corrupted string would just fail at readTextFile anyway.
                let Some(path_str) = path.to_str().map(|s| s.to_string()) else {
                    eprintln!("skipping non-UTF-8 path from RunEvent::Opened");
                    continue;
                };
                if has_webview {
                    if let Err(err) = app_handle.emit(EVENT_OPEN_PATH, &path_str) {
                        eprintln!("failed to emit {EVENT_OPEN_PATH}: {err}");
                    }
                } else {
                    state.lock_recover().push(path_str);
                }
            }
        }
    });
}

fn build_app_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<Menu<R>> {
    // About panel provenance. Version is pulled from Cargo at compile time so
    // it cannot drift from the bundle. Author / website / copyright point at
    // the open-source project home; the project ships under MIT.
    let app_metadata = AboutMetadata {
        name: Some("Markdown".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        authors: Some(vec!["Dejan Brinker".into()]),
        comments: Some("Local-first Markdown editor.".into()),
        copyright: Some("© 2026 Dejan Brinker. MIT licensed.".into()),
        website: Some("https://github.com/Dede98/markdown".into()),
        website_label: Some("github.com/Dede98/markdown".into()),
        ..Default::default()
    };

    #[cfg(target_os = "macos")]
    let app_submenu = Submenu::with_items(
        handle,
        "Markdown",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About Markdown"), Some(app_metadata))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let help_submenu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[&PredefinedMenuItem::about(
            handle,
            Some("About Markdown"),
            Some(app_metadata),
        )?],
    )?;

    let new_item = MenuItem::with_id(handle, MENU_NEW, "New", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(handle, MENU_OPEN, "Open…", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(handle, MENU_SAVE, "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(
        handle,
        MENU_SAVE_AS,
        "Save As…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let export_pdf_item = MenuItem::with_id(
        handle,
        MENU_EXPORT_PDF,
        "Export PDF…",
        true,
        Some("CmdOrCtrl+P"),
    )?;

    let file_submenu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &new_item,
            &open_item,
            &PredefinedMenuItem::separator(handle)?,
            &save_item,
            &save_as_item,
            &PredefinedMenuItem::separator(handle)?,
            &export_pdf_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let toggle_raw_item = MenuItem::with_id(
        handle,
        MENU_TOGGLE_RAW,
        "Raw View",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let toggle_zen_item =
        MenuItem::with_id(handle, MENU_TOGGLE_ZEN, "Zen Mode", true, Some("CmdOrCtrl+."))?;

    let view_submenu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &toggle_raw_item,
            &toggle_zen_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    let window_submenu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        handle,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(
        handle,
        &[
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )?;

    Ok(menu)
}
