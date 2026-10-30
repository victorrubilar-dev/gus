import type { ClipboardEvent, Dispatch, RefObject, SetStateAction } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyText } from "../lib/clipboard";
import { cellRectClipboard, clearTableCells, actionRect, planTableDeletion, tableIntersects, type TableCellRect } from "../lib/tableLayout";
import { stripPasteFormatting } from "../lib/pasteText";
import { lineRangeAt } from "../lib/editorText";
import type { SourceLine } from "./InlinePreview";
import type { ContextMenuState, EditorMenu } from "./markdownEditorTypes";

/** Lo que el portapapeles necesita del editor: el campo de texto, la tabla y cómo escribir en la nota. */
export interface EditorClipboardDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  cellDragRef: RefObject<{ anchor: number; line: number; col: number } | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  sourceInfo: SourceLine[];
  tableRect: TableCellRect | null;
  setTableRect: Dispatch<SetStateAction<TableCellRect | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  setMenu: Dispatch<SetStateAction<EditorMenu | null>>;
  editBody: (next: string) => void;
  replaceRange: (start: number, text: string, caretOffset: number, kind?: "insert" | "paste") => void;
  forceHistoryRef: RefObject<boolean>;
  selectionCellRect: (area: HTMLTextAreaElement) => TableCellRect | null;
}

/**
 * Cortar, copiar, pegar y seleccionar todo, con lo propio de las tablas: lo
 * marcado en celdas se copia como tabla y cortar vacía las celdas sin quitarla.
 */
export function useEditorClipboard(deps: EditorClipboardDeps) {
  const { textareaRef, pendingCaretRef, cellDragRef, tableAnchorRef, sourceInfo, tableRect, setTableRect, setContextMenu, setMenu, editBody, replaceRange, forceHistoryRef, selectionCellRect } = deps;

  /**
   * Celdas del rectángulo marcado al portapapeles (Ctrl+C y «Copiar»): lo que
   * se ve es lo que se copia, no la escalera de texto que guarda el textarea.
   */
  function copyCellRect(rect: TableCellRect, clip?: DataTransfer | null): boolean {
    const text = cellRectClipboard(sourceInfo, rect);
    if (!text) return false;
    clip?.setData("text/plain", text);
    void copyText(text).catch(() => undefined);
    return true;
  }

  /**
   * Corta el rectángulo marcado: sus celdas pasan al portapapeles y se vacían,
   * dejando la tabla entera en el documento (igual que Supr, que nunca la
   * quita: eso solo lo hace «Eliminar tabla»).
   */
  function cutCellRect(rect: TableCellRect, clip?: DataTransfer | null) {
    if (!copyCellRect(rect, clip)) return;
    const cleared = clearTableCells(sourceInfo, rect);
    if (!cleared) return;
    tableAnchorRef.current = null;
    setTableRect(null);
    pendingCaretRef.current = [cleared.caret, cleared.caret];
    editBody(cleared.text);
  }

  /**
   * Corte de una selección de texto que abarca varias celdas: al portapapeles
   * van como tabla (con tabuladores) y el borrado respeta justo lo seleccionado
   * —celdas vaciadas y «|» en su sitio— en vez de llevarse filas enteras.
   */
  function cutCellSelection(
    area: HTMLTextAreaElement,
    rect: TableCellRect,
    clip?: DataTransfer | null,
  ) {
    if (!copyCellRect(rect, clip)) return;
    const plan = planTableDeletion(sourceInfo, area.value, area.selectionStart, area.selectionEnd);
    if (!plan || plan.text === area.value) return;
    tableAnchorRef.current = null;
    setTableRect(null);
    cellDragRef.current = null;
    pendingCaretRef.current = [plan.caret, plan.caret];
    editBody(plan.text);
  }

  /** Igual, pero desde el menú (el portapapeles se escribe con `writeText`). */
  async function cutCellSelectionAsync(area: HTMLTextAreaElement, rect: TableCellRect) {
    const text = cellRectClipboard(sourceInfo, rect);
    if (!text) return;
    const copied = await writeText(text)
      .then(() => true)
      .catch(() => false);
    if (!copied) return;

    const plan = planTableDeletion(sourceInfo, area.value, area.selectionStart, area.selectionEnd);
    if (!plan || plan.text === area.value) return;
    tableAnchorRef.current = null;
    setTableRect(null);
    cellDragRef.current = null;
    pendingCaretRef.current = [plan.caret, plan.caret];
    editBody(plan.text);
  }

  async function cutSelection() {
    const area = textareaRef.current;
    setContextMenu(null);
    if (!area) return;

    // Con celdas marcadas se cortan esas celdas y nada más.
    const rect = tableRect;
    if (rect) {
      cutCellRect(rect);
      return;
    }

    // Selección arrastrada que abarca varias celdas: se copian como tabla y se
    // vacía justo lo seleccionado.
    const span = selectionCellRect(area);
    if (span) {
      await cutCellSelectionAsync(area, span);
      return;
    }

    // Sin selección se corta la línea entera, igual que con Ctrl+X.
    const [start, end] =
      area.selectionEnd > area.selectionStart
        ? [area.selectionStart, area.selectionEnd]
        : lineRangeAt(area.value, area.selectionStart);
    const text = area.value.slice(start, end);
    if (!text) return;
    // Lo que rompería una tabla no se corta (eso solo lo hace «Eliminar tabla»).
    if (planTableDeletion(sourceInfo, area.value, start, end)) return;
    const copied = await writeText(text)
      .then(() => true)
      .catch(() => false);
    if (!copied) return;
    // Igual que Ctrl+X: sin mover antes la selección, el deshacer conserva el
    // cursor y no la línea ya recortada.
    pendingCaretRef.current = [start, start];
    editBody(`${area.value.slice(0, start)}${area.value.slice(end)}`);
  }

  /**
   * Corta la línea entera del cursor (Ctrl+X sin selección, como en VS Code).
   * No se selecciona la línea antes de borrar: así el paso de deshacer guarda
   * la posición real del cursor y Ctrl+Z lo devuelve a donde estaba.
   */
  function cutCurrentLine(clip?: DataTransfer | null): boolean {
    const area = textareaRef.current;
    if (!area) return false;

    const [start, end] = lineRangeAt(area.value, area.selectionStart);
    if (end <= start) return false;
    // La fila de una tabla no se corta: eso rompería el bloque.
    if (planTableDeletion(sourceInfo, area.value, start, end)) return false;

    setContextMenu(null);
    setMenu(null);
    const text = area.value.slice(start, end);
    // El texto va al portapapeles: si el evento lo trae, ahí mismo; en todo
    // caso, por el plugin (el mismo que lee «Pegar» del menú).
    clip?.setData("text/plain", text);
    void writeText(text).catch(() => undefined);

    pendingCaretRef.current = [start, start];
    editBody(`${area.value.slice(0, start)}${area.value.slice(end)}`);
    return true;
  }

  /**
   * Ctrl+X sin selección: corta la línea entera. Con selección manda el corte
   * nativo, que ya lleva el texto al portapapeles.
   */
  function handleCut(event: ClipboardEvent<HTMLTextAreaElement>) {
    const area = textareaRef.current;
    if (!area || event.defaultPrevented) return;

    // Rectángulo de celdas marcado: se copian sus celdas y se vacían.
    const rect = tableRect;
    if (rect) {
      event.preventDefault();
      cutCellRect(rect, event.clipboardData);
      return;
    }

    // Selección arrastrada que abarca varias celdas: al portapapeles van como
    // tabla y el borrado respeta lo seleccionado.
    const span = selectionCellRect(area);
    if (span) {
      event.preventDefault();
      cutCellSelection(area, span, event.clipboardData);
      return;
    }

    if (area.selectionEnd > area.selectionStart) {
      // Con selección manda el corte nativo, salvo que el rango toque la
      // estructura de una tabla: entonces no se corta nada.
      if (planTableDeletion(sourceInfo, area.value, area.selectionStart, area.selectionEnd)) {
        event.preventDefault();
      }
      return;
    }

    const [start, end] = lineRangeAt(area.value, area.selectionStart);
    if (end <= start) return;

    event.preventDefault();
    forceHistoryRef.current = true;
    cutCurrentLine(event.clipboardData);
  }

  /**
   * Ctrl+C con celdas marcadas: al portapapeles va lo que se ve (esas celdas,
   * con tabuladores de por medio) y no la escalera de texto que el textarea
   * guarda por debajo, que se llevaría filas de más. También vale para una
   * selección hecha arrastrando sobre varias celdas: lo que has encerrado son
   * celdas, así que se copia como tabla y no con los «|» del crudo.
   */
  function handleCopy(event: ClipboardEvent<HTMLTextAreaElement>) {
    const area = textareaRef.current;
    const rect = actionRect(area ? selectionCellRect(area) : null, tableRect);
    if (!rect) return;
    event.preventDefault();
    copyCellRect(rect, event.clipboardData);
  }

  async function copySelection() {
    const area = textareaRef.current;
    setContextMenu(null);
    if (area && tableRect) {
      copyCellRect(tableRect);
      return;
    }
    const text = area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
    if (!text) return;
    await writeText(text).catch(() => undefined);
  }

  async function pasteClipboard(plain: boolean) {
    const area = textareaRef.current;
    setContextMenu(null);
    if (!area) return;
    try {
      const raw = await readText();
      if (!raw) return;
      const text = plain ? stripPasteFormatting(raw) : raw;
      replaceRange(area.selectionStart, text, text.length, "paste");
    } catch {
      // portapapeles no disponible en este entorno
    }
  }

  /**
   * Ctrl+V (y el pegado nativo en general): se intercepta para que una línea
   * numerada pegada en un sitio nuevo arranque en 1, como lista nueva.
   */
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const area = textareaRef.current;
    if (!area || event.defaultPrevented) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    // Sin texto que pegar se deja el comportamiento nativo (p. ej. vacío).
    if (!text) return;

    // El pegado nativo queda anulado desde aquí: lo que sigue decide si el
    // texto puede entrar.
    event.preventDefault();
    setContextMenu(null);

    // No se pega encima de la estructura de una tabla, ni varias líneas
    // dentro de una celda (una tabla pegada dentro de otra la rompería).
    if (planTableDeletion(sourceInfo, area.value, area.selectionStart, area.selectionEnd)) return;
    if (
      text.includes("\n") &&
      tableIntersects(sourceInfo, area.value, area.selectionStart, area.selectionEnd)
    ) {
      return;
    }

    replaceRange(area.selectionStart, text, text.length, "paste");
  }

  function selectAllText() {
    textareaRef.current?.select();
    setContextMenu(null);
  }

  return {
    copyCellRect,
    cutCurrentLine,
    cutSelection,
    handleCut,
    handleCopy,
    copySelection,
    pasteClipboard,
    handlePaste,
    selectAllText,
  };
}
