/** Posición del cursor dentro de un `<textarea>` (para anclar menús flotantes).
 *
 * El truco es un «espejo»: un div invisible con las mismas tipografías, relleno
 * y ancho que el textarea, donde se coloca el texto hasta el cursor más un
 * marcador de cero ancho. La posición de ese marcador es la del cursor real,
 * con los saltos de línea incluidos.
 */

/** Coordenadas del menú flotante (posición `fixed`, en el viewport). */
export interface CaretAnchor {
  /** Y del cursor (la mitad superior del menú se pone debajo de la línea). */
  top: number;
  /** X del cursor (el menú se alinea a su izquierda). */
  left: number;
  /** Alto de la línea, para separar el menú un poco del texto. */
  height: number;
}

/** Estilos que el espejo debe copiar para medir igual que el textarea. */
const MIRRORED_STYLES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "letter-spacing",
  "line-height",
  "word-spacing",
  "text-transform",
  "text-indent",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
] as const;

/** Ancla del menú para la posición `caret` del `textarea`. */
export function caretAnchor(textarea: HTMLTextAreaElement, caret: number): CaretAnchor {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");

  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  for (const property of MIRRORED_STYLES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }

  mirror.textContent = textarea.value.slice(0, caret);

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  try {
    const rect = textarea.getBoundingClientRect();
    return {
      top: rect.top + marker.offsetTop - textarea.scrollTop,
      left: rect.left + marker.offsetLeft - textarea.scrollLeft,
      height: marker.offsetHeight || 18,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}

/**
 * Texto de la línea que ocupa `caret` (sin los propios saltos de línea).
 * El corte se hace hacia atrás con `caret - 1` para no tragarse un `\n` que
 * esté justo en la posición del cursor.
 */
export function lineAtCaret(text: string, caret: number): string {
  const from = caret <= 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  const to = text.indexOf("\n", caret);
  return text.slice(from, to === -1 ? text.length : to);
}
