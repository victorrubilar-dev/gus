import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SourceLine } from "./InlinePreview";
import { lineIndexOf, lineStartOffset, resolveTableCaret, sourceSegments, tableCellRange, type TableCellCaret, type TableCellRect } from "../lib/tableLayout";
import { type TableSelection } from "./InlinePreview";
import type { useTableKeyboard } from "./useTableKeyboard";


interface CaretTrackingDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  prevTableLineRef: RefObject<number>;
  contextMenuOpenRef: RefObject<boolean>;
  rightClickSelRef: RefObject<[number, number] | null>;
  markedRectRef: RefObject<TableCellRect | null>;
  sourceInfo: SourceLine[];
  tableCols: number | null;
  inlineActive: boolean;
  setCaretLine: Dispatch<SetStateAction<number>>;
  setTableCaret: Dispatch<SetStateAction<TableCellCaret | null>>;
  setTableSelection: Dispatch<SetStateAction<TableSelection | null>>;
  setTableRect: Dispatch<SetStateAction<TableCellRect | null>>;
  setCaretMark: Dispatch<SetStateAction<{ at: number; sel: TableSelection } | null>>;
  selectionCellRect: ReturnType<typeof useTableKeyboard>["selectionCellRect"];
}

/**
 * Dónde está el cursor: línea, celda de tabla y selección. Lo que el overlay
 * necesita saber para pintar el cursor y las celdas marcadas.
 */
export function useCaretTracking(deps: CaretTrackingDeps) {
  const {
    textareaRef, tableAnchorRef, prevTableLineRef, contextMenuOpenRef, rightClickSelRef, markedRectRef, sourceInfo,
    tableCols, inlineActive, setCaretLine, setTableCaret, setTableSelection, setTableRect, setCaretMark,
    selectionCellRect,
  } = deps;

  /**
   * Dónde está el cursor (dentro de su línea) y qué texto está seleccionado,
   * en posiciones absolutas. El overlay lo pinta cuando el textarea no puede:
   * dentro de una tabla (el cursor nativo va en coordenadas de la fuente) o
   * cuando una tabla de arriba ha crecido y lo dejaría descolocado.
   */
  function caretMarkAt(area: HTMLTextAreaElement) {
    const start = area.selectionStart;
    const line = lineIndexOf(area.value, start);
    return {
      at: start - lineStartOffset(sourceInfo, line),
      sel: { start, end: area.selectionEnd },
    };
  }

  function refreshCaretLine() {
    const area = textareaRef.current;
    if (!area) return;
    const selStart = area.selectionStart;
    const selEnd = area.selectionEnd;
    const line = area.value.slice(0, selStart).split("\n").length - 1;
    setCaretLine((current) => (current === line ? current : line));

    // Solo hay modo celda si ese bloque se renderiza como tabla (si no cabe en
    // una línea se queda en crudo y el caret responsable es el nativo).
    const segments =
      inlineActive && tableCols !== null ? sourceSegments(sourceInfo, false, tableCols) : [];
    const inTable = segments.some(
      (segment) => segment.kind === "table" && line >= segment.start && line <= segment.end,
    );
    // Selección que abarca una tabla aunque el cursor esté fuera: la tarjeta
    // tiene otra geometría que el texto crudo, así que su trozo lo marca el
    // overlay. Si no, la selección nativa se pinta en las coordenadas crudas
    // y queda como un fantasma desplazado al lado del texto de la tarjeta (la
    // sensación de «texto seleccionado duplicado al costado derecho»).
    const lineEnd = area.value.slice(0, selEnd).split("\n").length - 1;
    const touchesTable = segments.some(
      (segment) => segment.kind === "table" && segment.start <= lineEnd && segment.end >= line,
    );

    if (!inTable) {
      setTableCaret(null);
      setTableSelection(
        touchesTable && selStart !== selEnd ? { start: selStart, end: selEnd } : null,
      );
      setTableRect(null);
      tableAnchorRef.current = null;
      prevTableLineRef.current = line;
      setCaretMark(caretMarkAt(area));
      return;
    }

    let resolved = resolveTableCaret(sourceInfo, line, selStart, selEnd);

    // La fila del separador (|---|) no es editable: se reubica en la cabecera
    // o en la primera fila de datos según desde dónde se llegó, siempre al
    // final del contenido para que escribir añada sin pisar nada.
    if (resolved?.onDelimiter) {
      const targetLine =
        prevTableLineRef.current === resolved.blockStart
          ? resolved.blockStart + 2
          : resolved.blockStart;
      const range = tableCellRange(sourceInfo, targetLine, resolved.col);
      if (range) {
        area.setSelectionRange(range.end, range.end);
        resolved = resolveTableCaret(sourceInfo, targetLine, range.end, range.end);
      }
    }

    // Selección cruda: resalta todas las celdas que abarca, no solo la activa.
    setTableSelection(
      resolved
        ? { start: area.selectionStart, end: area.selectionEnd }
        : null,
    );
    setTableCaret(resolved);
    prevTableLineRef.current = resolved ? resolved.line : line;
    // Con la selección ya asentada (puede haberse reubicado fuera del
    // separador) se guarda dónde está el cursor: el overlay lo pinta cuando el
    // textarea no puede hacerlo.
    setCaretMark(caretMarkAt(area));
    // Lo que se marca es el rectángulo entre las dos puntas de la selección,
    // no la escalera de texto que las une: así el cuadro no se lleva por delante
    // filas enteras de celdas que nadie marcó.
    //
    // Salvedad: el clic derecho puede colapsar la selección en el motor, y con
    // ella desaparecería el cuadro justo cuando se va a abrir el menú sobre él.
    // Mientras haya un clic derecho pendiente, el cuadro se deja como estaba:
    // sigue siendo lo que la persona tiene seleccionado.
    // Con el menú abierto el rectángulo se congela: es lo que el menú está
    // ofreciendo, y recalcularlo aquí lo tiraría por tierra justo cuando se
    // va a usar. Solo se suelta si el cursor ya no está en una tabla.
    if (contextMenuOpenRef.current || rightClickSelRef.current) {
      // Con el menú abierto (o a punto de abrirse) lo pintado no se toca: es lo
      // que el menú está ofreciendo y recalcularlo aquí lo tiraría por tierra.
      if (!resolved) setTableRect(null);
    } else {
      // El espejo va siempre detrás de lo pintado: si ya no hay celdas
      // marcadas (el cursor se movió, o el bloque dejó de ser tabla), tampoco
      // las hay que recordar para un clic derecho.
      const next = resolved ? selectionCellRect(area) : null;
      markedRectRef.current = next;
      setTableRect(next);
    }
    // Cursor quieto en una celda: esa celda es la ancla de la próxima
    // selección. Aquí se renueva porque Mayús+↑/↓ ni mueve el cursor ni llega
    // por teclado (las selecciones se construyen desde esta ancla).
    if (resolved && area.selectionStart === area.selectionEnd) {
      tableAnchorRef.current = { line: resolved.line, col: resolved.col };
    }
  }

  return { refreshCaretLine };
}
