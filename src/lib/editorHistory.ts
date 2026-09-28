/** Pila de deshacer/rehacer del editor de notas. */

export interface HistorySnapshot {
  content: string;
  start: number;
  end: number;
  at: number;
}

export interface EditorHistory {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
}

/** Escrituras continuas dentro de esta ventana forman un solo paso de deshacer. */
const COALESCE_MS = 800;
const MAX_STEPS = 200;

export function createHistory(): EditorHistory {
  return { past: [], future: [] };
}

/**
 * Registra el estado previo a un cambio. Agrupa las escrituras continuas
 * salvo que `force` marque el inicio de un grupo nuevo (pegar, cortar).
 * Un cambio posterior invalida la pila de rehacer.
 */
export function recordHistory(
  history: EditorHistory,
  state: HistorySnapshot,
  force = false,
): void {
  history.future.length = 0;
  const last = history.past[history.past.length - 1];
  if (!force && last && state.at - last.at < COALESCE_MS) return;
  history.past.push(state);
  if (history.past.length > MAX_STEPS) history.past.shift();
}

/** Deshace: devuelve el estado anterior o null si no hay pasos. */
export function undoHistory(
  history: EditorHistory,
  present: HistorySnapshot,
): HistorySnapshot | null {
  const prev = history.past.pop();
  if (!prev) return null;
  history.future.push(present);
  return prev;
}

/** Rehace: devuelve el estado siguiente o null si no hay pasos. */
export function redoHistory(
  history: EditorHistory,
  present: HistorySnapshot,
): HistorySnapshot | null {
  const next = history.future.pop();
  if (!next) return null;
  history.past.push(present);
  return next;
}
