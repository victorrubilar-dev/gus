//! Menú nativo. Solo macOS lo muestra (en Linux y Windows la ventana no lleva
//! barra, como hasta ahora). Cada entrada propia emite `menu-action` con su id y
//! el frontend la atiende; las etiquetas siguen el idioma de la app.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const MENU_EVENT: &str = "menu-action";

fn build_menu<R: Runtime>(app: &AppHandle<R>, en: bool) -> tauri::Result<Menu<R>> {
    let l = |es: &'static str, en_text: &'static str| if en { en_text } else { es };
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);

    let app_menu = Submenu::with_items(
        app,
        "Gus",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        l("Archivo", "File"),
        true,
        &[
            &item("new-task", l("Nueva tarea", "New task"))?,
            &item("search", l("Buscar en el vault", "Search the vault"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        l("Edición", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        l("Ver", "View"),
        true,
        &[
            &item("tab-home", l("Resumen", "Overview"))?,
            &item("tab-notes", l("Notas", "Notes"))?,
            &item("tab-tasks", l("Tareas", "Tasks"))?,
            &item("tab-calendar", l("Calendario", "Calendar"))?,
            &item("tab-graph", l("Grafo", "Graph"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view])
}

/// El frontend lo llama al arrancar y al cambiar de idioma.
#[tauri::command]
pub fn set_app_menu<R: Runtime>(app: AppHandle<R>, lang: String) -> Result<(), String> {
    let menu = build_menu(&app, lang == "en").map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    app.set_menu(menu).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    drop(menu);
    Ok(())
}
