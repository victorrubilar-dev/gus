//! Operaciones de escritura sobre el vault: crear, leer, renombrar, mover y borrar notas, carpetas y ficheros.

use super::*;

pub(crate) fn ensure_md(path: &str) -> Result<(), String> {
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

#[tauri::command]
pub(crate) fn read_vault_file(path: String) -> Result<String, String> {
    let path = expand_home(&path);
    ensure_md(&path)?;

    std::fs::read_to_string(&path).map_err(|err| format!("No se pudo leer «{path}»: {err}"))
}

#[tauri::command]
pub(crate) fn write_vault_file(path: String, content: String) -> Result<(), String> {
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

    vigilancia::note_own_write(std::path::Path::new(&path));
    std::fs::write(&path, content).map_err(|err| format!("No se pudo escribir «{path}»: {err}"))
}

/// Filtro de `rename_vault_file`, `move_vault_file` y `delete_vault_file`: solo
/// tipos que el explorador sabe mostrar. La papelera (`move_to_trash`) NO usa
/// este filtro, porque tirar un archivo no depende de que lo sepan abrir.
pub(crate) fn ensure_entry(path: &str) -> Result<(), String> {
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
pub(crate) fn rename_vault_file(from: String, to: String) -> Result<String, String> {
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

#[tauri::command]
pub(crate) fn create_vault_file(path: String, content: String) -> Result<String, String> {
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
pub(crate) fn create_vault_dir(path: String) -> Result<String, String> {
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
pub(crate) fn delete_vault_file(path: String) -> Result<(), String> {
    let path = expand_home(&path);
    ensure_entry(&path)?;

    if !std::path::Path::new(&path).exists() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    std::fs::remove_file(&path).map_err(|err| format!("No se pudo eliminar «{path}»: {err}"))
}

#[tauri::command]
pub(crate) fn rename_vault_dir(from: String, to: String) -> Result<String, String> {
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
pub(crate) fn delete_vault_dir(path: String) -> Result<(), String> {
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
pub(crate) fn move_vault_file(from: String, to_dir: String) -> Result<String, String> {
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
