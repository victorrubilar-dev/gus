import {
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { AnimatePresence } from "framer-motion";
import type { Components, UrlTransform } from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import clsx from "clsx";
import { Check, ChevronDown, Eye, FileDown, Pencil, X } from "lucide-react";
import { pathWithTitle, safeFileName } from "../lib/fileName";
import { listEnterEdit } from "../lib/listContinue";
import {
  orderedBlockAt,
  renumberAfterPaste,
  renumberOrderedLists,
  type OrderedBlockRef,
  type PasteRange,
} from "../lib/listNumbering";
import { moveLines } from "../lib/moveLines";
import {
  addPersonalWord,
  getPersonalWords,
  ignoreWord,
  isPersonalWord,
  loadSpellEngine,
  removePersonalWord,
  spellSegments,
  spellWordAt,
  type SpellEngine,
  type SpellFn,
  type SpellLang,
} from "../lib/spellCheck";
import { offsetAtPointer } from "../lib/pointerOffset";
import { toLocalCoord } from "../lib/uiZoom";
import {
  adjacentTableCell,
  resolveTableCaret,
  sourceSegments,
  tableCellRange,
  tableRows,
  type TableCellCaret,
  type TableLine,
} from "../lib/tableLayout";
import {
  createHistory,
  recordHistory,
  redoHistory,
  undoHistory,
  type EditorHistory,
  type HistorySnapshot,
} from "../lib/editorHistory";
import { stripPasteFormatting } from "../lib/pasteText";
import {
  frontmatterLineOffset,
  parseNoteTagInput,
  parseNoteTags,
  replaceBody,
  setNoteTags,
  stripFrontmatter,
  tagOptions,
  type VaultTag,
} from "../lib/noteTags";
import { caretAnchor, lineAtCaret, type CaretAnchor } from "../lib/caretPosition";
import {
  decodeWikiUrl,
  detectSlashQuery,
  detectWikiQuery,
  findWikiNote,
  remarkWikiLinks,
  wikiInsertText,
  wikiMatches,
  type WikiNote,
} from "../lib/wikiLink";
import {
  filterSlashItems,
  SlashMenu,
  SpellSuggestMenu,
  WikiLinkMenu,
  type SlashItem,
} from "./EditorMenus";
import InlinePreview, { classifySource } from "./InlinePreview";
import MermaidDiagram from "./MermaidDiagram";
import EditorContextMenu, { type ContextSpell, type FormatKind } from "./EditorContextMenu";
import PdfExportDialog from "./PdfExportDialog";

export interface EditorDraft {
  path: string;
  title: string;
  content: string;
}

export interface MarkdownEditorHandle {
  flush: () => Promise<boolean>;
}

export interface MarkdownEditorProps {
  path: string;
  title: string;
  content: string;
  vaultPath?: string | null;
  onOpenWikiLink?: (target: string) => void;
  autoSave?: (draft: EditorDraft) => void;
  debounceMs?: number;
  fontSize?: number;
  spellLang?: SpellLang;
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

type SaveState = "idle" | "dirty" | "saved" | "error";

type ViewMode = "edit" | "preview";

interface EditorMenu {
  kind: "wiki" | "slash";
  start: number;
  query: string;
  index: number;
  anchor: CaretAnchor;
}

interface ContextMenuState {
  spell: ContextSpell | null;
  hasSelection: boolean;
  x: number;
  y: number;
}

/** Cuadro de correcciones que se despliega sobre la palabra mal escrita. */
interface SpellPopup {
  start: number;
  end: number;
  word: string;
  suggestions: string[];
  /** Índice recorrido con ↑/↓; -1 mientras la lista no se ha tocado. */
  index: number;
  anchor: CaretAnchor;
}

const FORMAT_MARKERS: Record<Exclude<FormatKind, "link">, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
};

const MarkdownBody = lazy(async () => {
  const [
    { default: ReactMarkdown, defaultUrlTransform },
    { default: remarkGfm },
    { default: remarkMath },
    { default: rehypeKatex },
  ] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
    import("remark-math"),
    import("rehype-katex"),
  ]);
  await import("katex/dist/katex.min.css");

  const urlTransform: UrlTransform = (value) =>
    value.startsWith("wiki:") ? value : defaultUrlTransform(value);

  function Preview({ components, children }: { components: Components; children: string }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkWikiLinks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    );
  }

  return { default: Preview };
});

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Rango completo de la línea que contiene la posición `at`, con su salto final
 * incluido: es lo que corta Ctrl+X cuando no hay selección, como en VS Code.
 */
function lineRangeAt(value: string, at: number): [number, number] {
  const start = at === 0 ? 0 : value.lastIndexOf("\n", at - 1) + 1;
  const newline = value.indexOf("\n", at);
  return [start, newline === -1 ? value.length : newline + 1];
}

/** Altura real de fila del textarea en unidades locales (el motor la redondea al escalar). */
function measureRowPitch(area: HTMLTextAreaElement | null): number | null {
  if (!area) return null;
  const prev = area.value;
  const selStart = area.selectionStart;
  const selEnd = area.selectionEnd;
  try {
    const rows = Math.ceil((area.clientHeight + 4) / 16) + 8;
    area.value = Array(rows).fill("X").join("\n");
    const first = area.scrollHeight;
    area.value = Array(rows + 10).fill("X").join("\n");
    const second = area.scrollHeight;
    const pitch = (second - first) / 10;
    return Number.isFinite(pitch) && pitch > 0 ? pitch : null;
  } catch {
    return null;
  } finally {
    area.value = prev;
    try {
      area.setSelectionRange(selStart, selEnd);
    } catch {
      // selección no aplicable
    }
  }
}

/** Columnas monoespaciadas que caben en una fila del textarea (para tablas). */
function measureTableCols(area: HTMLTextAreaElement | null): number | null {
  if (!area) return null;
  const style = getComputedStyle(area);
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const char = ctx.measureText("0").width;
  const width =
    area.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth);
  if (!(char > 0) || !(width > 0)) return null;
  return Math.floor(width / char);
}

export default function MarkdownEditor({
  path,
  title: initialTitle,
  content: initialContent,
  vaultPath,
  onOpenWikiLink,
  autoSave,
  debounceMs = DEFAULT_DEBOUNCE,
  fontSize,
  spellLang,
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
  const [headerMenu, setHeaderMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [caretLine, setCaretLine] = useState(0);
  const [tableCaret, setTableCaret] = useState<TableCellCaret | null>(null);
  const prevTableLineRef = useRef(-1);
  const [rowPitch, setRowPitch] = useState(23);
  const [tableCols, setTableCols] = useState<number | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const [composing, setComposing] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [engine, setEngine] = useState<SpellEngine | null>(null);
  const [spellRevision, setSpellRevision] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [spellPopup, setSpellPopup] = useState<SpellPopup | null>(null);
  const spellPopupTimerRef = useRef<number | null>(null);
  const spellSuggestCacheRef = useRef<{ word: string; list: string[] } | null>(null);
  /** Palabra descartada con Esc: no vuelve a abrirse hasta que el cursor salga. */
  const spellDismissedRef = useRef<{ word: string; start: number } | null>(null);
  /** Selección de la que ya partió un recálculo (corta bucles de recálculo). */
  const lastSpellSelRef = useRef<string | null>(null);
  // El temporizador vive fuera del render: siempre ejecuta la última versión.
  const spellPopupSyncRef = useRef<() => void>(() => {});
  spellPopupSyncRef.current = syncSpellPopup;

  useEffect(() => {
    if (!spellLang || spellLang === "off") {
      setEngine(null);
      return;
    }
    let alive = true;
    setEngine(null);
    void loadSpellEngine(spellLang).then((loaded) => {
      if (alive) setEngine(loaded);
    });
    return () => {
      alive = false;
    };
  }, [spellLang]);

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
  useEffect(() => {
    if (!autoExportPath || autoExportPath !== path) return;
    setHeaderMenu(false);
    setExportOpen(true);
    onAutoExportShown?.();
  }, [autoExportPath, path]);

  const spell = useMemo<SpellFn | null>(
    () => (engine ? (text: string) => spellSegments(text, engine.correct) : null),
    [engine, spellWords, spellRevision],
  );

  /** El motor cambia (idioma): se olvida lo sugerido antes. */
  useEffect(() => {
    spellSuggestCacheRef.current = null;
    if (engine) scheduleSpellPopup(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  /**
   * El cursor no siempre pasa por «select» (hay movimientos programáticos), así
   * que se vigila la selección del documento. Solo si ha cambiado respecto a
   * la última vez que se programó un recálculo se vuelve a calcular: eso
   * también corta cualquier selección disparada por el propio cálculo.
   */
  useEffect(() => {
    const onSelectionChange = () => {
      const area = textareaRef.current;
      if (!area || document.activeElement !== area) return;
      const current = `${area.selectionStart}/${area.selectionEnd}`;
      if (current === lastSpellSelRef.current) return;
      scheduleSpellPopup();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [tagInput, setTagInput] = useState("");
  const [vaultTags, setVaultTags] = useState<VaultTag[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagIndex, setTagIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<EditorHistory>(createHistory());
  const pendingRestoreRef = useRef<HistorySnapshot | null>(null);
  const forceHistoryRef = useRef(false);
  const skipHistoryRef = useRef(false);
  const pendingCaretRef = useRef<[number, number] | null>(null);
  const wikiRequestRef = useRef(0);
  const tagRequestRef = useRef(0);

  const ownPathRef = useRef(path);
  const sequenceRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  dirtyRef.current = saveState === "dirty";

  useEffect(() => {
    if (path === ownPathRef.current) return;

    sequenceRef.current += 1;
    ownPathRef.current = path;
    setTitle(initialTitle);
    setContent(initialContent);
    setSaveState("idle");
    setSaveError(null);
    setMenu(null);
    historyRef.current = createHistory();
    pendingRestoreRef.current = null;
    forceHistoryRef.current = false;
    skipHistoryRef.current = false;
    clearHintTimer();
    hintLineRef.current = -1;
    setLineHint(false);
    setTableCaret(null);
    prevTableLineRef.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (viewMode === "preview") loadWikiNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [content]);

  useEffect(() => {
    if (viewMode === "preview") {
      setLineHint(false);
      clearHintTimer();
      hintLineRef.current = -1;
      setTableCaret(null);
      closeSpellPopup();
      return;
    }
    refreshCaretLine();
    const area = textareaRef.current;
    if (area) syncLineHint(area.value, area.selectionStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  // Al desmontar no queda ningún temporizador de la pista colgando.
  useEffect(() => {
    return () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    syncOverlayGeometry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, spell]);

  async function persist(): Promise<boolean> {
    const sequence = ++sequenceRef.current;
    const from = ownPathRef.current;
    let target = from;

    try {
      const wanted = pathWithTitle(from, title);
      if (wanted !== from) {
        target = await invoke<string>("rename_vault_file", { from, to: wanted });
      }
      await invoke("write_vault_file", { path: target, content });
    } catch (error) {
      if (sequence === sequenceRef.current) {
        setSaveState("error");
        setSaveError(String(error));
      }
      return false;
    }

    // La nota cambió mientras se guardaba: no tocar el estado de la nueva.
    if (sequence !== sequenceRef.current) return false;

    ownPathRef.current = target;
    autoSaveRef.current?.({ path: target, title: safeFileName(title), content });
    setSaveState("saved");
    setSaveError(null);
    return true;
  }

  const persistRef = useRef(persist);
  persistRef.current = persist;

  async function flush(): Promise<boolean> {
    if (!dirtyRef.current) return true;

    dirtyRef.current = false;
    const saved = await persistRef.current();
    if (!saved) dirtyRef.current = true;
    return saved;
  }

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  useEffect(() => {
    if (saveState !== "dirty" || !autoSaveEnabled) return;

    const timer = setTimeout(() => void persistRef.current(), debounceMs);
    return () => clearTimeout(timer);
  }, [title, content, saveState, debounceMs, autoSaveEnabled]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void persistRef.current();
      }
    };
  }, []);

  function editTitle(next: string) {
    setTitle(next);
    setSaveState("dirty");
  }

  function historySnapshot(): HistorySnapshot {
    const area = textareaRef.current;
    return {
      content,
      start: area?.selectionStart ?? content.length,
      end: area?.selectionEnd ?? content.length,
      at: Date.now(),
    };
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

  function refreshCaretLine() {
    const area = textareaRef.current;
    if (!area) return;
    const selStart = area.selectionStart;
    const selEnd = area.selectionEnd;
    const line = area.value.slice(0, selStart).split("\n").length - 1;
    setCaretLine((current) => (current === line ? current : line));

    // Solo hay modo celda si ese bloque se renderiza como tabla (si no cabe en
    // una línea se queda en crudo y el caret responsable es el nativo).
    const inTable =
      inlineActive &&
      tableCols !== null &&
      sourceSegments(sourceInfo, false, tableCols).some(
        (segment) => segment.kind === "table" && line >= segment.start && line <= segment.end,
      );

    if (!inTable) {
      setTableCaret(null);
      prevTableLineRef.current = line;
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

    setTableCaret(resolved);
    prevTableLineRef.current = resolved ? resolved.line : line;
  }

  function syncOverlayGeometry() {
    const area = textareaRef.current;
    if (!area) return;

    const overlay = overlayRef.current;
    if (overlay) overlay.scrollTop = area.scrollTop;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function applyNoteTags(next: string[]) {
    const updated = setNoteTags(content, next);
    if (updated === content) return;
    editContent(updated);
  }

  function loadVaultTags() {
    if (!vaultPath) return;

    const request = ++tagRequestRef.current;
    invoke<VaultTag[]>("list_vault_tags", { path: vaultPath })
      .then((tags) => {
        if (request === tagRequestRef.current) setVaultTags(tags);
      })
      .catch(() => {
      });
  }

  function pickTag(tag: string) {
    applyNoteTags([...parseNoteTags(content), tag]);
    setTagInput("");
    setTagIndex(0);
  }

  function commitTagInput() {
    const parsed = parseNoteTagInput(tagInput);
    if (parsed.length === 0) return;

    applyNoteTags([...parseNoteTags(content), ...parsed]);
    setTagInput("");
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const options = tagOptions(vaultTags, tagInput, parseNoteTags(content));

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!tagMenuOpen || options.length === 0) return;
      event.preventDefault();

      const current = Math.min(tagIndex, options.length - 1);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : current <= 0
            ? options.length - 1
            : current - 1;
      setTagIndex(next);
      return;
    }

    if (event.key === "Escape") {
      if (!tagMenuOpen) return;
      event.preventDefault();
      setTagMenuOpen(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (tagMenuOpen && options.length > 0) {
        pickTag(options[Math.min(tagIndex, options.length - 1)].tag);
        return;
      }
      commitTagInput();
      return;
    }

    if (event.key === "Backspace" && tagInput === "") {
      const tags = parseNoteTags(content);
      if (tags.length > 0) applyNoteTags(tags.slice(0, -1));
    }
  }

  function handleTagInputChange(value: string) {
    if (/[,，]/.test(value)) {
      applyNoteTags([...parseNoteTags(content), ...parseNoteTagInput(value)]);
      setTagInput("");
      return;
    }
    setTagInput(value);
    setTagIndex(0);
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

  /** Clic sobre una celda de la tabla: selecciona su contenido (estilo Excel). */
  function handleCellMouseDown(event: MouseEvent<HTMLTextAreaElement>) {
    if (event.button !== 0 || !inlineActive) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const cell = Array.from(overlay.querySelectorAll<HTMLElement>("[data-cell]")).find(
      (element) => {
        const rect = element.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      },
    );
    if (!cell) return;

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    const range = tableCellRange(sourceInfo, line, col);
    const area = textareaRef.current;
    if (!range || !area) return;

    event.preventDefault();
    area.focus();
    area.setSelectionRange(range.start, range.end);
    handleCaretMove();
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

    pendingCaretRef.current = [start + caretOffset, start + caretOffset];
    const paste: PasteRange | undefined =
      kind === "paste" ? { from: start, to: start + text.length } : undefined;
    editBody(`${current.slice(0, start)}${text}${current.slice(cursor)}`, paste);
    setMenu(null);
  }

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
    replaceRange(menu.start, item.snippet, item.caretOffset);
  }

  /** Sugerencias de hunspell con caché de un término (se repiten al navegar). */
  function suggestionsFor(word: string): string[] {
    const cached = spellSuggestCacheRef.current;
    if (cached && cached.word === word) return cached.list;
    const list = engine ? engine.suggest(word) : [];
    spellSuggestCacheRef.current = { word, list };
    return list;
  }

  /**
   * Recalcula el cuadro de correcciones para la palabra bajo el cursor. No se
   * muestra si el motor aún no está listo, si el editor no tiene el foco o si
   * la palabra se ha quedado fuera de la vista.
   */
  function syncSpellPopup() {
    const area = textareaRef.current;
    if (
      !area ||
      !engine ||
      viewMode === "preview" ||
      document.activeElement !== area ||
      area.selectionStart !== area.selectionEnd
    ) {
      setSpellPopup(null);
      return;
    }

    const caret = area.selectionStart;
    const span = spellWordAt(area.value, caret, engine.correct);
    const dismissed = spellDismissedRef.current;
    if (dismissed && (!span || dismissed.word !== span.word || dismissed.start !== span.start)) {
      spellDismissedRef.current = null; // el cursor ya salió de esa palabra
    }
    if (!span || !span.bad) {
      setSpellPopup(null);
      return;
    }
    if (spellDismissedRef.current) {
      setSpellPopup(null);
      return;
    }

    const suggestions = suggestionsFor(span.word);
    if (suggestions.length === 0) {
      setSpellPopup(null);
      return;
    }

    const anchor = caretAnchor(area, span.start);
    const rect = area.getBoundingClientRect();
    const visibleTop = toLocalCoord(rect.top);
    const visibleBottom = toLocalCoord(rect.bottom);
    if (anchor.top < visibleTop || anchor.top + anchor.height > visibleBottom) {
      setSpellPopup(null);
      return;
    }

    setSpellPopup((current) =>
      current && current.start === span.start && current.word === span.word
        ? // Mismo término: se conserva el índice marcado con ↑/↓.
          { ...current, end: span.end, suggestions, anchor }
        : { start: span.start, end: span.end, word: span.word, suggestions, index: -1, anchor },
    );
  }

  /** Debounce: el cuadro sale cuando el cursor deja de moverse o de teclear. */
  function scheduleSpellPopup(delay = 160) {
    if (spellPopupTimerRef.current !== null) window.clearTimeout(spellPopupTimerRef.current);
    const area = textareaRef.current;
    lastSpellSelRef.current = area ? `${area.selectionStart}/${area.selectionEnd}` : null;
    spellPopupTimerRef.current = window.setTimeout(() => {
      spellPopupTimerRef.current = null;
      spellPopupSyncRef.current();
    }, delay);
  }

  /** Cierra el cuadro y cancela su cálculo pendiente. */
  function closeSpellPopup() {
    if (spellPopupTimerRef.current !== null) {
      window.clearTimeout(spellPopupTimerRef.current);
      spellPopupTimerRef.current = null;
    }
    setSpellPopup(null);
  }

  function openEditorMenu(clientX: number, clientY: number) {
    const area = textareaRef.current;
    if (!area) return;

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
        const offset = offsetAtPointer(area, clientX, clientY) ?? selStart;
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
      x: toLocalCoord(clientX),
      y: toLocalCoord(clientY),
    });
  }

  function handleContextMenu(event: MouseEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    openEditorMenu(event.clientX, event.clientY);
  }

  /** Sustituye el rango [start, end) por `replacement` y deja el cursor tras él. */
  function replaceSpellWord(start: number, end: number, replacement: string) {
    const area = textareaRef.current;
    const current = area?.value ?? stripFrontmatter(content);
    setContextMenu(null);
    const from = Math.min(start, current.length);
    const to = Math.min(Math.max(end, from), current.length);

    pendingCaretRef.current = [from + replacement.length, from + replacement.length];
    editBody(`${current.slice(0, from)}${replacement}${current.slice(to)}`);
    scheduleSpellPopup();
  }

  function applySpellReplacement(replacement: string) {
    const spell = contextMenu?.spell;
    if (!spell) {
      setContextMenu(null);
      return;
    }
    replaceSpellWord(spell.start, spell.end, replacement);
  }

  /**
   * Corrige la palabra errónea bajo el cursor sin ratón (Alt+Intro o el cuadro
   * de sugerencias). Devuelve `true` si había una palabra errónea: aunque no
   * tenga candidatas se consume la tecla para que no parta la línea sin querer.
   */
  function applySpellCorrection(suggestion?: string): boolean {
    const area = textareaRef.current;
    if (!area || !engine) return false;

    const caret = Math.max(area.selectionStart, area.selectionEnd);
    const span = spellWordAt(area.value, caret, engine.correct);
    if (!span || !span.bad) return false;

    const list = suggestionsFor(span.word);
    const popup = spellPopup;
    const marked =
      popup && popup.start === span.start && popup.word === span.word ? popup.index : -1;
    const target = suggestion ?? list[marked >= 0 ? marked : 0];
    // Palabra errónea sin candidatas: la tecla se consume igual para no partir
    // la línea sin querer.
    if (!target) return true;

    replaceSpellWord(span.start, span.end, target);
    return true;
  }

  function addSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    if (addPersonalWord(word)) onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
  }

  function ignoreSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    ignoreWord(word);
    setSpellRevision((value) => value + 1);
  }

  function removeSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    removePersonalWord(word);
    onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
  }

  async function cutSelection() {
    const area = textareaRef.current;
    setContextMenu(null);
    if (!area) return;
    // Sin selección se corta la línea entera, igual que con Ctrl+X.
    const [start, end] =
      area.selectionEnd > area.selectionStart
        ? [area.selectionStart, area.selectionEnd]
        : lineRangeAt(area.value, area.selectionStart);
    const text = area.value.slice(start, end);
    if (!text) return;
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
    if (area.selectionEnd > area.selectionStart) return;

    const [start, end] = lineRangeAt(area.value, area.selectionStart);
    if (end <= start) return;

    event.preventDefault();
    forceHistoryRef.current = true;
    cutCurrentLine(event.clipboardData);
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

  async function copySelection() {
    const area = textareaRef.current;
    const text = area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
    setContextMenu(null);
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

    event.preventDefault();
    setContextMenu(null);
    replaceRange(area.selectionStart, text, text.length, "paste");
  }

  function selectAllText() {
    textareaRef.current?.select();
    setContextMenu(null);
  }

  function applyFormat(kind: FormatKind) {
    setContextMenu(null);
    const area = textareaRef.current;
    if (!area) return;
    const start = area.selectionStart;
    const selected = area.value.slice(start, area.selectionEnd);

    if (kind === "link") {
      replaceRange(start, `[${selected}]()`, `[${selected}](`.length);
      return;
    }

    const [open, close] = FORMAT_MARKERS[kind];
    const wrapped =
      selected.startsWith(open) &&
      selected.endsWith(close) &&
      selected.length >= open.length + close.length
        ? selected.slice(open.length, selected.length - close.length)
        : open + selected + close;

    if (selected) replaceRange(start, wrapped, wrapped.length);
    else replaceRange(start, open + close, open.length);
  }

  function insertFromMenu(item: SlashItem) {
    setContextMenu(null);
    const area = textareaRef.current;
    if (!area) return;
    const pos = area.selectionStart;
    area.setSelectionRange(pos, pos);
    replaceRange(pos, item.snippet, item.caretOffset);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && (contextMenu || headerMenu)) {
      event.preventDefault();
      setContextMenu(null);
      setHeaderMenu(false);
      return;
    }

    // Alt+Intro corrige la palabra errónea bajo el cursor, sin usar el ratón.
    if (event.key === "Enter" && event.altKey && !event.ctrlKey && !event.metaKey) {
      const applied = applySpellCorrection();
      if (applied) {
        event.preventDefault();
        return;
      }
    }

    if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void persistRef.current();
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && key === "z") {
      event.preventDefault();
      if (event.shiftKey) applyRedo();
      else applyUndo();
      return;
    }
    if (mod && !event.altKey && key === "y") {
      event.preventDefault();
      applyRedo();
      return;
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

    // Alt+↑ / Alt+↓ mueve la línea del cursor (o las seleccionadas) una
    // posición, como en VS Code. Con un menú desplegado manda el menú.
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !menu &&
      moveLine(event.key === "ArrowUp" ? -1 : 1)
    ) {
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

  /**
   * Teclado del cuadro de sugerencias. Mientras nadie lo ha recorrido con ↑/↓
   * no se secuestran teclas: el cuadro solo informa y el cursor sigue moviéndose
   * y partiendo líneas. En cuanto se toca la lista, ↑/↓ eligen y Intro o los
   * números 1-9 aplican la corrección; Esc lo cierra siempre.
   */
  function handleSpellPopupKeys(event: KeyboardEvent<HTMLElement>): boolean {
    const popup = spellPopup;
    if (!popup || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      spellDismissedRef.current = { word: popup.word, start: popup.start };
      closeSpellPopup();
      return true;
    }

    // El cuadro puede ir por detrás del cursor (recálculo aplazado): no se
    // aplica nada si esa palabra ya no es la que se tiene debajo.
    const area = textareaRef.current;
    const caret = area ? area.selectionStart : -1;
    if (
      !area ||
      caret < popup.start ||
      caret > popup.end ||
      area.value.slice(popup.start, popup.end) !== popup.word
    ) {
      scheduleSpellPopup(0);
      return false;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const size = popup.suggestions.length;
      if (size === 0) return false;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      const next =
        popup.index < 0
          ? down
            ? 0
            : size - 1
          : down
            ? (popup.index + 1) % size
            : popup.index <= 0
              ? size - 1
              : popup.index - 1;
      setSpellPopup({ ...popup, index: next });
      return true;
    }

    // La lista todavía no se ha tocado: Intro parte línea y los dígitos escriben.
    if (popup.index < 0) return false;

    if (event.key === "Enter") {
      if (!applySpellCorrection(popup.suggestions[popup.index])) return false;
      event.preventDefault();
      return true;
    }

    if (/^[1-9]$/.test(event.key)) {
      const target = popup.suggestions[Number(event.key) - 1];
      if (!target || !applySpellCorrection(target)) return false;
      event.preventDefault();
      return true;
    }

    return false;
  }

  function handleListEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.nativeEvent.isComposing) return;

    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    if (area.selectionStart !== area.selectionEnd) return;

    const edit = listEnterEdit(area.value, area.selectionStart);
    if (!edit) return;

    event.preventDefault();
    replaceRange(edit.start, edit.insert, edit.caret - edit.start);
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

  /** Tab / Shift+Tab y Enter recorren las celdas como en Excel. */
  function handleTableNav(event: KeyboardEvent<HTMLElement>) {
    const cell = tableCaret;
    if (!cell || menu || event.nativeEvent.isComposing) return;

    if (event.key === "Tab") {
      event.preventDefault();
      const target = adjacentTableCell(cell, event.shiftKey ? -1 : 1);
      if (target) focusTableCell(target.line, target.col, false);
      else if (!event.shiftKey) appendTableCellRow(cell);
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

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menu) return;

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
          : filterSlashItems(menu.query).length;
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

    const items = filterSlashItems(menu.query);
    if (items.length === 0) return;
    event.preventDefault();
    insertSlashItem(items[Math.min(menu.index, items.length - 1)]);
  }

  const statusLabel =
    saveState === "dirty"
      ? "Editando…"
      : saveState === "saved"
        ? "Guardado"
        : saveState === "error"
          ? "Error al guardar"
          : "Sin cambios";

  const statusDot =
    saveState === "dirty"
      ? "bg-amber-400"
      : saveState === "saved"
        ? "bg-emerald-400"
        : saveState === "error"
          ? "bg-rose-400"
          : "bg-gus-muted";

  const body = stripFrontmatter(content);
  const previewOffset = frontmatterLineOffset(content);
  const words = countWords(body);
  const sourceLines = useMemo(() => body.split(/\r?\n/), [body]);
  const sourceInfo = useMemo(() => classifySource(sourceLines), [sourceLines]);
  const inlineActive = viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;
  const spellOverlay =
    spell !== null && viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;
  const noteTags = parseNoteTags(content);
  const tagOptionList = tagOptions(vaultTags, tagInput, noteTags);

  const previewComponents: Components = {
    h1: ({ children }) => (
      <h1 className="mt-7 mb-3 text-3xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-3 text-2xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-xl font-semibold text-gus-text first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-2 text-lg font-semibold text-gus-text first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-4 mb-2 text-xs font-semibold tracking-wider text-gus-muted uppercase first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-4 mb-2 text-xs font-semibold tracking-wider text-gus-muted/80 uppercase first:mt-0">
        {children}
      </h6>
    ),
    p: ({ children }) => <p className="my-3 leading-7 text-gus-text first:mt-0 last:mb-0">{children}</p>,
    a: ({ href, children }) => {
      const wikiTarget = href ? decodeWikiUrl(href) : null;

      if (wikiTarget !== null) {
        const known = findWikiNote(wikiNotes, wikiTarget) !== null;

        return (
          <button
            type="button"
            onClick={() => onOpenWikiLink?.(wikiTarget)}
            title={
              known
                ? `Abrir «${wikiTarget}»`
                : `«${wikiTarget}» no existe todavía: se creará al pulsarlo`
            }
            className={clsx(
              "inline cursor-pointer rounded text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              known
                ? "text-gus-accent underline decoration-gus-accent/40 underline-offset-2 hover:decoration-gus-accent"
                : "text-gus-muted underline decoration-dashed decoration-gus-muted/60 hover:text-gus-text",
            )}
          >
            {children}
          </button>
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-gus-accent underline decoration-gus-accent/40 underline-offset-2 transition-colors hover:decoration-gus-accent"
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ol>
    ),
    li: ({ node, children }) => {
      const rawClass = node?.properties?.className;
      const classNames = Array.isArray(rawClass) ? rawClass.map(String) : [];
      const line = node?.position?.start?.line;

      if (!classNames.includes("task-list-item") || typeof line !== "number") {
        return <li className="leading-7">{children}</li>;
      }

      const sourceLine = line - previewOffset;
      const checked = taskCheckedAt(sourceLine) === true;

      return (
        <li className="my-1.5 flex list-none items-start gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? "Marcar tarea como pendiente" : "Marcar tarea como completada"}
            onClick={() => toggleTaskAt(sourceLine)}
            className={clsx(
              "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              checked
                ? "border-gus-accent bg-gus-accent text-gus-bg"
                : "border-gus-muted/50 bg-gus-card hover:border-gus-accent/60",
            )}
          >
            {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
          </button>
          <div className={clsx("min-w-0 flex-1", checked && "text-gus-muted line-through")}>
            {children}
          </div>
        </li>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="my-4 rounded-r-xl border-l-4 border-gus-accent/60 bg-gus-card px-4 py-3 text-gus-muted italic [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-gus-border" />,
    strong: ({ children }) => <strong className="font-semibold text-gus-text">{children}</strong>,
    del: ({ children }) => <del className="text-gus-muted line-through">{children}</del>,
    pre: ({ children }) => (
      <pre className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border bg-gus-card px-4 py-3 text-[13px] leading-relaxed text-gus-text [&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-inherit">
        {children}
      </pre>
    ),
    code: ({ className, children }) => {
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <MermaidDiagram code={String(children).replace(/\n+$/, "")} />;
      }

      return language ? (
        <code className={clsx("font-mono", className)}>{children}</code>
      ) : (
        <code className="rounded bg-gus-card px-1.5 py-0.5 font-mono text-[0.9em] text-gus-accent">
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border">
        <table className="w-full text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gus-card text-[11px] tracking-wide text-gus-muted uppercase">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className="border-b border-gus-border px-3 py-2 font-semibold text-gus-text">{children}</th>
    ),
    tr: ({ children }) => <tr className="odd:bg-gus-card/40">{children}</tr>,
    td: ({ children }) => (
      <td className="border-b border-gus-border/60 px-3 py-2 align-top text-gus-text">{children}</td>
    ),
    input: () => null,
  };

  function previewPane() {
    return (
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Vista previa de la nota"
        className="gus-scrollbar min-h-0 flex-1 overflow-y-auto bg-gus-bg px-6 py-5 focus:outline-none"
      >
        {body.trim() === "" ? (
          <p className="text-sm text-gus-muted">
            Esta nota está vacía. Pulsa «Editar» para escribir.
          </p>
        ) : (
          <article className="mx-auto max-w-3xl pb-10">
            <Suspense fallback={<p className="text-sm text-gus-muted">Cargando vista previa…</p>}>
              <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
            </Suspense>
          </article>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("flex h-full min-h-0 flex-col bg-gus-bg", className)}>
      <header className="shrink-0 border-b border-gus-border px-6 py-4">
        <div className="flex items-start gap-3">
          <input
            value={title}
            onChange={(event) => editTitle(event.target.value)}
            placeholder="Sin título"
            aria-label="Título de la nota"
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-gus-text outline-none placeholder:text-gus-muted"
          />

          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setViewMode(viewMode === "edit" ? "preview" : "edit");
            }}
            aria-label={viewMode === "edit" ? "Previsualizar la nota" : "Volver a editar la nota"}
            title={viewMode === "edit" ? "Previsualizar" : "Editar"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-3 py-1.5 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
          >
            {viewMode === "edit" ? (
              <>
                <Eye className="h-4 w-4" aria-hidden="true" />
                Previsualizar
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </>
            )}
          </button>

          <div ref={headerMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setHeaderMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={headerMenu}
              aria-label="Más opciones de la nota"
              title="Más opciones"
              className="inline-flex h-[30px] items-center rounded-lg border border-gus-border bg-gus-card px-2 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>

            {headerMenu && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setHeaderMenu(false);
                    setExportOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Exportar a PDF
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {noteTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[11px] text-gus-accent"
            >
              {tag}
              <button
                type="button"
                onClick={() => applyNoteTags(noteTags.filter((item) => item !== tag))}
                aria-label={`Quitar etiqueta ${tag}`}
                className="-mr-1 rounded-full opacity-70 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}

          <div className="relative min-w-40 max-w-64 flex-1">
            <input
              value={tagInput}
              onChange={(event) => handleTagInputChange(event.target.value)}
              onKeyDown={handleTagInputKeyDown}
              onFocus={() => {
                if (!vaultPath) return;
                loadVaultTags();
                setTagMenuOpen(true);
              }}
              onBlur={() => {
                commitTagInput();
                setTagMenuOpen(false);
              }}
              placeholder={noteTags.length > 0 ? "añadir etiqueta…" : "añadir etiqueta (Enter o coma)…"}
              aria-label="Etiquetas de la nota"
              role="combobox"
              aria-expanded={tagMenuOpen}
              aria-controls="gus-tag-menu"
              className="w-full rounded-full border border-transparent bg-gus-card/60 px-2.5 py-0.5 text-[11px] text-gus-text outline-none transition-colors placeholder:text-gus-muted/70 focus:border-gus-accent/50"
            />

            {tagMenuOpen && (
              <div
                id="gus-tag-menu"
                role="listbox"
                aria-label="Etiquetas del vault"
                className="absolute left-0 top-full z-30 mt-1 max-h-56 w-64 min-w-full overflow-y-auto rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
              >
                {tagOptionList.length === 0 ? (
                  <p className="px-3 py-1.5 text-[11px] text-gus-muted">
                    {tagInput
                      ? `Sin coincidencias · Intro para crear «${tagInput}»`
                      : "Todavía no hay etiquetas en el vault"}
                  </p>
                ) : (
                  tagOptionList.map((entry, index) => (
                    <button
                      key={entry.tag}
                      type="button"
                      role="option"
                      aria-selected={index === Math.min(tagIndex, tagOptionList.length - 1)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickTag(entry.tag)}
                      onMouseEnter={() => setTagIndex(index)}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] outline-none",
                        index === Math.min(tagIndex, tagOptionList.length - 1)
                          ? "bg-gus-accent/15 text-gus-accent"
                          : "text-gus-text hover:bg-gus-card",
                      )}
                    >
                      <span className="truncate">{entry.tag}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-gus-muted">
                        {entry.count} nota{entry.count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gus-muted">
          <span className="flex items-center gap-1.5" role="status" aria-live="polite">
            <span className={clsx("h-1.5 w-1.5 rounded-full", statusDot)} aria-hidden="true" />
            {statusLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {words} palabra{words === 1 ? "" : "s"} · {body.length} carácter
            {body.length === 1 ? "" : "es"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-gus-muted/70">Ctrl+S para guardar</span>
        </div>
        {saveError && (
          <p className="mt-2 break-words rounded-md border border-rose-400/30 bg-rose-400/5 px-2 py-1.5 text-[11px] text-rose-300">
            {saveError}
          </p>
        )}
      </header>

      {viewMode === "edit" ? (
        <div className="relative min-h-0 w-full flex-1 bg-gus-bg">
          {(inlineActive || spellOverlay) && (
            <InlinePreview
              lines={sourceInfo}
              caretLine={caretLine}
              scrollbarWidth={scrollbarWidth}
              fontSize={fontSize}
              rowHeight={rowPitch}
              hidden={composing}
              overlayRef={overlayRef}
              spell={spell}
              raw={!inlineActive}
              slashHint={lineHint && !menu && !slashHintUsed}
              tableCols={tableCols}
              tableCaret={tableCaret}
            />
          )}

          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => handleContentChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onCut={handleCut}
            onPaste={handlePaste}
            onMouseDown={handleCellMouseDown}
            onSelect={handleCaretMove}
            onScroll={handleScroll}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onBlur={() => {
              setMenu(null);
              setContextMenu(null);
              spellDismissedRef.current = null;
              closeSpellPopup();
            }}
            onContextMenu={handleContextMenu}
            placeholder="Escribe tu nota en markdown… — [[ enlazar otra nota · / insertar bloques"
            aria-label="Contenido de la nota"
            spellCheck={false}
            lang={spellLang !== undefined && spellLang !== "off" ? spellLang : undefined}
            style={
              fontSize || tableCaret
                ? {
                    ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
                    ...(tableCaret && !composing ? { caretColor: "transparent" } : {}),
                  }
                : undefined
            }
            className={clsx(
              // break-spaces: los espacios finales envuelven en vez de «colgar»
              // fuera del borde derecho; el cursor baja al pulsar espacio y el
              // overlay maqueta igual (mismo white-space en InlinePreview).
              "gus-scrollbar relative h-full w-full resize-none whitespace-break-spaces px-6 py-4 font-mono text-sm leading-[23px] text-gus-text outline-none placeholder:text-gus-muted focus:outline-none",
              inlineActive && "gus-source-area",
              composing && "gus-source-text",
              tableCaret && !composing && "gus-cell-edit",
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
                items={filterSlashItems(menu.query)}
                index={menu.index}
                onPick={insertSlashItem}
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
        previewPane()
      )}

      {exportOpen && (
        <PdfExportDialog title={title} onClose={() => setExportOpen(false)}>
          <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
        </PdfExportDialog>
      )}
    </div>
  );
}
