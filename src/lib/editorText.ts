/** Utilidades de texto del editor, sin DOM: se prueban en `editorText.test.ts`. */

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Rango completo de la línea que contiene la posición `at`, con su salto final
 * incluido: es lo que corta Ctrl+X cuando no hay selección, como en VS Code.
 */
export function lineRangeAt(value: string, at: number): [number, number] {
  const start = at === 0 ? 0 : value.lastIndexOf("\n", at - 1) + 1;
  const newline = value.indexOf("\n", at);
  return [start, newline === -1 ? value.length : newline + 1];
}

/**
 * Rango que borraría Supr/Backspace. Con Ctrl/Meta se aproxima al borrado
 * de palabra, que nunca cruza el salto de línea.
 */
export function deletionRange(
  value: string,
  start: number,
  end: number,
  backspace: boolean,
  mod: boolean,
): [number, number] {
  if (end > start) return [start, end];

  if (backspace) {
    if (start === 0) return [0, 0];
    if (!mod) return [start - 1, start];
    let at = start;
    while (at > 0 && /\s/.test(value[at - 1]) && value[at - 1] !== "\n") at -= 1;
    while (at > 0 && !/\s/.test(value[at - 1])) at -= 1;
    return [at, start];
  }

  if (start >= value.length) return [start, start];
  if (!mod) return [start, start + 1];
  let at = start;
  while (at < value.length && !/\s/.test(value[at])) at += 1;
  return [start, at];
}
