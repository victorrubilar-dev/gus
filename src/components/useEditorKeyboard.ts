import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type { SourceLine } from "./InlinePreview";
import { formatSelection } from "../lib/textFormat";
import { listEnterEdit } from "../lib/listContinue";
import { orderedBlockAt, type OrderedBlockRef, type PasteRange } from "../lib/listNumbering";
import { moveLines } from "../lib/moveLines";
import { comboFor, matchesCombo, type ShortcutId, type ShortcutMap } from "../lib/shortcuts";
import { duplicateTableRow, lineIndexOf, moveTableRow, tableIntersects, tableSkeleton, type TableCellCaret, type TableLine } from "../lib/tableLayout";
import { caretAnchor } from "../lib/caretPosition";
import { wikiInsertText, wikiMatches, type WikiNote } from "../lib/wikiLink";
import { filterSlashItems, type SlashItem } from "./EditorMenus";
import type { useTableActions } from "./useTableActions";
import { type FormatKind, type TableAction } from "./EditorContextMenu";
import type { useTableKeyboard } from "./useTableKeyboard";
import type { useEditorImages } from "./useEditorImages";
import type { useEditorClipboard } from "./useEditorClipboard";
import type { useEditorSpell } from "./useEditorSpell";
import type { EditorMenu, ContextMenuState, ViewMode } from "./markdownEditorTypes";


interface EditorKeyboardDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  forceHistoryRef: RefObject<boolean>;
  shortcutsRef: RefObject<ShortcutMap | null>;
  persistRef: RefObject<() => Promise<boolean>>;
  sourceInfo: SourceLine[];
  viewMode: ViewMode;
  setViewMode: Dispatch<SetStateAction<ViewMode>>;
  menu: EditorMenu | null;
  setMenu: Dispatch<SetStateAction<EditorMenu | null>>;
  contextMenu: ContextMenuState | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  headerMenu: boolean;
  setHeaderMenu: Dispatch<SetStateAction<boolean>>;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  composing: boolean;
  setComposing: Dispatch<SetStateAction<boolean>>;
  tableCaret: TableCellCaret | null;
  wikiNotes: WikiNote[];
  replaceRange: (start: number, text: string, caretOffset: number, kind?: "insert" | "paste") => void;
  editBody: (nextBody: string, paste?: PasteRange, previous?: OrderedBlockRef | null) => { body: string; caret: number };
  handleCaretMove: () => void;
  applyUndo: () => void;
  applyRedo: () => void;
  currentLines: ReturnType<typeof useTableActions>["currentLines"];
  runTableShortcut: ReturnType<typeof useTableActions>["runTableShortcut"];
  handleTableAction: ReturnType<typeof useTableActions>["handleTableAction"];
  handleTableDeletion: ReturnType<typeof useTableActions>["handleTableDeletion"];
  handleTableReplace: ReturnType<typeof useTableActions>["handleTableReplace"];
  applyTableEdit: ReturnType<typeof useTableActions>["applyTableEdit"];
  convertSelectionToTable: ReturnType<typeof useTableActions>["convertSelectionToTable"];
  handleTableNav: ReturnType<typeof useTableKeyboard>["handleTableNav"];
  selectionCellRect: ReturnType<typeof useTableKeyboard>["selectionCellRect"];
  cutCurrentLine: ReturnType<typeof useEditorClipboard>["cutCurrentLine"];
  handleSpellPopupKeys: ReturnType<typeof useEditorSpell>["handleSpellPopupKeys"];
  applySpellCorrection: ReturnType<typeof useEditorSpell>["applySpellCorrection"];
  imageMatches: ReturnType<typeof useEditorImages>["imageMatches"];
  loadVaultImages: ReturnType<typeof useEditorImages>["loadVaultImages"];
  insertVaultImage: ReturnType<typeof useEditorImages>["insertVaultImage"];
  insertImagesFromComputer: ReturnType<typeof useEditorImages>["insertImagesFromComputer"];
}

/** Teclado del editor (Intro en listas, Tab, formato, atajos), y acciones de los menús «/», wiki e imágenes. */
export function useEditorKeyboard(deps: EditorKeyboardDeps) {
  const {
    textareaRef, pendingCaretRef, tableAnchorRef, forceHistoryRef, shortcutsRef, persistRef, sourceInfo, viewMode,
    setViewMode, menu, setMenu, contextMenu, setContextMenu, headerMenu, setHeaderMenu, setExportOpen, composing,
    setComposing, tableCaret, wikiNotes, replaceRange, editBody, handleCaretMove, applyUndo, applyRedo, currentLines,
    runTableShortcut, handleTableAction, handleTableDeletion, handleTableReplace, applyTableEdit, convertSelectionToTable,
    handleTableNav, selectionCellRect, cutCurrentLine, handleSpellPopupKeys, applySpellCorrection, imageMatches,
    loadVaultImages, insertVaultImage, insertImagesFromComputer,
  } = deps;

  function insertWikiNote(note: WikiNote) {
    if (!menu) return;
    const text = wikiInsertText(wikiNotes, note);
    replaceRange(menu.start, text, text.length);
  }

  function insertWikiRaw() {
    if (!menu) return;
    const text = `[[${menu.query}]]`;
    replaceRange(menu.start, text, text.length);
  }

  function insertSlashItem(item: SlashItem) {
    if (!menu) return;
    // En el menú «/» lo que se sustituye es el propio `/consulta` del documento.
    runMenuItem(item, menu.start);
  }

  /**
   * Alt+↑ / Alt+↓: mueve la línea del cursor (o las líneas seleccionadas) una
   * posición arriba o abajo, como en VS Code. Devuelve `true` si se movió.
   */
  function moveLine(direction: -1 | 1): boolean {
    const area = textareaRef.current;
    if (!area || viewMode === "preview") return false;

    const before = area.value;
    // El arranque de la lista que toca el cursor se toma antes de mover: así,
    // al renumerar, la lista conserva su primer número aunque cambie de orden.
    const previous = orderedBlockAt(before, area.selectionStart);
    const edit = moveLines(before, area.selectionStart, area.selectionEnd, direction);
    if (!edit) return false;

    // Las filas de una tabla no se mueven: saldrían del bloque.
    if (tableIntersects(sourceInfo, before, edit.start, edit.end)) return false;

    // El movimiento es un paso de deshacer propio, igual que pegar o cortar.
    forceHistoryRef.current = true;
    pendingCaretRef.current = [edit.start, edit.end];
    setContextMenu(null);

    const result = editBody(edit.text, undefined, previous);
    if (result.body === before) {
      pendingCaretRef.current = null;
      return false;
    }

    // Si el cursor cae dentro de una lista numerada, `editBody` la renumera y
    // el texto puede cambiar de longitud: la selección se corrige con ese
    // mismo desplazamiento para no perder la columna.
    const shift = result.caret - edit.start;
    pendingCaretRef.current = [result.caret, Math.max(result.caret, edit.end + shift)];
    return true;
  }

  function applyFormat(kind: FormatKind) {
    setContextMenu(null);
    const area = textareaRef.current;
    if (!area) return;
    const start = area.selectionStart;
    const { text, caret } = formatSelection(kind, area.value.slice(start, area.selectionEnd));
    replaceRange(start, text, caret);
  }

  /**
   * Elementos del menú «/». Con el cursor dentro de una tabla solo aparecen las
   * acciones de esa tabla: allí los bloques no caben.
   */
  function slashItems(query: string): SlashItem[] {
    const insideTable = tableCaret !== null;
    const items = filterSlashItems(query, insideTable);
    if (insideTable) return items;
    // Fuera de una tabla, convertir texto en tabla solo tiene sentido con algo
    // seleccionado: si no, el ítem no se ofrece.
    const area = textareaRef.current;
    const hasSelection = area !== null && area.selectionEnd > area.selectionStart;
    return hasSelection ? items : items.filter((item) => item.id !== "table-from-text");
  }

  function insertFromMenu(item: SlashItem) {
    setContextMenu(null);
    const area = textareaRef.current;
    if (!area) return;
    // Desde el menú contextual lo que se sustituye es el texto del cursor.
    runMenuItem(item, area.selectionStart);
  }

  /**
   * Líneas del documento con el trozo `menu.start..caret` (el `/consulta`)
   * eliminado de la línea del cursor. Se usa para que las acciones del menú «/»
   * se apliquen sobre el texto limpio sin generar un segundo paso de deshacer.
   */
  function linesWithout(from: number, caret: number): TableLine[] {
    const area = textareaRef.current;
    if (!area || caret <= from) return currentLines();
    const line = lineIndexOf(area.value, caret);
    const text = area.value;
    const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
    const breakAt = text.indexOf("\n", caret);
    const lineEnd = breakAt === -1 ? text.length : breakAt;
    const cleaned = text.slice(lineStart, from) + text.slice(caret, lineEnd);
    return currentLines().map((entry, index) =>
      index === line ? { ...entry, text: cleaned } : entry,
    );
  }

  /**
   * Lo que hace un elemento del menú, sea del «/» o del contextual: si es una
   * acción de tabla, opera sobre la del cursor; si lleva a otro grupo, cambia
   * el grupo; y si trae texto (o un tamaño), lo inserta en `from`.
   */
  function runMenuItem(item: SlashItem, from: number) {
    const area = textareaRef.current;
    if (!area) return;

    // Acción de tabla: no inserta texto, opera sobre la tabla del cursor.
    if (item.tableAction) {
      const cell = tableCaret;
      if (!cell) return;
      const block = { start: cell.blockStart, end: cell.blockEnd };
      setMenu(null);
      handleTableAction(
        item.tableAction,
        {
          block,
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
        },
        // El «/consulta» no forma parte de la tabla: se borra en la misma
        // operación, para que deshacer deshaga la acción y no el texto previo.
        menu?.kind === "slash" ? linesWithout(menu.start, area.selectionEnd) : undefined,
      );
      return;
    }

    // La tabla entra ya con sus medidas (3×5) y el cursor en la primera celda
    // de datos. Se llama a replaceRange sin mover antes la selección: el rango
    // va de `from` al cursor, y si el cursor se colapsa en `from` la consulta
    // «/tabla» se quedaba pegada al final de la tabla.
    if (item.size) {
      const skeleton = tableSkeleton(item.size.cols, item.size.rows);
      setMenu(null);
      replaceRange(from, skeleton.text, skeleton.caret);
      return;
    }

    if (item.convertSelection) {
      setMenu(null);
      convertSelectionToTable();
      return;
    }

    // Imagen del vault: se abre el selector con las imágenes del vault. La
    // consulta del «/» se queda en el documento mientras tanto: la sustituye
    // el enlace que se inserta al elegir una.
    if (item.imageSource === "vault") {
      setMenu({
        kind: "images",
        start: from,
        query: "",
        index: 0,
        anchor: caretAnchor(area, area.selectionStart),
      });
      loadVaultImages();
      return;
    }

    // Imagen del equipo: se elige en el diálogo del sistema y, mientras se
    // decide, el menú se cierra (el enlace entra al volver).
    if (item.imageSource === "computer") {
      setMenu(null);
      void insertImagesFromComputer(from);
      return;
    }

    // Desde el menú «/» hay que sustituir la consulta, que ocupa hasta el
    // cursor: colapsar el rango la dejaba pegada al bloque («# /titu»). Desde
    // el menú contextual, en cambio, hay selección y se inserta delante sin
    // comérsela.
    if (menu?.kind !== "slash") area.setSelectionRange(from, from);
    replaceRange(from, item.snippet, item.caretOffset);
  }

  /** ¿La pulsación es el atajo indicado? Null = no hay atajo asignado. */
  function isShortcut(event: KeyboardEvent<HTMLElement>, id: ShortcutId): boolean {
    const combo = comboFor(shortcutsRef.current, id);
    return combo !== "" && matchesCombo(event, combo);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Una composición que no recibió `compositionend` (tecla muerta de tilde
    // abandonada) dejaría la renumeración de listas y la edición de tablas
    // paradas: una tecla que no forme parte de la composición la da por
    // terminada.
    if (composing && !event.nativeEvent.isComposing) setComposing(false);

    // El selector de imágenes se lleva el teclado mientras está abierto: sus
    // teclas escriben en la consulta del menú y no deben llegar al documento.
    if (menu?.kind === "images") {
      handleImageMenuKeys(event);
      if (event.defaultPrevented) return;
    }

    // La ancla de la selección multifila solo vive mientras se extiende con
    // Mayús: cualquier otra tecla la retira.
    if (!event.shiftKey && !/^(Shift|Control|Meta|Alt)$/.test(event.key)) {
      tableAnchorRef.current = null;
    }

    // Supr / Backspace: la estructura de una tabla no se toca con la tecla de
    // borrar (se conservan separadores, fila «|---|» y saltos de línea).
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.nativeEvent.isComposing &&
      handleTableDeletion(event)
    ) {
      return;
    }

    // Igual para escribir encima de una selección que abarca esas filas.
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing &&
      handleTableReplace(event)
    ) {
      return;
    }

    if (event.key === "Escape" && (contextMenu || headerMenu)) {
      event.preventDefault();
      setContextMenu(null);
      setHeaderMenu(false);
      return;
    }

    // Alt+Intro corrige la palabra errónea bajo el cursor, sin usar el ratón.
    if (isShortcut(event, "applySuggestion")) {
      const applied = applySpellCorrection();
      if (applied) {
        event.preventDefault();
        return;
      }
    }

    if (isShortcut(event, "saveNote")) {
      event.preventDefault();
      void persistRef.current();
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    // Ctrl+A dentro de una celda: marca todo el texto de esa celda, no el
    // documento entero.
    if (mod && !event.altKey && key === "a" && tableCaret) {
      const cellArea = event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (cellArea) {
        event.preventDefault();
        // La celda queda marcada y a la vez es la ancla: Mayús+flechas siguen
        // ampliando desde ella.
        tableAnchorRef.current = { line: tableCaret.line, col: tableCaret.col };
        cellArea.setSelectionRange(tableCaret.cellStart, tableCaret.cellEnd);
        handleCaretMove();
        return;
      }
    }

    if (isShortcut(event, "undo") && !event.shiftKey) {
      event.preventDefault();
      applyUndo();
      return;
    }
    // Mayús con el atajo de deshacer vuelve a hacer, como en cualquier editor.
    if ((isShortcut(event, "redo") || (isShortcut(event, "undo") && event.shiftKey)) && !event.altKey) {
      event.preventDefault();
      applyRedo();
      return;
    }
    if (isShortcut(event, "toggleView")) {
      event.preventDefault();
      setViewMode(viewMode === "edit" ? "preview" : "edit");
      return;
    }

    if (isShortcut(event, "exportPdf")) {
      event.preventDefault();
      setHeaderMenu(false);
      setExportOpen(true);
      return;
    }

    // Formato rápido: negrita, cursiva, subrayado, tachado y código en línea.
    // Solo si el atajo está asignado (siempre lleva Ctrl/Alt: si no, escribiría).
    if (!event.nativeEvent.isComposing) {
      const formats: [ShortcutId, FormatKind][] = [
        ["bold", "bold"],
        ["italic", "italic"],
        ["underline", "strike"],
        ["strikethrough", "strike"],
        ["inlineCode", "code"],
      ];
      for (const [id, kind] of formats) {
        if (!isShortcut(event, id)) continue;
        event.preventDefault();
        applyFormat(kind);
        return;
      }

      // En una tabla, los atajos de fila y columna crecen la rejilla en vez de
      // formatear: allí lo que hace falta es añadir sitio.
      const tableShortcut: [ShortcutId, TableAction][] = [
        ["addRow", "add-row"],
        ["addColumn", "add-col"],
      ];
      if (tableCaret) {
        for (const [id, action] of tableShortcut) {
          if (!isShortcut(event, id)) continue;
          event.preventDefault();
          runTableShortcut(action);
          return;
        }
      }
    }

    if (mod && !event.altKey && (key === "v" || key === "x")) {
      // Pegar o cortar inicia un grupo de deshacer propio.
      forceHistoryRef.current = true;
    }

    if (mod && !event.altKey && key === "x") {
      // Sin selección, Ctrl+X corta la línea entera (como en VS Code). Si se
      // corta aquí no llega a emitirse el evento nativo de corte, así que no
      // hay doble corte.
      const area = event.target instanceof HTMLTextAreaElement ? event.target : null;
      if (area && area.selectionStart === area.selectionEnd && cutCurrentLine()) {
        event.preventDefault();
        return;
      }
    }

    // Los mismos atajos dentro de una tabla mueven la fila del cursor (y con
    // Mayús la duplican): mover la línea entera la sacaría del bloque, así que
    // aquí manda la fila, como en una hoja de cálculo.
    const movingUp = isShortcut(event, "moveLineUp");
    const movingDown = isShortcut(event, "moveLineDown");
    if (
      tableCaret &&
      (movingUp || movingDown) &&
      !event.nativeEvent.isComposing
    ) {
      const lines = currentLines();
      const up = movingUp;
      const edit = event.shiftKey
        ? duplicateTableRow(lines, tableCaret.line, tableCaret.col, up ? -1 : 1)
        : moveTableRow(lines, tableCaret.line, tableCaret.col, up ? -1 : 1);
      if (edit) {
        event.preventDefault();
        applyTableEdit(edit);
        return;
      }
    }

    // El atajo mueve la línea del cursor (o las seleccionadas) una posición,
    // como en VS Code. Con un menú desplegado manda el menú.
    if ((movingUp || movingDown) && !menu && moveLine(movingUp ? -1 : 1)) {
      event.preventDefault();
      return;
    }

    if (menu) {
      handleMenuKeyDown(event);
      if (event.defaultPrevented) return;
    }

    if (handleSpellPopupKeys(event)) return;

    handleTableNav(event);
    if (event.defaultPrevented) return;

    handleListEnter(event);
  }

  function handleListEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.nativeEvent.isComposing) return;

    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    if (area.selectionStart !== area.selectionEnd) return;

    const edit = listEnterEdit(area.value, area.selectionStart);
    if (!edit) {
      return;
    }

    event.preventDefault();
    replaceRange(edit.start, edit.insert, edit.caret - edit.start);
  }

  /**
   * Teclado del selector de imágenes. Mientras está abierto las teclas no van
   * al documento: escriben en la consulta del menú (el textarea conserva el
   * foco, que es lo que hace que el cursor no se mueva), ↑↓ recorren, Intro
   * inserta y Esc cierra.
   */
  function handleImageMenuKeys(event: KeyboardEvent<HTMLElement>) {
    const selector = menu;
    if (!selector || selector.kind !== "images") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      setMenu({ ...selector, query: selector.query.slice(0, -1), index: 0 });
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const size = imageMatches.length;
      event.preventDefault();
      if (size === 0) return;

      const actual = Math.min(selector.index, size - 1);
      const siguiente =
        event.key === "ArrowDown"
          ? (actual + 1) % size
          : actual <= 0
            ? size - 1
            : actual - 1;
      setMenu({ ...selector, index: siguiente });
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      // Sin coincidencias no se cierra: se sigue afinando la consulta.
      const elegida = imageMatches[Math.min(selector.index, imageMatches.length - 1)];
      if (!elegida) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      insertVaultImage(elegida);
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      setMenu({ ...selector, query: selector.query + event.key, index: 0 });
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menu) return;

    // El selector de imágenes tiene teclado propio (se gestiona al principio
    // de handleKeyDown): aquí no hay nada que hacer con él.
    if (menu.kind === "images") return;

    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const size =
        menu.kind === "wiki"
          ? wikiMatches(wikiNotes, menu.query).length
          : slashItems(menu.query).length;
      if (size === 0) return;

      const current = Math.min(menu.index, size - 1);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % size
          : current <= 0
            ? size - 1
            : current - 1;
      setMenu({ ...menu, index: next });
      return;
    }

    if (event.key !== "Enter" && event.key !== "Tab") return;

    if (menu.kind === "wiki") {
      const matches = wikiMatches(wikiNotes, menu.query);
      event.preventDefault();
      if (matches.length === 0) insertWikiRaw();
      else insertWikiNote(matches[Math.min(menu.index, matches.length - 1)]);
      return;
    }

    const items = slashItems(menu.query);
    if (items.length === 0) return;
    event.preventDefault();
    insertSlashItem(items[Math.min(menu.index, items.length - 1)]);
  }

  return {
    insertWikiNote,
    insertSlashItem,
    applyFormat,
    slashItems,
    insertFromMenu,
    handleKeyDown,
  };
}
