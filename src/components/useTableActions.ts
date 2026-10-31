import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type { OrderedBlockRef, PasteRange } from "../lib/listNumbering";
import type { SourceLine } from "./InlinePreview";
import { charWidthPx } from "../lib/pointerOffset";
import { alignTableColumn, clearTableCells, computeTableMerges, duplicateTableRow, insertTableColumn, insertTableRow, isTableMergePossible, lineIndexOf, actionRect, mergeTableCells, moveTableRow, planTableDeletion, removeTable, removeTableColumn, removeTableRow, safeTableCaret, sortTableRows, splitTableCells, tableBlockAt, tableCellRange, tableFromDelimited, toggleTableTask, unmergeTableCells, visualLength, type TableCellCaret, type TableCellRect, type TableEdit, type TableLine } from "../lib/tableLayout";
import { classifySource } from "./InlinePreview";
import type { TableAction, TableMenuInfo } from "./EditorContextMenu";
import { MIN_COL_WIDTH } from "../lib/editorMeasure";
import type { EditorMenu, ContextMenuState } from "./markdownEditorTypes";
import { deletionRange } from "../lib/editorText";

/** Acciones sobre tablas: editar con las acciones del menú o atajos, borrar, reemplazar, convertir texto y autoajustar columnas. */
interface TableActionsDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  forceHistoryRef: RefObject<boolean>;
  sourceInfo: SourceLine[];
  body: string;
  tableCaret: TableCellCaret | null;
  tableRect: TableCellRect | null;
  setTableRect: Dispatch<SetStateAction<TableCellRect | null>>;
  setTableWidths: Dispatch<SetStateAction<Map<number, number[]> | null>>;
  contextMenu: ContextMenuState | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  setMenu: Dispatch<SetStateAction<EditorMenu | null>>;
  scrollbarWidth: number;
  editBody: (nextBody: string, paste?: PasteRange, previous?: OrderedBlockRef | null) => { body: string; caret: number };
  tableMaxWidthPx: (area: HTMLTextAreaElement) => number | null;
  measureTableColumns: (blockStart: number) => number[] | null;
  selectionCellRect: (area: HTMLTextAreaElement) => TableCellRect | null;
  copyCellRect: (rect: TableCellRect, clip?: DataTransfer | null) => boolean;
  dropSlashQuery: () => void;
}

export function useTableActions(deps: TableActionsDeps) {
  const {
    textareaRef,
    pendingCaretRef,
    tableAnchorRef,
    forceHistoryRef,
    sourceInfo,
    body,
    tableCaret,
    tableRect,
    setTableRect,
    setTableWidths,
    contextMenu,
    setContextMenu,
    setMenu,
    scrollbarWidth,
    editBody,
    tableMaxWidthPx,
    measureTableColumns,
    selectionCellRect,
    copyCellRect,
    dropSlashQuery,
  } = deps;

  /**
   * Doble clic sobre el borde de una columna: se ajusta a su contenido, como el
   * doble clic de Excel sobre el separador de cabeceras. Se mide la celda más
   * larga de la columna (en una sola línea) y se respeta el ancho disponible.
   */
  function autoFitColumn(blockStart: number, col: number) {
    const area = textareaRef.current;
    const lines = currentLines();
    const block = tableBlockAt(lines, blockStart);
    const widths = measureTableColumns(blockStart);
    if (!area || !block || !widths) return;
    const char = charWidthPx(area);
    if (!char) return;

    let longest = 0;
    for (let line = block.start; line <= block.end; line += 1) {
      if (line === block.start + 1) continue; // separador
      const cell = splitTableCells(lines[line].text)[col];
      if (cell) longest = Math.max(longest, visualLength(cell.text));
    }
    // 24 px son los rellenos laterales de la celda (12 a cada lado).
    const next = [...widths];
    next[col] = Math.max(MIN_COL_WIDTH, Math.round(longest * char) + 24);
    const available = tableMaxWidthPx(area);
    if (available !== null) {
      const total = next.reduce((sum, width) => sum + width, 0);
      const limit = Math.max(0, available - scrollbarWidth);
      if (total > limit) next[col] = Math.max(MIN_COL_WIDTH, next[col] - (total - limit));
    }
    setTableWidths((prev) => {
      const map = new Map(prev ?? []);
      map.set(blockStart, next);
      return map;
    });
  }

  /**
   * Convierte el texto seleccionado en tabla: se separa por tabuladores (o por
   * comas o «|», según lo que traiga), la primera línea pasa a ser cabecera y
   * el resto son filas.
   */
  function convertSelectionToTable() {
    const area = textareaRef.current;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    if (end <= start) return;

    const selected = area.value.slice(start, end);
    const built = tableFromDelimited(selected, selected.includes("\n"));
    if (built.lines.length === 0) return;

    tableAnchorRef.current = null;
    setTableRect(null);
    pendingCaretRef.current = [start + built.caret, start + built.caret];
    editBody(`${area.value.slice(0, start)}${built.lines.join("\n")}${area.value.slice(end)}`);
  }

  /**
   * Supr / Backspace con una tabla de por medio: si el rango toca su
   * estructura, el borrado se reescribe aquí dejando intactos los «|», la fila
   * del separador y los saltos que la unen al resto del documento. Así la
   * tabla nunca desaparece con la tecla de borrar: eso solo lo hace
   * «Eliminar tabla». Devuelve `true` si la pulsación queda consumida.
   */
  function handleTableDeletion(event: KeyboardEvent<HTMLElement>): boolean {
    const area = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!area) return false;

    // Hay un rectángulo de celdas marcado: Supr vacía esas celdas y solo esas.
    // La selección de texto de debajo es más ancha (es la escalera que une las
    // dos puntas), así que no manda aquí.
    const rect = tableRect;
    if (rect) {
      event.preventDefault();
      const cleared = clearTableCells(sourceInfo, rect);
      // Todas las celdas ya estaban vacías: no se toca nada (queda la marca).
      if (!cleared) return true;
      tableAnchorRef.current = null;
      setTableRect(null);
      pendingCaretRef.current = [cleared.caret, cleared.caret];
      editBody(cleared.text);
      return true;
    }

    const backspace = event.key === "Backspace";
    const [start, end] = deletionRange(area.value, area.selectionStart, area.selectionEnd, backspace, event.metaKey || event.ctrlKey);
    if (end <= start) return false;

    const plan = planTableDeletion(sourceInfo, area.value, start, end);
    if (!plan) return false;

    event.preventDefault();
    // Todo lo seleccionado era estructura: no se borra nada.
    if (plan.text === area.value) return true;

    const caret = safeTableCaret(plan.text, plan.caret);
    tableAnchorRef.current = null;
    pendingCaretRef.current = [caret, caret];
    editBody(plan.text);
    return true;
  }

  /**
   * Escribir encima de una selección que abarca la estructura de una tabla:
   * el rango se vacía conservando los «|», la fila del separador y los saltos
   * (como haría Supr) y el carácter tecleado solo entra si puede colocarse sin
   * romper la fila. Así «escribir por encima» no puede dejar la tabla fuera
   * del documento. Devuelve `true` si la tecla queda consumida.
   */
  function handleTableReplace(event: KeyboardEvent<HTMLElement>): boolean {
    const area = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!area || area.selectionEnd <= area.selectionStart) return false;

    // Con celdas marcadas se vacían esas celdas —no la escalera de texto que
    // las une— y el carácter entra en la primera de ellas. Si ya estaban
    // vacías, se escribe directamente donde está el cursor.
    const rect = tableRect;
    const plan =
      rect !== null
        ? (clearTableCells(sourceInfo, rect) ?? {
            text: area.value,
            caret: area.selectionStart,
          })
        : planTableDeletion(sourceInfo, area.value, area.selectionStart, area.selectionEnd);
    if (!plan) return false;

    event.preventDefault();

    const at = safeTableCaret(plan.text, plan.caret);
    const rowLines = plan.text.split("\n").map((text) => ({ text, code: false }));
    const line = lineIndexOf(plan.text, at);
    const before = tableBlockAt(rowLines, line);
    let next = plan.text;
    let typed = false;

    // El carácter se coloca donde estaba el cursor, pero solo si la fila sigue
    // en pie (nada de escribir delante de la «|» inicial ni en el separador).
    const candidate = `${plan.text.slice(0, at)}${event.key}${plan.text.slice(at)}`;
    if (!before) {
      next = candidate;
      typed = true;
    } else {
      const lines2 = candidate.split("\n").map((text) => ({ text, code: false }));
      const after = tableBlockAt(lines2, line);
      if (after && after.start === before.start && after.end === before.end) {
        next = candidate;
        typed = true;
      }
    }

    if (next === area.value) return true;

    const caret = typed ? at + event.key.length : at;
    tableAnchorRef.current = null;
    setTableRect(null);
    pendingCaretRef.current = [caret, caret];
    editBody(next);
    return true;
  }

  /** Líneas actuales del cuerpo con su marca de bloque de código. */
  function currentLines() {
    const area = textareaRef.current;
    return classifySource((area?.value ?? body).split(/\r?\n/));
  }

  /**
   * Aplica una operación de tabla: escribe el resultado, recoloca el cursor en
   * la celda que toque y cierra el menú. La tabla solo puede desaparecer por
   * aquí («Eliminar tabla»), nunca por teclado.
   */
  function applyTableEdit(edit: TableEdit | null) {
    setContextMenu(null);
    setMenu(null);
    if (!edit) return;

    const area = textareaRef.current;
    const current = area?.value ?? body;
    const nextBody = edit.lines.join("\n");
    if (nextBody === current) return;

    tableAnchorRef.current = null;
    const caretLines: TableLine[] = edit.lines.map((text) => ({ text, code: false }));
    if (edit.offset !== undefined) {
      pendingCaretRef.current = [edit.offset, edit.offset];
    } else if (edit.caret) {
      const range = tableCellRange(caretLines, edit.caret.line, edit.caret.col);
      if (range) pendingCaretRef.current = [range.end, range.end];
    } else if (edit.keepCaret && tableCaret) {
      // Alinear u ordenar no mueven al usuario de celda: se recoloca en la que
      // ya estaba, con los offsets recalculados sobre el texto nuevo.
      const range = tableCellRange(caretLines, tableCaret.line, tableCaret.col);
      if (range) pendingCaretRef.current = [range.end, range.end];
    }

    // Cada operación de tabla es un paso de deshacer propio.
    forceHistoryRef.current = true;
    editBody(nextBody);
  }

  /**
   * Atajo de fila/columna: opera sobre la tabla del cursor sin necesidad del
   * menú, que es lo único que cambia respecto a elegirlo en el menú «/».
   */
  function runTableShortcut(action: TableAction) {
    const cell = tableCaret;
    const area = textareaRef.current;
    if (!cell || !area) return;

    handleTableAction(action, {
      block: { start: cell.blockStart, end: cell.blockEnd },
      line: cell.onDelimiter ? cell.blockStart : cell.line,
      col: cell.col,
      cols: cell.cols,
      rect: selectionCellRect(area),
      canDeleteRow: false,
      canDeleteCol: false,
      canSort: false,
      canMoveUp: false,
      canMoveDown: false,
      canToggleTask: false,
      canMerge: false,
      canUnmerge: false,
    });
  }

  /**
   * Acción de tabla, venga del menú contextual o del menú «/» (que la pasa
   * como `target` porque no hay clic derecho detrás).
   */
  function handleTableAction(action: TableAction, explicit?: TableMenuInfo, given?: TableLine[]) {
    const target = explicit ?? contextMenu?.table;
    if (!target) {
      setContextMenu(null);
      return;
    }

    const lines = given ?? currentLines();
    const { block, line, col } = target;
    let edit: TableEdit | null = null;

    switch (action) {
      case "add-row":
        // La fila entra debajo de la que se pulsó, con el cursor en su columna.
        edit = insertTableRow(lines, line, col);
        break;
      case "add-col":
        edit = insertTableColumn(lines, block, col, line);
        break;
      case "del-row":
        edit = removeTableRow(lines, line, col);
        break;
      case "del-col":
        edit = removeTableColumn(lines, block, col, line);
        break;
      case "del-table":
        edit = removeTable(lines, block);
        break;
      case "sort-asc":
        edit = sortTableRows(lines, block, col, false);
        break;
      case "sort-desc":
        edit = sortTableRows(lines, block, col, true);
        break;
      case "align-left":
      case "align-center":
      case "align-right": {
        // Manda la celda que se ve (el puntero sobre la tarjeta pintada): el
        // texto crudo está desalineado con ella y un clic a la derecha de una
        // celda combinada caería en la columna vecina. Si la celda resultante
        // es una continuación, la que se alinea es su maestra: la alineación
        // se guarda en la columna del separador.
        const base = target.visual ?? { line, col };
        const info = computeTableMerges(lines, block.start, block.end).get(`${base.line}:${base.col}`);
        const alignCol = info?.isContinuation ? info.masterCol : base.col;
        const align = action === "align-left" ? "left" : action === "align-center" ? "center" : "right";
        edit = alignTableColumn(lines, block, alignCol, align);
        break;
      }
      case "move-up":
        edit = moveTableRow(lines, line, col, -1);
        break;
      case "move-down":
        edit = moveTableRow(lines, line, col, 1);
        break;
      case "dup-up":
        edit = duplicateTableRow(lines, line, col, -1);
        break;
      case "dup-down":
        edit = duplicateTableRow(lines, line, col, 1);
        break;
      case "toggle-task":
        edit = toggleTableTask(lines, line, col);
        break;
      case "merge-cells": {
        // Une el rectángulo marcado (el menú ya avisó si abarca una sola celda).
        const rect = actionRect(target.rect, tableRect);
        if (rect && isTableMergePossible(rect)) edit = mergeTableCells(lines, rect);
        break;
      }
      case "unmerge-cells":
        // Con marca separa lo marcado; sin ella, el merge de la celda del cursor.
        edit = unmergeTableCells(lines, line, col, actionRect(target.rect, tableRect));
        break;
      case "clipboard": {
        // Al portapapeles va lo marcado: el rectángulo de celdas o, sin él, la
        // celda del cursor (como en una hoja de cálculo).
        setContextMenu(null);
        setMenu(null);
        dropSlashQuery();
        const rect = actionRect(target.rect, tableRect) ?? {
          top: line,
          bottom: line,
          left: col,
          right: col,
        };
        copyCellRect(rect);
        return;
      }
    }

    applyTableEdit(edit);
  }

  /** «+» de abajo: fila nueva por el final, con el cursor en la columna actual. */
  function addTableRowAt(line: number) {
    const lines = currentLines();
    const block = tableBlockAt(lines, line);
    if (!block) return;
    const focus = tableCaret && tableCaret.blockStart === block.start ? tableCaret.col : 0;
    applyTableEdit(insertTableRow(lines, line, focus));
  }

  /** «+» del costado: columna nueva a la derecha, con el cursor en la fila actual. */
  function addTableColumnAt(blockStart: number, col: number) {
    const lines = currentLines();
    const block = tableBlockAt(lines, blockStart);
    if (!block) return;
    const focus =
      tableCaret && tableCaret.blockStart === blockStart ? tableCaret.line : block.start;
    applyTableEdit(insertTableColumn(lines, block, col, focus));
  }

  return {
    autoFitColumn,
    convertSelectionToTable,
    handleTableDeletion,
    handleTableReplace,
    currentLines,
    applyTableEdit,
    runTableShortcut,
    handleTableAction,
    addTableRowAt,
    addTableColumnAt,
  };
}
