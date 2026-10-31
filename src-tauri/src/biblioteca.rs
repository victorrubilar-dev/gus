//! Biblioteca de PDF (REQ-02): estanterías que el usuario define, guardadas en `.gus-library.json`.

use super::*;
use std::collections::HashMap;

pub(crate) const LIBRARY_FILE: &str = ".gus-library.json";

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub(crate) struct LibraryStore {
    #[serde(default)]
    pub(crate) version: u32,
    /// Nombres de las estanterías, en el orden en que se muestran.
    #[serde(default)]
    pub(crate) shelves: Vec<String>,
    /// Ruta relativa del PDF → estantería. Sin entrada = «sin estantería».
    #[serde(default)]
    pub(crate) assign: HashMap<String, String>,
}

fn library_path(vault_path: &str) -> Result<std::path::PathBuf, String> {
    Ok(tareas::vault_root(vault_path)?.join(LIBRARY_FILE))
}

#[tauri::command]
pub(crate) fn load_library(vault_path: String) -> Result<LibraryStore, String> {
    let path = library_path(&vault_path)?;
    if !path.exists() {
        return Ok(LibraryStore::default());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("No se pudo leer la biblioteca «{}»: {err}", path.display()))
}

#[tauri::command]
pub(crate) fn save_library(vault_path: String, store: LibraryStore) -> Result<(), String> {
    let path = library_path(&vault_path)?;
    let store = LibraryStore { version: 1, ..store };
    let raw = serde_json::to_string_pretty(&store)
        .map_err(|err| format!("No se pudo serializar la biblioteca: {err}"))?;

    vigilancia::note_own_write(&path);
    write_atomic(&path, raw)
        .map_err(|err| format!("No se pudo escribir «{}»: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_biblioteca_se_guarda_y_se_lee_y_sin_archivo_esta_vacia() {
        let dir = std::env::temp_dir().join(format!("gus-lib-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("vault");
        let vault = dir.to_string_lossy().into_owned();

        assert_eq!(load_library(vault.clone()).expect("vacía"), LibraryStore::default());

        let store = LibraryStore {
            version: 0,
            shelves: vec!["Clases".into()],
            assign: HashMap::from([("a/b.pdf".to_string(), "Clases".to_string())]),
        };
        save_library(vault.clone(), store.clone()).expect("guardar");
        let leida = load_library(vault).expect("leer");
        assert_eq!(leida.shelves, store.shelves);
        assert_eq!(leida.assign, store.assign);
        assert_eq!(leida.version, 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
