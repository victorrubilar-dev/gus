//! Historial de versiones por nota: copias en `<vault>/.gus-history/<ruta de la nota>/<ms>.md`.
//! Se guarda lo que había en disco justo antes de sobrescribirlo, como mucho
//! una vez cada `MIN_GAP_MS` por nota, y se poda por número y por antigüedad.

use super::*;

/// Versiones que se conservan por nota.
const KEEP: usize = 50;
/// Las más viejas que esto se borran.
const MAX_AGE_MS: u64 = 90 * 24 * 60 * 60 * 1000;
/// Con el autoguardado se escribe cada pocos segundos: una copia por tanda basta.
const MIN_GAP_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteVersion {
    /// Milisegundos en que se guardó; sirve también de id.
    pub saved_ms: u64,
    pub size: u64,
}

/// Carpeta del historial de una nota. La nota tiene que ser `.md` y colgar del vault.
// shortcut: el historial va por ruta, así que al renombrar o mover la nota se queda con el nombre viejo; moverlo en `rename_vault_*` si se echa de menos.
fn history_dir(vault: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let path = expand_home(path);
    archivos::ensure_md(&path)?;
    let vault = canonical_vault(vault)?;
    let note = std::path::Path::new(&path);
    let parent = note.parent().ok_or_else(|| format!("Ruta inválida «{path}»"))?;
    let real_parent = std::fs::canonicalize(parent)
        .map_err(|err| format!("No existe «{}»: {err}", parent.display()))?;
    let relative = real_parent
        .strip_prefix(&vault)
        .map_err(|_| format!("«{path}» está fuera del vault"))?;
    let stem = note.file_stem().ok_or_else(|| format!("Ruta inválida «{path}»"))?;
    Ok(vault.join(".gus-history").join(relative).join(stem))
}

/// Ids (ms) de las versiones guardadas, de la más nueva a la más vieja.
fn version_ids(dir: &std::path::Path) -> Vec<u64> {
    let mut ids: Vec<u64> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.strip_suffix(".md")?.parse().ok())
        .collect();
    ids.sort_unstable_by(|a, b| b.cmp(a));
    ids
}

/// Qué versiones sobran: más allá de las `KEEP` más nuevas o más viejas que `MAX_AGE_MS`.
fn versions_to_prune(ids_newest_first: &[u64], now: u64) -> Vec<u64> {
    ids_newest_first
        .iter()
        .enumerate()
        .filter(|(index, id)| *index >= KEEP || now.saturating_sub(**id) > MAX_AGE_MS)
        .map(|(_, id)| *id)
        .collect()
}

/// Guarda una copia de lo que hay ahora en disco. Sin `force`, solo si la
/// última copia tiene más de diez minutos; nunca si es idéntica a la última.
/// Devuelve si se guardó.
#[tauri::command]
pub(crate) fn snapshot_note(vault: String, path: String, force: bool) -> Result<bool, String> {
    let dir = history_dir(&vault, &path)?;
    let content = match std::fs::read_to_string(expand_home(&path)) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(format!("No se pudo leer «{path}»: {err}")),
    };

    let now = now_ms();
    let ids = version_ids(&dir);
    if let Some(&newest) = ids.first() {
        if !force && now.saturating_sub(newest) < MIN_GAP_MS {
            return Ok(false);
        }
        if std::fs::read_to_string(dir.join(format!("{newest}.md"))).ok().as_deref() == Some(content.as_str()) {
            return Ok(false);
        }
    }

    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("No se pudo crear «{}»: {err}", dir.display()))?;
    write_atomic(&dir.join(format!("{now}.md")), &content)
        .map_err(|err| format!("No se pudo guardar la versión: {err}"))?;

    let mut all = ids;
    if all.first() != Some(&now) {
        all.insert(0, now);
    }
    for id in versions_to_prune(&all, now) {
        let _ = std::fs::remove_file(dir.join(format!("{id}.md")));
    }
    Ok(true)
}

#[tauri::command]
pub(crate) fn list_note_versions(vault: String, path: String) -> Result<Vec<NoteVersion>, String> {
    let dir = history_dir(&vault, &path)?;
    Ok(version_ids(&dir)
        .into_iter()
        .map(|saved_ms| NoteVersion {
            saved_ms,
            size: std::fs::metadata(dir.join(format!("{saved_ms}.md"))).map(|m| m.len()).unwrap_or(0),
        })
        .collect())
}

#[tauri::command]
pub(crate) fn read_note_version(vault: String, path: String, saved_ms: u64) -> Result<String, String> {
    let file = history_dir(&vault, &path)?.join(format!("{saved_ms}.md"));
    std::fs::read_to_string(&file).map_err(|err| format!("No se pudo leer la versión: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_temporal(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gus-hist-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).expect("vault");
        std::fs::canonicalize(&dir).expect("ruta canónica")
    }

    #[test]
    fn se_podan_las_que_pasan_del_tope_o_de_la_edad() {
        let now = MAX_AGE_MS * 2;
        let ids: Vec<u64> = (0..60).map(|i| now - i).collect();
        assert_eq!(versions_to_prune(&ids, now), ids[KEEP..].to_vec());
        assert_eq!(versions_to_prune(&[now, now - MAX_AGE_MS - 1], now), vec![now - MAX_AGE_MS - 1]);
        assert!(versions_to_prune(&[now, now - MAX_AGE_MS], now).is_empty());
    }

    #[test]
    fn la_copia_respeta_la_pausa_y_no_repite_contenido() {
        let vault = vault_temporal("copia");
        let note = vault.join("sub/nota.md");
        let (v, p) = (vault.display().to_string(), note.display().to_string());

        assert!(!snapshot_note(v.clone(), p.clone(), false).unwrap(), "sin archivo no hay copia");
        std::fs::write(&note, "uno").unwrap();
        assert!(snapshot_note(v.clone(), p.clone(), false).unwrap());
        assert!(vault.join(".gus-history/sub/nota").is_dir());

        std::fs::write(&note, "dos").unwrap();
        assert!(!snapshot_note(v.clone(), p.clone(), false).unwrap(), "dentro de la pausa no copia");
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(snapshot_note(v.clone(), p.clone(), true).unwrap(), "forzada sí copia");
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(!snapshot_note(v.clone(), p.clone(), true).unwrap(), "igual que la última no copia");

        let versions = list_note_versions(v.clone(), p.clone()).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(read_note_version(v.clone(), p.clone(), versions[0].saved_ms).unwrap(), "dos");
        assert_eq!(read_note_version(v, p, versions[1].saved_ms).unwrap(), "uno");
        let _ = std::fs::remove_dir_all(&vault);
    }

    #[test]
    fn rechaza_notas_fuera_del_vault_y_lo_que_no_es_md() {
        let vault = vault_temporal("fuera");
        let v = vault.join("sub").display().to_string();
        let fuera = vault.join("otra.md").display().to_string();
        assert!(list_note_versions(v.clone(), fuera).is_err());
        assert!(list_note_versions(v, vault.join("sub/a.txt").display().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&vault);
    }
}
