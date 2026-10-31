//! Pizarras (REQ-03): cada una es un JSON en `.gus-boards/<id>.json`. El
//! contenido lo entiende la interfaz; aquí solo se guarda, se lee y se lista.

use super::*;

pub(crate) const BOARDS_DIR: &str = ".gus-boards";

/// Una pizarra entera por encima de esto es un error, no un dibujo.
const MAX_BOARD_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub id: String,
    pub name: String,
    pub modified_ms: Option<u64>,
    /// Fijada arriba en la lista.
    pub pinned: bool,
    /// Color de etiqueta (`#rrggbb`), si se le puso uno.
    pub color: Option<String>,
}

/// `#rgb` o `#rrggbb`: lo único que se deja pasar como color de etiqueta.
fn is_hex_color(text: &str) -> bool {
    matches!(text.len(), 4 | 7)
        && text.starts_with('#')
        && text[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// El id acaba siendo un nombre de archivo: solo letras, cifras, `-` y `_`,
/// así no puede salirse de `.gus-boards` con `..` ni barras.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn board_file(vault_path: &str, id: &str) -> Result<std::path::PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Id de pizarra no válido: «{id}»"));
    }
    Ok(tareas::vault_root(vault_path)?
        .join(BOARDS_DIR)
        .join(format!("{id}.json")))
}

#[tauri::command]
pub(crate) fn list_boards(vault_path: String) -> Result<Vec<BoardInfo>, String> {
    let dir = tareas::vault_root(&vault_path)?.join(BOARDS_DIR);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut boards: Vec<BoardInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.to_string();
            if path.extension()?.to_str()? != "json" || !valid_id(&id) {
                return None;
            }
            let value = std::fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
            let name = value
                .as_ref()
                .and_then(|value| value.get("name")?.as_str().map(String::from))
                .unwrap_or_else(|| id.clone());
            let pinned = value.as_ref().and_then(|value| value.get("pinned")?.as_bool()).unwrap_or(false);
            let color = value
                .as_ref()
                .and_then(|value| value.get("color")?.as_str().map(String::from))
                .filter(|color| is_hex_color(color));
            let modified_ms = std::fs::metadata(&path).ok().and_then(|meta| metadata_modified_ms(&meta));
            Some(BoardInfo { id, name, modified_ms, pinned, color })
        })
        .collect();

    boards.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    Ok(boards)
}

#[tauri::command]
pub(crate) fn load_board(vault_path: String, id: String) -> Result<String, String> {
    let path = board_file(&vault_path, &id)?;
    std::fs::read_to_string(&path)
        .map_err(|err| format!("No se pudo leer la pizarra «{}»: {err}", path.display()))
}

#[tauri::command]
pub(crate) fn save_board(vault_path: String, id: String, json: String) -> Result<(), String> {
    if json.len() > MAX_BOARD_BYTES {
        return Err("La pizarra pesa demasiado para guardarla".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|err| format!("La pizarra no es un JSON válido: {err}"))?;

    let path = board_file(&vault_path, &id)?;
    if let Some(parent) = path.parent() {
        ensure_dir_exists(parent)?;
    }

    vigilancia::note_own_write(&path);
    write_atomic(&path, json)
        .map_err(|err| format!("No se pudo escribir la pizarra «{}»: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_se_aceptan_ids_que_no_se_salen_de_la_carpeta() {
        assert!(valid_id("abc-123_DEF"));
        for malo in ["", "..", "../x", "a/b", "a\\b", "a.json", "con espacio"] {
            assert!(!valid_id(malo), "{malo}");
        }
        assert!(load_board("/tmp".into(), "../etc".into()).is_err());
        assert!(is_hex_color("#a855f7") && is_hex_color("#abc"));
        for mal in ["", "#", "a855f7", "#a855f", "red", "#zzzzzz", "#a855f7; x"] {
            assert!(!is_hex_color(mal), "{mal}");
        }
    }

    #[test]
    fn guardar_listar_y_leer_una_pizarra() {
        let dir = std::env::temp_dir().join(format!("gus-pizarras-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("vault");
        let vault = dir.to_string_lossy().into_owned();

        assert!(list_boards(vault.clone()).expect("vacío").is_empty());

        save_board(vault.clone(), "b1".into(), r#"{"name":"Ideas","elements":[]}"#.into()).expect("guardar");
        save_board(vault.clone(), "b2".into(), r#"{"elements":[]}"#.into()).expect("sin nombre");
        assert!(save_board(vault.clone(), "b3".into(), "no es json".into()).is_err());
        assert!(save_board(vault.clone(), "../fuera".into(), "{}".into()).is_err());

        let mut nombres: Vec<String> = list_boards(vault.clone())
            .expect("lista")
            .into_iter()
            .map(|board| board.name)
            .collect();
        nombres.sort();
        assert_eq!(nombres, vec!["Ideas", "b2"]);
        assert!(load_board(vault, "b1".into()).expect("leer").contains("Ideas"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_lista_trae_fijada_y_color_solo_si_son_validos() {
        let dir = std::env::temp_dir().join(format!("gus-pizarras-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("vault");
        let vault = dir.to_string_lossy().into_owned();

        save_board(vault.clone(), "fijada".into(), r##"{"name":"Fijada","pinned":true,"color":"#3b82f6","elements":[]}"##.into()).expect("fijada");
        save_board(vault.clone(), "rara".into(), r##"{"name":"Rara","pinned":"sí","color":"red; x","elements":[]}"##.into()).expect("rara");
        let lista = list_boards(vault).expect("lista");

        let fijada = lista.iter().find(|board| board.id == "fijada").expect("fijada");
        assert!(fijada.pinned && fijada.color.as_deref() == Some("#3b82f6"));
        let rara = lista.iter().find(|board| board.id == "rara").expect("rara");
        assert!(!rara.pinned && rara.color.is_none(), "lo que no es un booleano ni un color no pasa");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
