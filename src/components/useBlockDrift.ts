import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { sourceSegments } from "../lib/tableLayout";
import { toLocalCoord } from "../lib/uiZoom";
import type { SourceLine } from "./InlinePreview";
import type { BlockDrift } from "./markdownEditorTypes";

/** Mapa de alturas vacío reutilizable: evita re-renderizar por un Map nuevo. */
const EMPTY_DRIFT: Map<number, BlockDrift> = new Map();

/** ¿Dos mapas de alturas de bloque dicen lo mismo? (evita re-renderizar) */
function sameDrift(a: Map<number, BlockDrift>, b: Map<number, BlockDrift>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, drift] of a) {
    const other = b.get(key);
    if (!other || other.end !== drift.end || other.extra !== drift.extra) return false;
  }
  return true;
}

/**
 * Alto que gana un bloque por encima de su markdown (tablas que envuelven sus
 * celdas, imágenes a tamaño real) y las cuentas para compensarlo al hacer scroll,
 * clic o situar el cursor.
 */
export function useBlockDrift({
  overlayRef,
  textareaRef,
  sourceInfo,
  inlineActive,
  tableCols,
  rowPitch,
  tableWidths,
  caretLine,
  imageResize,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sourceInfo: SourceLine[];
  inlineActive: boolean;
  tableCols: number | null;
  rowPitch: number;
  tableWidths: Map<number, number[]> | null;
  caretLine: number;
  imageResize: { line: number; width: number } | null;
}) {
  /** Alto ganado por cada tabla al envolver sus celdas (por bloque). */
  const [blockDrift, setBlockDrift] = useState<Map<number, BlockDrift>>(EMPTY_DRIFT);
  /** Espejo de blockDrift: se lee al hacer scroll y al situar el cursor. */
  const blockDriftRef = useRef<Map<number, BlockDrift>>(blockDrift);
  useLayoutEffect(() => {
    blockDriftRef.current = blockDrift;
  });

  // Alto que gana un bloque por encima de su markdown: las tablas al envolver
  // sus celdas y las líneas de imagen que se pintan a tamaño real. A partir de
  // su última línea el overlay queda más abajo que el textarea, así que se mide
  // para poder compensarlo (scroll, clic y cursor).
  //
  // Esta medición depende de que el efecto anterior ya haya pintado los anchos
  // y de que R haya fijado la altura de fila: la cadena de efectos es el
  // propósito (medir el resultado de lo anterior), no un accidente de renders.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !inlineActive || tableCols === null) {
      setBlockDrift(EMPTY_DRIFT);
      return;
    }
    const next = new Map<number, BlockDrift>();
    for (const segment of sourceSegments(sourceInfo, false, tableCols)) {
      if (segment.kind !== "table") continue;
      const element = overlay.querySelector<HTMLElement>(`[data-table-block="${segment.start}"]`);
      if (!element) continue;
      const extra = element.offsetHeight - (segment.end - segment.start + 1) * rowPitch;
      // offsetHeight viene entero: se ignoran los restos de subpíxel.
      if (extra > 1) next.set(segment.start, { end: segment.end, extra });
    }
    // Las imágenes de bloque: su sobrante es lo que la línea mide de más
    // sobre el alto que el textarea reserva para su markdown (medido con el
    // medidor de la propia línea, que envuelve igual).
    for (const element of overlay.querySelectorAll<HTMLElement>("[data-drift-line]")) {
      const line = Number(element.dataset.driftLine);
      if (!Number.isInteger(line)) continue;
      const measure = element.querySelector<HTMLElement>("[data-line-measure]");
      const extra = element.offsetHeight - (measure?.offsetHeight ?? rowPitch);
      if (extra > 1) next.set(line, { end: line, extra });
    }
    setBlockDrift((prev) => (sameDrift(prev, next) ? prev : next));
    // `imageResize`: mientras se arrastra el asa, la altura de la línea cambia
    // en cada movimiento y hay que remesurar el sobrante al momento.
  }, [sourceInfo, inlineActive, tableCols, rowPitch, tableWidths, caretLine, imageResize]);

  /** Píxeles que los bloques ya superados dejan más abajo en el overlay. */
  function driftBeforeLine(line: number): number {
    let extra = 0;
    for (const drift of blockDriftRef.current.values()) {
      if (drift.end < line) extra += drift.extra;
    }
    return extra;
  }

  /** Igual, pero medido sobre el overlay: sirve para compensar el scroll. */
  function driftBeforeScroll(scrollTop: number): number {
    const overlay = overlayRef.current;
    if (!overlay || blockDriftRef.current.size === 0) return 0;
    let extra = 0;
    for (const [block, drift] of blockDriftRef.current) {
      // Las tablas se identifican por bloque y las imágenes por su línea.
      const element = overlay.querySelector<HTMLElement>(
        `[data-table-block="${block}"], [data-drift-line="${block}"]`,
      );
      if (element && element.offsetTop + element.offsetHeight <= scrollTop) extra += drift.extra;
    }
    return extra;
  }

  /**
   * Desplazamiento que los bloques crecidos añaden a un punto del ratón. El
   * textarea no lo sabe, así que se lo pasamos al cálculo geométrico del offset
   * (el nativo ya acierta por su cuenta).
   *
   * El punto se mide desde el borde del área (padding incluido), que es la
   * misma convención de los `offsetTop` del overlay con los que se compara:
   * restar el relleno aquí dejaría cada bloque16 px «más abajo» y el clic
   * justo debajo de uno crecido no lo contaría.
   */
  function driftAtPointer(clientY: number): number {
    const area = textareaRef.current;
    if (!area || blockDriftRef.current.size === 0) return 0;
    const rect = area.getBoundingClientRect();
    const y = toLocalCoord(clientY) - toLocalCoord(rect.top) + area.scrollTop;
    return driftBeforeScroll(y);
  }

  /** Sumando todos los bloques: el textarea reserva ese alto al final para poder bajar al último renglón. */
  const driftTotal = [...blockDrift.values()].reduce((sum, drift) => sum + drift.extra, 0);

  return { blockDriftRef, driftTotal, driftBeforeLine, driftBeforeScroll, driftAtPointer };
}
