/** Medidas del textarea del editor (DOM): alto de fila y columnas que caben. */

/**
 * Altura real de fila del textarea en unidades locales (el motor la redondea al
 * escalar). Se mide en un clon invisible para no tocar el valor real del
 * textarea: escribir en él fuerza un re-render y desincroniza el overlay,
 * sobre todo al bajar el zoom (la interfaz se queda «rara»).
 */
export function measureRowPitch(area: HTMLTextAreaElement | null): number | null {
  if (!area) return null;
  try {
    const rows = Math.ceil((area.clientHeight + 4) / 16) + 8;
    const clon = area.cloneNode() as HTMLTextAreaElement;
    // El clon no está en el DOM: no dispara eventos ni causa re-renders.
    clon.style.position = "absolute";
    clon.style.visibility = "hidden";
    clon.style.height = "auto";
    clon.style.overflow = "hidden";
    clon.removeAttribute("rows");
    clon.value = Array(rows).fill("X").join("\n");
    document.body.appendChild(clon);
    const first = clon.scrollHeight;
    clon.value = Array(rows + 10).fill("X").join("\n");
    const second = clon.scrollHeight;
    clon.remove();
    const pitch = (second - first) / 10;
    return Number.isFinite(pitch) && pitch > 0 ? pitch : null;
  } catch {
    return null;
  }
}

/** Columnas monoespaciadas que caben en una fila del textarea (para tablas). */
export function measureTableCols(area: HTMLTextAreaElement | null): number | null {
  if (!area) return null;
  const style = getComputedStyle(area);
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const char = ctx.measureText("0").width;
  const width =
    area.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth);
  if (!(char > 0) || !(width > 0)) return null;
  return Math.floor(width / char);
}

/** Anchura mínima de una columna al redimensionar, y de una que no se pueda
 *  medir (píxeles): la celda lleva 16 de relleno, así que 24 ya deja texto. */
export const MIN_COL_WIDTH = 24;
export const DEFAULT_COL_WIDTH = 48;

export function insideRect(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function sameWidths(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((width, index) => width === b[index]);
}

/**
 * Entra en caja una lista de anchuras en el ancho de la fila. Si se pasan, se
 * encogen **en la misma proporción** (no solo la más ancha): así, al estrechar
 * la ventana todas las columnas ceden un poco y la tabla sigue leyéndose, en
 * vez de aplastar unas contra el mínimo y dejar otras enormes. Ninguna baja del
 * mínimo y, si con eso todavía no cabe, se sale (mandará el resto del texto).
 */
export function clampColumnWidths(widths: number[], limit: number): number[] {
  if (widths.length === 0) return widths;
  let next = [...widths];
  for (let round = 0; round < 24; round += 1) {
    const total = next.reduce((sum, width) => sum + width, 0);
    if (total <= limit) return next;
    const ratio = limit / total;
    let moved = false;
    next = next.map((width) => {
      const scaled = Math.max(MIN_COL_WIDTH, Math.round(width * ratio));
      if (scaled !== width) moved = true;
      return scaled;
    });
    // El redondeo puede dejar el total un par de píxeles por encima (si son
    // muchas columnas, uno por columna): se corrige de la más ancha.
    let sum = next.reduce((acc, width) => acc + width, 0);
    while (sum > limit) {
      let widest = 0;
      for (let i = 1; i < next.length; i += 1) if (next[i] > next[widest]) widest = i;
      if (next[widest] <= MIN_COL_WIDTH) break;
      next[widest] -= 1;
      sum -= 1;
      moved = true;
    }
    // Todas están ya en el mínimo: no queda nada que ceder.
    if (!moved) break;
  }
  return next;
}
