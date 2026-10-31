//! Grafo de enlaces del vault: `[[wiki]]` entre notas y sus backlinks.

use super::*;

/* ------------------------------------------------------------------ */

/// Un enlace saliente de una nota, contado cuántas veces aparece en ella.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLink {
    pub target: String,
    pub count: usize,
}

/// Una nota del vault con sus enlaces salientes y sus etiquetas.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkNode {
    pub name: String,
    pub path: String,
    pub relative: String,
    pub modified_ms: Option<u64>,
    pub tags: Vec<String>,
    pub links: Vec<NoteLink>,
}

/// Relaciones de todo el vault: con esto el frontend dibuja backlinks y grafo.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraph {
    pub nodes: Vec<LinkNode>,
    pub generated_ms: u64,
}

/// ¿La línea es un cercado de código (apertura con idioma o cierre)? Devuelve
/// el carácter y cuántas veces se repite: ``` y ~~~ son los del Markdown.
pub(crate) fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let mut chars = trimmed.chars();
    let first = chars.next()?;
    if first != '`' && first != '~' {
        return None;
    }

    let length = 1 + chars.clone().take_while(|char| *char == first).count();
    if length < 3 {
        return None;
    }

    // Tras los cercados solo puede haber espacio o el idioma del bloque:
    // «```rust» abre, pero «``` ```» con la marca repetida no dice nada.
    let rest = trimmed[first.len_utf8() * length..].trim();
    (!rest.contains(first)).then_some((first, length))
}

/// ¿Cierra el bloque abierto? Un cierre puede ser más largo que su apertura
/// (```` cierra ```), nunca más corto, y no lleva idioma detrás.
pub(crate) fn is_closing_fence(line: &str, marker: char, length: usize) -> bool {
    let trimmed = line.trim_start();
    let count = trimmed.chars().take_while(|char| *char == marker).count();
    count >= length && trimmed[marker.len_utf8() * count..].trim().is_empty()
}

/// Quita lo que haya dentro de comillas invertidas: `[[así]]` escrito ahí no
/// es un enlace, es código de ejemplo.
pub(crate) fn strip_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut inside = false;

    for char in line.chars() {
        if char == '`' {
            inside = !inside;
            continue;
        }
        if !inside {
            out.push(char);
        }
    }

    out
}

/// Enlaces `[[destino]]` o `[[destino|etiqueta]]` de un texto, en orden.
pub(crate) fn scan_wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor = 0usize;

    while let Some(open) = text[cursor..].find("[[") {
        let start = cursor + open + 2;
        let Some(close) = text[start..].find("]]") else {
            break;
        };

        let raw = &text[start..start + close];
        // Un «[[» dentro del enlace lo arruina: se reinicia justo después.
        if raw.contains("[[") {
            cursor = start + 2;
            continue;
        }

        let target = raw.split('|').next().unwrap_or(raw).trim();
        if !target.is_empty() && !target.chars().any(char::is_control) {
            out.push(target.to_string());
        }

        cursor = start + close + 2;
    }

    out
}

/// Enlaces `[[wiki]]` de una nota completa, ignorando bloques de código y
/// comillas invertidas. El objetivo es el texto de dentro, sin la etiqueta.
pub(crate) fn extract_wiki_targets(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut fence: Option<(char, usize)> = None;

    for line in text.lines() {
        if let Some((marker, length)) = fence {
            if is_closing_fence(line, marker, length) {
                fence = None;
            }
            continue;
        }

        if let Some(opening) = fence_marker(line) {
            fence = Some(opening);
            continue;
        }

        out.extend(scan_wiki_links(&strip_inline_code(line)));
    }

    out
}

/// Enlaces de una nota agrupados por destino, contados y ordenados (los más
/// repetidos primero). El destino se guarda tal cual se escribió la primera
/// vez; la comparación va en minúsculas, que es como resuelve el frontend.
pub(crate) fn count_wiki_links(text: &str) -> Vec<NoteLink> {
    let mut counts: std::collections::HashMap<String, (String, usize)> =
        std::collections::HashMap::new();

    for target in extract_wiki_targets(text) {
        let key = target.to_lowercase();
        let slot = counts.entry(key).or_insert((target, 0));
        slot.1 += 1;
    }

    let mut links: Vec<NoteLink> = counts
        .into_values()
        .map(|(target, count)| NoteLink { target, count })
        .collect();

    links.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.target.to_lowercase().cmp(&b.target.to_lowercase()))
    });
    links
}

/**
 * Grafo de enlaces de todo el vault: cada nota con sus etiquetas y sus
 * enlaces salientes. El frontend resuelve a qué nota apunta cada destino
 * (igual que al pulsar un enlace) y de ahí salen backlinks y el grafo.
 */
#[tauri::command]
pub(crate) fn build_link_graph(path: String) -> Result<LinkGraph, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let mut notes = Vec::new();
    collect_notes(root, "", 0, &mut notes);
    notes.sort_by_key(|note| note.relative.to_lowercase());

    let mut nodes = Vec::with_capacity(notes.len());
    for note in notes {
        let Ok(content) = std::fs::read_to_string(&note.path) else {
            continue;
        };

        nodes.push(LinkNode {
            tags: frontmatter_tags(&content),
            links: count_wiki_links(&content),
            name: note.name,
            path: note.path,
            relative: note.relative,
            modified_ms: note.modified_ms,
        });
    }

    let generated_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);

    Ok(LinkGraph {
        nodes,
        generated_ms,
    })
}
