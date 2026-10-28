//! Imágenes, miniaturas y PDF del vault: lectura como data URL y escritura de PDF exportados.

use super::*;

pub(crate) fn image_mime(path: &std::path::Path) -> Option<&'static str> {
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

pub(crate) fn is_image_file(path: &std::path::Path) -> bool {
    image_mime(path).is_some()
}

pub(crate) fn is_pdf_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
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

/// Descodifica Base64: es como viaja el PDF desde el navegador hasta aquí.
pub(crate) fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
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
pub(crate) fn write_pdf_file(path: String, data: String) -> Result<(), String> {
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

#[tauri::command]
pub(crate) fn read_vault_image(path: String) -> Result<String, String> {
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

/**
 * Miniatura de una imagen para el selector de imágenes: PNG de lado `max_px`
 * como máximo, para que cada fila del menú no cargue la foto entera. Los
 * formatos que el codificador no entiende (HEIC, JXL, SVG…) fallan aquí y la
 * fila se queda con su icono: la imagen sigue pudiéndose insertar igual.
 */
#[tauri::command]
pub(crate) fn read_vault_image_thumb(path: String, max_px: u32) -> Result<String, String> {
    let path = expand_home(&path);
    let archivo = std::path::Path::new(&path);

    if image_mime(archivo).is_none() {
        return Err(format!("Formato no soportado (solo imágenes): «{path}»"));
    }
    if !archivo.is_file() {
        return Err(format!("No existe el archivo «{path}»"));
    }

    const MAX_BYTES: u64 = 60 * 1024 * 1024;
    let metadata = std::fs::metadata(archivo)
        .map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!(
            "La imagen pesa {} MB y el límite son 60 MB",
            metadata.len() / (1024 * 1024)
        ));
    }

    let bytes =
        std::fs::read(archivo).map_err(|err| format!("No se pudo leer «{path}»: {err}"))?;
    let imagen = image::load_from_memory(&bytes)
        .map_err(|err| format!("No se pudo reducir «{path}»: {err}"))?;

    let lado = max_px.max(16);
    let miniatura = imagen.thumbnail(lado, lado);
    let mut png = Vec::new();
    miniatura
        .write_to(
            &mut std::io::Cursor::new(&mut png),
            image::ImageFormat::Png,
        )
        .map_err(|err| format!("No se pudo guardar la miniatura de «{path}»: {err}"))?;

    Ok(format!("data:image/png;base64,{}", base64_encode(&png)))
}

#[tauri::command]
pub(crate) fn read_vault_pdf(path: String) -> Result<String, String> {
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
