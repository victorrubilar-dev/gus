use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

mod biblioteca;
mod busqueda;
mod archivos;
mod configuracion;
mod enlaces;
mod habitos;
mod importar;
mod listados;
mod menu;
mod medios;
mod papelera;
mod pizarras;
mod tareas;
mod vigilancia;

#[cfg(test)]
use configuracion::*;
#[cfg(test)]
use importar::*;
#[cfg(test)]
use archivos::*;
use listados::*;
use medios::*;
use papelera::*;

#[cfg(test)]
use busqueda::*;
#[cfg(test)]
use enlaces::*;
#[cfg(test)]
use tareas::*;

fn is_md_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// Escribe en un temporal oculto y lo renombra sobre el destino: un corte a mitad
/// de escritura deja el fichero anterior intacto, nunca uno vacío o cortado.
fn write_atomic(path: &std::path::Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.gus-tmp"));
    std::fs::write(&tmp, contents)
        .and_then(|()| std::fs::rename(&tmp, path))
        .inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })
}

fn ensure_dir_exists(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|err| format!("No se pudo crear el directorio «{}»: {err}", path.display()))?;
    }
    Ok(())
}

fn metadata_modified_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
}

fn unique_path(wanted: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !wanted.exists() {
        return Ok(wanted.to_path_buf());
    }

    let parent = wanted.parent();
    let stem = wanted
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("archivo");
    let ext = wanted.extension().and_then(|e| e.to_str());

    for n in 2..1_000 {
        let name = match ext {
            Some(ext) => format!("{stem}-{n}.{ext}"),
            None => format!("{stem}-{n}"),
        };
        let candidate = match parent {
            Some(parent) => parent.join(&name),
            None => std::path::PathBuf::from(&name),
        };
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    let where_ = parent
        .map(|parent| parent.display().to_string())
        .unwrap_or_else(|| ".".to_string());
    Err(format!("Demasiados elementos llamados «{stem}» en «{where_}»"))
}

/// Solo se descargan instaladores de las releases del proyecto (ver PRIVACY.md).
const UPDATE_DOWNLOAD_PREFIX: &str = "https://github.com/victorrubilar-dev/gus/releases/download/";
const INSTALLER_EXTENSIONS: [&str; 4] = [".exe", ".msi", ".dmg", ".appimage"];

/// Nombre del instalador de una URL de release, o error si no es uno de Gus.
fn installer_name(url: &str) -> Result<&str, String> {
    // La ruta es `<etiqueta>/<fichero>`: el fichero es lo que se guarda.
    let rest = url
        .strip_prefix(UPDATE_DOWNLOAD_PREFIX)
        .ok_or("Solo se descargan instaladores de las releases de Gus")?;
    let (tag, name) = rest
        .split_once('/')
        .ok_or_else(|| format!("«{rest}» no es un instalador de Gus"))?;
    let lower = name.to_lowercase();
    if !tag.is_empty() && !name.contains('/') && INSTALLER_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
        Ok(name)
    } else {
        Err(format!("«{name}» no es un instalador de Gus"))
    }
}

/// ¿Puede esta instalación reemplazarse a sí misma? En Linux solo si corre como
/// AppImage: un .deb o un .rpm vive en `/usr` y el actualizador no puede
/// sobrescribirlo, así que esos siguen con el aviso de descarga manual.
#[tauri::command]
fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        cfg!(any(target_os = "windows", target_os = "macos"))
    }
}

/// Baja el instalador de una release a Descargas y lo abre para instalarlo.
#[tauri::command]
async fn download_update(app: AppHandle, url: String) -> Result<String, String> {
    let name = installer_name(&url)?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|err| format!("No se encontró la carpeta de Descargas: {err}"))?;

    let bytes = reqwest::get(&url)
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("No se pudo descargar la actualización: {err}"))?
        .bytes()
        .await
        .map_err(|err| format!("No se pudo descargar la actualización: {err}"))?;

    let target = unique_path(&downloads.join(name))?;
    std::fs::write(&target, &bytes)
        .map_err(|err| format!("No se pudo guardar «{}»: {err}", target.display()))?;

    // Un AppImage sin bit de ejecución no se abre desde el gestor de archivos.
    #[cfg(unix)]
    if name.to_lowercase().ends_with(".appimage") {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
            .map_err(|err| format!("No se pudo hacer ejecutable «{name}»: {err}"))?;
    }

    let path = target.to_string_lossy().into_owned();
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|err| format!("No se pudo abrir el instalador: {err}"))?;
    Ok(path)
}



fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}


fn ensure_inside(dir: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    if path != dir && path.starts_with(dir) {
        Ok(())
    } else {
        Err(format!("«{}» está fuera de la papelera", path.display()))
    }
}

fn move_entry(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    let origen = source.display().to_string();

    if let Err(rename_error) = std::fs::rename(source, target) {
        let copiado = if source.is_dir() {
            copy_dir_all(source, target)
        } else {
            std::fs::copy(source, target)
                .map(|_| ())
                .map_err(|err| err.to_string())
        };
        copiado.map_err(|err| format!("No se pudo mover «{origen}»: {rename_error} (copiar: {err})"))?;

        let retirado = if source.is_dir() {
            std::fs::remove_dir_all(source).map_err(|err| err.to_string())
        } else {
            std::fs::remove_file(source).map_err(|err| err.to_string())
        };
        retirado.map_err(|err| {
            format!(
                "Quedó copiado en «{}», pero no se pudo retirar «{origen}»: {err}",
                target.display()
            )
        })?;
    }

    Ok(())
}

fn copy_dir_all(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(target)
        .map_err(|err| format!("no se pudo crear «{}»: {err}", target.display()))?;

    let entries = std::fs::read_dir(source)
        .map_err(|err| format!("no se pudo leer «{}»: {err}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("no se pudo leer «{}»: {err}", source.display()))?;
        let from = entry.path();
        let to = target.join(entry.file_name());

        if from.is_dir() {
            copy_dir_all(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|err| format!("no se pudo copiar «{}»: {err}", from.display()))?;
        }
    }

    Ok(())
}



#[tauri::command]
fn vault_dir_exists(path: String) -> bool {
    std::path::Path::new(&expand_home(&path)).is_dir()
}

const WELCOME_NOTE: &str = "\
# Bienvenido a Gus 👋

Todas tus notas y tareas viven aquí, en archivos `.md` normales que puedes
abrir con cualquier otra herramienta.

## Tareas

- [ ] Marcar esta tarea como hecha #empezar
- [ ] Crear mi primera nota con el botón **+**

";

#[tauri::command]
fn create_vault(base: String, name: String) -> Result<String, String> {
    let name = name.trim();

    if name.is_empty() {
        return Err("El vault necesita un nombre".to_string());
    }
    if name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
    {
        return Err(format!("Nombre de vault no válido: «{name}»"));
    }

    let base = expand_home(&base);
    let path = std::path::Path::new(&base).join(name);

    if path.exists() {
        return Err(format!(
            "Ya existe «{name}» en «{base}». Si es un vault tuyo, usa «Abrir carpeta existente»."
        ));
    }

    std::fs::create_dir_all(&path)
        .map_err(|err| format!("No se pudo crear «{}»: {err}", path.display()))?;

    std::fs::write(path.join("Bienvenido.md"), WELCOME_NOTE)
        .map_err(|err| format!("No se pudo crear la nota de bienvenida: {err}"))?;

    Ok(path.to_string_lossy().into_owned())
}


fn home_dir() -> Option<String> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

fn expand_home(path: &str) -> String {
    if path == "~" {
        return home_dir().unwrap_or_else(|| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

/* ------------------------------------------------------------------ */
/* Grafo de enlaces [[wiki]]                                            */


fn frontmatter_lines(text: &str) -> Option<Vec<&str>> {
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }

    let mut body: Vec<&str> = Vec::new();
    for line in lines {
        if line.trim_end() == "---" {
            if body.iter().any(|entry| is_property_line(entry)) {
                return Some(body);
            }
            return None;
        }
        body.push(line);
    }
    None
}

fn is_property_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    let Some(colon) = trimmed.find(':') else {
        return false;
    };

    let key = &trimmed[..colon];
    key.chars().next().is_some_and(|first| {
        first.is_alphanumeric() || first == '_' || first == '-'
    }) && key
        .chars()
        .all(|char| char.is_alphanumeric() || char == '_' || char == '-')
}

fn frontmatter_tags(text: &str) -> Vec<String> {
    let Some(body) = frontmatter_lines(text) else {
        return Vec::new();
    };

    let key = body.iter().position(|line| {
        line.trim_start().strip_prefix("tags:").is_some_and(|rest| {
            rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') || rest.starts_with('[')
        })
    });
    let Some(key) = key else {
        return Vec::new();
    };

    let value = body[key].trim_start()["tags:".len()..].trim();
    let raw: Vec<String> = if value.is_empty() {
        body[key + 1..]
            .iter()
            .map_while(|line| {
                let rest = line.trim_start().strip_prefix('-')?;
                (rest.starts_with(' ') || rest.starts_with('\t')).then(|| unquote_yaml(rest.trim()))
            })
            .collect()
    } else if let Some(flow) = value.strip_prefix('[') {
        let inner = flow.split(']').next().unwrap_or(flow);
        split_flow(inner).iter().map(|item| unquote_yaml(item)).collect()
    } else {
        vec![unquote_yaml(value)]
    };

    let mut seen = std::collections::HashSet::new();
    raw.into_iter()
        .filter_map(|tag| {
            let clean = tag.trim().trim_start_matches('#').to_string();
            if clean.is_empty() {
                return None;
            }
            seen.insert(clean.to_lowercase()).then_some(clean)
        })
        .collect()
}

fn split_flow(inner: &str) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for char in inner.chars() {
        match quote {
            Some(open) => {
                current.push(char);
                if char == open {
                    quote = None;
                }
            }
            None => match char {
                '"' | '\'' => {
                    quote = Some(char);
                    current.push(char);
                }
                ',' => {
                    items.push(current.trim().to_string());
                    current.clear();
                }
                _ => current.push(char),
            },
        }
    }

    items.push(current.trim().to_string());
    items
}

fn unquote_yaml(value: &str) -> String {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        if let Ok(unescaped) = serde_json::from_str::<String>(value) {
            return unescaped;
        }
        return value[1..value.len() - 1].to_string();
    }
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return value[1..value.len() - 1].replace("''", "'");
    }
    value.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(vigilancia::VaultWatcher::default())
        .on_menu_event(|app, event| {
            let _ = app.emit(menu::MENU_EVENT, event.id().0.clone());
        })
        .setup(|app| {
            purge_expired_trash(&legacy_trash_dir());
            // Actualizador y reinicio: solo en escritorio, el móvil se actualiza por su tienda.
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            #[cfg(not(desktop))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            download_update,
            can_self_update,
            menu::set_app_menu,
            papelera::migrate_legacy_trash,
            listados::read_vault_dir,
            listados::get_vault_files,
            listados::list_recent_notes,
            listados::list_vault_notes,
            listados::list_vault_images,
            listados::list_vault_pdfs,
            listados::list_notes_with_checkboxes,
            biblioteca::load_library,
            biblioteca::save_library,
            habitos::load_habits,
            habitos::save_habits,
            pizarras::list_boards,
            pizarras::load_board,
            pizarras::save_board,
            listados::list_vault_tags,
            enlaces::build_link_graph,
            busqueda::build_search_index,
            busqueda::update_index_note,
            busqueda::prune_search_index,
            busqueda::search_notes,
            busqueda::search_index_facets,
            archivos::read_vault_file,
            archivos::write_vault_file,
            medios::write_pdf_file,
            medios::write_image_file,
            archivos::rename_vault_file,
            listados::list_vault_entries,
            listados::list_vault_dirs,
            archivos::create_vault_file,
            archivos::create_vault_dir,
            importar::import_files_to_vault,
            archivos::delete_vault_file,
            papelera::move_to_trash,
            papelera::list_trash,
            papelera::restore_from_trash,
            papelera::delete_from_trash,
            papelera::empty_trash,
            archivos::delete_vault_dir,
            archivos::rename_vault_dir,
            archivos::move_vault_file,
            medios::read_vault_image,
            medios::read_vault_image_thumb,
            medios::read_vault_pdf,
            configuracion::load_app_config,
            configuracion::save_app_config,
            vault_dir_exists,
            create_vault,
            tareas::load_tasks,
            tareas::save_tasks,
            tareas::read_legacy_tasks,
            tareas::archive_legacy_tasks,
            tareas::publish_new_task,
            vigilancia::watch_vault,
            vigilancia::unwatch_vault
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod vault_trash_tests {
    use super::*;

    fn carpeta_temporal(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gus-vt-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("crear carpeta temporal");
        std::fs::canonicalize(&dir).expect("ruta canónica")
    }

    #[test]
    fn solo_se_tira_lo_que_cuelga_del_vault() {
        let base = carpeta_temporal("dentro");
        let vault = base.join("vault");
        std::fs::create_dir_all(&vault).expect("vault");
        let vault = std::fs::canonicalize(&vault).expect("ruta canónica");
        let dentro = vault.join("nota.md");
        let fuera = base.join("otra.md");
        std::fs::write(&dentro, "a").expect("nota");
        std::fs::write(&fuera, "b").expect("otra");

        assert!(ensure_in_vault(&dentro, &vault).is_ok());
        assert!(ensure_in_vault(&fuera, &vault).is_err());
        assert!(ensure_in_vault(&vault, &vault).is_err(), "la raíz del vault no se tira");
        assert!(ensure_in_vault(&vault.join("..").join("otra.md"), &vault).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn la_migracion_manda_cada_elemento_a_su_vault() {
        let base = carpeta_temporal("migra");
        let vault_a = base.join("a");
        let vault_b = base.join("b");
        let legacy = base.join("legacy");
        for dir in [&vault_a, &vault_b, &legacy] {
            std::fs::create_dir_all(dir).expect("carpeta");
        }
        let vault_a = std::fs::canonicalize(&vault_a).expect("ruta canónica");
        let vault_b = std::fs::canonicalize(&vault_b).expect("ruta canónica");

        std::fs::write(legacy.join("nota.md"), "de a").expect("nota");
        std::fs::write(legacy.join("suelta.md"), "de nadie").expect("suelta");
        save_trash_manifest(
            &legacy,
            &[
                TrashRecord {
                    name: "nota.md".into(),
                    origin: vault_a.join("nota.md").to_string_lossy().into_owned(),
                    trashed_at_ms: now_ms(),
                },
                TrashRecord {
                    name: "suelta.md".into(),
                    origin: base.join("fuera").join("suelta.md").to_string_lossy().into_owned(),
                    trashed_at_ms: now_ms(),
                },
            ],
        )
        .expect("manifiesto");

        let moved = move_legacy_trash(&legacy, &[vault_a.clone(), vault_b]).expect("migrar");

        assert_eq!(moved, 1);
        assert!(vault_trash(&vault_a).join("nota.md").is_file());
        assert_eq!(load_trash_manifest(&vault_trash(&vault_a)).len(), 1);
        assert!(legacy.join("suelta.md").is_file(), "lo que no es de ningún vault se queda");
        assert_eq!(load_trash_manifest(&legacy).len(), 1);

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod write_atomic_tests {
    use super::*;

    #[test]
    fn write_atomic_reemplaza_el_contenido_y_no_deja_temporales() {
        let dir = std::env::temp_dir().join(format!("gus-atomic-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("carpeta");
        let file = dir.join("nota.md");

        write_atomic(&file, "uno").expect("crear");
        write_atomic(&file, "dos").expect("reemplazar");

        assert_eq!(std::fs::read_to_string(&file).expect("leer"), "dos");
        assert_eq!(std::fs::read_dir(&dir).expect("listar").count(), 1);
        assert!(write_atomic(&dir.join("falta/x.md"), "a").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod update_download_tests {
    use super::*;

    #[test]
    fn installer_name_solo_acepta_instaladores_de_las_releases_de_gus() {
        let base = "https://github.com/victorrubilar-dev/gus/releases/download/v0.1.4";
        assert_eq!(installer_name(&format!("{base}/gus_0.1.4_x64-setup.exe")), Ok("gus_0.1.4_x64-setup.exe"));
        assert_eq!(installer_name(&format!("{base}/gus_0.1.4_amd64.AppImage")), Ok("gus_0.1.4_amd64.AppImage"));
        assert!(installer_name(&format!("{base}/notas.txt")).is_err());
        assert!(installer_name(&format!("{base}/sub/gus.exe")).is_err());
        assert!(installer_name("https://evil.example/gus.exe").is_err());
        assert!(installer_name("https://github.com/victorrubilar-dev/gus/releases/download/v0.1.4").is_err());
    }
}

#[cfg(test)]
mod config_tests {
    use super::*;

    /// El corrector acepta varios diccionarios a la vez y una lista vacía.
    #[test]
    fn spell_langs_admite_varios_y_vacio() {
        let mut settings = AppSettings {
            spell_langs: vec!["es".into(), "en-US".into(), "fr".into()],
            ..AppSettings::default()
        };
        settings.sanitize();
        assert_eq!(
            settings.spell_langs,
            vec!["es".to_string(), "en-US".to_string(), "fr".to_string()]
        );

        let mut off = AppSettings {
            spell_langs: Vec::new(),
            ..AppSettings::default()
        };
        off.sanitize();
        assert!(off.spell_langs.is_empty());
    }

    /// Un config.json antiguo, con `spellLang` de un solo idioma, se migra.
    #[test]
    fn migra_el_idioma_unico_del_config_antiguo() {
        let raw = r#"{
          "baseDir": null, "vaults": [], "lastVault": null,
          "settings": { "spellLang": "de" }
        }"#;

        // Lo que llega al frontend es una lista con el idioma guardado.
        let value: serde_json::Value = serde_json::from_str(raw).expect("json");
        let old = value["settings"]["spellLang"].as_str().expect("spellLang");

        let mut settings = AppSettings {
            spell_langs: vec![old.to_string()],
            ..AppSettings::default()
        };
        settings.sanitize();
        assert_eq!(settings.spell_langs, vec!["de".to_string()]);
    }

    /// Los atajos guardados se limpian: solo acciones conocidas y combinaciones
    /// con forma de atajo, en minúsculas y sin espacios.
    #[test]
    fn sanea_los_atajos_guardados() {
        use std::collections::BTreeMap;

        let mut shortcuts = BTreeMap::new();
        shortcuts.insert("saveNote".to_string(), "Ctrl + Shift + K".to_string());
        shortcuts.insert("atajoRetirado".to_string(), "ctrl+j".to_string());
        shortcuts.insert("undo".to_string(), "esto no es un atajo".to_string());
        shortcuts.insert("redo".to_string(), String::new());
        shortcuts.insert("newNote".to_string(), "alt+arrowup".to_string());

        let mut settings = AppSettings {
            shortcuts,
            ..AppSettings::default()
        };
        settings.sanitize();

        assert_eq!(settings.shortcuts.get("saveNote").map(String::as_str), Some("ctrl+shift+k"));
        assert_eq!(settings.shortcuts.get("newNote").map(String::as_str), Some("alt+arrowup"));
        // Acción que ya no existe.
        assert!(!settings.shortcuts.contains_key("atajoRetirado"));
        // Combinación sin forma de atajo: la resuelve el frontend con su valor
        // por defecto, así que aquí simplemente no se guarda.
        assert!(!settings.shortcuts.contains_key("undo"));
        assert!(!settings.shortcuts.contains_key("redo"));
        // La nota del día tiene atajo propio y se reconoce.
        assert!(AppSettings::SHORTCUT_IDS.contains(&"openDailyNote"));
    }

    /// La carpeta y la plantilla de las notas diarias se corrigen a mano.
    #[test]
    fn sanea_la_configuracion_del_diario() {
        let mut settings = AppSettings {
            daily_notes_folder: "  /Notas:diarias/  ".into(),
            daily_notes_template: "# Título\r\n\r\n".into(),
            ..AppSettings::default()
        };
        settings.sanitize();
        // Segmentos vacíos fuera, caracteres prohibidos fuera.
        assert_eq!(settings.daily_notes_folder, "Notasdiarias");
        assert_eq!(settings.daily_notes_template, "# Título\n\n");

        // Lo que no deje nada usable vuelve al valor por defecto.
        let mut empty = AppSettings {
            daily_notes_folder: "   ".into(),
            daily_notes_template: String::new(),
            ..AppSettings::default()
        };
        empty.sanitize();
        assert_eq!(empty.daily_notes_folder, AppSettings::default().daily_notes_folder);
        // Una plantilla vacía es una decisión, no un error.
        assert!(empty.daily_notes_template.is_empty());

        // La plantilla no puede crecer sin límite.
        let mut long = AppSettings {
            daily_notes_template: "x".repeat(9000),
            ..AppSettings::default()
        };
        long.sanitize();
        assert_eq!(long.daily_notes_template.chars().count(), 4000);
    }

    /// La antelación de los recordatorios solo admite la lista cerrada.
    #[test]
    fn sanea_la_antelacion_de_los_avisos() {
        let mut ok = AppSettings {
            notification_lead_days: 7,
            ..AppSettings::default()
        };
        ok.sanitize();
        assert_eq!(ok.notification_lead_days, 7);

        // Cero días es válido: el aviso suena el propio día del vencimiento.
        let mut same_day = AppSettings {
            notification_lead_days: 0,
            ..AppSettings::default()
        };
        same_day.sanitize();
        assert_eq!(same_day.notification_lead_days, 0);

        // Un valor fuera de serie vuelve al default en lugar de quedarse raro.
        let mut weird = AppSettings {
            notification_lead_days: 99,
            ..AppSettings::default()
        };
        weird.sanitize();
        assert_eq!(
            weird.notification_lead_days,
            AppSettings::default().notification_lead_days
        );
    }

    /// Los enlaces se leen con y sin alias, y las repeticiones se agrupan.
    #[test]
    fn lee_los_enlaces_wiki_de_un_texto() {
        assert_eq!(
            extract_wiki_targets("Hola [[Métodos]] y [[Métodos|otra vez]]"),
            vec!["Métodos", "Métodos"]
        );
        // El alias no forma parte del destino y un enlace vacío no cuenta.
        assert_eq!(extract_wiki_targets("[[ | ]]"), Vec::<String>::new());
        // Un enlace sin cerrar se ignora, no se come el resto del texto.
        assert_eq!(
            extract_wiki_targets("[[abierto y [[Cerrado]]"),
            vec!["Cerrado"]
        );
    }

    /// Dentro de bloques de código o comillas invertidas no hay enlaces.
    #[test]
    fn ignora_los_enlaces_dentro_de_codigo() {
        let text = "```md\n[[No cuenta]]\n```\n\n`[[Tampoco]]`\n\nSí: [[Cuenta]]";
        assert_eq!(extract_wiki_targets(text), vec!["Cuenta"]);

        // Un cierre más largo que su apertura también cierra el bloque.
        // (Uno más corto no cierra: es la regla de CommonMark.)
        let fenced = "```text\n[[No cuenta]]\n````\n[[Sí]]";
        assert_eq!(extract_wiki_targets(fenced), vec!["Sí"]);
    }

    /// Las repeticiones del mismo destino se agrupan, más repetido primero.
    #[test]
    fn cuenta_los_enlaces_repetidos() {
        let links = count_wiki_links("[[b]] [[a]] [[b]] [[A|alias]] [[b]]");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "b");
        assert_eq!(links[0].count, 3);
        // «A» y «a» son el mismo destino: se comparan en minúsculas.
        assert_eq!(links[1].target.to_lowercase(), "a");
        assert_eq!(links[1].count, 2);
    }
}
