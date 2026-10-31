import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SourceLine } from "./InlinePreview";
import { useEffect } from "react";
import { sourceSegments, tableBlockAt } from "../lib/tableLayout";
import type { useTableResize } from "./useTableResize";
import { clampColumnWidths, sameWidths } from "../lib/editorMeasure";


interface FrozenTableWidthsDeps {
  overlayRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  colWidthsRef: RefObject<Map<number, number[]>>;
  sourceInfo: SourceLine[];
  inlineActive: boolean;
  tableCols: number | null;
  zoomTick: number;
  fontSize: number | undefined;
  setTableWidths: Dispatch<SetStateAction<Map<number, number[]> | null>>;
  measureTableColumns: ReturnType<typeof useTableResize>["measureTableColumns"];
  tableMaxWidthPx: ReturnType<typeof useTableResize>["tableMaxWidthPx"];
}

/** Congela la anchura de las columnas de cada tabla tras medirla (ver el comentario del efecto). */
export function useFrozenTableWidths(deps: FrozenTableWidthsDeps) {
  const {
    overlayRef, textareaRef, colWidthsRef, sourceInfo, inlineActive, tableCols, zoomTick, fontSize, setTableWidths,
    measureTableColumns, tableMaxWidthPx,
  } = deps;

  /**
   * Anchura de cada columna de cada tabla, medida una vez sobre el overlay y ya
   * no suelta. Es lo que evita que la tabla «respire» al escribir: si el ancho
   * fuera automático, teclear ensancharía la columna —y al llegar al borde de la
   * línea la tabla dejaría de dibujarse como tabla—, así que se congela en la
   * medida inicial y a partir de ahí manda lo que diga su contenido, que salta
   * de línea y hace crecer la fila, como en Excel. Solo vuelve a cambiar si el
   * usuario arrastra un borde, hace doble clic sobre él, cambia la estructura o
   * la ventana se encoge (entonces solo se recorta lo que sobra).
   */
  useEffect(() => {
    const overlay = overlayRef.current;
    const area = textareaRef.current;
    if (!overlay || !area || !inlineActive || tableCols === null) return;

    const available = tableMaxWidthPx(area);
    // Se mide la barra de scroll en este mismo momento: el estado `scrollbarWidth`
    // puede ir con un render de retraso y el recorte debe usar el ancho real.
    const scrollbar = area.offsetWidth - area.clientWidth;
    const limit = available === null ? Number.POSITIVE_INFINITY : available - scrollbar;
    const before = colWidthsRef.current;
    const next = new Map(before);
    let changed = false;

    for (const segment of sourceSegments(sourceInfo, false, tableCols)) {
      if (segment.kind !== "table") continue;
      // Al medir se mezclan las anchuras ya guardadas con las de las columnas
      // nuevas (una columna recién añadida se mide con las demás en `auto`).
      const measured = measureTableColumns(segment.start);
      if (!measured) continue;
      const stored = before.get(segment.start);
      // Ya fijada y con el mismo número de columnas: solo hay que mantenerla
      // dentro de la fila (si la ventana se ha encogido, ceden todas un poco).
      const wanted = stored && stored.length === measured.length ? stored : measured;
      const clamped = clampColumnWidths(wanted, limit);
      if (stored && sameWidths(stored, clamped)) continue;
      next.set(segment.start, clamped);
      changed = true;
    }

    // Las anchuras fijadas de una tabla que ya no existe no sirven: se quitan
    // aquí, con lo que este efecto queda como único escritor de `tableWidths`.
    for (const key of [...next.keys()]) {
      if (!tableBlockAt(sourceInfo, key)) {
        next.delete(key);
        changed = true;
      }
    }

    if (changed) setTableWidths(next);
    // `zoomTick`/`fontSize` entran en las deps: al escalar cambia la medida del
    // texto y hay que volver a congelar las columnas. `tableCols` y la barra de
    // scroll ya cubren sus propios cambios por otras vías (ResizeObserver y la
    // medición local de arriba).
  }, [sourceInfo, inlineActive, tableCols, zoomTick, fontSize]);
}
