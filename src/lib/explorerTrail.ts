/** Ruta del explorador y su historial «atrás»/«adelante»: funciones puras sin React. */

export interface FolderEntry {
  name: string;
  path: string;
}

/** Ruta actual más el historial que alimenta los botones «atrás»/«adelante». */
export interface TrailState {
  /** Carpetas desde la raíz hasta la que estás viendo. */
  trail: FolderEntry[];
  /** Pasos anteriores (pila de «atrás»), el último es el inmediatamente previo. */
  past: FolderEntry[][];
  /** Pasos deshechos al retroceder (pila de «adelante»). */
  future: FolderEntry[][];
}

/** Un tramo de la ruta con su posición real, para cortarla ahí donde se pulsa. */
export interface TrailPart {
  folder: FolderEntry;
  index: number;
}

/** Pasos de historial que se conservan para «atrás»/«adelante». */
export const TRAIL_HISTORY_LIMIT = 50;

const keep = (steps: FolderEntry[][]) => steps.slice(-TRAIL_HISTORY_LIMIT);

/** Cambia de carpeta guardando el paso anterior: habilita «atrás» y limpia «adelante». */
export function navigateTo(prev: TrailState, next: FolderEntry[]): TrailState {
  const unchanged =
    prev.trail.length === next.length &&
    prev.trail.every((step, index) => step.path === next[index].path);
  if (unchanged) return prev;

  return { trail: next, past: keep([...prev.past, prev.trail]), future: [] };
}

/** Un paso atrás en el historial. */
export function goBack(prev: TrailState): TrailState {
  const previous = prev.past[prev.past.length - 1];
  if (!previous) return prev;

  return {
    trail: previous,
    past: prev.past.slice(0, -1),
    future: keep([...prev.future, prev.trail]),
  };
}

/** Un paso adelante, lo que se deshizo al retroceder. */
export function goForward(prev: TrailState): TrailState {
  const next = prev.future[prev.future.length - 1];
  if (!next) return prev;

  return {
    trail: next,
    past: keep([...prev.past, prev.trail]),
    future: prev.future.slice(0, -1),
  };
}

/** Sube a la carpeta padre. */
export function goUp(prev: TrailState): TrailState {
  if (prev.trail.length < 2) return prev;

  return { trail: prev.trail.slice(0, -1), past: keep([...prev.past, prev.trail]), future: [] };
}

/**
 * Reescribe la ruta tras renombrar o mover carpetas. No crea un paso de historial,
 * pero sí corrige los guardados, para que «atrás» no apunte a rutas ya inexistentes.
 */
export function rewriteTrail(
  prev: TrailState,
  mapTrail: (trail: FolderEntry[]) => FolderEntry[],
): TrailState {
  return {
    trail: mapTrail(prev.trail),
    past: prev.past.map(mapTrail),
    future: prev.future.map(mapTrail),
  };
}

/**
 * Reparte la ruta en tramos visibles y ocultos (el «…»), de más a menos detalle:
 * todo → raíz, penúltimo y actual → raíz y actual → penúltimo y actual → solo la
 * actual. `level` decide cuánto se colapsa y lo sube la medición del ancho real de
 * la barra, así la ruta siempre cabe en una línea pase lo que pase con el ancho.
 */
export function splitTrail(trail: FolderEntry[], level: number): {
  visible: TrailPart[];
  hidden: TrailPart[];
  maxLevel: number;
} {
  const parts = trail.map((folder, index) => ({ folder, index }));
  const last = parts.length - 1;

  if (parts.length < 2) return { visible: parts, hidden: [], maxLevel: 0 };

  const combos: number[][] = [
    parts.map((part) => part.index),
    ...(parts.length >= 3 ? [[0, last - 1, last]] : []),
    [0, last],
    ...(parts.length >= 3 ? [[last - 1, last]] : []),
    [last],
  ];
  // Sin repetidos: con pocas carpetas varias opciones coinciden y solo harían parpadear la barra.
  const distinct = combos.filter(
    (combo, index, all) => all.findIndex((other) => other.join(",") === combo.join(",")) === index,
  );

  const chosen = distinct[Math.min(level, distinct.length - 1)];
  const visible = chosen.map((index) => parts[index]);
  const hidden = parts.filter((part) => !chosen.includes(part.index));

  return { visible, hidden, maxLevel: distinct.length - 1 };
}
