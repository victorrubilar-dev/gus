use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn ensure_md(path: &str) -> Result<(), String> {
    let is_md = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));

    if is_md {
        Ok(())
    } else {
        Err(format!("Solo se permiten archivos .md: «{path}»"))
    }
}

fn is_md_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

fn image_mime(path: &std::path::Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();

    Some(match ext.as_str() {
        "png" | "apng" => "image/png",
        "jpg" | "jpeg" | "jpe" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" | "cur" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "jxl" => "image/jxl",
        "pnm" | "ppm" | "pgm" | "pbm" => "image/x-portable-anymap",
        "qoi" => "image/qoi",
        "xbm" => "image/x-xbitmap",
        _ => return None,
    })
}

fn is_image_file(path: &std::path::Path) -> bool {
    image_mime(path).is_some()
}

fn is_pdf_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);

    for chunk in data.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        let n = (u32::from(first) << 16) | (u32::from(second) << 8) | u32::from(third);

        out.push(ALPHABET[(n >> 18 & 0x3F) as usize] as char);
        out.push(ALPHABET[(n >> 12 & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6 & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 0x3F) as usize] as char
        } else {
            '='
        });
    }

    out
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

#[tauri::command]
fn read_vault_file(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    std::fs::read_to_string(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))
}

#[tauri::command]
fn write_vault_file(path: String, content: String) -> Result<(), String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    if let Some(parent) = std::path::Path::new(&path).parent() {
        // `parent()` es "" para rutas relativas sin carpeta (p. ej. "nota.md").
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                format!("No se pudo crear el directorio «{}»: {err}", parent.display())
            })?;
        }
    }

    std::fs::write(&path, content).map_err(|err| format!("No se pudo escribir «{path}»: {err}"))
}

/// Descodifica Base64: es como viaja el PDF desde el navegador hasta aquí.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn digit(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;

    for byte in input.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value =
            digit(byte).ok_or_else(|| "El contenido recibido no es Base64 válido".to_string())?;
        acc = (acc << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }

    Ok(out)
}

/// Escribe el PDF exportado en la ruta que haya elegido el usuario.
#[tauri::command]
fn write_pdf_file(path: String, data: String) -> Result<(), String> {
    let path = expand_home(&path);
    // Algunos diálogos no añaden la extensión que se pidió en el filtro.
    let path = if path.to_lowercase().ends_with(".pdf") {
        path
    } else {
        format!("{path}.pdf")
    };
    let bytes = decode_base64(&data)?;

    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                format!("No se pudo crear el directorio «{}»: {err}", parent.display())
            })?;
        }
    }

    std::fs::write(&path, bytes).map_err(|err| format!("No se pudo escribir «{path}»: {err}"))
}

/// Filtro de `rename_vault_file`, `move_vault_file` y `delete_vault_file`: solo
/// tipos que el explorador sabe mostrar. La papelera (`move_to_trash`) NO usa
/// este filtro, porque tirar un archivo no depende de que lo sepan abrir.
fn ensure_entry(path: &str) -> Result<(), String> {
    let path_ref = std::path::Path::new(path);

    if is_md_file(path_ref) || is_pdf_file(path_ref) || is_image_file(path_ref) {
        Ok(())
    } else {
        Err(format!(
            "Solo se permiten archivos .md, .pdf o imágenes: «{path}»"
        ))
    }
}

#[tauri::command]
fn rename_vault_file(from: String, to: String) -> Result<String, String> {
    let from = expand_home(&from);
    let to = expand_home(&to);
    ensure_entry(&from)?;
    ensure_entry(&to)?;

    if from == to {
        return Ok(to);
    }
    if !std::path::Path::new(&from).exists() {
        return Err(format!("No existe el archivo «{from}»"));
    }
    if std::path::Path::new(&to).exists() {
        return Err(format!("Ya existe otro archivo en «{to}»"));
    }

    if let Some(parent) = std::path::Path::new(&to).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                format!("No se pudo crear el directorio «{}»: {err}", parent.display())
            })?;
        }
    }

    std::fs::rename(&from, &to).map_err(|err| {
        format!("No se pudo renombrar «{from}» → «{to}»: {err}")
    })?;

    Ok(to)
}

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
fn list_vault_entries(path: String) -> Result<Vec<VaultEntry>, String> {
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
fn create_vault_file(path: String, content: String) -> Result<String, String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    let wanted = std::path::Path::new(&path);
    if let Some(parent) = wanted.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                format!("No se pudo crear el directorio «{}»: {err}", parent.display())
            })?;
        }
    }

    let target = unique_path(wanted)?;
    std::fs::write(&target, content)
        .map_err(|err| format!("No se pudo crear «{}»: {err}", target.display()))?;

    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_vault_dir(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    let wanted = std::path::Path::new(&path);

    if wanted.exists() && !wanted.is_dir() {
        return Err(format!("Ya existe un archivo con ese nombre en «{path}»"));
    }

    let target = unique_path(wanted)?;
    std::fs::create_dir_all(&target)
        .map_err(|err| format!("No se pudo crear la carpeta «{}»: {err}", target.display()))?;

    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_vault_file(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    ensure_entry(&path)?;

    if !std::path::Path::new(&path).exists() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    std::fs::remove_file(&path).map_err(|err| format!("No se pudo eliminar «{path}»: {err}"))
}

const TRASH_MANIFEST: &str = ".gus-trash-manifest.json";

const TRASH_TTL_DAYS: u64 = 30;

const TRASH_TTL_MS: u64 = TRASH_TTL_DAYS * 24 * 60 * 60 * 1_000;

fn trash_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(expand_home("~/gus-vault/.gus-trash"))
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
struct TrashRecord {
    name: String,
    origin: String,
    trashed_at_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn load_trash_manifest(trash: &std::path::Path) -> Vec<TrashRecord> {
    std::fs::read_to_string(trash.join(TRASH_MANIFEST))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_trash_manifest(trash: &std::path::Path, records: &[TrashRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(records)
        .map_err(|err| format!("No se pudo serializar el manifiesto: {err}"))?;
    ensure_dir_exists(trash)?;
    std::fs::write(trash.join(TRASH_MANIFEST), raw)
        .map_err(|err| format!("No se pudo actualizar el manifiesto: {err}"))
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

fn move_path_to_trash(
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

fn trash_entry(
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
        let _ = save_trash_manifest(trash, &records);
    }

    Ok(moved)
}

fn purge_expired_trash(trash: &std::path::Path) -> usize {
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

    if changed {
        let _ = save_trash_manifest(trash, &records);
    }

    purged
}

#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    trash_entry_if_safe(std::path::Path::new(&path), &trash_dir())?;
    Ok(())
}

/**
 * Tira un archivo o una carpeta en la papelera.
 *
 * La papelera NO filtra por tipo de archivo: aquí solo se comprueba que el
 * elemento exista y que no estemos tirando la papelera dentro de sí misma.
 * Así caben `.md`, `.pdf`, `.png`, `.jpg`, y en general cualquier archivo.
 */
fn trash_entry_if_safe(
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

fn ensure_trashable_file(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
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

fn ensure_trashable_dir(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
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
fn list_trash() -> Result<Vec<TrashItem>, String> {
    let trash = trash_dir();
    purge_expired_trash(&trash);
    list_trash_items(&trash)
}

#[tauri::command]
fn restore_from_trash(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    restore_trashed(std::path::Path::new(&path), &trash_dir())
}

#[tauri::command]
fn delete_from_trash(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    delete_trashed(std::path::Path::new(&path), &trash_dir())
}

#[tauri::command]
fn empty_trash() -> Result<(), String> {
    empty_trash_dir(&trash_dir())
}

fn list_trash_items(trash: &std::path::Path) -> Result<Vec<TrashItem>, String> {
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

fn restore_trashed(source: &std::path::Path, trash: &std::path::Path) -> Result<String, String> {
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
    let _ = save_trash_manifest(trash, &records);

    Ok(target.to_string_lossy().into_owned())
}

fn delete_trashed(path: &std::path::Path, trash: &std::path::Path) -> Result<(), String> {
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
        let _ = save_trash_manifest(trash, &records);
    }

    Ok(())
}

fn empty_trash_dir(trash: &std::path::Path) -> Result<(), String> {
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

#[tauri::command]
fn rename_vault_dir(from: String, to: String) -> Result<String, String> {
    let from = expand_home(&from);
    let to = expand_home(&to);

    let source = std::path::Path::new(&from);
    if !source.is_dir() {
        return Err(format!("No existe la carpeta «{from}»"));
    }

    let destination = std::path::Path::new(&to);
    if source != destination && destination.starts_with(source) {
        return Err("No se puede mover una carpeta dentro de sí misma".to_string());
    }
    if destination.exists() {
        return Err(format!("Ya existe «{to}»"));
    }

    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("No se pudo crear «{}»: {err}", parent.display()))?;
        }
    }

    std::fs::rename(source, destination)
        .map_err(|err| format!("No se pudo renombrar «{from}» → «{to}»: {err}"))?;

    Ok(to)
}

#[tauri::command]
fn delete_vault_dir(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    let target = std::path::Path::new(&path);

    if !target.is_dir() {
        return Err(format!("No existe la carpeta «{path}»"));
    }

    let Some(parent) = target.parent() else {
        return Err(format!("No se puede eliminar la raíz «{path}»"));
    };
    if parent.as_os_str().is_empty() && target.is_absolute() {
        return Err(format!("No se puede eliminar la raíz «{path}»"));
    }

    std::fs::remove_dir_all(target)
        .map_err(|err| format!("No se pudo eliminar la carpeta «{path}»: {err}"))
}

#[tauri::command]
fn read_vault_image(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    let mime = image_mime(std::path::Path::new(&path))
        .ok_or_else(|| format!("Formato no soportado (solo imágenes): «{path}»"))?;

    if !std::path::Path::new(&path).is_file() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    const MAX_BYTES: u64 = 30 * 1024 * 1024;
    let metadata =
        std::fs::metadata(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "La imagen pesa {} MB y el límite son 30 MB",
            metadata.len() / (1024 * 1024)
        ));
    }

    let bytes =
        std::fs::read(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;

    Ok(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

#[tauri::command]
fn read_vault_pdf(path: String) -> Result<String, String> {
    let path = expand_home(&path);

    if !is_pdf_file(std::path::Path::new(&path)) {
        return Err(format!("Formato no soportado (solo PDF): «{path}»"));
    }

    if !std::path::Path::new(&path).is_file() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    const MAX_BYTES: u64 = 60 * 1024 * 1024;
    let metadata =
        std::fs::metadata(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "El PDF pesa {} MB y el límite son 60 MB",
            metadata.len() / (1024 * 1024)
        ));
    }

    let bytes =
        std::fs::read(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;

    Ok(format!(
        "data:application/pdf;base64,{}",
        base64_encode(&bytes)
    ))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultInfo {
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub open_last_vault: bool,
    pub always_notes_tab: bool,
    pub animations: bool,
    pub accent: String,
    pub editor_font_size: u8,
    pub ui_zoom: u16,
    pub auto_save: bool,
    pub hide_completed_tasks: bool,
    pub calendar_show_completed: bool,
    pub spell_lang: String,
    pub spell_words: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            open_last_vault: true,
            always_notes_tab: false,
            animations: true,
            accent: "terracota".into(),
            editor_font_size: 14,
            ui_zoom: 100,
            auto_save: true,
            hide_completed_tasks: false,
            calendar_show_completed: true,
            spell_lang: "es".into(),
            spell_words: Vec::new(),
        }
    }
}

impl AppSettings {
    /// Colores de acento aceptados (deben coincidir con los del frontend).
    const ACCENTS: [&'static str; 4] = ["terracota", "menta", "marfil", "cielo"];

    /// Idiomas del corrector aceptados (deben coincidir con los del frontend).
    const SPELL_LANGS: [&'static str; 8] =
        ["off", "es", "en-US", "en-GB", "fr", "de", "pt-BR", "it"];

    /// Corrige valores escritos a mano en el `config.json` (nunca falla).
    fn sanitize(&mut self) {
        if !Self::ACCENTS.contains(&self.accent.as_str()) {
            self.accent = Self::default().accent;
        }
        if !Self::SPELL_LANGS.contains(&self.spell_lang.as_str()) {
            self.spell_lang = Self::default().spell_lang;
        }
        self.editor_font_size = self.editor_font_size.clamp(12, 22);
        self.ui_zoom = self.ui_zoom.clamp(50, 200);

        let mut words: Vec<String> = Vec::new();
        for raw in std::mem::take(&mut self.spell_words) {
            let word: String = raw.trim().chars().take(64).collect();
            if word.is_empty() || words.contains(&word) {
                continue;
            }
            words.push(word);
        }
        self.spell_words = words;
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub base_dir: Option<String>,
    pub vaults: Vec<VaultInfo>,
    pub last_vault: Option<String>,
    pub settings: AppSettings,
}

fn default_vaults_base() -> String {
    match home_dir() {
        Some(home) => format!("{home}/Documents/gus-vaults"),
        None => "~/Documents/gus-vaults".to_string(),
    }
}

fn config_file_path() -> Option<std::path::PathBuf> {
    match std::env::consts::OS {
        "windows" => std::env::var_os("APPDATA")
            .map(|dir| std::path::PathBuf::from(dir).join("gus").join("config.json")),
        "macos" => home_dir().map(|home| {
            std::path::PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("gus")
                .join("config.json")
        }),
        _ => {
            if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
                if !xdg.is_empty() {
                    return Some(std::path::PathBuf::from(xdg).join("gus").join("config.json"));
                }
            }
            home_dir().map(|home| {
                std::path::PathBuf::from(home)
                    .join(".config")
                    .join("gus")
                    .join("config.json")
            })
        }
    }
}

fn load_config_from(path: &std::path::Path) -> AppConfig {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return AppConfig::default();
    };

    match serde_json::from_str::<AppConfig>(&raw) {
        Ok(mut config) => {
            config.settings.sanitize();
            config
        }
        Err(_) => AppConfig::default(),
    }
}

fn save_config_to(path: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config)
        .map_err(|err| format!("No se pudo serializar la configuración: {err}"))?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("No se pudo crear «{}»: {err}", parent.display()))?;
        }
    }

    std::fs::write(path, raw)
        .map_err(|err| format!("No se pudo escribir la configuración: {err}"))
}

#[tauri::command]
fn load_app_config() -> AppConfig {
    let mut config = match config_file_path() {
        Some(path) => load_config_from(&path),
        None => AppConfig::default(),
    };

    if config.base_dir.is_none() {
        config.base_dir = Some(default_vaults_base());
    }

    config
}

#[tauri::command]
fn save_app_config(config: AppConfig) -> Result<(), String> {
    let path = config_file_path()
        .ok_or_else(|| "No se encontró el directorio de configuración".to_string())?;

    save_config_to(&path, &config)
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

const TASK_STORE_FILE: &str = ".gus-tasks.json";
const LEGACY_TASKS_FILE: &str = "tareas.md";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    Baja,
    Media,
    Alta,
    Urgente,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTask {
    id: String,
    title: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    completes: bool,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    due: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    priority: Option<TaskPriority>,
    #[serde(default)]
    doing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct TaskStore {
    version: u32,
    tasks: Vec<StoredTask>,
}

impl Default for TaskStore {
    fn default() -> Self {
        Self {
            version: 1,
            tasks: Vec::new(),
        }
    }
}

fn vault_root(vault_path: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::PathBuf::from(expand_home(vault_path));
    if root.is_dir() {
        Ok(root)
    } else {
        Err(format!("No existe el vault «{}»", root.display()))
    }
}

fn task_store_path(vault_path: &str) -> Result<std::path::PathBuf, String> {
    Ok(vault_root(vault_path)?.join(TASK_STORE_FILE))
}

#[tauri::command]
fn load_tasks(vault_path: String) -> Result<Vec<StoredTask>, String> {
    let path = task_store_path(&vault_path)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))?;
    let store: TaskStore = serde_json::from_str(&raw)
        .map_err(|err| format!("No se pudo leer el almacén de tareas «{}»: {err}", path.display()))?;

    Ok(store.tasks)
}

#[tauri::command]
fn save_tasks(vault_path: String, tasks: Vec<StoredTask>) -> Result<(), String> {
    let path = task_store_path(&vault_path)?;
    let store = TaskStore {
        version: 1,
        tasks,
    };
    let raw = serde_json::to_string_pretty(&store)
        .map_err(|err| format!("No se pudo serializar las tareas: {err}"))?;

    std::fs::write(&path, raw)
        .map_err(|err| format!("No se pudo escribir «{}»: {err}", path.display()))
}

#[tauri::command]
fn read_legacy_tasks(vault_path: String) -> Result<Option<String>, String> {
    let path = vault_root(&vault_path)?.join(LEGACY_TASKS_FILE);
    if !path.is_file() {
        return Ok(None);
    }

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|err| format!("No se pudo leer «{}»: {err}", path.display()))
}

#[tauri::command]
fn archive_legacy_tasks(vault_path: String) -> Result<bool, String> {
    let root = vault_root(&vault_path)?;
    let source = root.join(LEGACY_TASKS_FILE);
    if !source.is_file() {
        return Ok(false);
    }

    let target = unique_path(&root.join(".gus-tasks.md.bak"))?;
    std::fs::rename(&source, &target)
        .map_err(|err| format!("No se pudo archivar «{}»: {err}", source.display()))?;
    Ok(true)
}

const NEW_TASK_EVENT: &str = "task-created";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub priority: Option<TaskPriority>,
}

fn validate_new_task(task: NewTask) -> Result<NewTask, String> {
    let title = task.title.trim().to_string();
    if title.is_empty() {
        return Err("La tarea necesita un nombre".to_string());
    }

    let description = task
        .description
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());

    let due = task
        .due
        .map(|date| date.trim().to_string())
        .filter(|date| !date.is_empty());

    if let Some(date) = &due {
        let shape_ok = date.len() == 10
            && date.bytes().enumerate().all(|(i, byte)| {
                if i == 4 || i == 7 {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            });
        if !shape_ok {
            return Err(format!("Fecha de plazo no válida: «{date}» (usa AAAA-MM-DD)"));
        }
    }

    Ok(NewTask {
        title,
        description,
        tags: task.tags,
        due,
        priority: task.priority,
    })
}

#[tauri::command]
fn publish_new_task(app: AppHandle, task: NewTask) -> Result<(), String> {
    let task = validate_new_task(task)?;

    app.emit(NEW_TASK_EVENT, task)
        .map_err(|err| format!("No se pudo publicar la tarea: {err}"))?;

    Ok(())
}

#[tauri::command]
fn move_vault_file(from: String, to_dir: String) -> Result<String, String> {
    let from = expand_home(&from);
    ensure_entry(&from)?;
    let to_dir = expand_home(&to_dir);

    let dir = std::path::Path::new(&to_dir);
    if !dir.is_dir() {
        return Err(format!("No existe la carpeta destino «{to_dir}»"));
    }

    let source = std::path::Path::new(&from);
    if !source.exists() {
        return Err(format!("No existe el archivo «{from}»"));
    }

    let name = source
        .file_name()
        .ok_or_else(|| format!("Ruta inválida «{from}»"))?;
    let destination = dir.join(name);

    if destination.as_path() == source {
        return Ok(from);
    }

    let target = unique_path(&destination)?;
    std::fs::rename(source, &target).map_err(|err| {
        format!("No se pudo mover «{from}» → «{}»: {err}", target.display())
    })?;

    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_vault_dirs(path: String) -> Result<Vec<VaultDir>, String> {
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

fn collect_dirs(
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

#[tauri::command]
fn read_vault_dir(path: String) -> Result<Vec<FileItem>, String> {
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
fn get_vault_files(path: String) -> Result<Vec<VaultFile>, String> {
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
fn list_recent_notes(path: String, limit: usize) -> Result<Vec<RecentNote>, String> {
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

fn collect_notes(dir: &std::path::Path, relative: &str, depth: usize, out: &mut Vec<RecentNote>) {
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
fn list_vault_notes(path: String) -> Result<Vec<RecentNote>, String> {
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
#[serde(rename_all = "camelCase")]
pub struct VaultTag {
    pub tag: String,
    pub count: usize,
}

#[tauri::command]
fn list_vault_tags(path: String) -> Result<Vec<VaultTag>, String> {
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
        .setup(|_app| {
            purge_expired_trash(&trash_dir());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_vault_dir,
            get_vault_files,
            list_recent_notes,
            list_vault_notes,
            list_vault_tags,
            read_vault_file,
            write_vault_file,
            write_pdf_file,
            rename_vault_file,
            list_vault_entries,
            list_vault_dirs,
            create_vault_file,
            create_vault_dir,
            delete_vault_file,
            move_to_trash,
            list_trash,
            restore_from_trash,
            delete_from_trash,
            empty_trash,
            delete_vault_dir,
            rename_vault_dir,
            move_vault_file,
            read_vault_image,
            read_vault_pdf,
            load_app_config,
            save_app_config,
            vault_dir_exists,
            create_vault,
            load_tasks,
            save_tasks,
            read_legacy_tasks,
            archive_legacy_tasks,
            publish_new_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("gus-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp vault");
        dir
    }

    /** Codificador de referencia para contrastar `decode_base64`. */
    fn to_base64(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();

        for chunk in bytes.chunks(3) {
            let tail = [
                chunk[0],
                chunk.get(1).copied().unwrap_or(0),
                chunk.get(2).copied().unwrap_or(0),
            ];
            let packed =
                (u32::from(tail[0]) << 16) | (u32::from(tail[1]) << 8) | u32::from(tail[2]);
            out.push(ALPHABET[(packed >> 18) as usize & 63] as char);
            out.push(ALPHABET[(packed >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(packed >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[packed as usize & 63] as char
            } else {
                '='
            });
        }

        out
    }

    #[test]
    fn decode_base64_matches_reference_encoder() {
        let cases: [&[u8]; 7] = [
            b"",
            b"A",
            b"AB",
            b"ABC",
            b"ABCD",
            b"%PDF-1.7\n",
            &[0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255],
        ];

        for bytes in cases {
            let encoded = to_base64(bytes);
            assert_eq!(
                decode_base64(&encoded).expect("base64 válido"),
                bytes.to_vec(),
                "fallo con {encoded:?}",
            );
            // El relleno y los saltos de línea no deben confundir al lector.
            let wrapped = encoded.replace('-', "+").replace('_', "/");
            assert_eq!(decode_base64(&wrapped).expect("base64 válido"), bytes.to_vec());
        }
    }

    #[test]
    fn decode_base64_rejects_invalid_characters() {
        assert!(decode_base64("hola??").is_err());
        assert!(decode_base64("abc$").is_err());
        assert!(decode_base64("ññññ").is_err());
    }

    #[test]
    fn write_pdf_file_saves_decoded_bytes_and_completes_extension() {
        let dir = temp_vault("pdf-export");
        let target = dir.join("nota.pdf");
        let payload = b"%PDF-1.7\nfin";

        write_pdf_file(
            target.to_string_lossy().into_owned(),
            to_base64(payload),
        )
        .expect("escribir el pdf");

        assert_eq!(std::fs::read(&target).expect("leer el pdf"), payload);

        // Si el diálogo no añadió la extensión, se completa.
        let bare = dir.join("sin-extension");
        write_pdf_file(bare.to_string_lossy().into_owned(), to_base64(b"x")).expect("escribir");
        assert!(dir.join("sin-extension.pdf").exists());
        assert!(!bare.exists());
    }

    #[test]
    fn read_vault_dir_filters_non_md_files() {
        let dir = temp_vault("vault-test");

        std::fs::write(dir.join("bienvenida.md"), "# Hola").expect("write md");
        std::fs::write(dir.join("README.txt"), "no soy md").expect("write txt");
        std::fs::write(dir.join("NOTAS.MD"), "# Mayúsculas").expect("write MD");
        std::fs::create_dir(dir.join("carpeta.md")).expect("create dir with .md name");

        let path = dir.to_string_lossy().into_owned();
        let items = read_vault_dir(path.clone()).expect("read vault");

        let names: Vec<&str> = items.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["bienvenida.md", "NOTAS.MD"]);
        assert_eq!(items[0].path, dir.join("bienvenida.md").to_string_lossy());
        assert_eq!(items[0].size, 6);
        assert!(items[0].modified_ms.is_some());

        let missing = format!("{path}/no-existe");
        let created = read_vault_dir(missing.clone()).expect("create and read");
        assert!(created.is_empty());
        assert!(std::path::Path::new(&missing).is_dir());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn get_vault_files_returns_name_and_modified() {
        let dir = temp_vault("vault-files");

        std::fs::write(dir.join("zeta.md"), "z").expect("write md");
        std::fs::write(dir.join("alpha.md"), "alpha").expect("write md");
        std::fs::write(dir.join("notas.txt"), "x").expect("write txt");

        let path = dir.to_string_lossy().into_owned();
        let files = get_vault_files(path).expect("get vault files");

        let names: Vec<&str> = files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, vec!["alpha.md", "zeta.md"]);
        for file in &files {
            assert!(file.path.ends_with(&file.name));
            assert!(file.modified_ms.is_some());
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_recent_notes_ordena_por_fecha_y_omite_ocultas() {
        use std::time::{Duration, SystemTime};

        let dir = temp_vault("recent-notes");
        std::fs::create_dir(dir.join("viajes")).expect("subdir");
        std::fs::create_dir(dir.join(".oculta")).expect("hidden dir");

        std::fs::write(dir.join("vieja.md"), "vieja").expect("write md");
        std::fs::write(dir.join("viajes").join("intermedia.md"), "intermedia").expect("sub md");
        std::fs::write(dir.join("nueva.md"), "nueva").expect("write md");
        std::fs::write(dir.join("no-md.txt"), "x").expect("write txt");
        std::fs::write(dir.join(".oculta").join("secreta.md"), "oculta").expect("hidden md");

        let now = SystemTime::now();
        let touch = |name: &str, age: Duration| {
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(dir.join(name))
                .expect("open for mtime");
            file.set_modified(now - age).expect("mtime");
        };
        touch("vieja.md", Duration::from_secs(3 * 24 * 3600));
        touch("viajes/intermedia.md", Duration::from_secs(24 * 3600));
        touch("nueva.md", Duration::from_secs(60));
        touch(".oculta/secreta.md", Duration::ZERO);

        let path = dir.to_string_lossy().into_owned();
        let notes = list_recent_notes(path.clone(), 10).expect("list");

        let relatives: Vec<&str> = notes.iter().map(|note| note.relative.as_str()).collect();
        assert_eq!(
            relatives,
            vec!["nueva.md", "viajes/intermedia.md", "vieja.md"],
            "orden = {relatives:?}"
        );
        assert_eq!(notes[1].name, "intermedia.md");
        assert!(
            notes.iter().all(|note| !note.relative.contains(".oculta")),
            "las carpetas ocultas no aparecen"
        );
        assert!(notes.iter().all(|note| note.modified_ms.is_some()));

        assert_eq!(
            list_recent_notes(path.clone(), 2).expect("limit 2").len(),
            2
        );
        assert!(list_recent_notes(path.clone(), 0)
            .expect("limit 0")
            .is_empty());

        assert!(list_recent_notes(format!("{path}/no-existe"), 5).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_vault_notes_devuelve_todas_las_notas_ordenadas() {
        let dir = temp_vault("palette-notes");
        std::fs::create_dir(dir.join("viajes")).expect("subdir");
        std::fs::create_dir(dir.join(".oculta")).expect("hidden dir");

        std::fs::write(dir.join("zeta.md"), "z").expect("write md");
        std::fs::write(dir.join("alpha.md"), "a").expect("write md");
        std::fs::write(dir.join("viajes").join("paris.md"), "p").expect("sub md");
        std::fs::write(dir.join("notas.txt"), "x").expect("write txt");
        std::fs::write(dir.join(".oculta").join("secreta.md"), "s").expect("hidden md");

        let path = dir.to_string_lossy().into_owned();
        let notes = list_vault_notes(path.clone()).expect("list");

        let relatives: Vec<&str> = notes.iter().map(|note| note.relative.as_str()).collect();
        assert_eq!(
            relatives,
            vec!["alpha.md", "viajes/paris.md", "zeta.md"],
            "orden alfabético = {relatives:?}"
        );
        assert_eq!(notes[1].name, "paris.md");
        assert!(
            notes.iter().all(|note| !note.relative.contains(".oculta")),
            "las carpetas ocultas no aparecen"
        );
        assert!(notes.iter().all(|note| note.path.ends_with(".md")));

        assert!(list_vault_notes(format!("{path}/no-existe")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn frontmatter_tags_lee_flujo_bloque_y_comillas() {
        assert_eq!(
            frontmatter_tags("---\ntags: [casa, \"a: b\"]\n---\nTexto"),
            vec!["casa", "a: b"]
        );
        // Las etiquetas con espacios no se parten: solo la coma separa.
        assert_eq!(
            frontmatter_tags("---\ntags: [Unidad 2, Examen final]\n---\nX"),
            vec!["Unidad 2", "Examen final"]
        );
        assert_eq!(
            frontmatter_tags("---\ntags:\n- Unidad 2\n---\nX"),
            vec!["Unidad 2"]
        );
        assert_eq!(
            frontmatter_tags("---\ntags:\n- uno\n- dos\ntitle: X\n---\nTexto"),
            vec!["uno", "dos"]
        );
        assert_eq!(
            frontmatter_tags("---\ntags: [#Casa, casa, CASA]\n---\nX"),
            vec!["Casa"]
        );
        assert_eq!(
            frontmatter_tags("---\ntitle: Solo título\n---\nX"),
            Vec::<String>::new()
        );
        assert_eq!(frontmatter_tags("Texto normal"), Vec::<String>::new());
        assert_eq!(
            frontmatter_tags("---\nsin propiedades\n---\nX"),
            Vec::<String>::new()
        );
        assert_eq!(
            frontmatter_tags("# Título\n---\ntags: [x]\n---"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn list_vault_tags_recoge_las_etiquetas_de_todo_el_vault() {
        let dir = temp_vault("vault-tags");
        std::fs::create_dir(dir.join("viajes")).expect("subdir");

        std::fs::write(dir.join("a.md"), "---\ntags: [casa, viaje]\n---\n# A").expect("write a");
        std::fs::write(
            dir.join("viajes").join("b.md"),
            "---\ntags:\n- Casa\n- #playa\n---\n# B",
        )
        .expect("write b");
        std::fs::write(dir.join("c.md"), "# C sin etiquetas").expect("write c");
        std::fs::write(dir.join("d.md"), "---\ntitle: Solo título\n---\n# D").expect("write d");
        std::fs::write(dir.join("notas.txt"), "tags: [ignorado]").expect("write txt");

        let path = dir.to_string_lossy().into_owned();
        let tags = list_vault_tags(path.clone()).expect("tags");

        let pairs: Vec<(String, usize)> = tags
            .iter()
            .map(|entry| (entry.tag.to_lowercase(), entry.count))
            .collect();
        assert_eq!(
            pairs,
            vec![("casa".to_string(), 2), ("playa".to_string(), 1), ("viaje".to_string(), 1)],
            "las notas con y sin etiquetas se cuentan bien: {pairs:?}"
        );

        assert!(list_vault_tags(format!("{path}/no-existe")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_vault_dir_creates_missing_folders() {
        let base = temp_vault("vault-missing");
        let nested = base.join("carpeta").join("profunda");

        let items = read_vault_dir(nested.to_string_lossy().into_owned()).expect("create nested");
        assert!(items.is_empty());
        assert!(nested.is_dir());

        let from_files = get_vault_files(nested.to_string_lossy().into_owned()).expect("list nested");
        assert!(from_files.is_empty());

        let file = base.join("nota.md");
        std::fs::write(&file, "# x").expect("write file");
        assert!(read_vault_dir(file.to_string_lossy().into_owned()).is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn write_vault_file_creates_missing_subdirs() {
        let base = temp_vault("vault-write-subdir");
        let note = base.join("proyectos").join("gus").join("idea.md");
        assert!(!note.parent().expect("parent").exists());

        let path = note.to_string_lossy().into_owned();
        let content = "# Idea\n\n- [ ] probarla #dev\n";

        write_vault_file(path.clone(), content.to_string()).expect("write into missing subdir");
        assert!(note.is_file());
        assert!(note.parent().expect("parent").is_dir());

        assert_eq!(read_vault_file(path).expect("read back"), content);

        write_vault_file(
            note.to_string_lossy().into_owned(),
            "# Idea v2\n".to_string(),
        )
        .expect("rewrite");
        assert_eq!(
            read_vault_file(note.to_string_lossy().into_owned()).expect("read again"),
            "# Idea v2\n"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rename_vault_file_moves_and_protects() {
        let base = temp_vault("vault-rename");

        let from = base.join("borrador.md");
        write_vault_file(from.to_string_lossy().into_owned(), "# Borrador\n".into())
            .expect("write");

        let to = base.join("archivo").join("final.md");
        let to_path = to.to_string_lossy().into_owned();
        let renamed =
            rename_vault_file(from.to_string_lossy().into_owned(), to_path.clone()).expect("rename");

        assert_eq!(renamed, to_path);
        assert!(!from.exists());
        assert!(to.is_file());
        assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

        let other = base.join("otro.md");
        write_vault_file(other.to_string_lossy().into_owned(), "# Otro\n".into()).expect("write");
        assert!(rename_vault_file(other.to_string_lossy().into_owned(), to_path.clone()).is_err());
        assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

        let txt = base.join("nota.txt").to_string_lossy().into_owned();
        std::fs::write(&txt, "x").expect("write txt");
        assert!(rename_vault_file(txt, base.join("ok.md").to_string_lossy().into_owned()).is_err());

        assert_eq!(
            rename_vault_file(to_path.clone(), to_path.clone()).expect("same path"),
            to_path
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn expand_home_only_touches_home_paths() {
        assert_eq!(expand_home("/tmp/vault"), "/tmp/vault");
        assert_eq!(expand_home("vault/rel"), "vault/rel");

        if let Some(home) = home_dir() {
            assert_eq!(expand_home("~"), home);
            assert_eq!(expand_home("~/vault"), format!("{home}/vault"));
        } else {
            assert_eq!(expand_home("~/vault"), "~/vault");
        }
    }

    #[test]
    fn read_write_vault_file_roundtrip() {
        let dir = temp_vault("vault-note");
        let note = dir.join("nota.md");
        let path = note.to_string_lossy().into_owned();

        write_vault_file(path.clone(), "# Hola\n\n- [ ] prueba\n".into()).expect("write");
        let content = read_vault_file(path.clone()).expect("read");
        assert_eq!(content, "# Hola\n\n- [ ] prueba\n");

        let txt = dir.join("no.md.txt").to_string_lossy().into_owned();
        assert!(read_vault_file(txt.clone()).is_err());
        assert!(write_vault_file(txt, "x".into()).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_vault_file_escribe_y_no_sobrescribe() {
        let dir = temp_vault("crud-create-file");
        let path = dir.join("nota.md").to_string_lossy().into_owned();

        let created = create_vault_file(path.clone(), "# Hola".into()).expect("debe crearse");
        assert_eq!(created, path);
        assert_eq!(std::fs::read_to_string(&created).expect("read"), "# Hola");

        let other = create_vault_file(path.clone(), "# Otra".into()).expect("debe crearse");
        assert_ne!(other, path);
        assert!(other.ends_with("nota-2.md"), "ruta = {other}");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "# Hola");

        let nested = dir.join("apuntes/mates/funciones.md").to_string_lossy().into_owned();
        let created = create_vault_file(nested.clone(), String::new()).expect("debe crearse");
        assert_eq!(created, nested);
        assert!(std::path::Path::new(&created).is_file());

        let txt = dir.join("nota.txt").to_string_lossy().into_owned();
        let err =
            create_vault_file(txt, String::new()).expect_err("la extensión .txt debe rechazarse");
        assert!(err.contains(".md"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_vault_dir_crea_y_no_ambigua() {
        let dir = temp_vault("crud-create-dir");
        let path = dir.join("proyectos").to_string_lossy().into_owned();

        let created = create_vault_dir(path.clone()).expect("debe crearse");
        assert_eq!(created, path);
        assert!(std::path::Path::new(&created).is_dir());

        let other = create_vault_dir(path).expect("debe crear una variante");
        assert!(other.ends_with("proyectos-2"), "ruta = {other}");

        let occupied = dir.join("archivo.md");
        std::fs::write(&occupied, "").expect("write");
        let err = create_vault_dir(occupied.to_string_lossy().into_owned())
            .expect_err("hay un archivo ahí");
        assert!(err.contains("archivo"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn delete_vault_file_quita_el_archivo() {
        let dir = temp_vault("crud-delete");
        let path = dir.join("borrar.md");
        std::fs::write(&path, "x").expect("write");
        let path = path.to_string_lossy().into_owned();

        delete_vault_file(path.clone()).expect("debe eliminarse");
        assert!(!std::path::Path::new(&path).exists());

        let err = delete_vault_file(path).expect_err("ya no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        let log = dir.join("fuga.log").to_string_lossy().into_owned();
        let err =
            delete_vault_file(log).expect_err("la extensión .log debe rechazarse");
        assert!(err.contains(".md"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn move_to_trash_mueve_a_la_papelera_oculta_y_la_crea() {
        let dir = temp_vault("trash");

        let default_trash = trash_dir();
        assert!(default_trash.ends_with(".gus-trash"), "{default_trash:?}");
        assert!(
            default_trash
                .parent()
                .is_some_and(|parent| parent.ends_with("gus-vault")),
            "papelera = {}",
            default_trash.display()
        );

        let trash = dir.join(".gus-trash");
        assert!(!trash.exists(), "la papelera aún no existe");

        let nota = dir.join("nota.md");
        std::fs::write(&nota, "contenido").expect("write md");

        let moved = move_path_to_trash(&nota, &trash).expect("debe moverse");

        assert!(!nota.exists(), "el original desaparece del vault");
        assert!(trash.is_dir(), "la papelera se crea sola");
        assert_eq!(moved, trash.join("nota.md"));
        assert_eq!(
            std::fs::read_to_string(&moved).expect("leer en la papelera"),
            "contenido"
        );

        std::fs::create_dir(dir.join("otra")).expect("subdir");
        let otra = dir.join("otra").join("nota.md");
        std::fs::write(&otra, "otra").expect("write md");
        let segunda = move_path_to_trash(&otra, &trash).expect("debe moverse 2");
        assert_eq!(segunda, trash.join("nota-2.md"));
        assert_eq!(
            std::fs::read_to_string(trash.join("nota.md")).expect("primera"),
            "contenido"
        );
        assert_eq!(
            std::fs::read_to_string(&segunda).expect("segunda"),
            "otra"
        );

        let falta = dir.join("fantasma.md");
        let vacia = dir.join(".gus-trash-vacia");
        let err = move_path_to_trash(&falta, &vacia).expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");
        assert!(!vacia.exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn papelera_lista_restaura_y_elimina_definitivamente() {
        let dir = temp_vault("trash-ui");
        let trash = dir.join(".gus-trash");
        let vault = dir.join("vault");
        std::fs::create_dir_all(&vault).expect("vault");

        let nota = vault.join("nota.md");
        std::fs::write(&nota, "hola").expect("write md");

        assert!(list_trash_items(&trash).expect("listar").is_empty());

        let tirada = trash_entry(&nota, &trash).expect("tirar");
        assert!(!nota.exists(), "el original ya no está en el vault");

        let items = list_trash_items(&trash).expect("listar");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "nota.md");
        assert_eq!(items[0].size, 4);
        assert!(!items[0].is_dir);
        assert_eq!(
            items[0].origin.as_deref(),
            Some(nota.to_string_lossy().as_ref())
        );
        assert!(items[0].trashed_at_ms.is_some());
        assert!(items[0].modified_ms.is_some());

        let restaurada = restore_trashed(&tirada, &trash).expect("restaurar");
        assert_eq!(restaurada, nota.to_string_lossy().into_owned());
        assert_eq!(std::fs::read_to_string(&nota).expect("leer"), "hola");
        assert!(list_trash_items(&trash).expect("listar").is_empty());

        let tirada = trash_entry(&nota, &trash).expect("tirar 2");
        std::fs::write(&nota, "nuevo").expect("write md");
        let restaurada = restore_trashed(&tirada, &trash).expect("restaurar 2");
        assert!(restaurada.ends_with("nota-2.md"), "ruta = {restaurada}");
        assert_eq!(std::fs::read_to_string(&nota).expect("leer"), "nuevo");
        assert_eq!(
            std::fs::read_to_string(&restaurada).expect("leer 2"),
            "hola"
        );

        let tirada = trash_entry(&nota, &trash).expect("tirar 3");
        delete_trashed(&tirada, &trash).expect("borrar");
        assert!(!tirada.exists());
        assert!(list_trash_items(&trash).expect("listar").is_empty());

        let err = restore_trashed(&nota, &trash).expect_err("fuera de la papelera");
        assert!(err.contains("fuera de la papelera"), "mensaje = {err}");
        let err = delete_trashed(&nota, &trash).expect_err("fuera de la papelera");
        assert!(err.contains("fuera de la papelera"), "mensaje = {err}");

        let otra = vault.join("otra.md");
        std::fs::write(&otra, "x").expect("write md");
        trash_entry(&otra, &trash).expect("tirar 4");
        empty_trash_dir(&trash).expect("vaciar");
        assert!(list_trash_items(&trash).expect("listar").is_empty());
        assert!(!trash.join(TRASH_MANIFEST).exists(), "sin manifiesto");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn papelera_acepta_carpetas_y_las_restaura_con_su_contenido() {
        let dir = temp_vault("trash-folders");
        let trash = dir.join(".gus-trash");
        let carpeta = dir.join("vault").join("viajes");
        std::fs::create_dir_all(carpeta.join("fotos")).expect("subdir");
        std::fs::write(carpeta.join("plan.md"), "# plan").expect("write md");
        std::fs::write(carpeta.join("fotos").join("paris.md"), "# paris").expect("write md");

        ensure_trashable_dir(&carpeta, &trash).expect("carpeta normal");

        let tirada = trash_entry(&carpeta, &trash).expect("tirar carpeta");
        assert!(!carpeta.exists(), "la carpeta sale del vault");
        assert!(tirada.is_dir(), "va entera a la papelera");
        assert_eq!(
            std::fs::read_to_string(tirada.join("plan.md")).expect("leer en la papelera"),
            "# plan"
        );

        let items = list_trash_items(&trash).expect("listar");
        assert_eq!(items.len(), 1);
        assert!(items[0].is_dir, "la papelera la lista como carpeta");
        assert_eq!(items[0].size, 0, "las carpetas no informan tamaño");
        assert_eq!(
            items[0].origin.as_deref(),
            Some(carpeta.to_string_lossy().as_ref())
        );

        let devuelta = restore_trashed(&tirada, &trash).expect("restaurar");
        assert_eq!(devuelta, carpeta.to_string_lossy().into_owned());
        assert_eq!(
            std::fs::read_to_string(carpeta.join("plan.md")).expect("leer"),
            "# plan"
        );
        assert!(
            carpeta.join("fotos").join("paris.md").exists(),
            "las subcarpetas vuelven enteras"
        );
        assert!(list_trash_items(&trash).expect("listar").is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_trashable_dir_rechaza_raices_y_la_papelera() {
        let dir = temp_vault("trash-guards");
        let trash = dir.join(".gus-trash");
        std::fs::create_dir_all(&trash).expect("trash");
        std::fs::create_dir_all(dir.join("vault").join("ok")).expect("folder");

        let err = ensure_trashable_dir(&dir.join("fantasma"), &trash).expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        let err = ensure_trashable_dir(std::path::Path::new("/"), &trash).expect_err("raíz");
        assert!(err.contains("raíz"), "mensaje = {err}");

        let err = ensure_trashable_dir(&trash, &trash).expect_err("papelera");
        assert!(err.contains("no se puede tirar"), "mensaje = {err}");
        let err = ensure_trashable_dir(&dir, &trash).expect_err("contenedora");
        assert!(err.contains("no se puede tirar"), "mensaje = {err}");

        ensure_trashable_dir(&dir.join("vault").join("ok"), &trash).expect("carpeta normal");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn papelera_admite_cualquier_tipo_de_archivo() {
        let dir = temp_vault("trash-any");
        let trash = dir.join(".gus-trash");
        let vault = dir.join("vault");
        std::fs::create_dir_all(&vault).expect("vault");

        let nombres = [
            "nota.md",
            "manual.pdf",
            "foto.jpg",
            "captura.png",
            "avatar.ico",
            "escaneo.tiff",
            "datos.txt",
            "backup.zip",
        ];

        for name in nombres {
            std::fs::write(vault.join(name), name).expect("write");
        }

        for name in nombres {
            let source = vault.join(name);
            let tirado = trash_entry_if_safe(&source, &trash)
                .unwrap_or_else(|err| panic!("«{name}» debe caber en la papelera: {err}"));
            assert!(!source.exists(), "«{name}» sale del vault");
            assert!(tirado.exists(), "«{name}» acaba en la papelera");
        }

        let items = list_trash_items(&trash).expect("listar");
        assert_eq!(items.len(), nombres.len());

        // Restaurar también vale para archivos que no son .md ni imágenes.
        let restaurada =
            restore_trashed(&trash.join("manual.pdf"), &trash).expect("restaurar el pdf");
        assert!(restaurada.ends_with("manual.pdf"), "ruta = {restaurada}");
        assert!(std::path::Path::new(&restaurada).exists());

        // Nada de tirar la papelera dentro de sí misma.
        let dentro = trash.join("datos.txt");
        let err = trash_entry_if_safe(&dentro, &trash).expect_err("ya está en la papelera");
        assert!(err.contains("ya está dentro"), "mensaje = {err}");

        let err = trash_entry_if_safe(&vault.join("fantasma.zip"), &trash)
            .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_entry_admite_md_pdf_e_imagenes() {
        ensure_entry("/vault/nota.md").expect("md");
        ensure_entry("/vault/manual.pdf").expect("pdf");
        ensure_entry("/vault/foto.jpeg").expect("jpeg");
        ensure_entry("/vault/escaneo.tiff").expect("tiff");
        ensure_entry("/vault/logo.svg").expect("svg");

        let err = ensure_entry("/vault/datos.zip").expect_err("zip");
        assert!(err.contains(".md"), "mensaje = {err}");
    }

    #[test]
    fn copy_dir_all_copia_el_arbol_completo() {
        let dir = temp_vault("copy-tree");
        let origen = dir.join("origen");
        std::fs::create_dir_all(origen.join("anidada")).expect("subdirs");
        std::fs::write(origen.join("a.md"), "a").expect("write a");
        std::fs::write(origen.join("anidada").join("b.md"), "b").expect("write b");

        let destino = dir.join("destino");
        copy_dir_all(&origen, &destino).expect("copiar");

        assert_eq!(
            std::fs::read_to_string(destino.join("a.md")).expect("a"),
            "a"
        );
        assert_eq!(
            std::fs::read_to_string(destino.join("anidada").join("b.md")).expect("b"),
            "b"
        );
        assert!(origen.exists(), "la copia no retira el original");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn papelera_purga_cada_elemento_a_los_30_dias() {
        let dir = temp_vault("trash-ttl");
        let trash = dir.join(".gus-trash");
        std::fs::create_dir_all(&trash).expect("trash");

        let ahora = now_ms();
        let dia: u64 = 24 * 60 * 60 * 1_000;

        let caducada = trash.join("vieja.md");
        let limite = trash.join("limite.md");
        let vigente = trash.join("reciente.md");
        std::fs::write(&caducada, "vieja").expect("write vieja");
        std::fs::write(&limite, "limite").expect("write limite");
        std::fs::write(&vigente, "hola").expect("write reciente");

        save_trash_manifest(
            &trash,
            &[
                TrashRecord {
                    name: "vieja.md".into(),
                    origin: dir.join("vieja.md").to_string_lossy().into_owned(),
                    trashed_at_ms: ahora - 31 * dia,
                },
                TrashRecord {
                    name: "limite.md".into(),
                    origin: dir.join("limite.md").to_string_lossy().into_owned(),
                    trashed_at_ms: ahora - 30 * dia,
                },
                TrashRecord {
                    name: "reciente.md".into(),
                    origin: dir.join("reciente.md").to_string_lossy().into_owned(),
                    trashed_at_ms: ahora - 5 * dia,
                },
            ],
        )
        .expect("manifest");

        let purgados = purge_expired_trash(&trash);
        assert_eq!(purgados, 2, "vencen las de 31 días y la de justo 30");
        assert!(!caducada.exists(), "la de 31 días se fue para siempre");
        assert!(!limite.exists(), "la de 30 días exactos también");
        assert!(vigente.exists(), "la de 5 días sigue entera");

        let restantes = load_trash_manifest(&trash);
        assert_eq!(restantes.len(), 1, "solo queda el registro vigente");
        assert_eq!(restantes[0].name, "reciente.md");

        let carpeta = trash.join("viajes");
        std::fs::create_dir_all(carpeta.join("fotos")).expect("subdir");
        std::fs::write(carpeta.join("fotos").join("paris.md"), "x").expect("write");
        let mut registros = load_trash_manifest(&trash);
        registros.push(TrashRecord {
            name: "viajes".into(),
            origin: dir.join("viajes").to_string_lossy().into_owned(),
            trashed_at_ms: ahora - 40 * dia,
        });
        save_trash_manifest(&trash, &registros).expect("manifest 2");

        assert_eq!(purge_expired_trash(&trash), 1);
        assert!(!carpeta.exists(), "la carpeta caducada se va entera");
        assert!(vigente.exists(), "lo vigente no se toca");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn purge_respeta_lo_sin_fecha_y_limpia_registros_basura() {
        let dir = temp_vault("trash-ttl-guard");
        let trash = dir.join(".gus-trash");
        std::fs::create_dir_all(&trash).expect("trash");

        let huerfana = trash.join("sin-fecha.md");
        std::fs::write(&huerfana, "?").expect("write");

        save_trash_manifest(
            &trash,
            &[TrashRecord {
                name: "../fuera.md".into(),
                origin: dir.join("fuera.md").to_string_lossy().into_owned(),
                trashed_at_ms: now_ms() - 40 * 24 * 60 * 60 * 1_000,
            }],
        )
        .expect("manifest");

        assert_eq!(purge_expired_trash(&trash), 0, "no se borró nada del disco");
        assert!(huerfana.exists(), "sin fecha no se caduca");
        assert!(
            load_trash_manifest(&trash).is_empty(),
            "el registro basura se fue"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn move_vault_file_entra_en_la_carpeta() {
        let dir = temp_vault("crud-move");
        let destino = dir.join("archivadas");
        std::fs::create_dir(&destino).expect("mkdir");
        let destino = destino.to_string_lossy().into_owned();

        let origen = dir.join("vieja.md");
        std::fs::write(&origen, "contenido").expect("write");
        let origen = origen.to_string_lossy().into_owned();

        let moved = move_vault_file(origen.clone(), destino.clone()).expect("debe moverse");
        assert!(!std::path::Path::new(&origen).exists());
        assert_eq!(moved, std::path::Path::new(&destino).join("vieja.md"));
        assert_eq!(std::fs::read_to_string(&moved).expect("read"), "contenido");

        std::fs::write(&origen, "2").expect("write");
        let moved_again = move_vault_file(origen.clone(), destino.clone()).expect("debe moverse");
        assert!(moved_again.ends_with("vieja-2.md"), "ruta = {moved_again}");
        assert_eq!(std::fs::read_to_string(&moved).expect("read"), "contenido");

        let before = moved.clone();
        let moved = move_vault_file(moved, destino.clone()).expect("no debe fallar");
        assert_eq!(moved, before, "mover a la misma carpeta no debe cambiar la ruta");
        assert!(std::path::Path::new(&moved_again).exists());

        let missing = dir.join("no-existe").to_string_lossy().into_owned();
        let err = move_vault_file(moved_again, missing).expect_err("el destino no existe");
        assert!(err.contains("destino"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_vault_entries_ordena_carpetas_primero_y_filtra() {
        let dir = temp_vault("crud-list");
        std::fs::write(dir.join("b-nota.md"), "").expect("write md");
        std::fs::write(dir.join("a-nota.md"), "").expect("write md");
        std::fs::write(dir.join("imagen.png"), [1, 2, 3]).expect("write png");
        std::fs::write(dir.join("manual.pdf"), "%PDF-1.4").expect("write pdf");
        std::fs::write(dir.join("datos.txt"), "x").expect("write txt");
        std::fs::write(dir.join(".oculta.md"), "").expect("write oculta");
        std::fs::create_dir(dir.join("zz-carpeta")).expect("mkdir");
        std::fs::create_dir(dir.join(".git")).expect("mkdir");

        let entries = list_vault_entries(dir.to_string_lossy().into_owned())
            .expect("debe listarse");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(
            names,
            ["zz-carpeta", "a-nota.md", "b-nota.md", "imagen.png", "manual.pdf"]
        );
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);
        assert!(entries[1].modified_ms.is_some());

        let missing = dir.join("recien-creada");
        let created = list_vault_entries(missing.to_string_lossy().into_owned())
            .expect("create and read");
        assert!(created.is_empty());
        assert!(missing.is_dir());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_vault_dirs_es_recursivo_y_relativo() {
        let dir = temp_vault("crud-dirs");
        std::fs::create_dir_all(dir.join("trabajo/urgente")).expect("mkdir");
        std::fs::create_dir(dir.join("personal")).expect("mkdir");
        std::fs::create_dir(dir.join(".oculta")).expect("mkdir");
        std::fs::write(dir.join("archivo.md"), "").expect("write");

        let dirs = list_vault_dirs(dir.to_string_lossy().into_owned()).expect("debe listarse");
        let relatives: Vec<&str> = dirs.iter().map(|entry| entry.relative.as_str()).collect();
        assert_eq!(relatives, ["personal", "trabajo", "trabajo/urgente"]);

        let missing = dir.join("no-existe").to_string_lossy().into_owned();
        assert!(list_vault_dirs(missing).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_vault_dir_renombra_sin_pisar() {
        let dir = temp_vault("dir-rename");
        std::fs::create_dir(dir.join("vieja")).expect("mkdir");

        let renamed = rename_vault_dir(
            dir.join("vieja").to_string_lossy().into_owned(),
            dir.join("nueva").to_string_lossy().into_owned(),
        )
        .expect("debe renombrarse");
        assert!(std::path::Path::new(&renamed).is_dir());
        assert!(!dir.join("vieja").exists());
        assert!(dir.join("nueva").is_dir());

        let err = rename_vault_dir(
            dir.join("nueva").to_string_lossy().into_owned(),
            dir.join("nueva/hija").to_string_lossy().into_owned(),
        )
        .expect_err("una carpeta no puede contenerse");
        assert!(err.contains("dentro de sí misma"), "mensaje = {err}");
        assert!(dir.join("nueva").is_dir());

        std::fs::create_dir(dir.join("ocupada")).expect("mkdir");
        std::fs::create_dir(dir.join("tambien")).expect("mkdir");
        let err = rename_vault_dir(
            dir.join("tambien").to_string_lossy().into_owned(),
            dir.join("ocupada").to_string_lossy().into_owned(),
        )
        .expect_err("el destino ya existe");
        assert!(err.contains("Ya existe"), "mensaje = {err}");

        let destino = dir.join("contenedor");
        std::fs::create_dir(&destino).expect("mkdir destino");
        let movida = rename_vault_dir(
            dir.join("nueva").to_string_lossy().into_owned(),
            destino.join("movida").to_string_lossy().into_owned(),
        )
        .expect("debe mover la carpeta");
        assert!(std::path::Path::new(&movida).is_dir());
        assert_eq!(movida, destino.join("movida").to_string_lossy());
        assert!(!dir.join("nueva").exists());

        let err = rename_vault_dir(
            dir.join("fantasma").to_string_lossy().into_owned(),
            dir.join("otra").to_string_lossy().into_owned(),
        )
        .expect_err("no existe la carpeta origen");
        assert!(err.contains("No existe"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn delete_vault_dir_borra_en_carpetas_y_no_la_raiz() {
        let dir = temp_vault("dir-delete");
        let target = dir.join("temporal");
        std::fs::create_dir_all(target.join("anidada")).expect("mkdir");
        std::fs::write(target.join("anidada/nota.md"), "x").expect("write");

        delete_vault_dir(target.to_string_lossy().into_owned()).expect("debe eliminarse");
        assert!(!target.exists());

        let err =
            delete_vault_dir(dir.join("no-existe").to_string_lossy().into_owned())
                .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        let file = dir.join("archivo.md");
        std::fs::write(&file, "").expect("write file");
        let err = delete_vault_dir(file.to_string_lossy().into_owned()).expect_err("es un archivo");
        assert!(err.contains("No existe"), "mensaje = {err}");

        assert!(delete_vault_dir("/".to_string()).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn base64_codifica_vectores_conocidos() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"abcd"), "YWJjZA==");
        assert_eq!(base64_encode(&[0xFF, 0xFE, 0xFD]), "//79");
    }

    #[test]
    fn read_vault_image_devuelve_data_url() {
        let dir = temp_vault("img-read");
        let png = dir.join("foto.png");
        std::fs::write(&png, b"Man").expect("write png");

        let url = read_vault_image(png.to_string_lossy().into_owned()).expect("debe leerse");
        assert_eq!(url, "data:image/png;base64,TWFu");

        std::fs::write(dir.join("a.JPG"), b"Ma").expect("write jpg");
        assert_eq!(
            read_vault_image(dir.join("a.JPG").to_string_lossy().into_owned()).expect("jpg"),
            "data:image/jpeg;base64,TWE="
        );

        std::fs::write(dir.join("d.txt"), b"Man").expect("write txt");
        let err = read_vault_image(dir.join("d.txt").to_string_lossy().into_owned())
            .expect_err("no es imagen");
        assert!(err.contains("solo imágenes"), "mensaje = {err}");

        let err = read_vault_image(dir.join("no-existe.png").to_string_lossy().into_owned())
            .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_vault_pdf_devuelve_data_url() {
        let dir = temp_vault("pdf-read");
        let pdf = dir.join("clase.pdf");
        std::fs::write(&pdf, b"Man").expect("write pdf");

        let url = read_vault_pdf(pdf.to_string_lossy().into_owned()).expect("debe leerse");
        assert_eq!(url, "data:application/pdf;base64,TWFu");

        std::fs::write(dir.join("a.PDF"), b"Ma").expect("write pdf mayúsculas");
        assert_eq!(
            read_vault_pdf(dir.join("a.PDF").to_string_lossy().into_owned()).expect("PDF"),
            "data:application/pdf;base64,TWE="
        );

        std::fs::write(dir.join("d.txt"), b"Man").expect("write txt");
        let err = read_vault_pdf(dir.join("d.txt").to_string_lossy().into_owned())
            .expect_err("no es pdf");
        assert!(err.contains("solo PDF"), "mensaje = {err}");

        let err = read_vault_pdf(dir.join("no-existe.pdf").to_string_lossy().into_owned())
            .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_vault_image_rechaza_archivos_gigantes() {
        let dir = temp_vault("img-big");
        let big = dir.join("gigante.png");

        let file = std::fs::File::create(&big).expect("create");
        file.set_len(31 * 1024 * 1024).expect("set_len");
        drop(file);

        let err =
            read_vault_image(big.to_string_lossy().into_owned()).expect_err("demasiado grande");
        assert!(err.contains("30 MB"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn crud_de_archivos_tambien_funciona_en_imagenes() {
        let dir = temp_vault("crud-img-entry");
        let img = dir.join("foto.png");
        std::fs::write(&img, b"x").expect("write png");

        let renamed = rename_vault_file(
            img.to_string_lossy().into_owned(),
            dir.join("playa.png").to_string_lossy().into_owned(),
        )
        .expect("debe renombrarse");
        assert!(renamed.ends_with("playa.png"), "ruta = {renamed}");
        assert!(std::path::Path::new(&renamed).is_file());

        let sub = dir.join("viajes");
        std::fs::create_dir(&sub).expect("mkdir");
        let moved = move_vault_file(renamed, sub.to_string_lossy().into_owned())
            .expect("debe moverse");
        assert!(std::path::Path::new(&moved).is_file());

        delete_vault_file(moved.clone()).expect("debe borrarse");
        assert!(!std::path::Path::new(&moved).exists());

        let csv = dir.join("datos.csv");
        std::fs::write(&csv, "a,b").expect("write csv");
        let err = delete_vault_file(csv.to_string_lossy().into_owned()).expect_err("csv");
        assert!(err.contains(".md"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn app_config_roundtrip_y_default() {
        let dir = temp_vault("app-config");
        let path = dir.join("config.json");

        assert_eq!(load_config_from(&path), AppConfig::default());

        let config = AppConfig {
            base_dir: Some("~/Documents/gus-vaults".into()),
            vaults: vec![
                VaultInfo {
                    name: "Diario".into(),
                    path: "~/Documents/gus-vaults/Diario".into(),
                    cover: None,
                },
                VaultInfo {
                    name: "Trabajo".into(),
                    path: "~/Documents/gus-vaults/Trabajo".into(),
                    cover: Some("~/Pictures/trabajo.png".into()),
                },
            ],
            last_vault: Some("~/Documents/gus-vaults/Diario".into()),
            settings: AppSettings::default(),
        };

        save_config_to(&path, &config).expect("debe guardarse");
        assert_eq!(load_config_from(&path), config);

        let raw = std::fs::read_to_string(&path).expect("raw");
        assert!(raw.contains("baseDir"), "raw = {raw}");
        assert!(raw.contains("lastVault"), "raw = {raw}");

        std::fs::write(&path, "no-es-json{{").expect("corrupt");
        assert_eq!(load_config_from(&path), AppConfig::default());

        assert!(
            default_vaults_base().ends_with("Documents/gus-vaults"),
            "base = {}",
            default_vaults_base()
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn app_settings_se_normalizan_al_cargar() {
        let dir = temp_vault("app-settings");
        let path = dir.join("config.json");

        std::fs::write(
            &path,
            r#"{"baseDir":"~/vaults","vaults":[],"lastVault":null}"#,
        )
        .expect("raw");
        let legacy = load_config_from(&path);
        assert_eq!(legacy.settings, AppSettings::default());
        assert!(legacy.settings.open_last_vault);
        assert!(legacy.settings.animations);
        assert_eq!(legacy.settings.accent, "terracota");
        assert_eq!(legacy.settings.editor_font_size, 14);
        assert_eq!(legacy.settings.spell_lang, "es");
        assert!(legacy.settings.spell_words.is_empty());

        let custom = AppConfig {
            settings: AppSettings {
                open_last_vault: false,
                animations: false,
                accent: "menta".into(),
                editor_font_size: 18,
                auto_save: false,
                hide_completed_tasks: true,
                spell_lang: "de".into(),
                spell_words: vec!["Gus".into(), "Tauri".into()],
                ..AppSettings::default()
            },
            ..AppConfig::default()
        };
        save_config_to(&path, &custom).expect("guarda");
        assert_eq!(load_config_from(&path), custom);

        std::fs::write(
            &path,
            r#"{
              "baseDir": null,
              "vaults": [],
              "lastVault": null,
              "settings": { "accent": "neon", "editorFontSize": 240, "spellLang": "xx",
                             "spellWords": ["  Gus  ", "", "Gus", "Tauri"] }
            }"#,
        )
        .expect("raw");
        let saned = load_config_from(&path);
        assert_eq!(saned.settings.accent, "terracota");
        assert_eq!(saned.settings.editor_font_size, 22);
        assert_eq!(saned.settings.spell_lang, "es");
        assert_eq!(saned.settings.spell_words, vec!["Gus", "Tauri"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn task_store_es_un_json_oculto_y_persiste_tareas() {
        let dir = temp_vault("task-store");

        assert_eq!(
            load_tasks(dir.to_string_lossy().into_owned()).expect("load inicial"),
            Vec::<StoredTask>::new()
        );

        let tasks = vec![StoredTask {
            id: "task-1".into(),
            title: "Comprar pan".into(),
            tags: vec!["casa".into()],
            completes: false,
            description: Some("Antes de las ocho".into()),
            due: Some("2026-09-30".into()),
            priority: None,
            doing: false,
        }];

        save_tasks(dir.to_string_lossy().into_owned(), tasks.clone()).expect("debe guardarse");
        assert_eq!(
            load_tasks(dir.to_string_lossy().into_owned()).expect("debe recargarse"),
            tasks
        );

        let path = dir.join(TASK_STORE_FILE);
        assert!(path.is_file(), "el almacén debe ser {TASK_STORE_FILE}");
        let raw = std::fs::read_to_string(&path).expect("raw");
        assert!(raw.contains("\"version\": 1"), "raw = {raw}");
        assert!(raw.contains("\"completes\": false"), "raw = {raw}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migracion_lee_y_archiva_tareas_markdown() {
        let dir = temp_vault("task-migrate");

        assert!(
            !read_legacy_tasks(dir.to_string_lossy().into_owned())
                .expect("legacy inicial")
                .is_some()
        );
        assert!(!archive_legacy_tasks(dir.to_string_lossy().into_owned())
            .expect("archive sin origen"));

        let legacy = dir.join(LEGACY_TASKS_FILE);
        std::fs::write(&legacy, "- [ ] Llamar al doctor 2026-10-01\n").expect("legacy");
        let markdown =
            read_legacy_tasks(dir.to_string_lossy().into_owned()).expect("legacy leído");
        assert!(markdown.expect("contiene tareas").contains("Llamar"));

        assert!(archive_legacy_tasks(dir.to_string_lossy().into_owned()).expect("archivado"));
        assert!(!legacy.exists());
        let archived = dir.join(".gus-tasks.md.bak");
        assert!(archived.is_file(), "respaldo oculto = {}", archived.display());

        assert!(!archive_legacy_tasks(dir.to_string_lossy().into_owned())
            .expect("ya archivado"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_vault_crea_dir_y_bienvenida_sin_pisar() {
        let base = temp_vault("vault-create");

        let created = create_vault(
            base.to_string_lossy().into_owned(),
            "Diario".into(),
        )
        .expect("debe crearse");
        assert!(std::path::Path::new(&created).is_dir());
        assert!(created.ends_with("Diario"));

        let welcome = std::fs::read_to_string(std::path::Path::new(&created).join("Bienvenido.md"))
            .expect("nota de bienvenida");
        assert!(welcome.contains("# Bienvenido"), "welcome = {welcome}");
        assert!(welcome.contains("- [ ]"), "welcome = {welcome}");

        let deep = base.join("otra-base");
        let created = create_vault(
            deep.to_string_lossy().into_owned(),
            "Anidado".into(),
        )
        .expect("debe crearse con base nueva");
        assert!(std::path::Path::new(&created).is_dir());

        let err = create_vault(base.to_string_lossy().into_owned(), "Diario".into())
            .expect_err("ya existe");
        assert!(err.contains("Ya existe"), "mensaje = {err}");

        let err = create_vault(base.to_string_lossy().into_owned(), "   ".into())
            .expect_err("vacío");
        assert!(err.contains("nombre"), "mensaje = {err}");
        assert!(create_vault(base.to_string_lossy().into_owned(), "a/b".into()).is_err());
        assert!(create_vault(base.to_string_lossy().into_owned(), "..".into()).is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn vault_dir_exists_detecta_solo_carpetas() {
        let dir = temp_vault("vault-exists");

        assert!(vault_dir_exists(dir.to_string_lossy().into_owned()));

        let file = dir.join("nota.md");
        std::fs::write(&file, "").expect("write");
        assert!(!vault_dir_exists(file.to_string_lossy().into_owned()), "un archivo no cuenta");

        assert!(!vault_dir_exists(dir.join("fantasma").to_string_lossy().into_owned()));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nueva_tarea_se_valida_y_normaliza() {
        let err = validate_new_task(NewTask {
            title: "   ".into(),
            description: None,
            tags: vec![],
            due: None,
            priority: None,
        })
        .expect_err("sin nombre");
        assert!(err.contains("nombre"), "mensaje = {err}");

        let task = validate_new_task(NewTask {
            title: "  Comprar pan  ".into(),
            description: Some("  ".into()),
            tags: vec!["casa".into()],
            due: Some(String::new()),
            priority: None,
        })
        .expect("debe ser válida");
        assert_eq!(task.title, "Comprar pan");
        assert_eq!(task.description, None);
        assert_eq!(task.due, None);
        assert_eq!(task.tags, ["casa"]);
        assert_eq!(task.priority, None);

        let task = validate_new_task(NewTask {
            title: "X".into(),
            description: Some("Detalle.".into()),
            tags: vec![],
            due: Some("2026-10-15".into()),
            priority: Some(TaskPriority::Alta),
        })
        .expect("fecha correcta");
        assert_eq!(task.due.as_deref(), Some("2026-10-15"));
        assert_eq!(task.description.as_deref(), Some("Detalle."));
        assert_eq!(task.priority, Some(TaskPriority::Alta));

        let err = validate_new_task(NewTask {
            title: "X".into(),
            description: None,
            tags: vec![],
            due: Some("15/10/2026".into()),
            priority: None,
        })
        .expect_err("formato raro");
        assert!(err.contains("Fecha"), "mensaje = {err}");
    }

    #[test]
    fn nueva_tarea_desde_json_tolera_campos_ausentes() {
        let task: NewTask = serde_json::from_str(r#"{"title":"Solo nombre"}"#).expect("json");
        assert_eq!(task.title, "Solo nombre");
        assert_eq!(task.description, None);
        assert!(task.tags.is_empty());
        assert_eq!(task.due, None);
        assert_eq!(task.priority, None);
    }

    #[test]
    fn task_store_lee_prioridad_sin_cambiar_los_archivos_antiguos() {
        let dir = temp_vault("task-priority");

        std::fs::write(
            dir.join(TASK_STORE_FILE),
            r#"{"version":1,"tasks":[{"id":"t1","title":"Tarea antigua"}]}"#,
        )
        .expect("raw antiguo");
        let legacy = load_tasks(dir.to_string_lossy().into_owned()).expect("load antiguo");
        assert_eq!(legacy.len(), 1);
        assert_eq!(legacy[0].priority, None);
        assert!(!legacy[0].doing);

        let tasks = vec![StoredTask {
            id: "t2".into(),
            title: "Enviar el informe".into(),
            tags: vec!["trabajo".into()],
            completes: false,
            description: None,
            due: None,
            priority: Some(TaskPriority::Urgente),
            doing: true,
        }];
        save_tasks(dir.to_string_lossy().into_owned(), tasks.clone()).expect("save");
        assert_eq!(
            load_tasks(dir.to_string_lossy().into_owned()).expect("reload"),
            tasks
        );

        let raw = std::fs::read_to_string(dir.join(TASK_STORE_FILE)).expect("raw");
        assert!(raw.contains("\"priority\": \"urgente\""), "raw = {raw}");
        assert!(raw.contains("\"doing\": true"), "raw = {raw}");

        std::fs::write(
            dir.join(TASK_STORE_FILE),
            r#"{"version":1,"tasks":[{"id":"t3","title":"Sin bandera","tags":[],"completes":false,"priority":null,"doing":false}]}"#,
        )
        .expect("raw con null");
        let tasks = load_tasks(dir.to_string_lossy().into_owned()).expect("load con null");
        assert_eq!(tasks[0].priority, None);

        std::fs::write(
            dir.join(TASK_STORE_FILE),
            r#"{"version":1,"tasks":[{"id":"t4","title":"Rara","priority":"media-alta"}]}"#,
        )
        .expect("raw rara");
        let err = load_tasks(dir.to_string_lossy().into_owned())
            .expect_err("prioridad desconocida");
        assert!(err.contains("unknown variant"), "mensaje = {err}");
        assert!(err.contains("urgente"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}
