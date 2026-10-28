import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import { type OrderedBlockRef, type PasteRange } from "../lib/listNumbering";
import { adjacentTableCell, cellRect, lineIndexOf, lineStartOffset, neighbourColumn, rectSpansCells, resolveTableCaret, rowJumpAllowed, splitTableCells, tableBlockAt, tableCellRange, tableRows, type TableCellCaret, type TableCellRect, type TableCellRef, type TableLine } from "../lib/tableLayout";
import { classifySource } from "./InlinePreview";
import type { EditorMenu } from "./markdownEditorTypes";


/** Lo que el teclado de tablas necesita del editor: estado, refs y acciones. */
export interface TableKeyboardDeps {
  menu: EditorMenu | null;
  tableCaret: TableCellCaret | null;
  tableRect: TableCellRect | null;
  setTableRect: Dispatch<SetStateAction<TableCellRect | null>>;
  sourceInfo: ReturnType<typeof classifySource>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  cellGeometry: (line: number, col: number, local: number) => { row: number; rows: number } | null;
  editBody: (
    nextBody: string,
    paste?: PasteRange,
    previous?: OrderedBlockRef | null,
  ) => { body: string; caret: number };
  focusTableCell: (line: number, col: number, select: boolean) => void;
  appendTableCellRow: (cell: TableCellCaret) => void;
  handleCaretMove: () => void;
}

/**
 * Teclado de las tablas del editor: Tab y flechas entre celdas, ↓ y ↑ en el
 * borde del bloque para salir, y la selección de celdas con Mayús.
 */
export function useTableKeyboard(deps: TableKeyboardDeps) {
  const { menu, tableCaret, tableRect, setTableRect, sourceInfo, textareaRef, tableAnchorRef, pendingCaretRef, cellGeometry, editBody, focusTableCell, appendTableCellRow, handleCaretMove } = deps;
  function focusTableCellAtColumn(line: number, col: number, local: number) {
    const range = tableCellRange(sourceInfo, line, col);
    const area = textareaRef.current;
    if (!range || !area) return;
    area.focus();
    const at = range.start + Math.min(Math.max(local, 0), range.end - range.start);
    tableAnchorRef.current = { line, col };
    setTableRect(null);
    area.setSelectionRange(at, at);
    handleCaretMove();
  }

  /**
   * ←/→ en el borde de una celda: salta a la contigua de la misma fila. Dentro
   * del texto no hace nada (que lo mueva el motor, y con Ctrl de palabra en
   * palabra): el salto solo ocurre al llegar al final o al principio, donde antes
   * las flechas se metían entre los «|» del crudo y dejaban el cursor en medio de
   * la fila de al lado.
   */
  function jumpAcrossCells(cell: TableCellCaret, direction: 1 | -1): boolean {
    const area = textareaRef.current;
    if (!area) return false;
    const range = tableCellRange(sourceInfo, cell.line, cell.col);
    if (!range) return false;

    // Solo en el borde de la celda. Con texto marcado, la flecha se lleva el
    // cursor al extremo desde el que se está saliendo.
    const caret = direction === 1 ? area.selectionEnd : area.selectionStart;
    if (caret !== (direction === 1 ? range.end : range.start)) return false;

    const col = neighbourColumn(sourceInfo, cell.line, cell.col, direction);
    if (col === null) return false; // borde de la tabla: aquí no hay celda
    const target = tableCellRange(sourceInfo, cell.line, col);
    if (!target) return false;

    const at = direction === 1 ? target.start : target.end;
    tableAnchorRef.current = { line: cell.line, col };
    setTableRect(null);
    area.setSelectionRange(at, at);
    handleCaretMove();
    return true;
  }

  /**
   * ↑/↓: de fila en fila en la misma columna, conservando la posición horizontal
   * dentro de la celda, como en una hoja de cálculo. Solo salta cuando el cursor
   * está en el primer o el último renglón visual: si el texto se envuelve en
   * varias líneas, dentro de él mandan las flechas de siempre.
   */
  function jumpAcrossRows(cell: TableCellCaret, direction: 1 | -1): boolean {
    const area = textareaRef.current;
    if (!area) return false;
    const range = tableCellRange(sourceInfo, cell.line, cell.col);
    if (!range) return false;

    const rows = tableRows(cell);
    const index = rows.indexOf(cell.line);
    if (index < 0) return false;
    const target = rows[index + direction];
    // En el borde del bloque no se salta de fila: eso es para salir de la tabla
    // (exitTableCell), que se encarga antes.
    if (target === undefined) return false;

    const caret = direction === 1 ? area.selectionEnd : area.selectionStart;
    const local = Math.max(0, caret - range.start);
    const geometry = cellGeometry(cell.line, cell.col, local);
    if (geometry && !rowJumpAllowed(geometry.row, geometry.rows, direction)) return false;

    const col = clampCellCol(target, cell.col);
    if (!tableCellRange(sourceInfo, target, col)) return false;
    focusTableCellAtColumn(target, col, local);
    return true;
  }

  /**
   * Tab / Shift+Tab y Enter recorren las celdas como en Excel. ↑/↓ sobre el
   * borde del bloque no dan vueltas dentro: salen de la tabla (exitTableCell).
   */
  function handleTableNav(event: KeyboardEvent<HTMLElement>) {
    const cell = tableCaret;
    if (!cell || menu || event.nativeEvent.isComposing) return;

    // Mayús + ↑/↓: la selección crece fila a fila sin salir del bloque, así
    // se marcan celdas completas para vaciarlas con Supr o copiarlas con
    // Ctrl+C / Ctrl+X.
    if (
      event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      extendTableSelection(cell, event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    // Mayús + ←/→: dentro de la fila, la selección salta de celda en celda.
    // Sin Mayús no se toca nada: el texto dentro de la celda se edita con las
    // flechas de siempre (y Ctrl+←/→ sigue yendo de palabra en palabra).
    if (
      event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      extendTableCellColumn(event.key === "ArrowRight" ? 1 : -1);
      return;
    }

    // ↑/↓ sin modificar sobre el borde del bloque: el cursor sale de la tabla
    // en vez de quedarse dentro. Es la única puerta cuando la nota termina (o
    // empieza) en la tabla: allí no hay línea contigua y Enter solo añade filas.
    // Con celdas marcadas no se sale: la marca se recoge en la celda del borde,
    // como al soltar las flechas en el escritorio.
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !tableRect
    ) {
      const area = textareaRef.current;
      if (area) {
        const down = event.key === "ArrowDown";
        const focus = down ? area.selectionEnd : area.selectionStart;
        const focusLine = lineIndexOf(area.value, focus);
        if (focusLine === (down ? cell.blockEnd : cell.blockStart)) {
          event.preventDefault();
          exitTableCell(down, focusLine);
          return;
        }
      }
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const target = adjacentTableCell(cell, event.shiftKey ? -1 : 1);
      if (target) focusTableCell(target.line, target.col, false);
      else if (!event.shiftKey) appendTableCellRow(cell);
      return;
    }

    // ←/→ sin Mayús: dentro del texto se mueve de carácter (Ctrl, de palabra) y
    // al llegar al borde de la celda salta a la siguiente, como en una hoja de
    // cálculo. Antes las flechas seguían por el crudo y el cursor acababa entre
    // los «|» de la fila de al lado.
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (jumpAcrossCells(cell, event.key === "ArrowRight" ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }

    // ↑/↓ sin Mayús: de fila en fila en la misma columna (el borde del bloque ya
    // se ha resuelto antes, saliendo de la tabla).
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (jumpAcrossRows(cell, event.key === "ArrowDown" ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const rows = tableRows(cell);
    const index = rows.indexOf(cell.line);
    const target = rows[index + (event.shiftKey ? -1 : 1)];
    if (target !== undefined) focusTableCell(target, cell.col, false);
    else if (!event.shiftKey) appendTableCellRow(cell);
  }

  /**
   * ↑/↓ sobre el borde del bloque: el cursor sale de la tabla al texto de
   * al lado, conservando su columna (acotada al ancho de la línea destino).
   * Si no hay nada allí —la nota acaba o empieza en la tabla— se abre la
   * línea que falta y el cursor baja/sube a ella: es la única salida que no
   * rompe la estructura, ya que Enter y Tab siguen añadiendo filas.
   */
  function exitTableCell(down: boolean, focusLine: number) {
    const area = textareaRef.current;
    if (!area) return;

    const value = area.value;
    const lines: TableLine[] = value.split("\n").map((text) => ({ text, code: false }));
    const focus = down ? area.selectionEnd : area.selectionStart;
    const col = focus - lineStartOffset(lines, focusLine);
    const targetLine = down ? focusLine + 1 : focusLine - 1;

    if (targetLine < 0 || targetLine >= lines.length) {
      const next = down ? `${value}\n` : `\n${value}`;
      const caret = down ? next.length : 0;
      pendingCaretRef.current = [caret, caret];
      editBody(next);
      return;
    }

    const caret =
      lineStartOffset(lines, targetLine) + Math.min(col, lines[targetLine].text.length);
    area.setSelectionRange(caret, caret);
    handleCaretMove();
  }

  /**
   * Celda que contiene el desplazamiento `offset`. Sobre el separador no hay
   * celdas, así que cuenta como «ninguna»: la selección sigue al otro extremo.
   */
  function cellAtOffset(area: HTMLTextAreaElement, offset: number): TableCellRef | null {
    const caret = resolveTableCaret(sourceInfo, lineIndexOf(area.value, offset), offset, offset);
    if (!caret || caret.onDelimiter) return null;
    return { line: caret.line, col: caret.col };
  }

  function selectionCellRect(area: HTMLTextAreaElement): TableCellRect | null {
    if (area.selectionStart === area.selectionEnd) return null;
    return cellRectBetween(area.selectionStart, area.selectionEnd);
  }

  /**
   * Rectángulo que abarca la selección entre dos desplazamientos: las dos puntas
   * caen en celdas del mismo bloque y lo que se marca es el cuadro que las une,
   * con celdas completas. Devuelve null con una sola celda marcada o cuando la
   * selección se sale del bloque (entonces manda el texto).
   */
  function cellRectBetween(start: number, end: number): TableCellRect | null {
    const area = textareaRef.current;
    if (!area) return null;
    const from = cellAtOffset(area, start);
    const to = cellAtOffset(area, end);
    if (!from || !to) return null;
    const fromBlock = tableBlockAt(sourceInfo, from.line);
    const toBlock = tableBlockAt(sourceInfo, to.line);
    if (!fromBlock || !toBlock || fromBlock.start !== toBlock.start) return null;
    const rect = cellRect(from, to);
    return rectSpansCells(rect) ? rect : null;
  }

  /**
   * Punta fija de la selección: la celda ancla guardada o, si aún no la hay
   * (un arrastre de ratón, que no pasa por teclado), el extremo contrario al
   * que se está moviendo según la dirección nativa de la selección.
   */
  function selectionAnchorCell(area: HTMLTextAreaElement): TableCellRef | null {
    const stored = tableAnchorRef.current;
    if (stored) return stored;
    const fixed =
      area.selectionDirection === "backward" ? area.selectionEnd : area.selectionStart;
    return cellAtOffset(area, fixed);
  }

  /**
   * Celda activa de la selección: la ancla se queda quieta y lo que se mueve
   * es el otro extremo del rango, el que no cae dentro de la celda ancla.
   * Se calcula después de guardar el ancla, que es quien señala cuál es.
   */
  function selectionFocusCell(area: HTMLTextAreaElement): TableCellRef | null {
    const anchor = tableAnchorRef.current;
    const start = cellAtOffset(area, area.selectionStart);
    const end = cellAtOffset(area, area.selectionEnd);
    if (anchor && start && start.line === anchor.line && start.col === anchor.col) {
      return end ?? start;
    }
    return start ?? end;
  }

  /** Columna válida en una fila más corta que el resto del bloque. */
  function clampCellCol(line: number, col: number) {
    const text = sourceInfo[line]?.text;
    if (text === undefined) return col;
    return Math.max(Math.min(col, splitTableCells(text).length - 1), 0);
  }

  /**
   * Marca las celdas completas de la celda ancla a la de `focus`. El rango de
   * texto que las cubre es la escalera de siempre (filas intermedias enteras),
   * de modo que Supr vacía justo lo marcado y deja los «|» en su sitio.
   */
  function selectCellBlock(anchor: TableCellRef, focus: TableCellRef) {
    const area = textareaRef.current;
    const from = tableCellRange(sourceInfo, anchor.line, anchor.col);
    const to = tableCellRange(sourceInfo, focus.line, clampCellCol(focus.line, focus.col));
    if (!area || !from || !to) return;
    // La marca no cruza de bloque: un arrastre que llegue hasta otra tabla no
    // arrastra la selección fuera de la que se está editando.
    const aBlock = tableBlockAt(sourceInfo, anchor.line);
    const bBlock = tableBlockAt(sourceInfo, focus.line);
    if (!aBlock || !bBlock || aBlock.start !== bBlock.start || aBlock.end !== bBlock.end) return;
    tableAnchorRef.current = anchor;
    area.setSelectionRange(Math.min(from.start, to.start), Math.max(from.end, to.end));
    handleCaretMove();
  }

  /**
   * Mayús+↑/↓: la selección crece fila a fila con celdas completas y nunca
   * sale del bloque (en el borde no ocurre nada). El móvil sube o baja a la
   * misma columna de la fila contigua; al volver a la celda ancla la marca se
   * queda en ella, que es donde empezó todo.
   */
  function extendTableSelection(cell: TableCellCaret, direction: 1 | -1) {
    const area = textareaRef.current;
    if (!area) return;

    const anchor = selectionAnchorCell(area);
    if (!anchor) return;
    tableAnchorRef.current = anchor;
    const focus = selectionFocusCell(area) ?? anchor;

    const rows = tableRows(cell);
    let index = rows.indexOf(focus.line);
    if (index < 0) index = rows.indexOf(cell.line);
    if (index < 0) return;

    const targetRow = rows[index + direction];
    if (targetRow === undefined) return; // la selección no sale del bloque
    selectCellBlock(anchor, { line: targetRow, col: focus.col });
  }

  /**
   * Mayús+←/→: la selección avanza de celda en celda dentro de la fila. La
   * fila no se envuelve (el último «|» es un límite, no un pasillo): para
   * cruzar de fila están ↑/↓, que intercalan las de en medio al completo.
   */
  function extendTableCellColumn(direction: 1 | -1) {
    const area = textareaRef.current;
    if (!area) return;

    const anchor = selectionAnchorCell(area);
    if (!anchor) return;
    tableAnchorRef.current = anchor;
    const focus = selectionFocusCell(area) ?? anchor;

    const targetCol = focus.col + direction;
    if (targetCol < 0 || !tableCellRange(sourceInfo, focus.line, targetCol)) return;
    selectCellBlock(anchor, { line: focus.line, col: targetCol });
  }

  return { handleTableNav, selectionCellRect, cellRectBetween, selectionAnchorCell, selectCellBlock };
}
