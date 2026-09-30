// Anotaciones del visor de PDF: notas al margen, trazos de lápiz/marcador,
// marcapáginas, progreso de lectura y filtro. Todo se guarda en localStorage
// (por ruta del archivo en el vault): el PDF en disco nunca se modifica.

export type PdfReadFilter = "normal" | "sepia" | "noche";

export interface PdfNote {
  id: string;
  page: number;
  text: string;
  created: number;
}

export interface PdfPoint {
  x: number;
  y: number;
}

/** Trazo sobre una página; coordenadas normalizadas (0..1) para que el zoom
 *  solo reescale al redibujar. */
export interface PdfStroke {
  id: string;
  page: number;
  color: string;
  width: number;
  alpha: number;
  points: PdfPoint[];
}

export interface PdfBookmark {
  page: number;
}

export interface PdfProgress {
  /** Página 1-based cuyo interior contiene el centro del visor. */
  page: number;
  /** Desplazamiento del borde superior del visor respecto al inicio de esa
   *  página, en alturas de página (puede ser negativo si el visor está antes). */
  frac: number;
}

export interface PdfDocData {
  notes: PdfNote[];
  strokes: PdfStroke[];
  bookmark: PdfBookmark | null;
  filter: PdfReadFilter;
}

const DOC_PREFIX = "gus:pdf-doc:";
const PROGRESS_PREFIX = "gus:pdf-progress:";

export const EMPTY_PDF_DOC: PdfDocData = {
  notes: [],
  strokes: [],
  bookmark: null,
  filter: "normal",
};

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadPdfDoc(path: string): PdfDocData {
  const stored = parse<PdfDocData>(localStorage.getItem(DOC_PREFIX + path));
  if (!stored) return EMPTY_PDF_DOC;
  return {
    notes: Array.isArray(stored.notes) ? stored.notes : [],
    strokes: Array.isArray(stored.strokes) ? stored.strokes : [],
    bookmark:
      stored.bookmark && Number.isFinite(stored.bookmark.page)
        ? { page: Math.max(1, Math.floor(stored.bookmark.page)) }
        : null,
    filter: stored.filter === "sepia" || stored.filter === "noche" ? stored.filter : "normal",
  };
}

export function savePdfDoc(path: string, data: PdfDocData): void {
  try {
    localStorage.setItem(DOC_PREFIX + path, JSON.stringify(data));
  } catch {
    // Cuota llena: la sesión sigue funcionando, solo no persiste.
  }
}

export function loadPdfProgress(path: string): PdfProgress | null {
  const stored = parse<PdfProgress>(localStorage.getItem(PROGRESS_PREFIX + path));
  if (!stored || !Number.isFinite(stored.page)) return null;
  return {
    page: Math.max(1, Math.floor(stored.page)),
    frac: Math.min(1, Math.max(-1, Number.isFinite(stored.frac) ? stored.frac : 0)),
  };
}

export function savePdfProgress(path: string, progress: PdfProgress): void {
  try {
    localStorage.setItem(PROGRESS_PREFIX + path, JSON.stringify(progress));
  } catch {
    // Ver loadPdfDoc.
  }
}

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
