import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import type { SourceLine } from "./InlinePreview";

import { isPersonalWord, spellWordAt } from "../lib/spellCheck";
import { offsetAtPointer } from "../lib/pointerOffset";
import { toLocalCoord } from "../lib/uiZoom";
import { isTableMergePossible, isTableTaskCell, isTableUnmergePossible, lineIndexOf, resolveTableCaret, splitTableCells, type TableCellRect } from "../lib/tableLayout";
import type { ContextSpell, TableMenuInfo } from "./EditorContextMenu";
import type { useTableKeyboard } from "./useTableKeyboard";
import type { useEditorSpell } from "./useEditorSpell";
import type { EditorMenu, ContextMenuState } from "./markdownEditorTypes";


interface EditorContextMenuDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  rightClickSelRef: RefObject<[number, number] | null>;
  tableCellsRef: RefObject<HTMLElement[]>;
  markedRectRef: RefObject<TableCellRect | null>;
  contextMenuOpenRef: RefObject<boolean>;
  sourceInfo: SourceLine[];
  tableRect: TableCellRect | null;
  setMenu: Dispatch<SetStateAction<EditorMenu | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  driftAtPointer: (clientY: number) => number;
  engine: ReturnType<typeof useEditorSpell>["engine"];
  setSpellPopup: ReturnType<typeof useEditorSpell>["setSpellPopup"];
  cellRectBetween: ReturnType<typeof useTableKeyboard>["cellRectBetween"];
}

/** Menú contextual (clic derecho): qué hay bajo el puntero (palabra errónea, selección, celda de tabla) y dónde abrirlo. */
export function useEditorContextMenu(deps: EditorContextMenuDeps) {
  const {
    textareaRef, rightClickSelRef, tableCellsRef, markedRectRef, contextMenuOpenRef, sourceInfo, tableRect, setMenu,
    setContextMenu, driftAtPointer, engine, setSpellPopup, cellRectBetween,
  } = deps;

  function openEditorMenu(clientX: number, clientY: number) {
    const area = textareaRef.current;
    if (!area) return;
    contextMenuOpenRef.current = true;
    const selStart = area.selectionStart;
    const selEnd = area.selectionEnd;
    let spell: ContextSpell | null = null;

    if (engine) {
      let span: ReturnType<typeof spellWordAt> = null;
      if (selStart !== selEnd) {
        const selected = area.value.slice(selStart, selEnd);
        if (/^[\p{L}][\p{L}'’]*$/u.test(selected)) {
          span = spellWordAt(area.value, selStart, engine.correct);
        }
      } else {
        const offset = offsetAtPointer(area, clientX, clientY, driftAtPointer(clientY)) ?? selStart;
        span = spellWordAt(area.value, offset, engine.correct);
      }

      if (span) {
        if (span.bad) {
          spell = {
            mode: "misspelled",
            word: span.word,
            start: span.start,
            end: span.end,
            suggestions: engine.suggest(span.word),
          };
        } else if (isPersonalWord(span.word)) {
          spell = {
            mode: "personal",
            word: span.word,
            start: span.start,
            end: span.end,
            suggestions: [],
          };
        }
      }
    }

    setMenu(null);
    setSpellPopup(null);
    setContextMenu({
      spell,
      hasSelection: selStart !== selEnd,
      table: tableTargetAt(clientX, clientY),
      x: toLocalCoord(clientX),
      y: toLocalCoord(clientY),
    });
  }

  /**
   * Tabla bajo el clic derecho: fila y columna apuntadas (nunca la del
   * separador) y el rectángulo de celdas marcadas que trae el menú, para
   * que las acciones sepan qué celdas tocan («Copiar celdas» lleva lo
   * marcado, o la celda del cursor si no hay marca).
   */
  /**
   * Celda de la tarjeta pintada que hay bajo el puntero. La tarjeta y el texto
   * crudo no están alineados columna a columna (una celda combinada es mucho
   * más ancha que su texto), así que para alinear manda lo que se ve: una celda
   * combinada tapa sus continuaciones, con lo que el rect que se encuentra es
   * siempre el de su maestra.
   */
  function visualCellAt(clientX: number, clientY: number): { line: number; col: number } | null {
    for (const cell of tableCellsRef.current) {
      const rect = cell.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const line = Number(cell.dataset.line);
        const col = Number(cell.dataset.col);
        if (Number.isFinite(line) && Number.isFinite(col)) return { line, col };
      }
    }
    return null;
  }

  function tableTargetAt(clientX: number, clientY: number): TableMenuInfo | null {
    const area = textareaRef.current;
    if (!area) return null;

    const value = area.value;
    const at = offsetAtPointer(area, clientX, clientY, driftAtPointer(clientY)) ?? area.selectionStart;
    // El motor puede colapsar la selección al pulsar el botón derecho: si lo
    // hizo, se usan las filas que había justo antes del clic.
    const picked = rightClickSelRef.current;
    rightClickSelRef.current = null;

    // Dónde se ha resuelto la celda del clic. Si el puntero no da una celda
    // (está sobre el margen, o el cálculo se ha quedado corto porque la tabla
    // ha crecido), se recurre al cursor: si estaba dentro de una tabla, la
    // sección de tabla del menú debe aparecer igualmente, que si no las
    // acciones de tabla desaparecen sin explicación.
    let resolved = resolveTableCaret(sourceInfo, lineIndexOf(value, at), at, at);
    if (!resolved) {
      const caretAt = area.selectionStart;
      resolved = resolveTableCaret(sourceInfo, lineIndexOf(value, caretAt), caretAt, caretAt);
    }
    if (!resolved) return null;

    const block = { start: resolved.blockStart, end: resolved.blockEnd };
    const line = resolved.onDelimiter ? resolved.blockStart : resolved.line;
    const selection = picked ?? [area.selectionStart, area.selectionEnd];

    // El rectángulo se calcula con la selección guardada; si esa ya no vale (el
    // clic derecho la colapsó y la dejó sin celdas), se cae al que está
    // pintado, que es lo que la persona ve seleccionado en pantalla.
    const marked =
      cellRectBetween(selection[0], selection[1]) ?? tableRect ?? markedRectRef.current;

    return {
      block,
      line,
      col: resolved.col,
      cols: resolved.cols,
      rect: marked,
      visual: visualCellAt(clientX, clientY),
      canDeleteRow: line > block.start + 1 && block.end - block.start >= 3,
      canDeleteCol: resolved.cols > 2,
      canSort: block.end - block.start >= 3,
      canMoveUp: line > block.start + 1,
      canMoveDown: line >= block.start + 2 && line < block.end,
      canToggleTask: isTableTaskCell(
        splitTableCells(sourceInfo[line]?.text ?? "")[resolved.col]?.text ?? "",
      ),
      canMerge: isTableMergePossible(marked),
      canUnmerge: isTableUnmergePossible(sourceInfo, line, resolved.col, marked),
    };
  }

  function handleContextMenu(event: MouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    openEditorMenu(event.clientX, event.clientY);
  }

  return { openEditorMenu, handleContextMenu };
}
