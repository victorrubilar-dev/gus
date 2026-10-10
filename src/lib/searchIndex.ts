/**
 * Tipos y utilidades de la búsqueda a texto completo (REQ-08).
 *
 * El trabajo pesado vive en Rust: `search_notes` recorre el índice que hay en
 * `<vault>/.gus-index/index.json` y devuelve los aciertos con los fragmentos
 * ya troceados en segmentos con y sin resaltado. Aquí solo se pinta y se
 * gestionan los filtros de la interfaz.
 */

import { isInsidePath } from "./fileName";

/** Un trozo de fragmento: o es coincidencia o es contexto alrededor. */
export interface SearchSegment {
  text: string;
  hit: boolean;
}

/** Una línea de una nota con su coincidencia ya separada para resaltarla. */
export interface SearchSnippet {
  /** Número de línea, empezando en 1. */
  line: number;
  segments: SearchSegment[];
}

/** Una nota que cuadra con la búsqueda. */
export interface SearchMatch {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedMs: number;
  score: number;
  /** El término aparece también en el título de la nota. */
  inTitle: boolean;
  snippets: SearchSnippet[];
}

/** Respuesta completa de `search_notes`. */
export interface SearchResults {
  matches: SearchMatch[];
  /** Cuántas notas cuadran en total, antes del tope de resultados. */
  total: number;
  notesSearched: number;
  durationMs: number;
}

/** Carpetas y etiquetas del índice, para poblar los filtros de la UI. */
export interface SearchFacets {
  folders: string[];
  tags: string[];
  notes: number;
}

/** Filtros que envía la UI. `null` en las fechas = sin filtro por fecha. */
export interface SearchFilters {
  folder: string;
  tags: string[];
  modifiedAfterMs: number | null;
  modifiedBeforeMs: number | null;
}

/** Filtros apagados: la búsqueda pasa por encima de todo el índice. */
export const EMPTY_FILTERS: SearchFilters = {
  folder: "",
  tags: [],
  modifiedAfterMs: null,
  modifiedBeforeMs: null,
};

/** Fecha del campo `<input type="date">`: «AAAA-MM-DD». */
const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Divide la consulta en términos comparables: en minúsculas, sin espacios y
 * sin repetir. Sirve para decir si hay algo que buscar y para enseñar los
 * términos de la consulta.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const chunk of query.split(/\s+/)) {
    const term = chunk.trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  return terms;
}

/** ¿Hay al menos un término en la consulta? Si no, no se busca. */
export function canSearch(query: string): boolean {
  return searchTerms(query).length > 0;
}

/** ¿Está puesto algún filtro? Para apagar el botón de limpiar filtros. */
export function filtersActive(filters: SearchFilters): boolean {
  return (
    filters.folder !== "" ||
    filters.tags.length > 0 ||
    filters.modifiedAfterMs !== null ||
    filters.modifiedBeforeMs !== null
  );
}

/** Suma de los aciertos de un fragmento, para el «+N» de más coincidencias. */
export function snippetHits(snippet: SearchSnippet): number {
  return snippet.segments.filter((segment) => segment.hit).length;
}

/** Texto plano de un fragmento, sin la marca de resaltado. */
export function snippetText(snippet: SearchSnippet): string {
  return snippet.segments.map((segment) => segment.text).join("");
}

/** Carpeta de una nota a partir de su ruta relativa ("" = raíz del vault). */
export function folderOfRelative(relative: string): string {
  const slash = relative.lastIndexOf("/");
  return slash === -1 ? "" : relative.slice(0, slash);
}

/**
 * Ruta de la nota relativa al vault, con «/», que es como la guarda el
 * índice. Devuelve `null` si la nota no está dentro del vault (no debería
 * pasar: el editor solo escribe dentro).
 */
export function relativeNotePath(vaultPath: string, notePath: string): string | null {
  const vault = vaultPath.replace(/[/\\]+$/, "");
  if (notePath === vault) return null;
  if (!isInsidePath(notePath, vault)) return null;

  const separator = vault.includes("\\") && !vault.includes("/") ? "\\" : "/";
  const relative = notePath.slice(vault.length + separator.length);
  return relative.split(separator).join("/") || null;
}

/** Minúscula del día que empieza en la fecha del campo de fecha, en local. */
export function startOfDayMs(value: string): number | null {
  const parsed = parseDateInput(value);
  if (!parsed) return null;
  const { year, month, day } = parsed;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

/** Último milisegundo del día de la fecha del campo, en local. */
export function endOfDayMs(value: string): number | null {
  const parsed = parseDateInput(value);
  if (!parsed) return null;
  const { year, month, day } = parsed;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

function parseDateInput(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_INPUT.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // El constructor normaliza el desbordamiento: 2026-02-31 no existe.
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}
