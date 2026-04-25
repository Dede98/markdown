// Tauri 2 shell for the local-first Markdown editor.
//
// Responsibilities of this module:
// 1. Wire the `fs` and `dialog` plugins so the TauriFileAdapter can read/write
//    `.md` files and prompt the user for paths via native pickers.
// 2. Build a native macOS-style menu (App / File / Edit) with File > New /
//    Open / Save / Save As, and forward those clicks to the frontend as
//    `menu:new` / `menu:open` / `menu:save` / `menu:save-as` events.
//
// Naming rule: this is a *file* shell. No "document", "doc id", or "sync"
// concepts leak into menu ids or event names.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

const MENU_NEW: &str = "menu_new";
const MENU_OPEN: &str = "menu_open";
const MENU_SAVE: &str = "menu_save";
const MENU_SAVE_AS: &str = "menu_save_as";

const EVENT_NEW: &str = "menu:new";
const EVENT_OPEN: &str = "menu:open";
const EVENT_SAVE: &str = "menu:save";
const EVENT_SAVE_AS: &str = "menu:save-as";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_app_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<Menu<R>> {
    // The About panel surfaces basic provenance for the spike build. Version is
    // pulled from Cargo at compile time so the panel never drifts from the bundle.
    let app_metadata = AboutMetadata {
        name: Some("Markdown".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        authors: Some(vec!["ole.de".into()]),
        comments: Some("Local-first Markdown editor (spike).".into()),
        copyright: Some("© 2026 ole.de".into()),
        website: Some("https://ole.de".into()),
        website_label: Some("ole.de".into()),
        ..Default::default()
    };

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

    let view_submenu = Submenu::with_items(
        handle,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(handle, None)?],
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

    Menu::with_items(
        handle,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
        ],
    )
}
