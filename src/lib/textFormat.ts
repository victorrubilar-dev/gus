/** Formato en línea de la selección del editor (negrita, cursiva, tachado, código, enlace). */

export type FormatKind = "bold" | "italic" | "strike" | "code" | "link";

const MARKERS: Record<Exclude<FormatKind, "link">, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
};

/**
 * Texto que sustituye a la selección y cuántos caracteres avanza el cursor
 * desde su inicio. Aplicar el mismo formato a algo ya formateado lo quita; sin
 * selección deja el cursor entre los marcadores (en un enlace, entre los paréntesis).
 */
export function formatSelection(kind: FormatKind, selected: string): { text: string; caret: number } {
  if (kind === "link") {
    return { text: `[${selected}]()`, caret: `[${selected}](`.length };
  }

  const [open, close] = MARKERS[kind];
  const alreadyWrapped =
    selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length;

  if (alreadyWrapped) {
    const text = selected.slice(open.length, selected.length - close.length);
    return { text, caret: text.length };
  }
  if (selected) {
    const text = open + selected + close;
    return { text, caret: text.length };
  }
  return { text: open + close, caret: open.length };
}
