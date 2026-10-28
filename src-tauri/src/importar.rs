//! Importación de ficheros externos al vault (copiar, no mover; no pisa nada).

use super::*;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    /// Ruta original del archivo en el equipo.
    pub source: String,
    /// Dónde acabó dentro del vault (`None` si no se pudo añadir).
    pub path: Option<String>,
    /// Motivo del fallo o del «ya estaba ahí».
    pub error: Option<String>,
}

/// Lo mismo que muestra el explorador: `.md`, `.pdf` e imágenes.
pub(crate) fn is_importable(path: &std::path::Path) -> bool {
    is_md_file(path) || is_pdf_file(path) || is_image_file(path)
}

/**
 * Copia archivos del equipo al vault: es lo que usan el botón «Añadir archivos»
 * del explorador y el arrastre desde el gestor de archivos del sistema.
 *
 * Se copian, no se mueven: el original se queda donde estaba. Cada archivo se
 * juzga por separado, así que un lote mixto añade los que puede y explica el
 * resto en su `error`.
 */
#[tauri::command]
pub(crate) fn import_files_to_vault(
    sources: Vec<String>,
    dest_dir: String,
) -> Result<Vec<ImportItem>, String> {
    let dest = expand_home(&dest_dir);
    let dest_ref = std::path::Path::new(&dest);

    if dest_ref.exists() && !dest_ref.is_dir() {
        return Err(format!("«{dest}» no es una carpeta"));
    }
    ensure_dir_exists(dest_ref)?;

    Ok(sources
        .iter()
        .map(|source| import_file_into(source, dest_ref))
        .collect())
}

pub(crate) fn import_file_into(source: &str, dest: &std::path::Path) -> ImportItem {
    let source = expand_home(source);
    let src = std::path::Path::new(&source);

    let falla = |error: String| ImportItem {
        source: source.clone(),
        path: None,
        error: Some(error),
    };

    let nombre = src
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| source.clone());

    if src.is_dir() {
        return falla(format!(
            "«{nombre}» es una carpeta: añade sus archivos sueltos"
        ));
    }
    if !src.is_file() {
        return falla(format!("No existe el archivo «{source}»"));
    }
    if !is_importable(src) {
        return falla(format!("«{nombre}» no es .md, .pdf ni una imagen"));
    }

    // El markdown tiene que ser texto: con bytes que no son UTF-8 no se podría abrir.
    let md_bytes = if is_md_file(src) {
        match std::fs::read(src) {
            Ok(bytes) => {
                if std::str::from_utf8(&bytes).is_err() {
                    return falla(format!("«{nombre}» no es texto UTF-8 válido"));
                }
                Some(bytes)
            }
            Err(err) => return falla(format!("No se pudo leer «{source}»: {err}")),
        }
    } else {
        None
    };

    // Si el archivo ya está en la carpeta de destino no se copia encima de sí mismo.
    let candidato = dest.join(&nombre);
    let ya_esta_aqui = std::fs::canonicalize(src)
        .ok()
        .zip(std::fs::canonicalize(&candidato).ok())
        .is_some_and(|(original, copia)| original == copia);
    if ya_esta_aqui {
        return ImportItem {
            source,
            path: Some(candidato.to_string_lossy().into_owned()),
            error: Some("ya estaba en esta carpeta".to_string()),
        };
    }

    let target = match unique_path(&candidato) {
        Ok(target) => target,
        Err(err) => return falla(err),
    };

    let resultado = match md_bytes {
        Some(bytes) => std::fs::write(&target, bytes),
        None => std::fs::copy(src, &target).map(|_| ()),
    };
    if let Err(err) = resultado {
        let _ = std::fs::remove_file(&target);
        return falla(format!(
            "No se pudo añadir «{nombre}» a «{}»: {err}",
            dest.display()
        ));
    }

    ImportItem {
        source,
        path: Some(target.to_string_lossy().into_owned()),
        error: None,
    }
}
