//! Papelera por vault: `<vault>/.gus-trash`, con manifiesto JSON y TTL de 30 días.

use super::*;

pub(crate) const TRASH_MANIFEST: &str = ".gus-trash-manifest.json";

pub(crate) const TRASH_TTL_DAYS: u64 = 30;

pub(crate) const TRASH_TTL_MS: u64 = TRASH_TTL_DAYS * 24 * 60 * 60 * 1_000;

/// Papelera de un vault: oculta y dentro del propio vault (viaja con él).
pub(crate) fn vault_trash(vault: &std::path::Path) -> std::path::PathBuf {
    vault.join(".gus-trash")
}

/// Papelera global de las versiones anteriores; solo se vacía y migra.
pub(crate) fn legacy_trash_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(expand_home("~/gus-vault/.gus-trash"))
}

/// Ruta canónica del vault, para comparar sin trucos con `..` ni symlinks.
pub(crate) fn canonical_vault(vault: &str) -> Result<std::path::PathBuf, String> {
    let path = expand_home(vault);
    std::fs::canonicalize(&path).map_err(|err| format!("No se encontró el vault «{path}»: {err}"))
}

/// Solo se tira lo que cuelga del vault. Se mira la carpeta padre, no el
/// elemento, para que un symlink dentro del vault se tire como enlace.
pub(crate) fn ensure_in_vault(entry: &std::path::Path, vault: &std::path::Path) -> Result<(), String> {
    let parent = entry
        .parent()
        .ok_or_else(|| format!("No se puede tirar «{}»", entry.display()))?;
    let real_parent = std::fs::canonicalize(parent)
        .map_err(|err| format!("No existe «{}»: {err}", parent.display()))?;
    if real_parent.starts_with(vault) {
        Ok(())
    } else {
        Err(format!("«{}» está fuera del vault", entry.display()))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub name: String,
    pub path: String,
    pub origin: Option<String>,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub trashed_at_ms: Option<u64>,
    pub is_dir: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashRecord {
    pub(crate) name: String,
    pub(crate) origin: String,
    pub(crate) trashed_at_ms: u64,
}

pub(crate) fn load_trash_manifest(trash: &std::path::Path) -> Vec<TrashRecord> {
    std::fs::read_to_string(trash.join(TRASH_MANIFEST))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub(crate) fn save_trash_manifest(trash: &std::path::Path, records: &[TrashRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(records)
        .map_err(|err| format!("No se pudo serializar el manifiesto: {err}"))?;
    ensure_dir_exists(trash)?;
    std::fs::write(trash.join(TRASH_MANIFEST), raw)
        .map_err(|err| format!("No se pudo actualizar el manifiesto: {err}"))
}

pub(crate) fn move_path_to_trash(
    source: &std::path::Path,
    trash: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    if !source.exists() {
        return Err(format!("No existe el archivo «{}»", source.display()));
    }

    ensure_dir_exists(trash)?;

    let name = source
        .file_name()
        .ok_or_else(|| format!("La ruta «{}» no tiene nombre", source.display()))?;
    let target = unique_path(&trash.join(name))?;
    move_entry(source, &target)?;

    Ok(target)
}

pub(crate) fn trash_entry(
    source: &std::path::Path,
    trash: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let origin = source.display().to_string();
    let moved = move_path_to_trash(source, trash)?;

    if let Some(name) = moved.file_name().and_then(|name| name.to_str()) {
        let record = TrashRecord {
            name: name.to_string(),
            origin,
            trashed_at_ms: now_ms(),
        };

        let mut records = load_trash_manifest(trash);
        records.retain(|known| known.name != record.name);
        records.push(record);
        save_trash_manifest(trash, &records)?;
    }

    Ok(moved)
}

pub(crate) fn purge_expired_trash(trash: &std::path::Path) -> usize {
    if !trash.is_dir() {
        return 0;
    }

    let mut records = load_trash_manifest(trash);
    if records.is_empty() {
        return 0;
    }

    let now = now_ms();
    let mut purged = 0usize;
    let mut changed = false;

    records.retain(|record| {
        if now.saturating_sub(record.trashed_at_ms) < TRASH_TTL_MS {
            return true;
        }

        let directo = !record.name.is_empty()
            && !record.name.contains('/')
            && !record.name.contains('\\')
            && record.name != "."
            && record.name != "..";
        if !directo {
            changed = true;
            return false;
        }

        let victim = trash.join(&record.name);
        let borrado = if victim.is_dir() {
            std::fs::remove_dir_all(&victim)
        } else if victim.exists() {
            std::fs::remove_file(&victim)
        } else {
            Ok(())
        }
        .is_ok();

        changed = true;
        if borrado {
            purged += 1;
        }
        !borrado
    });

    // Sin propagar: la purga corre al arrancar y no tiene a quién devolver el error.
    if changed {
        if let Err(err) = save_trash_manifest(trash, &records) {
            eprintln!("Gus: purga de la papelera sin guardar el manifiesto: {err}");
        }
    }

    purged
}

#[tauri::command]
pub(crate) fn move_to_trash(path: String, vault: String) -> Result<(), String> {
    let path = expand_home(&path);
    let vault = canonical_vault(&vault)?;
    let entry = std::path::Path::new(&path);
    ensure_in_vault(entry, &vault)?;
    trash_entry_if_safe(entry, &vault_trash(&vault))?;
    Ok(())
}

/**
 * Tira un archivo o una carpeta en la papelera.
 *
 * La papelera NO filtra por tipo de archivo: aquí solo se comprueba que el
 * elemento exista y que no estemos tirando la papelera dentro de sí misma.
 * Así caben `.md`, `.pdf`, `.png`, `.jpg`, y en general cualquier archivo.
 */
pub(crate) fn trash_entry_if_safe(
    entry: &std::path::Path,
    trash: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    if entry.is_dir() {
        ensure_trashable_dir(entry, trash)?;
    } else {
        ensure_trashable_file(entry, trash)?;
    }

    purge_expired_trash(trash);
    trash_entry(entry, trash)
}

pub(crate) fn ensure_trashable_file(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
    if path.is_dir() {
        return Err(format!("«{}» es una carpeta", path.display()));
    }
    if !path.exists() {
        return Err(format!("No existe el archivo «{}»", path.display()));
    }
    if path.starts_with(trash) {
        return Err(format!(
            "«{}» ya está dentro de la papelera",
            path.display()
        ));
    }

    Ok(())
}

pub(crate) fn ensure_trashable_dir(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("No existe la carpeta «{}»", path.display()));
    }

    let Some(parent) = path.parent() else {
        return Err(format!("No se puede tirar la raíz «{}»", path.display()));
    };
    if parent.as_os_str().is_empty() && path.is_absolute() {
        return Err(format!("No se puede tirar la raíz «{}»", path.display()));
    }

    if trash.starts_with(path) || path.starts_with(trash) {
        return Err(format!("«{}» no se puede tirar a la papelera", path.display()));
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn list_trash(vault: String) -> Result<Vec<TrashItem>, String> {
    let trash = vault_trash(&canonical_vault(&vault)?);
    purge_expired_trash(&trash);
    list_trash_items(&trash)
}

#[tauri::command]
pub(crate) fn restore_from_trash(path: String, vault: String) -> Result<String, String> {
    let path = expand_home(&path);
    restore_trashed(std::path::Path::new(&path), &vault_trash(&canonical_vault(&vault)?))
}

#[tauri::command]
pub(crate) fn delete_from_trash(path: String, vault: String) -> Result<(), String> {
    let path = expand_home(&path);
    delete_trashed(std::path::Path::new(&path), &vault_trash(&canonical_vault(&vault)?))
}

#[tauri::command]
pub(crate) fn empty_trash(vault: String) -> Result<(), String> {
    empty_trash_dir(&vault_trash(&canonical_vault(&vault)?))
}

/// Pasa a la papelera de cada vault lo que la global tenía de él. Lo que no es
/// de ningún vault conocido, o no se puede mover, se queda donde estaba.
#[tauri::command]
pub(crate) fn migrate_legacy_trash(vaults: Vec<String>) -> Result<usize, String> {
    let roots: Vec<std::path::PathBuf> = vaults
        .iter()
        .filter_map(|vault| canonical_vault(vault).ok())
        .collect();
    move_legacy_trash(&legacy_trash_dir(), &roots)
}

pub(crate) fn move_legacy_trash(legacy: &std::path::Path, roots: &[std::path::PathBuf]) -> Result<usize, String> {
    if !legacy.is_dir() {
        return Ok(0);
    }

    let mut moved = 0usize;
    let mut kept = Vec::new();
    for record in load_trash_manifest(legacy) {
        let source = legacy.join(&record.name);
        if !source.exists() {
            continue;
        }

        let origin = std::path::Path::new(&record.origin);
        let root = roots
            .iter()
            .filter(|root| origin.starts_with(root))
            .max_by_key(|root| root.as_os_str().len());
        let Some(root) = root else {
            kept.push(record);
            continue;
        };

        let trash = vault_trash(root);
        match move_path_to_trash(&source, &trash) {
            Ok(target) => {
                let name = target
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string();
                let mut records = load_trash_manifest(&trash);
                records.push(TrashRecord {
                    name,
                    origin: record.origin,
                    trashed_at_ms: record.trashed_at_ms,
                });
                save_trash_manifest(&trash, &records)?;
                moved += 1;
            }
            Err(err) => {
                eprintln!("Gus: no se pudo migrar «{}»: {err}", source.display());
                kept.push(record);
            }
        }
    }

    save_trash_manifest(legacy, &kept)?;
    Ok(moved)
}

pub(crate) fn list_trash_items(trash: &std::path::Path) -> Result<Vec<TrashItem>, String> {
    if !trash.exists() {
        return Ok(Vec::new());
    }

    let records = load_trash_manifest(trash);
    let mut items = Vec::new();

    let entries = std::fs::read_dir(trash)
        .map_err(|err| format!("No se pudo leer la papelera «{}»: {err}", trash.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == TRASH_MANIFEST {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let record = records.iter().find(|known| known.name == name);

        items.push(TrashItem {
            path: entry.path().to_string_lossy().into_owned(),
            origin: record.map(|known| known.origin.clone()),
            trashed_at_ms: record.map(|known| known.trashed_at_ms),
            modified_ms: metadata_modified_ms(&metadata),
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            is_dir: metadata.is_dir(),
            name,
        });
    }

    items.sort_by(|a, b| {
        b.trashed_at_ms
            .cmp(&a.trashed_at_ms)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

pub(crate) fn restore_trashed(source: &std::path::Path, trash: &std::path::Path) -> Result<String, String> {
    ensure_inside(trash, source)?;
    if !source.exists() {
        return Err(format!("No existe en la papelera «{}»", source.display()));
    }

    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let mut records = load_trash_manifest(trash);
    let origin = records
        .iter()
        .find(|known| known.name == name)
        .map(|known| known.origin.clone());

    let target = match origin {
        Some(origin) if !origin.is_empty() => {
            let origin_path = std::path::Path::new(&origin);
            if let Some(parent) = origin_path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent).map_err(|err| {
                        format!("No se pudo recrear «{}»: {err}", parent.display())
                    })?;
                }
            }
            unique_path(origin_path)?
        }
        _ => unique_path(&trash.parent().unwrap_or(trash).join(&name))?,
    };

    move_entry(source, &target)?;

    records.retain(|known| known.name != name);
    save_trash_manifest(trash, &records)?;

    Ok(target.to_string_lossy().into_owned())
}

pub(crate) fn delete_trashed(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
    ensure_inside(trash, path)?;
    if !path.exists() {
        return Err(format!("No existe en la papelera «{}»", path.display()));
    }

    if path.is_dir() {
        std::fs::remove_dir_all(path)
            .map_err(|err| format!("No se pudo eliminar «{}»: {err}", path.display()))?;
    } else {
        std::fs::remove_file(path)
            .map_err(|err| format!("No se pudo eliminar «{}»: {err}", path.display()))?;
    }

    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
        let mut records = load_trash_manifest(trash);
        records.retain(|known| known.name != name);
        save_trash_manifest(trash, &records)?;
    }

    Ok(())
}

pub(crate) fn empty_trash_dir(trash: &std::path::Path) -> Result<(), String> {
    if !trash.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(trash)
        .map_err(|err| format!("No se pudo leer la papelera «{}»: {err}", trash.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let removed = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        removed.map_err(|err| format!("No se pudo vaciar «{}»: {err}", path.display()))?;
    }

    Ok(())
}
