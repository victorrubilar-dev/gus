//! Búsqueda a texto completo: índice incremental en `.gus-index/` dentro de cada vault.

use super::*;

/* ------------------------------------------------------------------ */
/* Índice de búsqueda full-text                                        */
/*                                                                     */
/* El texto de las notas se copia a `.gus-index/index.json` dentro del */
/* vault, de modo que buscar no vuelve a leer cientos de archivos. El  */
/* archivo se guarda con la fecha de cada nota: al editar solo se      */
/* reescribe la entrada que cambió («actualización incremental»).      */
/* ------------------------------------------------------------------ */

/// Carpeta del índice. Empieza por punto, así que `collect_notes` la salta.
pub(crate) const INDEX_DIR: &str = ".gus-index";
/// Versión del esquema: si cambia, el índice guardado se ignora y se reconstruye.
pub(crate) const INDEX_VERSION: u32 = 1;
/// Tope de notas que entra en el índice (mismo techo que el grafo).
pub(crate) const MAX_INDEX_NOTES: usize = 1000;
/// Coincidencias que se devuelven como máximo en una búsqueda.
pub(crate) const MAX_SEARCH_RESULTS: usize = 100;
/// Líneas de fragmento por nota en los resultados.
pub(crate) const MAX_SNIPPETS_PER_NOTE: usize = 3;
/// Caracteres de contexto antes y después de una coincidencia larga.
pub(crate) const SNIPPET_BEFORE: usize = 60;
pub(crate) const SNIPPET_AFTER: usize = 200;

/// Una nota dentro del índice. `path` es la ruta relativa al vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub tags: Vec<String>,
    pub modified_ms: u64,
    pub text: String,
}

/// El índice entero, tal y como se guarda en disco.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndex {
    pub version: u32,
    pub generated_ms: u64,
    pub entries: Vec<IndexEntry>,
}

impl SearchIndex {
    fn empty() -> Self {
        Self {
            version: INDEX_VERSION,
            generated_ms: 0,
            entries: Vec::new(),
        }
    }
}

/// Lo que cuenta la reconstrucción del índice, para poder enseñarlo.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStats {
    pub notes: usize,
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    /// Entradas que no han tocado el disco porque el archivo no cambió.
    pub reused: usize,
    pub duration_ms: u64,
}

/// Filtros de la búsqueda. Todos opcionales: vacío = sin filtro.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchFilters {
    /// Carpeta relativa. Coincide también con sus subcarpetas.
    pub folder: String,
    /// La nota ha de tener todas estas etiquetas.
    pub tags: Vec<String>,
    pub modified_after_ms: Option<u64>,
    pub modified_before_ms: Option<u64>,
}

impl SearchFilters {
    fn allows(&self, entry: &IndexEntry) -> bool {
        if !self.folder.is_empty() {
            let wanted = self.folder.to_lowercase();
            let own = entry.folder.to_lowercase();
            if own != wanted && !own.starts_with(&format!("{wanted}/")) {
                return false;
            }
        }

        if !self.tags.is_empty() {
            let own: Vec<String> = entry.tags.iter().map(|tag| tag.to_lowercase()).collect();
            if !self
                .tags
                .iter()
                .all(|tag| own.contains(&tag.to_lowercase()))
            {
                return false;
            }
        }

        if let Some(after) = self.modified_after_ms {
            if entry.modified_ms < after {
                return false;
            }
        }

        if let Some(before) = self.modified_before_ms {
            if entry.modified_ms > before {
                return false;
            }
        }

        true
    }
}

/// Un trozo de una línea: o es coincidencia o es contexto.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSegment {
    pub text: String,
    pub hit: bool,
}

/// Una línea con su coincidencia ya troceada (para resaltar en el frontend).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSnippet {
    /// Número de línea, empezando en 1.
    pub line: usize,
    pub segments: Vec<SearchSegment>,
}

/// Una nota que cuadra con la búsqueda.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub tags: Vec<String>,
    pub modified_ms: u64,
    pub score: u32,
    /// ¿El término aparece también en el título?
    pub in_title: bool,
    pub snippets: Vec<SearchSnippet>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub matches: Vec<SearchMatch>,
    /// Cuántas notas cuadran en total (puede haber más que las devueltas).
    pub total: usize,
    pub notes_searched: usize,
    pub duration_ms: u64,
}

/// Carpetas y etiquetas que aparecen en el índice, para los filtros de la UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFacets {
    pub folders: Vec<String>,
    pub tags: Vec<String>,
    pub notes: usize,
}

pub(crate) fn index_dir(root: &std::path::Path) -> std::path::PathBuf {
    root.join(INDEX_DIR)
}

pub(crate) fn index_file(root: &std::path::Path) -> std::path::PathBuf {
    index_dir(root).join("index.json")
}

pub(crate) fn load_index(root: &std::path::Path) -> SearchIndex {
    let Ok(raw) = std::fs::read_to_string(index_file(root)) else {
        return SearchIndex::empty();
    };

    match serde_json::from_str::<SearchIndex>(&raw) {
        // Un índice de otra versión no sirve: se reconstruye desde cero.
        Ok(index) if index.version == INDEX_VERSION => index,
        _ => SearchIndex::empty(),
    }
}

pub(crate) fn save_index(root: &std::path::Path, index: &SearchIndex) -> Result<(), String> {
    let dir = index_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("No se pudo crear «{}»: {err}", dir.display()))?;

    let file = index_file(root);
    let raw = serde_json::to_string(index)
        .map_err(|err| format!("No se pudo serializar el índice: {err}"))?;
    std::fs::write(&file, raw)
        .map_err(|err| format!("No se pudo escribir «{}»: {err}", file.display()))
}

/// Carpeta de una nota a partir de su ruta relativa (vacío = raíz del vault).
pub(crate) fn folder_of_relative(relative: &str) -> String {
    match relative.rfind('/') {
        Some(position) => relative[..position].to_string(),
        None => String::new(),
    }
}

/// Devuelve el texto a partir del cierre del frontmatter inicial. Si no hay
/// frontmatter completo, devuelve el texto entero.
pub(crate) fn after_frontmatter(text: &str) -> &str {
    let mut lines = text.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end() != "---" {
        return text;
    }

    let mut consumed = first.len();
    for line in lines {
        consumed += line.len();
        if line.trim_end() == "---" {
            return &text[consumed..];
        }
    }

    // Sin cierre no había frontmatter, así que nada se ha de saltar.
    text
}

/// Título de la nota: el primer encabezado que viene después del frontmatter.
/// Si no hay, el nombre del archivo sin extensión.
pub(crate) fn note_title(text: &str, fallback: &str) -> String {
    for line in after_frontmatter(text).lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
        // La primera línea que no está vacía decide: si no es un título, no hay.
        break;
    }

    fallback.trim_end_matches(".md").to_string()
}

/// Posiciones (en bytes de `line`) de cada aparición de `terms`, sin
/// distinguir mayúsculas. Se comparan carácter a carácter para que la
/// longitud variable del minúsculado no descuadre los offsets.
pub(crate) fn term_ranges(line: &str, terms: &[String]) -> Vec<(usize, usize)> {
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let lowered: Vec<char> = chars
        .iter()
        .map(|(_, char)| char.to_lowercase().next().unwrap_or(*char))
        .collect();

    let mut ranges: Vec<(usize, usize)> = Vec::new();

    for term in terms {
        let needle: Vec<char> = term.chars().collect();
        if needle.is_empty() || needle.len() > lowered.len() {
            continue;
        }

        let mut start = 0;
        while start + needle.len() <= lowered.len() {
            if lowered[start..start + needle.len()] == needle[..] {
                let from = chars[start].0;
                let to = if start + needle.len() < chars.len() {
                    chars[start + needle.len()].0
                } else {
                    line.len()
                };
                ranges.push((from, to));
                start += needle.len();
            } else {
                start += 1;
            }
        }
    }

    ranges.sort();
    ranges
}

/// Trocea una línea en segmentos con y sin resaltado, recortada a una ventana
/// alrededor de la primera coincidencia para no devolver párrafos enteros.
pub(crate) fn snippet_segments(line: &str, ranges: &[(usize, usize)]) -> Vec<SearchSegment> {
    if ranges.is_empty() {
        return Vec::new();
    }

    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let first_byte = ranges[0].0;
    let last_byte = ranges[ranges.len() - 1].1;

    let first_char = chars.partition_point(|(byte, _)| *byte < first_byte);
    let last_char = chars.partition_point(|(byte, _)| *byte < last_byte);
    let from_char = first_char.saturating_sub(SNIPPET_BEFORE);
    let to_char = std::cmp::min(chars.len(), last_char + SNIPPET_AFTER);

    let from_byte = chars[from_char].0;
    let to_byte = if to_char < chars.len() {
        chars[to_char].0
    } else {
        line.len()
    };

    let mut out: Vec<SearchSegment> = Vec::new();
    if from_char > 0 {
        out.push(SearchSegment {
            text: "…".into(),
            hit: false,
        });
    }

    let mut cursor = from_byte;
    for (start, end) in ranges {
        let start = (*start).max(from_byte);
        let end = (*end).min(to_byte);
        if start >= end || start < cursor {
            continue;
        }
        if start > cursor {
            out.push(SearchSegment {
                text: line[cursor..start].to_string(),
                hit: false,
            });
        }
        out.push(SearchSegment {
            text: line[start..end].to_string(),
            hit: true,
        });
        cursor = end;
    }

    if cursor < to_byte {
        out.push(SearchSegment {
            text: line[cursor..to_byte].to_string(),
            hit: false,
        });
    }
    if to_char < chars.len() {
        out.push(SearchSegment {
            text: "…".into(),
            hit: false,
        });
    }

    out.retain(|segment| !segment.text.is_empty());
    out
}

#[tauri::command]
pub(crate) fn build_search_index(path: String) -> Result<SearchIndexStats, String> {
    let started = std::time::Instant::now();
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta «{}»", root.display()));
    }

    let previous = load_index(root);
    let mut leftovers: std::collections::HashMap<String, IndexEntry> = previous
        .entries
        .into_iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();

    let mut notes = Vec::new();
    collect_notes(root, "", 0, &mut notes);
    notes.truncate(MAX_INDEX_NOTES);
    notes.sort_by_key(|note| note.relative.to_lowercase());

    let mut entries: Vec<IndexEntry> = Vec::with_capacity(notes.len());
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut reused = 0usize;

    for note in notes {
        // Si el archivo no ha tocado el disco, la entrada de antes sirve.
        let previous_entry = leftovers.remove(&note.relative);
        let was_indexed = previous_entry.is_some();
        let is_unchanged = previous_entry
            .as_ref()
            .is_some_and(|old| old.modified_ms == note.modified_ms.unwrap_or(0));

        if is_unchanged {
            // `expect`: solo entra aquí si había entrada previa.
            entries.push(previous_entry.expect("entrada previa presente"));
            reused += 1;
            continue;
        }

        let Ok(text) = std::fs::read_to_string(&note.path) else {
            continue;
        };

        entries.push(IndexEntry {
            title: note_title(&text, &note.name),
            folder: folder_of_relative(&note.relative),
            tags: frontmatter_tags(&text),
            path: note.relative,
            modified_ms: note.modified_ms.unwrap_or(0),
            text,
        });

        if was_indexed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    // Lo que quedó en `leftovers` eran notas que ya no existen.
    let removed = leftovers.len();
    let notes_total = entries.len();

    let index = SearchIndex {
        version: INDEX_VERSION,
        generated_ms: now_ms(),
        entries,
    };
    save_index(root, &index)?;

    Ok(SearchIndexStats {
        notes: notes_total,
        added,
        updated,
        removed,
        reused,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// Reescribe la entrada de una nota ya guardada en disco. Es el camino
/// barato: no vuelve a leer el vault entero, solo esta nota.
#[tauri::command]
pub(crate) fn update_index_note(
    path: String,
    relative: String,
    text: String,
    modified_ms: u64,
) -> Result<SearchIndexStats, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    let mut index = load_index(root);
    index.version = INDEX_VERSION;

    let entry = IndexEntry {
        title: note_title(&text, &relative),
        folder: folder_of_relative(&relative),
        tags: frontmatter_tags(&text),
        path: relative.clone(),
        modified_ms,
        text,
    };

    let mut added = 0;
    let mut updated = 0;
    match index.entries.iter_mut().find(|item| item.path == relative) {
        Some(slot) => {
            *slot = entry;
            updated = 1;
        }
        None => {
            index.entries.push(entry);
            added = 1;
        }
    }

    index.entries.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    index.generated_ms = now_ms();
    let notes_total = index.entries.len();
    save_index(root, &index)?;

    Ok(SearchIndexStats {
        notes: notes_total,
        added,
        updated,
        removed: 0,
        reused: 0,
        duration_ms: 0,
    })
}

/// Quita del índice notas que ya no existen (borrados, renombrados, papelera).
#[tauri::command]
pub(crate) fn prune_search_index(path: String, relatives: Vec<String>) -> Result<usize, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    let mut index = load_index(root);

    let wanted: std::collections::HashSet<String> = relatives.into_iter().collect();
    let before = index.entries.len();
    index.entries.retain(|entry| !wanted.contains(&entry.path));
    let removed = before - index.entries.len();

    if removed > 0 {
        index.generated_ms = now_ms();
        save_index(root, &index)?;
    }

    Ok(removed)
}

#[tauri::command]
pub(crate) fn search_notes(
    path: String,
    query: String,
    filters: SearchFilters,
) -> Result<SearchResults, String> {
    let started = std::time::Instant::now();
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);

    // Los términos van en minúsculas: la comparación no distingue mayúsculas.
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect();

    let index = load_index(root);
    let notes_searched = index.entries.len();

    // Sin término no se devuelve nada: mejor eso que volcar el vault entero.
    if terms.is_empty() {
        return Ok(SearchResults {
            matches: Vec::new(),
            total: 0,
            notes_searched,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }

    let mut matches: Vec<SearchMatch> = Vec::new();

    for entry in &index.entries {
        if !filters.allows(entry) {
            continue;
        }

        let title_lower = entry.title.to_lowercase();
        // Todos los términos han de estar en el título o en el cuerpo (Y).
        let in_title = terms
            .iter()
            .all(|term| title_lower.contains(term.as_str()));
        let body_lower = entry.text.to_lowercase();
        let all_present = terms.iter().all(|term| {
            title_lower.contains(term.as_str()) || body_lower.contains(term.as_str())
        });

        if !all_present {
            continue;
        }

        let mut score: u32 = 0;
        let mut snippets: Vec<SearchSnippet> = Vec::new();

        for (index_line, line) in entry.text.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let ranges = term_ranges(trimmed, &terms);
            if ranges.is_empty() {
                continue;
            }

            score += ranges.len() as u32;
            if snippets.len() < MAX_SNIPPETS_PER_NOTE {
                snippets.push(SearchSnippet {
                    line: index_line + 1,
                    segments: snippet_segments(trimmed, &ranges),
                });
            }
        }

        // Un término solo en el título también es un acierto.
        if in_title {
            score += 5;
        }

        // Sin coincidencia en el cuerpo, el título basta para que aparezca.
        if score == 0 && !in_title {
            continue;
        }

        matches.push(SearchMatch {
            title: entry.title.clone(),
            folder: entry.folder.clone(),
            tags: entry.tags.clone(),
            modified_ms: entry.modified_ms,
            path: entry.path.clone(),
            score,
            in_title,
            snippets,
        });
    }

    matches.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.modified_ms.cmp(&a.modified_ms))
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });

    let total = matches.len();
    matches.truncate(MAX_SEARCH_RESULTS);

    Ok(SearchResults {
        matches,
        total,
        notes_searched,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// Carpetas y etiquetas del índice, para poblar los filtros de la búsqueda.
#[tauri::command]
pub(crate) fn search_index_facets(path: String) -> Result<SearchFacets, String> {
    let root = expand_home(&path);
    let root = std::path::Path::new(&root);
    let index = load_index(root);

    let mut folders: std::collections::BTreeSet<String> = Default::default();
    let mut tags: std::collections::BTreeSet<String> = Default::default();

    for entry in &index.entries {
        if !entry.folder.is_empty() {
            folders.insert(entry.folder.clone());
        }
        for tag in &entry.tags {
            if !tag.is_empty() {
                tags.insert(tag.clone());
            }
        }
    }

    Ok(SearchFacets {
        folders: folders.into_iter().collect(),
        tags: tags.into_iter().collect(),
        notes: index.entries.len(),
    })
}
