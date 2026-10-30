//! Listados del vault: entradas de una carpeta, notas recientes, imágenes y etiquetas.

use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultDir {
    pub path: String,
    pub relative: String,
}

#[tauri::command]
pub(crate) fn list_vault_entries(path: String) -> Result<Vec<VaultEntry>, String> {
    let path = expand_home(&path);
    ensure_dir_exists(std::path::Path::new(&path))?;

    let entries = std::fs::read_dir(&path)
        .map_err(|err| format!("No se pudo leer el directorio «{path}»: {err}"))?;

    let mut items: Vec<VaultEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|err| format!("Entrada ilegible en «{path}»: {err}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path();
        let Ok(metadata) = std::fs::metadata(&entry_path) else {
            continue;
        };
        let is_dir = metadata.is_dir();
        if !is_dir
            && !is_md_file(&entry_path)
            && !is_image_file(&entry_path)
            && !is_pdf_file(&entry_path)
        {
            continue;
        }

        items.push(VaultEntry {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            is_dir,
            modified_ms: metadata_modified_ms(&metadata),
        });
    }

    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.path.cmp(&b.path))
    });

    Ok(items)
}

#[tauri::command]
pub(crate) fn list_vault_dirs(path: String) -> Result<Vec<VaultDir>, String> {
    let root = expand_home(&path);
    if !std::path::Path::new(&root).is_dir() {
        return Err(format!("No existe la carpeta «{root}»"));
    }

    let mut dirs = Vec::new();
    collect_dirs(std::path::Path::new(&root), "", 0, &mut dirs)?;
    dirs.sort_by(|a, b| {
        a.relative
            .to_lowercase()
            .cmp(&b.relative.to_lowercase())
            .then_with(|| a.relative.cmp(&b.relative))
    });

    Ok(dirs)
}

pub(crate) fn collect_dirs(
    dir: &std::path::Path,
    relative: &str,
    depth: usize,
    out: &mut Vec<VaultDir>,
) -> Result<(), String> {
    if depth >= 8 {
        return Ok(());
    }

    let entries = std::fs::read_dir(dir)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Entrada ilegible en «{}»: {err}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let child = entry.path();
        let Ok(metadata) = std::fs::metadata(&child) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }

        let relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        out.push(VaultDir {
            path: child.to_string_lossy().into_owned(),
            relative: relative.clone(),
        });
        collect_dirs(&child, &relative, depth + 1, out)?;
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct FileItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VaultFile {
    pub name: String,
    pub path: String,
    pub modified_ms: Option<u64>,
}

#[tauri::command]
pub(crate) fn read_vault_dir(path: String) -> Result<Vec<FileItem>, String> {
    let path = expand_home(&path);

    if !std::path::Path::new(&path).exists() {
        std::fs::create_dir_all(&path)
            .map_err(|err| format!("No se pudo crear el directorio «{path}»: {err}"))?;
    }

    let entries = std::fs::read_dir(&path)
        .map_err(|err| format!("No se pudo leer el directorio «{path}»: {err}"))?;

    let mut items: Vec<FileItem> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|err| format!("Entrada ilegible en «{path}»: {err}"))?;
        let file_path = entry.path();

        if !is_md_file(&file_path) {
            continue;
        }

        let Ok(metadata) = std::fs::metadata(&file_path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        items.push(FileItem {
            id: file_path.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            path: file_path.to_string_lossy().into_owned(),
            size: metadata.len(),
            modified_ms: metadata_modified_ms(&metadata),
        });
    }

    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });

    Ok(items)
}

#[tauri::command]
pub(crate) fn get_vault_files(path: String) -> Result<Vec<VaultFile>, String> {
    let files = read_vault_dir(path)?
        .into_iter()
        .map(|file| VaultFile {
            name: file.name,
            path: file.path,
            modified_ms: file.modified_ms,
        })
        .collect();

    Ok(files)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecentNote {
    pub name: String,
    pub path: String,
    pub relative: String,
    pub modified_ms: Option<u64>,
}

#[tauri::command]
pub(crate) fn list_recent_notes(path: String, limit: usize) -> Result<Vec<RecentNote>, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut notes = Vec::new();
    collect_notes(root, "", 0, &mut notes);

    notes.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.relative.to_lowercase().cmp(&b.relative.to_lowercase()))
    });
    notes.truncate(limit.min(50));

    Ok(notes)
}

pub(crate) fn collect_notes(dir: &std::path::Path, relative: &str, depth: usize, out: &mut Vec<RecentNote>) {
    if depth >= 8 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let child = entry.path();
        let Ok(metadata) = std::fs::metadata(&child) else {
            continue;
        };

        let relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        if metadata.is_dir() {
            collect_notes(&child, &relative, depth + 1, out);
        } else if metadata.is_file() && is_md_file(&child) {
            out.push(RecentNote {
                name,
                path: child.to_string_lossy().into_owned(),
                relative,
                modified_ms: metadata_modified_ms(&metadata),
            });
        }
    }
}

#[tauri::command]
pub(crate) fn list_vault_notes(path: String) -> Result<Vec<RecentNote>, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut notes = Vec::new();
    collect_notes(root, "", 0, &mut notes);
    notes.sort_by_key(|note| note.relative.to_lowercase());
    notes.truncate(1000);

    Ok(notes)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VaultAsset {
    pub name: String,
    pub path: String,
    pub relative: String,
    pub modified_ms: Option<u64>,
}

/// Recorre el vault buscando los archivos que cumplan `keep` (imágenes, PDF…),
/// con la misma poda que `collect_notes` (nada de ocultas ni más allá de ocho
/// niveles).
pub(crate) fn collect_assets(
    dir: &std::path::Path,
    relative: &str,
    depth: usize,
    keep: fn(&std::path::Path) -> bool,
    out: &mut Vec<VaultAsset>,
) {
    if depth >= 8 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }

        let child = entry.path();
        let Ok(metadata) = std::fs::metadata(&child) else {
            continue;
        };

        let relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        if metadata.is_dir() {
            collect_assets(&child, &relative, depth + 1, keep, out);
        } else if metadata.is_file() && keep(&child) {
            out.push(VaultAsset {
                name,
                path: child.to_string_lossy().into_owned(),
                relative,
                modified_ms: metadata_modified_ms(&metadata),
            });
        }
    }
}

/**
 * Imágenes de todo el vault para el selector del menú «/»: primero las más
 * recientes, que son las que suele querer quien inserta una imagen.
 */
#[tauri::command]
pub(crate) fn list_vault_images(path: String) -> Result<Vec<VaultAsset>, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut images = Vec::new();
    collect_assets(root, "", 0, is_image_file, &mut images);
    images.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.relative.to_lowercase().cmp(&b.relative.to_lowercase()))
    });
    images.truncate(500);

    Ok(images)
}

/// PDF de todo el vault para la biblioteca: por orden alfabético de ruta.
#[tauri::command]
pub(crate) fn list_vault_pdfs(path: String) -> Result<Vec<VaultAsset>, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut pdfs = Vec::new();
    collect_assets(root, "", 0, is_pdf_file, &mut pdfs);
    pdfs.sort_by_key(|pdf| pdf.relative.to_lowercase());

    Ok(pdfs)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTag {
    pub tag: String,
    pub count: usize,
}

#[tauri::command]
pub(crate) fn list_vault_tags(path: String) -> Result<Vec<VaultTag>, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut notes = Vec::new();
    collect_notes(root, "", 0, &mut notes);
    notes.sort_by_key(|note| note.relative.to_lowercase());
    notes.truncate(1000);

    let mut counts: std::collections::HashMap<String, (String, usize)> =
        std::collections::HashMap::new();

    for note in &notes {
        use std::io::Read;

        let Ok(mut file) = std::fs::File::open(&note.path) else {
            continue;
        };
        let mut head = [0u8; 8 * 1024];
        let read = file.read(&mut head).unwrap_or(0);
        for tag in frontmatter_tags(&String::from_utf8_lossy(&head[..read])) {
            let slot = counts.entry(tag.to_lowercase()).or_insert_with(|| (tag, 0));
            slot.1 += 1;
        }
    }

    let mut tags: Vec<VaultTag> = counts
        .into_values()
        .map(|(tag, count)| VaultTag { tag, count })
        .collect();
    tags.sort_by_key(|entry| entry.tag.to_lowercase());

    Ok(tags)
}
