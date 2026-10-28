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
