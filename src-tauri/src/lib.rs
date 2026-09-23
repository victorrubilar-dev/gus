use serde::Serialize;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Solo se leen/escriben archivos `.md`.
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

/// ¿Termina la ruta en extensión `.md`? (case-insensitive)
fn is_md_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

/// MIME de las extensiones de imagen soportadas (`None` si no es imagen).
fn image_mime(path: &std::path::Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();

    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// ¿Es un archivo de imagen que la app puede listar y mostrar?
fn is_image_file(path: &std::path::Path) -> bool {
    image_mime(path).is_some()
}

/// Codifica bytes en Base64 estándar (con relleno `=`).
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

/// Crea el directorio (y sus padres) si todavía no existe.
fn ensure_dir_exists(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path)
            .map_err(|err| format!("No se pudo crear el directorio «{}»: {err}", path.display()))?;
    }
    Ok(())
}

/// Última modificación en ms desde el epoch (`None` si no está disponible).
fn metadata_modified_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
}

/// Devuelve `wanted`, o una variante `nombre-2`, `nombre-3`… si ya existe.
/// Nunca sobrescribe un archivo o carpeta existente.
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

/// Lee el contenido completo de un archivo `.md`.
#[tauri::command]
fn read_vault_file(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    std::fs::read_to_string(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))
}

/// Escribe el contenido en un archivo `.md` (lo crea si no existe).
/// El directorio padre también se crea si falta (`fs::create_dir_all`).
#[tauri::command]
fn write_vault_file(path: String, content: String) -> Result<(), String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    // Asegura que el directorio padre exista antes de escribir.
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

/// Solo se manipulan (renombrar/mover/borrar) `.md` e imágenes.
fn ensure_entry(path: &str) -> Result<(), String> {
    let path_ref = std::path::Path::new(path);

    if is_md_file(path_ref) || is_image_file(path_ref) {
        Ok(())
    } else {
        Err(format!(
            "Solo se permiten archivos .md o imágenes: «{path}»"
        ))
    }
}

/// Renombra/mueve un archivo `.md` o una imagen y devuelve la ruta final.
///
/// No pisa destinos existentes y crea el directorio padre si falta.
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

// ------------------------------------------------------------------
// CRUD de archivos .md y carpetas del vault
// ------------------------------------------------------------------

/// Entrada de un directorio del vault: una carpeta o un archivo `.md`.
#[derive(Debug, Clone, Serialize)]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub modified_ms: Option<u64>,
}

/// Carpeta disponible como destino al mover archivos.
#[derive(Debug, Clone, Serialize)]
pub struct VaultDir {
    pub path: String,
    /// Ruta relativa a la raíz del vault, con `/` como separador.
    pub relative: String,
}

/// Lista el contenido de `path`: carpetas primero y después los `.md` e
/// imágenes (PNG/JPEG/GIF/WebP/SVG/BMP/AVIF), todos ordenados por nombre
/// (ignorando mayúsculas). Oculta lo que empieza por `.` (`.git`, `.obsidian`…).
/// Si la carpeta no existe, se crea.
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
        if !is_dir && !is_md_file(&entry_path) && !is_image_file(&entry_path) {
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

/// Crea el archivo `.md` `path` con `content`.
/// Si ya existe, crea una variante `nombre-2.md` (nunca sobrescribe) y
/// devuelve la ruta final. Crea el directorio padre si falta.
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

/// Crea la carpeta `path` (con todos sus padres).
/// Si ya existe, devuelve una variante `nombre-2` en lugar de fallar.
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

/// Elimina el archivo `.md` o la imagen `path`.
#[tauri::command]
fn delete_vault_file(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    ensure_entry(&path)?;

    if !std::path::Path::new(&path).exists() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    std::fs::remove_file(&path).map_err(|err| format!("No se pudo eliminar «{path}»: {err}"))
}

/// Renombra la carpeta `from` a `to` (mismo directorio padre).
/// No sobrescribe: si `to` ya existe, devuelve error.
#[tauri::command]
fn rename_vault_dir(from: String, to: String) -> Result<String, String> {
    let from = expand_home(&from);
    let to = expand_home(&to);

    let source = std::path::Path::new(&from);
    if !source.is_dir() {
        return Err(format!("No existe la carpeta «{from}»"));
    }

    let destination = std::path::Path::new(&to);
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

/// Elimina la carpeta `path` y TODO su contenido
/// (el frontend pide confirmación explícita antes de llamar a esto).
#[tauri::command]
fn delete_vault_dir(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    let target = std::path::Path::new(&path);

    if !target.is_dir() {
        return Err(format!("No existe la carpeta «{path}»"));
    }

    // Guardas: jamás una raíz del sistema ("/", "C:\", …).
    let Some(parent) = target.parent() else {
        return Err(format!("No se puede eliminar la raíz «{path}»"));
    };
    if parent.as_os_str().is_empty() && target.is_absolute() {
        return Err(format!("No se puede eliminar la raíz «{path}»"));
    }

    std::fs::remove_dir_all(target)
        .map_err(|err| format!("No se pudo eliminar la carpeta «{path}»: {err}"))
}

/// Lee una imagen del vault y la devuelve como data URL
/// (`data:image/png;base64,…`) para que el webview la muestre sin acceso
/// directo al disco. Rechaza formatos no soportados y archivos de +30 MB.
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

/// Mueve el archivo `.md` o la imagen `from` dentro de la carpeta `to_dir`
/// (que debe existir) y devuelve la ruta final.
/// Si el nombre ya está ocupado, usa una variante `nombre-2.<ext>`.
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

    // Mover a la misma carpeta es un no-op.
    if destination.as_path() == source {
        return Ok(from);
    }

    let target = unique_path(&destination)?;
    std::fs::rename(source, &target).map_err(|err| {
        format!("No se pudo mover «{from}» → «{}»: {err}", target.display())
    })?;

    Ok(target.to_string_lossy().into_owned())
}

/// Lista recursivamente las carpetas bajo `path` (máx. 8 niveles, ocultas
/// excluidas) para usarlas como destino al mover archivos.
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

/// Un archivo `.md` encontrado en el vault.
#[derive(Debug, Clone, Serialize)]
pub struct FileItem {
    /// Identificador único: la ruta completa del archivo.
    pub id: String,
    /// Nombre del archivo, p. ej. `notas.md`.
    pub name: String,
    /// Ruta completa del archivo.
    pub path: String,
    /// Tamaño en bytes.
    pub size: u64,
    /// Última modificación en milisegundos desde el epoch (`None` si no está disponible).
    pub modified_ms: Option<u64>,
}

/// Un archivo `.md` del vault: su nombre y su fecha de modificación.
#[derive(Debug, Clone, Serialize)]
pub struct VaultFile {
    /// Nombre del archivo, p. ej. `notas.md`.
    pub name: String,
    /// Ruta completa del archivo (sirve de id en el frontend).
    pub path: String,
    /// Última modificación en milisegundos desde el epoch (`None` si no está disponible).
    pub modified_ms: Option<u64>,
}

/// Directorio home del usuario (`HOME` en unix, `USERPROFILE` en Windows).
fn home_dir() -> Option<String> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(key).ok().filter(|value| !value.is_empty())
}

/// Expande `~` y `~/resto` al home del usuario; el resto de rutas va tal cual.
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

/// Lee `path` con `std::fs` y devuelve los archivos `.md` de ese directorio,
/// ordenados por nombre (ignorando mayúsculas/minúsculas).
///
/// Si la carpeta no existe, se crea automáticamente con `fs::create_dir_all`.
/// No es recursivo: solo los archivos directos del directorio.
/// Los directorios, otros tipos de archivo y las entradas ilegibles se omiten.
#[tauri::command]
fn read_vault_dir(path: String) -> Result<Vec<FileItem>, String> {
    let path = expand_home(&path);

    // Si el vault no existe, se crea antes de listar su contenido.
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

        // `fs::metadata` sigue los symlinks, así que un `.md` enlazado también cuenta.
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

/// Devuelve los archivos `.md` del directorio `path` con su nombre y su fecha
/// de modificación. Usa [`read_vault_dir`] internamente (mismo filtrado y orden).
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_vault_dir,
            get_vault_files,
            read_vault_file,
            write_vault_file,
            rename_vault_file,
            list_vault_entries,
            list_vault_dirs,
            create_vault_file,
            create_vault_dir,
            delete_vault_file,
            delete_vault_dir,
            rename_vault_dir,
            move_vault_file,
            read_vault_image
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

        // La carpeta inexistente se crea automáticamente y se lista vacía.
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
    fn read_vault_dir_creates_missing_folders() {
        let base = temp_vault("vault-missing");
        let nested = base.join("carpeta").join("profunda");

        // Crea la cadena completa de carpetas y devuelve una lista vacía.
        let items = read_vault_dir(nested.to_string_lossy().into_owned()).expect("create nested");
        assert!(items.is_empty());
        assert!(nested.is_dir());

        // `get_vault_files` hereda ese comportamiento.
        let from_files = get_vault_files(nested.to_string_lossy().into_owned()).expect("list nested");
        assert!(from_files.is_empty());

        // Si la ruta apunta a un archivo, listar sigue fallando.
        let file = base.join("nota.md");
        std::fs::write(&file, "# x").expect("write file");
        assert!(read_vault_dir(file.to_string_lossy().into_owned()).is_err());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn write_vault_file_creates_missing_subdirs() {
        let base = temp_vault("vault-write-subdir");
        // El subdirectorio NO existe todavía.
        let note = base.join("proyectos").join("gus").join("idea.md");
        assert!(!note.parent().expect("parent").exists());

        let path = note.to_string_lossy().into_owned();
        let content = "# Idea\n\n- [ ] probarla #dev\n";

        write_vault_file(path.clone(), content.to_string()).expect("write into missing subdir");
        assert!(note.is_file());
        assert!(note.parent().expect("parent").is_dir());

        // El contenido se puede leer de vuelta con normalidad.
        assert_eq!(read_vault_file(path).expect("read back"), content);

        // Seguir escribiendo en el mismo subdirectorio ya creado sigue funcionando.
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

        // El destino está en un subdirectorio inexistente: se crea solo.
        let to = base.join("archivo").join("final.md");
        let to_path = to.to_string_lossy().into_owned();
        let renamed =
            rename_vault_file(from.to_string_lossy().into_owned(), to_path.clone()).expect("rename");

        assert_eq!(renamed, to_path);
        assert!(!from.exists());
        assert!(to.is_file());
        assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

        // No pisa un archivo existente en el destino.
        let other = base.join("otro.md");
        write_vault_file(other.to_string_lossy().into_owned(), "# Otro\n".into()).expect("write");
        assert!(rename_vault_file(other.to_string_lossy().into_owned(), to_path.clone()).is_err());
        assert_eq!(read_vault_file(to_path.clone()).expect("read"), "# Borrador\n");

        // Solo archivos .md.
        let txt = base.join("nota.txt").to_string_lossy().into_owned();
        std::fs::write(&txt, "x").expect("write txt");
        assert!(rename_vault_file(txt, base.join("ok.md").to_string_lossy().into_owned()).is_err());

        // Mismo origen y destino: no-op.
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

        // Solo .md: se rechazan otros formatos antes de tocar el disco.
        let txt = dir.join("no.md.txt").to_string_lossy().into_owned();
        assert!(read_vault_file(txt.clone()).is_err());
        assert!(write_vault_file(txt, "x".into()).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------------------
    // CRUD de archivos .md y carpetas
    // ------------------------------------------------------------------

    #[test]
    fn create_vault_file_escribe_y_no_sobrescribe() {
        let dir = temp_vault("crud-create-file");
        let path = dir.join("nota.md").to_string_lossy().into_owned();

        let created = create_vault_file(path.clone(), "# Hola".into()).expect("debe crearse");
        assert_eq!(created, path);
        assert_eq!(std::fs::read_to_string(&created).expect("read"), "# Hola");

        // Un nombre ocupado no se pisa: se crea "nota-2.md".
        let other = create_vault_file(path.clone(), "# Otra".into()).expect("debe crearse");
        assert_ne!(other, path);
        assert!(other.ends_with("nota-2.md"), "ruta = {other}");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "# Hola");

        // Crea el directorio padre si falta.
        let nested = dir.join("apuntes/mates/funciones.md").to_string_lossy().into_owned();
        let created = create_vault_file(nested.clone(), String::new()).expect("debe crearse");
        assert_eq!(created, nested);
        assert!(std::path::Path::new(&created).is_file());

        // Solo .md.
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

        // Si hay un *archivo* con ese nombre, se avisa en lugar de renombrar.
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

        // Solo .md.
        let log = dir.join("fuga.log").to_string_lossy().into_owned();
        let err =
            delete_vault_file(log).expect_err("la extensión .log debe rechazarse");
        assert!(err.contains(".md"), "mensaje = {err}");

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

        // Si el destino ya está ocupado, se numera en lugar de pisar.
        std::fs::write(&origen, "2").expect("write");
        let moved_again = move_vault_file(origen.clone(), destino.clone()).expect("debe moverse");
        assert!(moved_again.ends_with("vieja-2.md"), "ruta = {moved_again}");
        assert_eq!(std::fs::read_to_string(&moved).expect("read"), "contenido");

        // A la misma carpeta: no-op (no se renumera).
        let before = moved.clone();
        let moved = move_vault_file(moved, destino.clone()).expect("no debe fallar");
        assert_eq!(moved, before, "mover a la misma carpeta no debe cambiar la ruta");
        assert!(std::path::Path::new(&moved_again).exists());

        // El destino debe existir.
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
        std::fs::write(dir.join("imagen.png"), [1, 2, 3]).expect("write png"); // imagen → SÍ entra
        std::fs::write(dir.join("datos.txt"), "x").expect("write txt"); // otro formato → fuera
        std::fs::write(dir.join(".oculta.md"), "").expect("write oculta"); // oculta → fuera
        std::fs::create_dir(dir.join("zz-carpeta")).expect("mkdir");
        std::fs::create_dir(dir.join(".git")).expect("mkdir"); // oculta → fuera

        let entries = list_vault_entries(dir.to_string_lossy().into_owned())
            .expect("debe listarse");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["zz-carpeta", "a-nota.md", "b-nota.md", "imagen.png"]);
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);
        assert!(entries[1].modified_ms.is_some());

        // La carpeta inexistente se crea automáticamente y se lista vacía.
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
        std::fs::create_dir(dir.join(".oculta")).expect("mkdir"); // oculta → fuera
        std::fs::write(dir.join("archivo.md"), "").expect("write"); // archivos → fuera

        let dirs = list_vault_dirs(dir.to_string_lossy().into_owned()).expect("debe listarse");
        let relatives: Vec<&str> = dirs.iter().map(|entry| entry.relative.as_str()).collect();
        assert_eq!(relatives, ["personal", "trabajo", "trabajo/urgente"]);

        // La raíz no existe → error.
        let missing = dir.join("no-existe").to_string_lossy().into_owned();
        assert!(list_vault_dirs(missing).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------------------
    // Carpetas: renombrar / eliminar
    // ------------------------------------------------------------------

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

        // Destino ocupado → error (nunca sobrescribe).
        std::fs::create_dir(dir.join("ocupada")).expect("mkdir");
        std::fs::create_dir(dir.join("tambien")).expect("mkdir");
        let err = rename_vault_dir(
            dir.join("tambien").to_string_lossy().into_owned(),
            dir.join("ocupada").to_string_lossy().into_owned(),
        )
        .expect_err("el destino ya existe");
        assert!(err.contains("Ya existe"), "mensaje = {err}");

        // Origen inexistente → error.
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

        // Inexistente → error.
        let err =
            delete_vault_dir(dir.join("no-existe").to_string_lossy().into_owned())
                .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        // Un archivo no es una carpeta.
        let file = dir.join("archivo.md");
        std::fs::write(&file, "").expect("write file");
        let err = delete_vault_dir(file.to_string_lossy().into_owned()).expect_err("es un archivo");
        assert!(err.contains("No existe"), "mensaje = {err}");

        // Jamás la raíz del sistema (la guarda salta antes de tocar nada).
        assert!(delete_vault_dir("/".to_string()).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    // ------------------------------------------------------------------
    // Imágenes: data URL + base64
    // ------------------------------------------------------------------

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

        // Otras extensiones soportadas con su MIME.
        std::fs::write(dir.join("a.JPG"), b"Ma").expect("write jpg");
        assert_eq!(
            read_vault_image(dir.join("a.JPG").to_string_lossy().into_owned()).expect("jpg"),
            "data:image/jpeg;base64,TWE="
        );

        // Formatos que no son imagen → rechazados.
        std::fs::write(dir.join("d.txt"), b"Man").expect("write txt");
        let err = read_vault_image(dir.join("d.txt").to_string_lossy().into_owned())
            .expect_err("no es imagen");
        assert!(err.contains("solo imágenes"), "mensaje = {err}");

        // Inexistente → error.
        let err = read_vault_image(dir.join("no-existe.png").to_string_lossy().into_owned())
            .expect_err("no existe");
        assert!(err.contains("No existe"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_vault_image_rechaza_archivos_gigantes() {
        let dir = temp_vault("img-big");
        let big = dir.join("gigante.png");

        // Archivo disperso de 31 MB: no escribe datos, solo ocupa el tamaño.
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

        // Renombrar (el destino lo arma el frontend conservando la extensión).
        let renamed = rename_vault_file(
            img.to_string_lossy().into_owned(),
            dir.join("playa.png").to_string_lossy().into_owned(),
        )
        .expect("debe renombrarse");
        assert!(renamed.ends_with("playa.png"), "ruta = {renamed}");
        assert!(std::path::Path::new(&renamed).is_file());

        // Mover a una subcarpeta.
        let sub = dir.join("viajes");
        std::fs::create_dir(&sub).expect("mkdir");
        let moved = move_vault_file(renamed, sub.to_string_lossy().into_owned())
            .expect("debe moverse");
        assert!(std::path::Path::new(&moved).is_file());

        // Borrar.
        delete_vault_file(moved.clone()).expect("debe borrarse");
        assert!(!std::path::Path::new(&moved).exists());

        // Extensiones que no son imagen siguen rechazadas.
        let csv = dir.join("datos.csv");
        std::fs::write(&csv, "a,b").expect("write csv");
        let err = delete_vault_file(csv.to_string_lossy().into_owned()).expect_err("csv");
        assert!(err.contains(".md"), "mensaje = {err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}
