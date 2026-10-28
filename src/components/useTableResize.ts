import type { Dispatch, RefObject, SetStateAction } from "react";
import { DEFAULT_COL_WIDTH, MIN_COL_WIDTH, insideRect } from "../lib/editorMeasure";
import { type TableBarHover } from "./InlinePreview";


/** Lo que el redimensionado de tablas necesita del editor: refs, estado y setters. */
export interface TableResizeDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  resizeDragRef: RefObject<{ block: number; col: number; startX: number; widths: number[] } | null>;
  tableResizeHandlesRef: RefObject<HTMLElement[]>;
  tableBarsRef: RefObject<HTMLElement[]>;
  colWidthsRef: RefObject<Map<number, number[]>>;
  setTableWidths: Dispatch<SetStateAction<Map<number, number[]> | null>>;
  scrollbarWidth: number;
}

/**
 * Redimensionado de columnas y barras de tabla con el puntero: qué celda o
 * borde está bajo el ratón, cuánto mide cada columna y arrastrar un borde.
 */
export function useTableResize(deps: TableResizeDeps) {
  const { textareaRef, overlayRef, resizeDragRef, tableResizeHandlesRef, tableBarsRef, colWidthsRef, setTableWidths, scrollbarWidth } = deps;

  /** Barra «+» de tabla bajo el punto (x, y), o null si no se pisa ninguna. */
  function tableBarAtPoint(clientX: number, clientY: number): TableBarHover | null {
    for (const bar of tableBarsRef.current) {
      if (!insideRect(bar, clientX, clientY)) continue;
      return {
        block: Number(bar.dataset.addBlock),
        part: bar.dataset.addBar === "bottom" ? "bottom" : "side",
      };
    }
    return null;
  }

  /** Botón «+» de fila o columna bajo el punto (x, y). */
  function addBadgeAt(clientX: number, clientY: number): HTMLElement | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    return (
      Array.from(overlay.querySelectorAll<HTMLElement>("[data-add-row],[data-add-col]")).find(
        (element) => insideRect(element, clientX, clientY),
      ) ?? null
    );
  }

  /** Anchura en píxeles de cada columna del bloque, medida del overlay. Las
   *  columnas que ya tienen anchura fijada la conservan. */
  function measureTableColumns(blockStart: number): number[] | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const container = overlay.querySelector<HTMLElement>(`[data-table-block="${blockStart}"]`);
    if (!container) return null;
    const handles = Array.from(container.querySelectorAll<HTMLElement>("[data-resize-block]"));
    if (handles.length === 0) return null;

    // Derecho de cada columna: la derecha de su última celda con asa.
    const edges = new Map<number, number>();
    let blockLeft = Infinity;
    for (const handle of handles) {
      const cell = handle.parentElement;
      if (!cell) return null;
      blockLeft = Math.min(blockLeft, cell.offsetLeft);
      edges.set(Number(handle.dataset.resizeCol), cell.offsetLeft + cell.offsetWidth);
    }
    const cols = Math.max(...edges.keys()) + 1;
    if (edges.size === 0) return null;
    const stored = colWidthsRef.current.get(blockStart);
    const widths: number[] = [];
    for (let col = 0; col < cols; col += 1) {
      if (stored && stored[col] !== undefined) {
        widths.push(stored[col]);
        continue;
      }
      const right = edges.get(col);
      const left = col === 0 ? blockLeft : edges.get(col - 1);
      widths.push(right !== undefined && left !== undefined ? right - left : DEFAULT_COL_WIDTH);
    }
    return widths;
  }

  /** Anchura en píxeles que cabe en una fila del textarea (la tabla no se sale). */
  function tableMaxWidthPx(area: HTMLTextAreaElement | null): number | null {
    if (!area) return null;
    const style = getComputedStyle(area);
    const width =
      area.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.borderRightWidth);
    return width > 0 ? width : null;
  }

  /**
   * Arrastre del borde de una columna: se mide la anchura actual de todas y se
   * sigue el ratón desde la ventana (el puntero puede salir del textarea). La
   * tabla no se ensancha más de lo que cabe en la fila.
   */
  function startColumnResize(block: number, col: number, startX: number, widths: number[]) {
    // El ancho disponible es el de la fila menos la barra de scroll: el overlay
    // es más estrecho que el textarea justo en esa medida.
    const available = tableMaxWidthPx(textareaRef.current);
    const max = available === null ? null : Math.max(0, available - scrollbarWidth);
    const onMove = (event: globalThis.MouseEvent) => {
      const next = [...widths];
      next[col] = Math.max(MIN_COL_WIDTH, widths[col] + (event.clientX - startX));
      if (max !== null) {
        const total = next.reduce((sum, width) => sum + width, 0);
        if (total > max) next[col] = Math.max(MIN_COL_WIDTH, next[col] - (total - max));
      }
      setTableWidths((prev) => {
        const map = new Map(prev ?? []);
        map.set(block, next);
        return map;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizeDragRef.current = null;
    };
    resizeDragRef.current = { block, col, startX, widths };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /** Asa de columna bajo el punto (x, y), o null si no se pisa ninguna. */
  function resizeHandleAt(
    clientX: number,
    clientY: number,
  ): { block: number; col: number } | null {
    const handles = tableResizeHandlesRef.current;
    const handle = handles.find((element) => insideRect(element, clientX, clientY));
    if (!handle) return null;
    const block = Number(handle.dataset.resizeBlock);
    const col = Number(handle.dataset.resizeCol);
    if (Number.isNaN(block) || Number.isNaN(col)) return null;
    return { block, col };
  }

  return { tableBarAtPoint, measureTableColumns, tableMaxWidthPx, startColumnResize, resizeHandleAt, addBadgeAt };
}
