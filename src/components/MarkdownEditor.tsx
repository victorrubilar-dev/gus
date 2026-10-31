import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import type { ImageInsertResult } from "../lib/importFiles";
import { DRAG_ENTRY_MIME } from "./FileExplorer";
import { isImagePath } from "../lib/imageLinks";
import { renumberAfterPaste, renumberOrderedLists, type OrderedBlockRef, type PasteRange } from "../lib/listNumbering";
import { codeBlocks, type CodeBlockInfo } from "../lib/codeBlocks";
import { type SpellLang } from "../lib/spellCheck";
import { comboFor, comboLabel, type ShortcutMap } from "../lib/shortcuts";
import { useT } from "../lib/i18n";
import { charWidthPx, offsetAtPointer } from "../lib/pointerOffset";
import { planTableDeletion, sourceSegments, splitTableCells, tableBlockAt, tableCellRange, tableIntersects, type TableCellCaret, type TableCellRect, type TableLine } from "../lib/tableLayout";
import { recordHistory, redoHistory, undoHistory, type HistorySnapshot } from "../lib/editorHistory";
import { frontmatterLineOffset, replaceBody, stripFrontmatter } from "../lib/noteTags";
import EditorHeader from "./EditorHeader";
import { caretAnchor, lineAtCaret } from "../lib/caretPosition";
import { detectSlashQuery, detectWikiQuery, wikiMatches, type WikiNote } from "../lib/wikiLink";
import { SlashMenu, SpellSuggestMenu, VaultImageMenu, WikiLinkMenu } from "./EditorMenus";
import { useNotePersistence } from "./useNotePersistence";
import { useCaretTracking } from "./useCaretTracking";
import { useEditorKeyboard } from "./useEditorKeyboard";
import { useEditorContextMenu } from "./useEditorContextMenu";
import { usePointerEvents } from "./usePointerEvents";
import { useTableActions } from "./useTableActions";
import { useBlockDrift } from "./useBlockDrift";
import InlinePreview, { classifySource, type TableBarHover, type TableResizeHover, type TableSelection } from "./InlinePreview";
import EditorContextMenu from "./EditorContextMenu";
import PdfExportDialog from "./PdfExportDialog";
import { useTableKeyboard } from "./useTableKeyboard";
import { useTableResize } from "./useTableResize";
import { clampColumnWidths, sameWidths } from "../lib/editorMeasure";
import { useEditorHistory } from "./useEditorHistory";
import { readExplorerEntry, useEditorImages } from "./useEditorImages";
import { useEditorClipboard } from "./useEditorClipboard";
import { useEditorSpell } from "./useEditorSpell";
import type { EditorMenu, ContextMenuState, ImageResizeDrag, SaveState, ViewMode } from "./markdownEditorTypes";
import { countWords } from "../lib/editorText";
import { measureRowPitch, measureTableCols } from "../lib/editorMeasure";
import { MarkdownBody } from "./markdownPreview";
import EditorPreview, { usePreviewComponents } from "./EditorPreview";

export interface EditorDraft {
  path: string;
  title: string;
  content: string;
}

export interface MarkdownEditorHandle {
  flush: () => Promise<boolean>;
  /** ¿Hay texto sin guardar? */
  isDirty: () => boolean;
  /** Olvida lo no guardado: así desmontar el editor no pisa el disco con ello. */
  discardChanges: () => void;
  requestExport: () => void;
  /**
   * Inserta imágenes en la nota, en el punto `point` (un arrastre del sistema
   * trae la posición) o donde esté el cursor. Las que vengan de fuera del
   * vault se copian junto a la nota antes de enlazarlas.
   */
  insertImages: (
    sources: string[],
    point?: { x: number; y: number },
  ) => Promise<ImageInsertResult>;
}

export interface MarkdownEditorProps {
  path: string;
  title: string;
  content: string;
  vaultPath?: string | null;
  onOpenWikiLink?: (target: string) => void;
  /**
   * «Ruta de nota → cuántas veces se la enlaza», del grafo que parsea el
   * backend. Cada enlace [[wiki]] de la vista previa enseña su contador.
   */
  linkRefs?: Record<string, number> | null;
  autoSave?: (draft: EditorDraft) => void;
  debounceMs?: number;
  fontSize?: number;
  /** Diccionarios activos del corrector. Vacío o sin definir = apagado. */
  spellLangs?: SpellLang[];
  /** Combinaciones de teclado, ya resueltas desde Ajustes → Atajos. */
  shortcuts?: ShortcutMap;
  spellWords?: string[];
  onSpellWordsChange?: (words: string[]) => void;
  autoSaveEnabled?: boolean;
  /**
   * Nota que debe abrir el diálogo de exportación a PDF en cuanto esté lista
   * (viene del clic derecho en el explorador).
   */
  autoExportPath?: string | null;
  /** Aviso de que la exportación automática ya se ha mostrado. */
  onAutoExportShown?: () => void;
  className?: string;
  ref?: Ref<MarkdownEditorHandle>;
}

const DEFAULT_DEBOUNCE = 500;

const MAX_DECORATED_LINES = 10000;

/** Retardo antes de mostrar la pista «/»: solo si el cursor se queda quieto. */
const HINT_DELAY_MS = 1500;

/** Marca persistente: el usuario ya usó el menú «/»; la pista no vuelve. */
const SLASH_HINT_KEY = "gus-slash-hint-used";

/** Lista vacía de imágenes, para no crear una nueva en cada render. */

export default function MarkdownEditor({
  path,
  title: initialTitle,
  content: initialContent,
  vaultPath,
  onOpenWikiLink,
  linkRefs,
  autoSave,
  debounceMs = DEFAULT_DEBOUNCE,
  fontSize,
  spellLangs,
  shortcuts,
  spellWords = [],
  onSpellWordsChange,
  autoSaveEnabled = true,
  autoExportPath,
  onAutoExportShown,
  className,
  ref,
}: MarkdownEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  // Botones «copiar» de los bloques de código en modo edición: qué bloque
  // tiene el cursor encima (resaltado) y cuál se acaba de copiar (✔ 1 s).
  const [copyHover, setCopyHover] = useState<number | null>(null);
  const [copyDone, setCopyDone] = useState<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const copyChipsRef = useRef<HTMLElement[]>([]);
  const [headerMenu, setHeaderMenu] = useState(false);
  // Si el explorador pidió exportar esta nota antes de que el editor montara,
  // el diálogo ya arranca abierto (la prop se consume aquí, no en un efecto).
  const [exportOpen, setExportOpen] = useState(() => autoExportPath === path);
  // Línea donde está el cursor. La overlay la pinta en crudo solo mientras el
  // textarea tiene foco: al abrir, WebKit dispara «select» con el cursor en la
  // línea 0 y el primer título se quedaría con su «#» sin que nadie haya
  // tocado nada (el textarea aún no tiene foco).
  const [caretLine, setCaretLine] = useState(-1);
  const [areaFocused, setAreaFocused] = useState(false);
  const [tableCaret, setTableCaret] = useState<TableCellCaret | null>(null);
  /** Selección absoluta mientras el cursor está en una tabla (puede ir más allá de la celda). */
  const [tableSelection, setTableSelection] = useState<TableSelection | null>(null);
  /** Rectángulo de celdas marcadas (varias): el cuadro que se pinta y lo que
   *  vacía Supr. Null cuando la selección se queda en una sola celda. */
  const [tableRect, setTableRect] = useState<TableCellRect | null>(null);
  /** Anchura en píxeles de cada columna por bloque (null = la que dé el texto). */
  const [tableWidths, setTableWidths] = useState<Map<number, number[]> | null>(null);
  /** Cursor y selección absolutos, para que los pinte el overlay. */
  const [caretMark, setCaretMark] = useState<{ at: number; sel: TableSelection } | null>(null);
  /** Borde de columna bajo el ratón, listo para arrastrar. */
  const [hoverResize, setHoverResize] = useState<TableResizeHover | null>(null);
  /** Redimensionado de imagen en marcha: línea y ancho en píxeles. */
  const [imageResize, setImageResize] = useState<{ line: number; width: number } | null>(null);
  /** Asa de imagen bajo el ratón (o cuyo arrastre va a cuestas), por línea. */
  const [hoverImageResize, setHoverImageResize] = useState<number | null>(null);
  const prevTableLineRef = useRef(-1);
  /** Celda ancla de la selección: punto fijo de Mayús+flechas / Mayús+clic. */
  const tableAnchorRef = useRef<{ line: number; col: number } | null>(null);
  /** Espejo de tableWidths para leerlo en los escuchadores del arrastre. */
  const colWidthsRef = useRef<Map<number, number[]>>(new Map());
  /** Espejo de `content`: el arrastre de imagen se suelta desde un escuchador
   * global montado una sola vez, y su cierre no ve el estado de este render. */
  const contentRef = useRef(content);
  const body = stripFrontmatter(content);
  const sourceLines = useMemo(() => body.split(/\r?\n/), [body]);
  const sourceInfo = useMemo(() => classifySource(sourceLines), [sourceLines]);
  /** Asas de redimensionar del overlay (se buscan por coordenadas). */
  const tableResizeHandlesRef = useRef<HTMLElement[]>([]);
  /**
   * Celdas del overlay, en el mismo orden que el DOM. El arrastre del ratón las
   * busca en cada movimiento: tenerlas en una lista evita recorrer el árbol (y
   * forzar el layout) en cada evento.
   */
  const tableCellsRef = useRef<HTMLElement[]>([]);
  // Espejos para los escuchadores: un ref se lee en cualquier momento y no
  // depende del cierre del render. Se sincronizan tras el commit y antes del
  // paint, para no escribir en un ref mientras se renderiza.
  useLayoutEffect(() => {
    colWidthsRef.current = tableWidths ?? new Map();
    contentRef.current = content;
  });
  /** Arrastre de columna en curso: bloque, columna, x inicial y anchuras. */
  const resizeDragRef = useRef<{
    block: number;
    col: number;
    startX: number;
    widths: number[];
  } | null>(null);
  /**
   * Arrastre de imagen en curso: línea, puntero de partida, anchura inicial y
   * actual, topes y escuchadores (para soltarlos al terminar).
   */
  const imageResizeRef = useRef<ImageResizeDrag | null>(null);
  const rightClickSelRef = useRef<[number, number] | null>(null);
  /**
   * Último rectángulo de celdas que se ha pintado, tal cual. La selección de
   * texto del motor no sirve para esto: al hacer clic derecho la colapsa, así
   * que el clic se apoya en este espejo, que solo se actualiza al pintar y se
   * suelta cuando la persona empieza otra selección (arrastre, clic o teclas).
   */
  const markedRectRef = useRef<TableCellRect | null>(null);
  /**
   * Arrastre de selección en marcha: el extremo que quedó fijo en el clic (el
   * desplazamiento en el documento) y la celda de la que salió, que sigue siendo
   * el ancla para Mayús+flechas y Supr.
   */
  const cellDragRef = useRef<{ anchor: number; line: number; col: number } | null>(null);
  /**
   * Arrastre de selección a mano (ver `startTextDrag`): solo existe mientras
   * el botón sigue bajo, y guarda sus escuchadores para poder soltarlos.
   */
  const textDragRef = useRef<{
    move: (event: globalThis.MouseEvent) => void;
    up: () => void;
  } | null>(null);
  /** Barra «+» de tabla bajo el ratón: las barras solo se enseñan así. */
  const [hoverBar, setHoverBar] = useState<TableBarHover | null>(null);
  const tableBarsRef = useRef<HTMLElement[]>([]);
  const [rowPitch, setRowPitch] = useState(23);
  const [tableCols, setTableCols] = useState<number | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const [composing, setComposing] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const t = useT();
  /** Combinación vigente de «guardar», para la pista de la cabecera. */
  const saveCombo = comboLabel(comboFor(shortcuts, "saveNote")) || "Ctrl+S";
  /**
   * Atajos vigentes. Se leen de un ref para que los escuchadores del editor
   * (que se enganchan una vez) vean siempre el último valor sin re-suscribirse.
   */
  const shortcutsRef = useRef<ShortcutMap | null>(shortcuts ?? null);
  useLayoutEffect(() => {
    shortcutsRef.current = shortcuts ?? null;
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  /**
   * Espejo del menú abierto. El estado de React todavía no está aplicado cuando
   * el navegador mueve el cursor por el clic derecho (pasa *después* de abrirse
   * el menú), así que para esa comprobación hace falta un ref, que se pone al
   * instante de abrirlo.
   */
  const contextMenuOpenRef = useRef(false);

  const headerMenuRef = useRef<HTMLDivElement>(null);

  /** El menú de la cabecera se cierra al pulsar fuera de él. */
  useEffect(() => {
    if (!headerMenu) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && headerMenuRef.current?.contains(target)) return;
      setHeaderMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [headerMenu]);

  /** El explorador pide exportar esta nota en cuanto esté abierta. */
  // La prop cambia de identidad en cada render (llega como flecha inline):
  // envuelta en useEffectEvent el efecto no necesita declararla en las deps.
  const notifyAutoExportEvent = useEffectEvent(() => onAutoExportShown?.());

  // Si la nota ya estaba abierta, App dispara `requestExport()` desde su propio
  // evento; esta vía solo cubre el montaje con la petición ya en vuelo y se
  // limita a consumirla (el estado se ajusta arriba, en el initializer).
  useEffect(() => {
    if (!autoExportPath || autoExportPath !== path) return;
    notifyAutoExportEvent();
  }, [autoExportPath, path]);

  const [menu, setMenu] = useState<EditorMenu | null>(null);

  const [lineHint, setLineHint] = useState(false);
  const [slashHintUsed, setSlashHintUsed] = useState(() => {
    try {
      return localStorage.getItem(SLASH_HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hintTimerRef = useRef<number | null>(null);
  const hintLineRef = useRef(-1);
  const [wikiNotes, setWikiNotes] = useState<WikiNote[]>([]);
  const [wikiNotesLoading, setWikiNotesLoading] = useState(false);
  /** Arrastrando una imagen del explorador por encima del campo de texto. */
  const [imageDropOver, setImageDropOver] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    imageMatches,
    vaultImagesLoading,
    imageNotice,
    showImageNotice,
    loadVaultImages,
    insertImagesDropped,
    insertImagesAt,
    insertImagesFromComputer,
    insertVaultImage,
  } = useEditorImages({ textareaRef, content, path, vaultPath, menu, replaceRange, caretAtPoint });
  const overlayRef = useRef<HTMLDivElement>(null);
  const { historyRef, pendingRestoreRef, forceHistoryRef, skipHistoryRef, historySnapshot } =
    useEditorHistory(textareaRef, contentRef);
  const pendingCaretRef = useRef<[number, number] | null>(null);
  const {
    engine,
    spell,
    spellPopup,
    setSpellPopup,
    spellDismissedRef,
    scheduleSpellPopup,
    closeSpellPopup,
    applySpellReplacement,
    applySpellCorrection,
    addSpellWord,
    ignoreSpellWord,
    removeSpellWord,
    handleSpellPopupKeys,
  } = useEditorSpell({ textareaRef, pendingCaretRef, viewMode, content, contextMenu, setContextMenu, editBody, spellLangs, spellWords, onSpellWordsChange });
  const { tableBarAtPoint, measureTableColumns, tableMaxWidthPx, startColumnResize, resizeHandleAt, addBadgeAt } =
    useTableResize({
      textareaRef,
      overlayRef,
      resizeDragRef,
      tableResizeHandlesRef,
      tableBarsRef,
      colWidthsRef,
      setTableWidths,
      scrollbarWidth,
    });
  const { handleTableNav, selectionCellRect, cellRectBetween, selectionAnchorCell, selectCellBlock } =
    useTableKeyboard({
      menu,
      tableCaret,
      tableRect,
      setTableRect,
      sourceInfo,
      textareaRef,
      tableAnchorRef,
      pendingCaretRef,
      cellGeometry,
      editBody,
      focusTableCell,
      appendTableCellRow,
      handleCaretMove,
    });
  const {
    copyCellRect,
    cutCurrentLine,
    cutSelection,
    handleCut,
    handleCopy,
    copySelection,
    pasteClipboard,
    handlePaste,
    selectAllText,
  } = useEditorClipboard({ textareaRef, pendingCaretRef, cellDragRef, tableAnchorRef, sourceInfo, tableRect, setTableRect, setContextMenu, setMenu, editBody, replaceRange, forceHistoryRef, selectionCellRect });
  const {
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
  } = useTableActions({
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
  });
  const wikiRequestRef = useRef(0);

  useEffect(() => {
    if (viewMode === "preview") loadWikiNotes();
  }, [viewMode, vaultPath, path]);

  /**
   * WebKit (el motor de la app) no desplaza la vista cuando el cursor se coloca
   * de forma programática: si una línea se mueve fuera del área visible, la vista
   * se quedaría quieta y cursor y línea desaparecerían sin acompañar el
   * movimiento. Soltar y recuperar el foco obliga al motor a revelar el cursor
   * con el menor desplazamiento posible; si ya se ve, no se mueve nada.
   */
  function revealCaret(area: HTMLTextAreaElement) {
    area.blur();
    area.focus();
  }

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const [from, to] = pendingCaretRef.current;
    pendingCaretRef.current = null;

    const area = textareaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(from, to);
    revealCaret(area);
    refreshCaretLine();
    scheduleSpellPopup();
    // Sin `refreshCaretLine` en las deps: se recrea en cada render y el
    // efecto:focus + restaurar caret se dispararía sin motivo (mismo criterio
    // que en el efecto de `viewMode` y en el de restauración de abajo).
  }, [content]);

  useEffect(() => {
    if (viewMode === "preview") {
      setLineHint(false);
      clearHintTimer();
      hintLineRef.current = -1;
      setTableCaret(null);
      setTableRect(null);
      closeSpellPopup();
      return;
    }

    refreshCaretLine();
    const area = textareaRef.current;
    if (area) syncLineHint(area.value, area.selectionStart);
  }, [viewMode, content]);

  // Usar el menú «/» una vez desactiva la pista para siempre.
  useEffect(() => {
    if (menu?.kind !== "slash" || slashHintUsed) return;
    setSlashHintUsed(true);
    clearHintTimer();
    setLineHint(false);
    try {
      localStorage.setItem(SLASH_HINT_KEY, "1");
    } catch {
      // Sin almacenamiento: la pista solo se olvida en esta sesión.
    }
  }, [menu]);

  // Al desmontar no queda ningún temporizador suelto (ni el de la pista del
  // «/» ni el del aviso de imágenes).
  useEffect(() => {
    return () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    syncOverlayGeometry();
  }, [content, spell]);

  const { dirtyRef, persistRef, flush } = useNotePersistence({
    path,
    title,
    content,
    saveState,
    setSaveState,
    setSaveError,
    autoSave,
    autoSaveEnabled,
    debounceMs,
  });

  const {
    insertWikiNote,
    insertSlashItem,
    applyFormat,
    slashItems,
    insertFromMenu,
    handleKeyDown,
  } = useEditorKeyboard({
    textareaRef,
    pendingCaretRef,
    tableAnchorRef,
    forceHistoryRef,
    shortcutsRef,
    persistRef,
    sourceInfo,
    viewMode,
    setViewMode,
    menu,
    setMenu,
    contextMenu,
    setContextMenu,
    headerMenu,
    setHeaderMenu,
    setExportOpen,
    composing,
    setComposing,
    tableCaret,
    wikiNotes,
    replaceRange,
    editBody,
    handleCaretMove,
    applyUndo,
    applyRedo,
    currentLines,
    runTableShortcut,
    handleTableAction,
    handleTableDeletion,
    handleTableReplace,
    applyTableEdit,
    convertSelectionToTable,
    handleTableNav,
    selectionCellRect,
    cutCurrentLine,
    handleSpellPopupKeys,
    applySpellCorrection,
    imageMatches,
    loadVaultImages,
    insertVaultImage,
    insertImagesFromComputer,
  });

  const insertImagesRef = useRef(insertImagesAt);
  useLayoutEffect(() => {
    insertImagesRef.current = insertImagesAt;
  });

  useImperativeHandle(
    ref,
    () => ({
      flush,
      isDirty: () => dirtyRef.current,
      discardChanges: () => {
        dirtyRef.current = false;
      },
      /** Abre el diálogo de exportación (lo llama App desde su evento). */
      requestExport: () => {
        setHeaderMenu(false);
        setExportOpen(true);
      },
      // Va por ref para que App suelte imágenes sobre la nota que toque sin
      // que el handle se quede con la ruta de la primera que se montó.
      insertImages: (sources: string[], point?: { x: number; y: number }) =>
        insertImagesRef.current(sources, point),
    }),
    [flush],
  );

  function editTitle(next: string) {
    setTitle(next);
    setSaveState("dirty");
  }

  function editContent(next: string) {
    if (next !== content && !skipHistoryRef.current) {
      recordHistory(historyRef.current, historySnapshot(), forceHistoryRef.current);
      forceHistoryRef.current = false;
    }
    skipHistoryRef.current = false;
    setContent(next);
    setSaveState("dirty");
  }

  /**
   * Guarda el cuerpo de la nota. Antes renumera la lista numerada que contiene
   * al cursor, de modo que al borrar o insertar una línea las que siguen se
   * actualizan y no quedan huecos (6, 7, 8, 10) ni números duplicados.
   * Si el cambio viene de un pegado (`paste`), una lista abierta por lo pegado
   * arranca en 1. Devuelve el cuerpo final y la posición corregida del cursor.
   */

  function editBody(
    nextBody: string,
    paste?: PasteRange,
    previous?: OrderedBlockRef | null,
  ): { body: string; caret: number } {
    const area = textareaRef.current;
    const pending = pendingCaretRef.current;
    // Mientras el usuario escribe, el DOM ya refleja el cambio y su cursor es
    // el válido; en los cambios programáticos (menús, pegado, corrección
    // ortográfica) el cursor llega fijado en pendingCaretRef.
    const domCaret = area && area.value === nextBody ? area.selectionStart : null;
    const hint = domCaret ?? pending?.[0] ?? area?.selectionStart ?? nextBody.length;
    const caret = Math.min(Math.max(hint, 0), nextBody.length);

    // Con un IME en marcha no se renumera: tocar el texto rompería la
    // composición (al terminarla volverá a entrar por aquí).
    let result: { body: string; caret: number } = { body: nextBody, caret };
    if (!composing) {
      result = paste
        ? renumberAfterPaste(nextBody, caret, paste)
        : renumberOrderedLists(nextBody, caret, previous);
    }

    const finalContent = replaceBody(content, result.body);
    // Si el texto final no es el que hay en el textarea, React reescribirá su
    // valor al renderizar y el cursor saltaría al final: hay que recolocarlo.
    if (finalContent !== content && (area === null || area.value !== result.body)) {
      pendingCaretRef.current = [result.caret, result.caret];
    }

    editContent(finalContent);
    return result;
  }

  function applyHistoryState(target: HistorySnapshot) {
    skipHistoryRef.current = true;
    editContent(target.content);
    pendingRestoreRef.current = target;
    setMenu(null);
    setContextMenu(null);
  }

  function applyUndo() {
    const target = undoHistory(historyRef.current, historySnapshot());
    if (target) applyHistoryState(target);
  }

  function applyRedo() {
    const target = redoHistory(historyRef.current, historySnapshot());
    if (target) applyHistoryState(target);
  }

  function syncOverlayGeometry() {
    const area = textareaRef.current;
    if (!area) return;

    const overlay = overlayRef.current;
    // El overlay es más alto que el textarea cuando un bloque ha crecido
    // (tabla envuelta, imagen a tamaño real): se le suma lo que ya ha pasado
    // por arriba para que siga entrando por arriba lo que toca.
    if (overlay) overlay.scrollTop = area.scrollTop + driftBeforeScroll(area.scrollTop);

    const width = area.offsetWidth - area.clientWidth;
    setScrollbarWidth((current) => (current === width ? current : width));
  }

  useEffect(() => {
    const onZoom = () => setZoomTick((tick) => tick + 1);
    window.addEventListener("gus:zoom", onZoom);
    return () => window.removeEventListener("gus:zoom", onZoom);
  }, []);

  // El motor redondea la interlínea del textarea a píxeles enteros al escalar;
  // medimos su altura real para que el overlay dibuje exactamente las mismas filas.
  useEffect(() => {
    const next = measureRowPitch(textareaRef.current);
    if (next !== null) setRowPitch((current) => (Math.abs(current - next) < 0.01 ? current : next));
  }, [zoomTick, fontSize]);

  // Ancho disponible en columnas para las tablas: sigue cualquier cambio del
  // contenedor (ventana, barra lateral, scrollbars). El textarea se desmonta
  // en modo vista previa, por eso se reobserva al volver a editar.
  useEffect(() => {
    if (viewMode !== "edit") return;
    const area = textareaRef.current;
    if (!area) return;
    const update = () => {
      const cols = measureTableCols(area);
      setTableCols((current) => (current === cols ? current : cols));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, [viewMode]);

  // Tras deshacer o rehacer se recupera la selección guardada en el paso.
  useEffect(() => {
    const target = pendingRestoreRef.current;
    if (!target) return;
    pendingRestoreRef.current = null;
    const area = textareaRef.current;
    if (!area) return;
    const max = area.value.length;
    area.setSelectionRange(Math.min(target.start, max), Math.min(target.end, max));
    revealCaret(area);
    refreshCaretLine();
    scheduleSpellPopup();
  }, [content]);

  function taskCheckedAt(line: number): boolean | null {
    const match = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(content.split("\n")[line - 1] ?? "");
    return match ? match[1] !== " " : null;
  }

  function toggleTaskAt(line: number) {
    const lines = content.split("\n");
    const source = lines[line - 1];
    if (source === undefined) return;

    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(source);
    if (!match) return;

    const nextState = match[2] === " " ? "x" : " ";
    lines[line - 1] = `${match[1]}${nextState}${match[3]}${source.slice(match[0].length)}`;
    editContent(lines.join("\n"));
  }

  function loadWikiNotes() {
    if (!vaultPath) return;

    const request = ++wikiRequestRef.current;
    setWikiNotesLoading(true);

    invoke<WikiNote[]>("list_vault_notes", { path: vaultPath })
      .then((notes) => {
        if (request !== wikiRequestRef.current) return;
        setWikiNotes(notes);
        setWikiNotesLoading(false);
      })
      .catch(() => {
        if (request !== wikiRequestRef.current) return;
        setWikiNotesLoading(false);
      });
  }

  function clearHintTimer() {
    if (hintTimerRef.current === null) return;
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = null;
  }

  function syncLineHint(text: string, caret: number) {
    const area = textareaRef.current;
    const onEmptyLine =
      !!area &&
      text !== "" &&
      area.selectionStart === area.selectionEnd &&
      lineAtCaret(text, caret).trim() === "";

    if (!onEmptyLine || slashHintUsed) {
      clearHintTimer();
      hintLineRef.current = -1;
      setLineHint(false);
      return;
    }

    const line = text.slice(0, caret).split("\n").length - 1;

    // Mismo hueco: se respeta lo que ya hubiera (visible o en espera).
    if (line === hintLineRef.current) return;

    // Línea nueva: la pista aparece solo si el cursor se queda quieto 1,5 s.
    hintLineRef.current = line;
    clearHintTimer();
    setLineHint(false);
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null;
      setLineHint(true);
    }, HINT_DELAY_MS);
  }

  function syncMenu(text: string, caret: number) {
    syncLineHint(text, caret);

    const wiki = detectWikiQuery(text, caret);
    if (wiki) {
      const area = textareaRef.current;
      if (area) {
        const anchor = caretAnchor(area, caret);
        setMenu((current) =>
          current &&
          current.kind === "wiki" &&
          current.start === wiki.start &&
          current.query === wiki.query
            ? current
            : { kind: "wiki", start: wiki.start, query: wiki.query, index: 0, anchor },
        );
      }
      if (!menu || menu.kind !== "wiki") loadWikiNotes();
      return;
    }

    const slash = detectSlashQuery(text, caret);
    if (slash) {
      const area = textareaRef.current;
      if (area) {
        const anchor = caretAnchor(area, caret);
        setMenu((current) =>
          current &&
          current.kind === "slash" &&
          current.start === slash.start &&
          current.query === slash.query
            ? current
            : { kind: "slash", start: slash.start, query: slash.query, index: 0, anchor },
        );
      }
      return;
    }

    setMenu(null);
  }

  function handleContentChange(next: string) {
    refreshCaretLine();
    const final = editBody(next);
    // Los rangos del menú ortográfico ya no son fiables: se cierra.
    setContextMenu(null);
    syncMenu(final.body, final.caret);
    scheduleSpellPopup();
  }

  function handleCaretMove() {
    const area = textareaRef.current;
    if (!area) return;
    refreshCaretLine();
    syncMenu(area.value, area.selectionStart);
    scheduleSpellPopup();
  }

  function handleScroll() {
    const area = textareaRef.current;
    if (!area) return;
    if (menu) setMenu({ ...menu, anchor: caretAnchor(area, area.selectionStart) });
    if (spellPopup) scheduleSpellPopup(0);
    syncOverlayGeometry();
  }

  function replaceRange(
    start: number,
    text: string,
    caretOffset: number,
    kind: "insert" | "paste" = "insert",
  ) {
    const area = textareaRef.current;
    const current = area?.value ?? stripFrontmatter(content);
    const cursor = Math.max(area?.selectionEnd ?? current.length, start);

    // No se sustituye nada que toque la estructura de una tabla (fila, fila de
    // separador o el salto que la une al texto): eso solo lo hace el menú.
    if (cursor > start && planTableDeletion(sourceInfo, current, start, cursor)) return;

    // Un bloque de varias líneas (una tabla entera, una lista…) no se inserta
    // dentro de una celda: dejaría el bloque inservible.
    if (text.includes("\n") && tableIntersects(sourceInfo, current, start, start)) return;

    pendingCaretRef.current = [start + caretOffset, start + caretOffset];
    const paste: PasteRange | undefined =
      kind === "paste" ? { from: start, to: start + text.length } : undefined;
    editBody(`${current.slice(0, start)}${text}${current.slice(cursor)}`, paste);
    setMenu(null);
  }

  /**
   * Punto del documento bajo unas coordenadas de pantalla (un arrastre del
   * sistema o del explorador), o `null` si caen fuera del campo: el cálculo se
   * pega a los bordes y ahí mejor manda el cursor.
   */
  function caretAtPoint(clientX: number, clientY: number): number | null {
    const area = textareaRef.current;
    if (!area) return null;

    const rect = area.getBoundingClientRect();
    const dentro =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (!dentro) return null;

    return offsetAtPointer(area, clientX, clientY, driftAtPointer(clientY));
  }

  useEffect(() => {
    contextMenuOpenRef.current = contextMenu !== null;
  }, [contextMenu]);

  /**
   * Cierra el menú «/» borrando su `/consulta` del documento. Se usa en las
   * acciones que no cambian el texto por sí mismas (como copiar), donde
   * no hay operación que pueda absorberlo.
   */
  function dropSlashQuery() {
    const area = textareaRef.current;
    if (menu?.kind !== "slash" || !area) return;
    const from = menu.start;
    const to = area.selectionEnd;
    if (to <= from) return;
    area.setSelectionRange(from, to);
    replaceRange(from, "", 0);
  }

  function focusTableCell(line: number, col: number, select: boolean) {
    const range = tableCellRange(sourceInfo, line, col);
    const area = textareaRef.current;
    if (!range || !area) return;
    area.focus();
    if (select) area.setSelectionRange(range.start, range.end);
    else area.setSelectionRange(range.end, range.end);
    handleCaretMove();
  }

  function appendTableCellRow(cell: TableCellCaret) {
    const rows = body.split("\n");
    const at = cell.blockEnd + 1;
    rows.splice(at, 0, `|${"  |".repeat(cell.cols)}`);
    const nextBody = rows.join("\n");
    const nextLines: TableLine[] = rows.map((text, index) => ({
      text,
      code: sourceInfo[index]?.code ?? false,
    }));
    const range = tableCellRange(nextLines, at, 0);
    if (range) {
      pendingRestoreRef.current = {
        content: nextBody,
        start: range.end,
        end: range.end,
        at: Date.now(),
      };
    }
    editBody(nextBody);
  }

  /**
   * Cómo está repartido el texto de una celda: en qué renglón visual está el
   * cursor y cuántos ocupa la celda. No es lo mismo que el número de caracteres,
   * porque una celda larga se envuelve dentro de su columna.
   */
  function cellGeometry(
    line: number,
    col: number,
    local: number,
  ): { row: number; rows: number } | null {
    const overlay = overlayRef.current;
    const area = textareaRef.current;
    if (!overlay || !area) return null;
    const span = splitTableCells(sourceInfo[line]?.text ?? "")[col];
    const char = charWidthPx(area);
    const element = overlay.querySelector<HTMLElement>(
      `[data-line="${line}"][data-col="${col}"]`,
    );
    if (!span || !char || !element) return null;

    const inner = (element.firstElementChild ?? element) as HTMLElement;
    const perLine = Math.max(1, Math.floor(inner.getBoundingClientRect().width / char));
    return {
      row: Math.floor(Math.max(0, local) / perLine),
      rows: Math.max(1, Math.ceil(span.text.length / perLine)),
    };
  }

  /** Pone el cursor en la celda conservando la posición horizontal dentro. */

  const previewOffset = frontmatterLineOffset(content);
  const previewComponents = usePreviewComponents({
    path,
    vaultPath,
    wikiNotes,
    linkRefs,
    onOpenWikiLink,
    previewOffset,
    taskCheckedAt,
    toggleTaskAt,
  });
  const words = countWords(body);
  const inlineActive = viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;
  const { refreshCaretLine } = useCaretTracking({
    textareaRef,
    tableAnchorRef,
    prevTableLineRef,
    contextMenuOpenRef,
    rightClickSelRef,
    markedRectRef,
    sourceInfo,
    tableCols,
    inlineActive,
    setCaretLine,
    setTableCaret,
    setTableSelection,
    setTableRect,
    setCaretMark,
    selectionCellRect,
  });
  const spellOverlay =
    spell !== null && viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;

  // Primera línea de cada bloque de código: es la clave del botón «copiar»
  // que pinta el overlay, y por ella se sabe qué contenido llevarse.
  const codeBlockMap = useMemo(() => {
    const map = new Map<number, CodeBlockInfo>();
    for (const block of codeBlocks(sourceInfo)) map.set(block.start, block);
    return map;
  }, [sourceInfo]);

  /** ¿Son las dos listas de anchuras la misma? */
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

  const { blockDriftRef, driftTotal, driftBeforeLine, driftBeforeScroll, driftAtPointer } = useBlockDrift({
    overlayRef,
    textareaRef,
    sourceInfo,
    inlineActive,
    tableCols,
    rowPitch,
    tableWidths,
    caretLine,
    imageResize,
  });

  // Con un bloque crecido por encima (una tabla envuelta o una imagen de
  // bloque a tamaño real), el overlay ya no coincide con el textarea: el
  // cursor y la selección los dibuja el overlay (el textarea los pone
  // transparentes) para que no queden descolocados.
  // Con la selección marcándose desde el overlay, el caret y la selección
  // nativos se ocultan (clase «gus-mark-edit»): pasa cuando el cursor está en
  // una tabla, cuando la selección abarca una (la tarjeta manda sobre el texto
  // crudo) y cuando un bloque de arriba ha crecido y lo dejaría descolocado.
  const overlayMark =
    !composing &&
    (tableCaret !== null || tableSelection !== null || driftBeforeLine(caretLine) > 0);


  // El scroll nativo sigue a un cursor que va más arriba que el dibujado cuando
  // hay un bloque crecido por encima: aquí se lleva la vista hasta el cursor del
  // overlay. Se repite porque cada ajuste reposiciona el overlay.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    const caret = overlayRef.current?.querySelector<HTMLElement>(".gus-cell-caret");
    if (!area || !caret) return;
    const margin = 8;
    for (let pass = 0; pass < 3; pass++) {
      const view = area.getBoundingClientRect();
      const at = caret.getBoundingClientRect();
      if (at.bottom > view.bottom - margin) area.scrollTop += at.bottom - (view.bottom - margin);
      else if (at.top < view.top + margin) area.scrollTop -= view.top + margin - at.top;
      else return;
      syncOverlayGeometry();
    }
  }, [caretMark, caretLine, overlayMark]);

  const { openEditorMenu, handleContextMenu } = useEditorContextMenu({
    textareaRef,
    rightClickSelRef,
    tableCellsRef,
    markedRectRef,
    contextMenuOpenRef,
    sourceInfo,
    tableRect,
    setMenu,
    setContextMenu,
    driftAtPointer,
    engine,
    setSpellPopup,
    cellRectBetween,
  });

  const {
    endImageResize,
    endTextDrag,
    handleOverlayMouseMove,
    handleOverlayMouseDown,
    handleOverlayDoubleClick,
  } = usePointerEvents({
    textareaRef,
    overlayRef,
    pendingCaretRef,
    forceHistoryRef,
    cellDragRef,
    tableAnchorRef,
    imageResizeRef,
    textDragRef,
    rightClickSelRef,
    resizeDragRef,
    copyTimerRef,
    copyChipsRef,
    tableCellsRef,
    blockDriftRef,
    markedRectRef,
    sourceInfo,
    codeBlockMap,
    rowPitch,
    inlineActive,
    setHoverImageResize,
    setImageResize,
    setCopyDone,
    setCopyHover,
    setHoverResize,
    setHoverBar,
    setTableRect,
    driftAtPointer,
    handleCaretMove,
    editBody,
    currentLines,
    autoFitColumn,
    applyTableEdit,
    addTableRowAt,
    addTableColumnAt,
    resizeHandleAt,
    tableBarAtPoint,
    startColumnResize,
    measureTableColumns,
    addBadgeAt,
    selectionAnchorCell,
    selectCellBlock,
  });

  // Los botones «copiar» se cachean: viven dentro del overlay (que va debajo
  // del textarea) y se detectan por coordenadas en cada movimiento del ratón,
  // así que no se quiere recorrer el árbol del documento en cada evento. Lo
  // mismo vale para las barras «+» de cada tabla, que solo se enseñan cuando
  // el ratón se posa sobre ellas.
  useEffect(() => {
    const overlay = overlayRef.current;
    copyChipsRef.current = overlay
      ? Array.from(overlay.querySelectorAll<HTMLElement>("[data-copy-line]"))
      : [];
    tableBarsRef.current = overlay
      ? Array.from(overlay.querySelectorAll<HTMLElement>("[data-add-bar]"))
      : [];
    tableResizeHandlesRef.current = overlay
      ? Array.from(overlay.querySelectorAll<HTMLElement>("[data-resize-block]"))
      : [];
    tableCellsRef.current = overlay
      ? Array.from(overlay.querySelectorAll<HTMLElement>("[data-cell]"))
      : [];
  }, [sourceInfo, inlineActive, viewMode, tableCols]);

  // El ✔ de «copiado» se apaga solo: al desmontar hay que soltar su reloj.
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  // El arrastre de selección se suelta al levantar el botón aunque el puntero se
  // haya ido de la ventana (o al perder el foco): si no, el siguiente movimiento
  // del ratón seguiría Selectionando.
  useEffect(() => {
    const stop = () => {
      cellDragRef.current = null;
      endTextDrag();
      endImageResize(true);
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);


  return (
    <div data-tour="editor" className={clsx("flex h-full min-h-0 flex-col bg-gus-bg", className)}>
      <EditorHeader
        title={title}
        onTitleChange={editTitle}
        viewMode={viewMode}
        onToggleView={() => {
          setMenu(null);
          setViewMode(viewMode === "edit" ? "preview" : "edit");
        }}
        menuOpen={headerMenu}
        onMenuOpenChange={setHeaderMenu}
        menuRef={headerMenuRef}
        onExport={() => {
          setHeaderMenu(false);
          setExportOpen(true);
        }}
        content={content}
        vaultPath={vaultPath}
        onContentChange={editContent}
        saveState={saveState}
        saveError={saveError}
        words={words}
        chars={body.length}
        saveCombo={saveCombo}
      />

      {viewMode === "edit" ? (
        <div className="relative min-h-0 w-full flex-1 bg-gus-bg">
          {(inlineActive || spellOverlay) && (
            <InlinePreview
              lines={sourceInfo}
              caretLine={areaFocused ? caretLine : -1}
              scrollbarWidth={scrollbarWidth}
              fontSize={fontSize}
              rowHeight={rowPitch}
              overlayRef={overlayRef}
              spell={spell}
              raw={!inlineActive}
              slashHint={lineHint && !menu && !slashHintUsed}
              tableCols={tableCols}
              tableCaret={tableCaret}
              tableSelection={tableSelection}
              tableRect={tableRect}
              hoveredBar={hoverBar}
              tableWidths={tableWidths}
              hoverResize={hoverResize}
              imageResize={imageResize}
              hoverImageLine={hoverImageResize}
              caretAt={overlayMark ? (caretMark?.at ?? null) : null}
              caretSel={overlayMark ? (caretMark?.sel ?? null) : null}
              copiedLine={copyDone}
              hoverLine={copyHover}
              notePath={path}
              vaultPath={vaultPath ?? null}
            />
          )}

          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => {
              // Un texto que llega sin composición da por terminada cualquier
              // composición huérfana: si no, la renumeración de listas y la
              // edición de tablas por celda se quedan paradas.
              if (!(event.nativeEvent as InputEvent).isComposing) setComposing(false);
              handleContentChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            onCut={handleCut}
            onCopy={handleCopy}
            onPaste={handlePaste}
            // Arrastre de una fila del explorador: las imágenes se enlazan en
            // el punto exacto; el resto (notas, carpetas) no se tira encima
            // del texto. Cualquier arrastre del explorador se come aquí para
            // que el navegador no pegue la ruta como texto.
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(DRAG_ENTRY_MIME)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              if (!imageDropOver) setImageDropOver(true);
            }}
            onDragLeave={(event) => {
              const destino = event.relatedTarget;
              if (destino instanceof Node && event.currentTarget.contains(destino)) return;
              setImageDropOver(false);
            }}
            onDrop={(event) => {
              const traeDelExplorador = Array.from(event.dataTransfer.types).includes(
                DRAG_ENTRY_MIME,
              );
              setImageDropOver(false);
              if (!traeDelExplorador) return;

              event.preventDefault();
              const entrada = readExplorerEntry(event.dataTransfer);
              if (!entrada || entrada.kind !== "file" || !isImagePath(entrada.path)) return;

              void insertImagesDropped(
                [entrada.path],
                caretAtPoint(event.clientX, event.clientY),
              ).then(showImageNotice);
            }}
            onMouseDown={handleOverlayMouseDown}
            onDoubleClick={handleOverlayDoubleClick}
            onSelect={handleCaretMove}
            onScroll={handleScroll}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={() => {
              // El arrastre de selección termina aquí (también si el puntero se
              // va de la ventana: en ese caso lo suelta el escuchador global).
              cellDragRef.current = null;
            }}
            onMouseLeave={() => {
              setCopyHover(null);
              setHoverBar(null);
              setHoverResize(null);
            }}
            // Mientras WebKit compone una tilde (tecla muerta) el textarea se
            // queda transparente y manda el overlay: allí se ve lo renderizado
            // (títulos, divisores, subrayados) y también la tilde pendiente,
            // que WebKit escribe en el valor del propio textarea.
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onFocus={() => setAreaFocused(true)}
            onBlur={() => {
              // Al salir del campo no puede quedar ninguna composición viva.
              setComposing(false);
              setAreaFocused(false);
              setMenu(null);
              setContextMenu(null);
              spellDismissedRef.current = null;
              closeSpellPopup();
            }}
            onContextMenu={handleContextMenu}
            placeholder={t("editor.placeholder")}
            aria-label={t("editor.body")}
            spellCheck={false}
            lang={spellLangs && spellLangs.length > 0 ? spellLangs[0] : undefined}
            style={
              fontSize || overlayMark || driftTotal > 0
                ? {
                    ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
                    ...(overlayMark ? { caretColor: "transparent" } : {}),
                    // py-4 de abajo (1rem) más el alto que ganan los bloques crecidos.
                    ...(driftTotal > 0 ? { paddingBottom: `calc(1rem + ${driftTotal}px)` } : {}),
                  }
                : undefined
            }
            // App mira este atributo para saber si un arrastre nativo del
            // sistema cae sobre la nota (y enlazar la imagen) o sobre una
            // carpeta del explorador.
            data-drop-editor="nota"
            className={clsx(
              // break-spaces: los espacios finales envuelven en vez de «colgar»
              // fuera del borde derecho; el cursor baja al pulsar espacio y el
              // overlay maqueta igual (mismo white-space en InlinePreview).
              "gus-scrollbar relative h-full w-full resize-none whitespace-break-spaces gus-editor-pad py-4 font-mono text-sm leading-[23px] text-gus-text outline-none placeholder:text-gus-muted focus:outline-none",
              inlineActive && "gus-source-area",
              tableCaret && !composing && "gus-cell-edit",
              overlayMark && "gus-mark-edit",
              copyHover !== null && "cursor-pointer",
              // El puntero cae en el textarea (el overlay no recibe eventos),
              // así que el cursor de redimensionado lo pone el propio campo
              // mientras hay un borde de columna justo debajo.
              hoverResize !== null && "cursor-col-resize",
              hoverImageResize !== null && "cursor-nwse-resize",
              imageDropOver && "ring-2 ring-inset ring-gus-accent",
            )}
          />

          <AnimatePresence>
            {menu?.kind === "wiki" && (
              <WikiLinkMenu
                key="wiki"
                anchor={menu.anchor}
                notes={wikiMatches(wikiNotes, menu.query)}
                loading={wikiNotesLoading}
                query={menu.query}
                index={menu.index}
                onPick={insertWikiNote}
                onHover={(index) => setMenu({ ...menu, index })}
              />
            )}

            {menu?.kind === "slash" && (
              <SlashMenu
                key="slash"
                anchor={menu.anchor}
                items={slashItems(menu.query)}
                index={menu.index}
                insideTable={tableCaret !== null}
                label={tableCaret !== null ? t("menu.tableActions") : undefined}
                onPick={insertSlashItem}
                onHover={(index) => setMenu({ ...menu, index })}
              />
            )}

            {menu?.kind === "images" && (
              <VaultImageMenu
                key="images"
                anchor={menu.anchor}
                images={imageMatches}
                loading={vaultImagesLoading}
                query={menu.query}
                index={menu.index}
                onPick={insertVaultImage}
                onHover={(index) => setMenu({ ...menu, index })}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {spellPopup && !menu && !contextMenu && (
              <SpellSuggestMenu
                key="spell"
                anchor={spellPopup.anchor}
                suggestions={spellPopup.suggestions}
                index={spellPopup.index}
                applyCombo={comboLabel(comboFor(shortcuts, "applySuggestion")) || "Alt+Enter"}
                onPick={(suggestion) => void applySpellCorrection(suggestion)}
              />
            )}
          </AnimatePresence>

          {contextMenu && (
            <EditorContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              spell={contextMenu.spell}
              hasSelection={contextMenu.hasSelection}
              table={contextMenu.table}
              onTableAction={handleTableAction}
              onPick={applySpellReplacement}
              onAdd={addSpellWord}
              onIgnore={ignoreSpellWord}
              onRemove={removeSpellWord}
              onCut={() => void cutSelection()}
              onCopy={() => void copySelection()}
              onPaste={(plain) => void pasteClipboard(plain)}
              onSelectAll={selectAllText}
              onFormat={applyFormat}
              onInsert={insertFromMenu}
              onClose={() => setContextMenu(null)}
              onReopen={openEditorMenu}
            />
          )}
        </div>
      ) : (
        <EditorPreview
          body={body}
          path={path}
          vaultPath={vaultPath}
          wikiNotes={wikiNotes}
          linkRefs={linkRefs}
          onOpenWikiLink={onOpenWikiLink}
          previewOffset={previewOffset}
          taskCheckedAt={taskCheckedAt}
          toggleTaskAt={toggleTaskAt}
          onKeyDown={handleKeyDown}
        />
      )}

      {exportOpen && (
        <PdfExportDialog title={title} onClose={() => setExportOpen(false)}>
          <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
        </PdfExportDialog>
      )}

      {imageNotice && (
        <div
          role="status"
          aria-live="polite"
          className={clsx(
            "fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border bg-gus-panel px-4 py-3 text-body shadow-2xl shadow-black/40",
            imageNotice.ok
              ? "border-gus-accent/40 text-gus-accent"
              : "border-amber-400/40 text-amber-300",
          )}
        >
          {imageNotice.message}
        </div>
      )}
    </div>
  );
}
