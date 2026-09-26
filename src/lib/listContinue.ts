/**
 * Continuación de listas al pulsar Intro en el textarea del editor.
 *
 * Devuelve el reemplazo exacto `[start, end) → insert` con el cursor final en
 * `caret`, o `null` si la línea no es de lista (entonces el salto es normal):
 *
 * - `- ` / `* ` / `+ ` / `1. ` / `2) ` → la línea nueva repite el marcador con
 *   la misma sangría (las ordenadas incrementan: `2.` → `3.`).
 * - `- [ ] tarea` / `1. [x] …` → la caja se conserva, siempre desmarcada.
 * - Intro sobre un ítem vacío → se retira el marcador: el «segundo Intro»
 *   cierra la lista.
 */

/** Cambio de texto que hay que aplicar en el textarea (rango → insert). */
export interface ListEnterEdit {
  /** Inicio del tramo que se sustituye. */
  start: number;
  /** Fin del tramo que se sustituye (exclusivo). */
  end: number;
  /** Texto nuevo que ocupa ese tramo. */
  insert: string;
  /** Posición del cursor tras aplicar el cambio. */
  caret: number;
}

/** `   - [ ] ` → indentación, marcador, caja opcional (`[ ]`) y contenido. */
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(?:\[([ xX])\](?=\s|$)\s*)?(.*)$/;

/**
 * Plan del salto de Intro dentro de `text` con el cursor en `caret`.
 * Solo mira lo que hay a la izquierda del cursor: lo de la derecha se queda
 * donde está (el texto posterior a la caja pasa a la línea nueva).
 */
export function listEnterEdit(text: string, caret: number): ListEnterEdit | null {
  if (caret < 0 || caret > text.length) return null;

  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  if (before === "") return null; // al inicio de la línea: salto normal

  const match = LIST_RE.exec(before);
  if (!match) return null;

  const indent = match[1];
  const marker = match[2];
  const box = match[4] !== undefined;
  const content = match[5];

  // Intro en un ítem vacío: retira el marcador y cierra la lista.
  if (content.trim() === "") {
    return { start: lineStart, end: caret, insert: "", caret: lineStart };
  }

  // Las ordenadas incrementan su número conservando el cierre: `2)` → `3)`.
  let nextMarker = marker;
  if (/^\d/.test(marker)) {
    nextMarker = `${Number(marker.slice(0, -1)) + 1}${marker.slice(-1)}`;
  }

  // La caja nueva nace siempre desmarcada: tras `- [x]` sigue `- [ ]`.
  const insert = `\n${indent}${nextMarker} ${box ? "[ ] " : ""}`;

  return { start: caret, end: caret, insert, caret: caret + insert.length };
}
