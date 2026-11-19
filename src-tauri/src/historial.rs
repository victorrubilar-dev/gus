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
/// El historial va por ruta: al renombrar o mover, `move_note_history` lo lleva detrás.
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

/// Ruta de `path` relativa al vault, sin `..` ni nada raro. `path` puede no
/// existir ya (el origen de un movimiento), así que se prueba con la ruta tal
/// cual y con la de su carpeta padre canonicalizada.
fn vault_relative(vault: &str, path: &str) -> Result<std::path::PathBuf, String> {
    let raw_vault = std::path::PathBuf::from(expand_home(vault));
    let path = std::path::PathBuf::from(expand_home(path));
    let relative = path.strip_prefix(&raw_vault).map(|r| r.to_path_buf()).or_else(|_| {
        let parent = path.parent().ok_or(())?;
        let real_parent = std::fs::canonicalize(parent).map_err(|_| ())?;
        let rest = real_parent.strip_prefix(canonical_vault(vault).map_err(|_| ())?).map_err(|_| ())?;
        Ok::<_, ()>(rest.join(path.file_name().ok_or(())?))
    });
    match relative {
        Ok(rel) if !rel.as_os_str().is_empty()
            && rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) => Ok(rel),
        _ => Err(format!("«{}» está fuera del vault", path.display())),
    }
}

/// Mueve `from` dentro de `to`. Si ya hay algo con el mismo nombre se mezcla
/// (carpetas) o se conserva lo que había (ficheros).
fn merge_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    if !to.exists() {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        return std::fs::rename(from, to);
    }
    if from.is_dir() && to.is_dir() {
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            merge_dir(&entry.path(), &to.join(entry.file_name()))?;
        }
        let _ = std::fs::remove_dir(from);
    }
    Ok(())
}

/// Tras renombrar o mover una nota o carpeta, lleva su historial a la ruta nueva.
#[tauri::command]
pub(crate) fn move_note_history(vault: String, from: String, to: String) -> Result<(), String> {
    let mut old = vault_relative(&vault, &from)?;
    let mut new = vault_relative(&vault, &to)?;
    // Una nota guarda su historial en `<carpeta>/<nombre sin .md>`; una carpeta, en su misma ruta.
    if std::path::Path::new(&expand_home(&to)).is_file() {
        archivos::ensure_md(&to)?;
        old.set_extension("");
        new.set_extension("");
    }
    let root = canonical_vault(&vault)?.join(".gus-history");
    let source = root.join(old);
    if !source.is_dir() {
        return Ok(());
    }
    merge_dir(&source, &root.join(new)).map_err(|err| format!("No se pudo mover el historial: {err}"))
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

    #[test]
    fn el_historial_sigue_a_la_nota_y_a_la_carpeta() {
        let vault = vault_temporal("mover");
        let v = vault.display().to_string();
        let ruta = |rel: &str| vault.join(rel).display().to_string();

        std::fs::write(vault.join("sub/nota.md"), "uno").unwrap();
        snapshot_note(v.clone(), ruta("sub/nota.md"), true).unwrap();

        std::fs::rename(vault.join("sub/nota.md"), vault.join("sub/otra.md")).unwrap();
        move_note_history(v.clone(), ruta("sub/nota.md"), ruta("sub/otra.md")).unwrap();
        assert_eq!(list_note_versions(v.clone(), ruta("sub/otra.md")).unwrap().len(), 1);

        std::fs::rename(vault.join("sub"), vault.join("dir")).unwrap();
        move_note_history(v.clone(), ruta("sub"), ruta("dir")).unwrap();
        assert_eq!(list_note_versions(v.clone(), ruta("dir/otra.md")).unwrap().len(), 1);

        // Sin historial no hace nada, y lo de fuera del vault se rechaza.
        move_note_history(v.clone(), ruta("dir/x.md"), ruta("dir/otra.md")).unwrap();
        assert!(move_note_history(v.clone(), ruta("../fuera"), ruta("dir")).is_err());
        assert!(move_note_history(v, "/tmp/otra".into(), ruta("dir")).is_err());
        let _ = std::fs::remove_dir_all(&vault);
    }
}
