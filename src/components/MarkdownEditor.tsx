import {
  Children,
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { AnimatePresence } from "framer-motion";
import type { Components, UrlTransform } from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import clsx from "clsx";
import { Check, ChevronDown, Eye, FileDown, Pencil, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { isInsidePath, parentPath, pathWithTitle, safeFileName } from "../lib/fileName";
import { imageFilters, importFilesIntoVault } from "../lib/importFiles";
import {
  decodeImageDest,
  filterVaultImages,
  imageAlt,
  imageCandidates,
  imageDest,
  imageMarkdown,
  isImagePath,
  type VaultImage,
} from "../lib/imageLinks";
import { DRAG_ENTRY_MIME, type DragEntry } from "./FileExplorer";
import { listEnterEdit } from "../lib/listContinue";
import {
  orderedBlockAt,
  renumberAfterPaste,
  renumberOrderedLists,
  type OrderedBlockRef,
  type PasteRange,
} from "../lib/listNumbering";
import { moveLines } from "../lib/moveLines";
import { copyText } from "../lib/clipboard";
import { codeBlocks, type CodeBlockInfo } from "../lib/codeBlocks";
import { highlightCode } from "../lib/highlight";
import {
  addPersonalWord,
  getPersonalWords,
  ignoreWord,
  isPersonalWord,
  loadSpellEngines,
  removePersonalWord,
  spellSegments,
  spellWordAt,
  type SpellEngine,
  type SpellFn,
  type SpellLang,
} from "../lib/spellCheck";
import { comboFor, comboLabel, matchesCombo, type ShortcutId, type ShortcutMap } from "../lib/shortcuts";
import { useT } from "../lib/i18n";
import { charWidthPx, offsetAtPointer } from "../lib/pointerOffset";
import { toLocalCoord } from "../lib/uiZoom";
import {
  adjacentTableCell,
  alignTableColumn,
  cellRect,
  cellRectClipboard,
  cellIndexAtPointer,
  clearTableCells,
  computeTableMerges,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  isTableMergePossible,
  isTableTaskCell,
  isTableUnmergePossible,
  lineIndexOf,
  lineStartOffset,
  actionRect,
  mergeTableCells,
  moveTableRow,
  neighbourColumn,
  planTableDeletion,
  rectSpansCells,
  removeTable,
  removeTableColumn,
  removeTableRow,
  resolveTableCaret,
  rowJumpAllowed,
  sortTableRows,
  sourceSegments,
  splitTableCells,
  tableBlockAt,
  tableCellRange,
  tableFromDelimited,
  tableIntersects,
  tableRows,
  tableSkeleton,
  toggleTableTask,
  unmergeTableCells,
  visualLength,
  wordRangeAt,
  type TableCellCaret,
  type TableCellRect,
  type TableCellRef,
  type TableEdit,
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
  VaultImageMenu,
  WikiLinkMenu,
  type SlashItem,
} from "./EditorMenus";
import CopyCodeButton from "./CopyCodeButton";
import InlinePreview, {
  classifySource,
  type TableBarHover,
  type TableResizeHover,
  type TableSelection,
} from "./InlinePreview";
import MermaidDiagram from "./MermaidDiagram";
import EditorContextMenu, {
  type ContextSpell,
  type FormatKind,
  type TableAction,
  type TableMenuInfo,
} from "./EditorContextMenu";
import PdfExportDialog from "./PdfExportDialog";

export interface EditorDraft {
  path: string;
  title: string;
  content: string;
}

/** Qué ha dado de sí meter un lote de imágenes en la nota. */
export interface ImageInsertResult {
  /** Imágenes que acabaron enlazadas. */
  inserted: number;
  /** Las que no se pudieron copiar ni resolver. */
  failed: number;
}

export interface MarkdownEditorHandle {
  flush: () => Promise<boolean>;
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

/** Anchura mínima de una columna al redimensionar, y de una que no se pueda
 *  medir (píxeles): la celda lleva 16 de relleno, así que 24 ya deja texto. */
const MIN_COL_WIDTH = 24;
const DEFAULT_COL_WIDTH = 48;
/** Zona de clic de la casilla de tarea (unos cinco caracteres con el relleno). */
const TASK_CHECKBOX_PX = 36;

/** Alto que una tabla ha ganado al envolver sus celdas: a partir de su última
 *  fila el overlay queda más abajo que el textarea, y hay que compensarlo. */
interface TableDrift {
  /** Última línea del bloque de tabla. */
  end: number;
  /** Píxeles de más que ocupa el bloque. */
  extra: number;
}

/** Mapa de alturas vacío reutilizable: evita re-renderizar por un Map nuevo. */
const EMPTY_DRIFT: Map<number, TableDrift> = new Map();

/** Lista vacía de imágenes, para no crear una nueva en cada render. */
const EMPTY_IMAGES: VaultImage[] = [];

type SaveState = "idle" | "dirty" | "saved" | "error";

type ViewMode = "edit" | "preview";

interface EditorMenu {
  kind: "wiki" | "slash" | "images";
  start: number;
  query: string;
  index: number;
  anchor: CaretAnchor;
  /** Grupo del menú «/»: el normal o el de tamaños de tabla. */
}

interface ContextMenuState {
  spell: ContextSpell | null;
  hasSelection: boolean;
  /** Tabla bajo el clic derecho (null si el clic no cayó en una). */
  table: TableMenuInfo | null;
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

/** Los bloques de la vista previa, al estilo Obsidian: fondo de bloque,
 *  esquinas a 4px (--code-radius) y sin borde (--code-border-width: 0px). */
/* ------------------------------------------------------------------ */
/* Traza temporal de tablas (se activa con /tmp/gus-tables.log)          */
/* ------------------------------------------------------------------ */
function traza(evento: string, datos: Record<string, unknown> = {}) {
  try {
    // eslint-disable-next-line no-undef
    // Se enciende con «pnpm tauri dev -- --traza-tablas» o poniendo
    // VITE_TRAZA_TABLAS=1; en una build normal no hay traza.
    const existe =
      typeof window !== "undefined" &&
      (window.localStorage.getItem("gus-tables-log") === "1" ||
        import.meta.env.VITE_TRAZA_TABLAS === "1");
    if (!existe) return;
    const linea = JSON.stringify({ evento, ...datos });
    void fetch("http://127.0.0.1:5198/log", {
      method: "POST",
      body: linea,
      mode: "no-cors",
    }).catch(() => {});
  } catch {
    /* la traza nunca debe romper el editor */
  }
}

const PRE_CLASS =
  "gus-scrollbar overflow-x-auto whitespace-pre-wrap rounded bg-gus-card px-4 py-3 text-[13px] leading-relaxed text-gus-text [&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-inherit";

/**
 * Lee el contenido del bloque que envuelve un <pre> de react-markdown y
 * detecta si es mermaid: ese bloque se sustituye por el diagrama y no debe
 * llevar botón de copiar (en Obsidian pasa lo mismo: el procesador de
 * mermaid quita el `<pre>` original antes de añadir su botón).
 */
function readCodeBlock(children: ReactNode): { text: string; mermaid: boolean } {
  const parts: string[] = [];
  let mermaid = false;

  const walk = (node: ReactNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isValidElement(node)) {
      const props = node.props as { className?: unknown; children?: ReactNode };
      if (
        typeof props.className === "string" &&
        /(?:^|\s)language-mermaid(?:\s|$)/.test(props.className)
      ) {
        mermaid = true;
      }
      walk(props.children);
    }
  };

  walk(children);
  return { text: parts.join("").replace(/\n+$/, ""), mermaid };
}

/** Texto plano de un nodo React: hace falta para leer los marcadores «>» y «^». */
function plainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement(node)) {
    return plainText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Fila React (tr) con forma de línea de tabla markdown, lista para parsearla. */
function rowToMarkdown(row: ReactElement): string {
  const cells = Children.toArray((row.props as { children?: ReactNode }).children);
  const body = cells
    // Los «|» de la celda se escapan: splitTableCells respeta el escape y el
    // recuento de columnas no se rompe.
    .map((cell) => plainText(cell).replace(/\|/g, "\\|"))
    .map((text) => ` ${text} `)
    .join("|");
  return `|${body}|`;
}

/**
 * Pinta las celdas combinadas en el modo de visualización: las celdas «>» y «^»
 * que dejó la fusión desaparecen y la maestra acumula colSpan/rowSpan. El
 * cálculo es el mismo que usa el modo edición (computeTableMerges), corrido
 * sobre una rejilla reconstruida aquí, porque react-markdown ya ha convertido
 * la tabla en filas y ya no trae el separador `|---|`.
 */
function applyPreviewMerges(children: ReactNode): ReactNode {
  const sections = Children.toArray(children);

  // 1. Rejilla de texto: cabecera, separador inventado (el HTML no lo lleva) y cuerpo.
  const grid: TableLine[] = [];
  const placements: { section: ReactElement; rows: { row: ReactElement; at: number | null }[] }[] =
    [];
  let needsSeparator = true;

  for (const section of sections) {
    if (!isValidElement(section)) continue;
    const rows = Children.toArray((section.props as { children?: ReactNode }).children);
    const placed: { row: ReactElement; at: number | null }[] = [];

    for (const row of rows) {
      if (!isValidElement(row)) continue;
      placed.push({ row, at: grid.length });
      grid.push({ text: rowToMarkdown(row), code: false });
      if (needsSeparator) {
        needsSeparator = false;
        grid.push({ text: "| --- |", code: false });
      }
    }

    placements.push({ section, rows: placed });
  }

  const merges = computeTableMerges(grid, 0, Math.max(0, grid.length - 1));

  // 2. Volver a montar las secciones sin las celdas de continuación, con los
  //    spans en las maestras (cloneElement conserva los props de react-markdown).
  return placements.map(({ section, rows }) => {
    const rebuiltRows = rows.map(({ row, at }) => {
      const cells = Children.toArray((row.props as { children?: ReactNode }).children);
      const merged: ReactNode[] = [];

      cells.forEach((cell, c) => {
        const info = at === null ? undefined : merges.get(`${at}:${c}`);
        if (info?.isContinuation) return;
        if (info && (info.colSpan > 1 || info.rowSpan > 1) && isValidElement(cell)) {
          merged.push(
            cloneElement(cell as ReactElement<{ colSpan?: number; rowSpan?: number }>, {
              colSpan: info.colSpan,
              rowSpan: info.rowSpan,
            }),
          );
        } else {
          merged.push(cell);
        }
      });

      return cloneElement(row, {}, merged);
    });

    return cloneElement(section, {}, rebuiltRows);
  });
}

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

/** Imágenes de la vista previa ya resueltas, para no repetir lecturas. */
const RESOLVED_IMAGES = new Map<string, string>();

/**
 * Imagen de la vista previa. Las rutas del vault no las entiende el webview
 * (son relativas a la nota o a la raíz), así que se resuelven a datos de
 * imagen con `read_vault_image`, probando primero junto a la nota y después
 * desde la raíz. Mientras carga y si no la encuentra se avisa en el sitio de
 * dejar un hueco roto.
 */
function PreviewImage({
  src,
  alt,
  notePath,
  vaultPath,
}: {
  src?: string;
  alt?: string;
  notePath: string;
  vaultPath: string | null;
}) {
  const t = useT();
  const candidates = useMemo(
    () => (src ? imageCandidates(src, notePath, vaultPath) : []),
    [src, notePath, vaultPath],
  );
  const directo = src && /^(data:|https?:\/\/)/i.test(src) ? src : null;
  const key = directo ?? candidates.join("\n");

  const [estado, setEstado] = useState<
    { fase: "listo"; url: string } | { fase: "carga" } | { fase: "fallo" }
  >(() => {
    if (directo) return { fase: "listo", url: directo };
    const cacheado = key ? RESOLVED_IMAGES.get(key) : undefined;
    return cacheado ? { fase: "listo", url: cacheado } : { fase: "carga" };
  });

  useEffect(() => {
    if (directo) {
      setEstado((actual) =>
        actual.fase === "listo" && actual.url === directo ? actual : { fase: "listo", url: directo },
      );
      return;
    }
    if (candidates.length === 0) {
      setEstado({ fase: "fallo" });
      return;
    }

    const cacheado = RESOLVED_IMAGES.get(key);
    if (cacheado) {
      setEstado({ fase: "listo", url: cacheado });
      return;
    }

    let cancelado = false;
    setEstado({ fase: "carga" });

    void (async () => {
      for (const ruta of candidates) {
        try {
          const url = await invoke<string>("read_vault_image", { path: ruta });
          RESOLVED_IMAGES.set(key, url);
          if (!cancelado) setEstado({ fase: "listo", url });
          return;
        } catch {
          // Ni una ni otra: se prueba la siguiente candidata.
        }
      }
      if (!cancelado) setEstado({ fase: "fallo" });
    })();

    return () => {
      cancelado = true;
    };
  }, [key, directo, candidates]);

  if (estado.fase === "listo") {
    return (
      <img
        src={estado.url}
        alt={alt ?? ""}
        loading="lazy"
        className="my-4 max-h-[70vh] max-w-full rounded-lg border border-gus-border bg-gus-card object-contain"
      />
    );
  }

  const nombre = alt || (src ? decodeImageDest(src) : "");

  if (estado.fase === "fallo") {
    return (
      <span className="my-4 block break-words rounded-lg border border-dashed border-rose-400/40 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
        {t("editor.imageBroken", { name: nombre })}
      </span>
    );
  }

  return (
    <span className="my-4 block rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-xs text-gus-muted">
      {t("editor.imageLoading")}
    </span>
  );
}

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

/** ¿Dos mapas de alturas de bloque dicen lo mismo? (evita re-renderizar) */
function sameDrift(a: Map<number, TableDrift>, b: Map<number, TableDrift>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, drift] of a) {
    const other = b.get(key);
    if (!other || other.end !== drift.end || other.extra !== drift.extra) return false;
  }
  return true;
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
  /** Alto ganado por cada tabla al envolver sus celdas (por bloque). */
  const [tableDrift, setTableDrift] = useState<Map<number, TableDrift>>(EMPTY_DRIFT);
  /** Borde de columna bajo el ratón, listo para arrastrar. */
  const [hoverResize, setHoverResize] = useState<TableResizeHover | null>(null);
  const prevTableLineRef = useRef(-1);
  /** Celda ancla de la selección: punto fijo de Mayús+flechas / Mayús+clic. */
  const tableAnchorRef = useRef<{ line: number; col: number } | null>(null);
  /** Espejo de tableWidths para leerlo en los escuchadores del arrastre. */
  const colWidthsRef = useRef<Map<number, number[]>>(new Map());
  /** Espejo de tableDrift: se lee al hacer scroll y al situar el cursor. */
  const tableDriftRef = useRef<Map<number, TableDrift>>(tableDrift);
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
    tableDriftRef.current = tableDrift;
  });
  /** Arrastre de columna en curso: bloque, columna, x inicial y anchuras. */
  const resizeDragRef = useRef<{
    block: number;
    col: number;
    startX: number;
    widths: number[];
  } | null>(null);
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
  /** Barra «+» de tabla bajo el ratón: las barras solo se enseñan así. */
  const [hoverBar, setHoverBar] = useState<TableBarHover | null>(null);
  const tableBarsRef = useRef<HTMLElement[]>([]);
  const [rowPitch, setRowPitch] = useState(23);
  const [tableCols, setTableCols] = useState<number | null>(null);
  const [zoomTick, setZoomTick] = useState(0);
  const [composing, setComposing] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const t = useT();
  const [engine, setEngine] = useState<SpellEngine | null>(null);
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
  const [spellRevision, setSpellRevision] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  /**
   * Espejo del menú abierto. El estado de React todavía no está aplicado cuando
   * el navegador mueve el cursor por el clic derecho (pasa *después* de abrirse
   * el menú), así que para esa comprobación hace falta un ref, que se pone al
   * instante de abrirlo.
   */
  const contextMenuOpenRef = useRef(false);
  const [spellPopup, setSpellPopup] = useState<SpellPopup | null>(null);
  const spellPopupTimerRef = useRef<number | null>(null);
  const spellSuggestCacheRef = useRef<{ word: string; list: string[] } | null>(null);
  /** Palabra descartada con Esc: no vuelve a abrirse hasta que el cursor salga. */
  const spellDismissedRef = useRef<{ word: string; start: number } | null>(null);
  /** Selección de la que ya partió un recálculo (corta bucles de recálculo). */
  const lastSpellSelRef = useRef<string | null>(null);
  // El temporizador vive fuera del render: siempre ejecuta la última versión.
  const spellPopupSyncRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    spellPopupSyncRef.current = syncSpellPopup;
  });

  useEffect(() => {
    const langs = spellLangs ?? [];
    if (langs.length === 0) {
      setEngine(null);
      return;
    }
    let alive = true;
    setEngine(null);
    void loadSpellEngines(langs).then((loaded) => {
      if (alive) setEngine(loaded);
    });
    return () => {
      alive = false;
    };
    // `spellLangs` viene del estado de ajustes y mantiene su identidad entre
    // renders, así que comparar por referencia equivale a comparar por
    // contenido y la dependencia se queda simple.
  }, [spellLangs]);

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

  const spell = useMemo<SpellFn | null>(() => {
    // `spellWords` se referencia a propósito: no cambia el resultado, pero
    // sí la identidad de `spell`, y con ella las líneas memorizadas que
    // vuelven a marcar el texto cuando cambia el diccionario.
    void spellWords;
    return engine ? (text: string) => spellSegments(text, engine.correct) : null;
  }, [engine, spellWords, spellRevision]);

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
  /** Imágenes del vault para el selector que abre «Imagen del vault». */
  const [vaultImages, setVaultImages] = useState<VaultImage[]>([]);
  const [vaultImagesLoading, setVaultImagesLoading] = useState(false);
  /** Arrastrando una imagen del explorador por encima del campo de texto. */
  const [imageDropOver, setImageDropOver] = useState(false);
  /**
   * Imágenes que enseña el selector: dependen de su consulta y de la lista del
   * vault, no del índice recorrido, para que el array no cambie al pulsar ↑↓
   * (si no, el efecto de las miniaturas se volvería a disparar en cada tecla).
   */
  const imagesQuery = menu?.kind === "images" ? menu.query : null;
  const imageMatches = useMemo(
    () => (imagesQuery === null ? EMPTY_IMAGES : filterVaultImages(vaultImages, imagesQuery)),
    [imagesQuery, vaultImages],
  );
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
  const imagesRequestRef = useRef(0);
  const tagRequestRef = useRef(0);

  const ownPathRef = useRef(path);
  const sequenceRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveRef = useRef(autoSave);
  // Espejos sincronizados tras el commit y antes del paint: no se escribe en
  // un ref durante el render y, como persist/autoSave se llaman también desde
  // handlers, la ref es la vía válida (useEffectEvent solo sirve en efectos).
  useLayoutEffect(() => {
    autoSaveRef.current = autoSave;
    dirtyRef.current = saveState === "dirty";
  });

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
    // Sin `refreshCaretLine` en las deps: se recrea en cada render y el
    // efecto:focus + restaurar caret se dispararía sin motivo (mismo criterio
    // que en el efecto de `viewMode` y en el de restauración de abajo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useLayoutEffect(() => {
    persistRef.current = persist;
  });

  const insertImagesRef = useRef(insertImagesAt);
  useLayoutEffect(() => {
    insertImagesRef.current = insertImagesAt;
  });

  // `flush` solo lee refs: con useCallback su identidad deja de cambiar en
  // cada render y useImperativeHandle no se vuelve a ejecutar sin motivo.
  const flush = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;

    dirtyRef.current = false;
    const saved = await persistRef.current();
    if (!saved) dirtyRef.current = true;
    return saved;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flush,
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

  function syncOverlayGeometry() {
    const area = textareaRef.current;
    if (!area) return;

    const overlay = overlayRef.current;
    // El overlay es más alto que el textarea cuando una tabla ha envuelto sus
    // celdas: se le suma lo que ya ha pasado por arriba para que siga entrando
    // por arriba lo que toca.
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

  /**
   * Imágenes de todo el vault para el selector que abre «Imagen del vault»: se
   * piden al abrirlo, que recorrer el vault entero no es algo que hacer en
   * cada render.
   */
  function loadVaultImages() {
    if (!vaultPath) {
      setVaultImages([]);
      setVaultImagesLoading(false);
      return;
    }

    const request = ++imagesRequestRef.current;
    setVaultImagesLoading(true);

    invoke<VaultImage[]>("list_vault_images", { path: vaultPath })
      .then((images) => {
        if (request !== imagesRequestRef.current) return;
        setVaultImages(images);
        setVaultImagesLoading(false);
      })
      .catch(() => {
        if (request !== imagesRequestRef.current) return;
        setVaultImagesLoading(false);
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

  /** ¿El punto (x, y) cae dentro del rectángulo del elemento? */
  function insideRect(element: Element, x: number, y: number): boolean {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /** Botón «copiar» bajo el punto (x, y): devuelve la línea de su bloque. */
  function copyChipAt(clientX: number, clientY: number): number | null {
    for (const chip of copyChipsRef.current) {
      if (insideRect(chip, clientX, clientY)) return Number(chip.dataset.copyLine);
    }
    return null;
  }

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
   * Doble clic: sobre el borde de una columna la ajusta al contenido (como el
   * doble clic de Excel); dentro de una celda, marca la palabra.
   */
  function handleOverlayDoubleClick(event: MouseEvent<HTMLTextAreaElement>) {
    const resize = resizeHandleAt(event.clientX, event.clientY);
    if (resize) {
      event.preventDefault();
      cellDragRef.current = null;
      autoFitColumn(resize.block, resize.col);
      return;
    }
    handleOverlayCellDoubleClick(event);
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

  /** Copia el contenido de un bloque de código y enseña el ✔ un segundo. */
  function copyCodeBlock(start: number) {
    const block = codeBlockMap.get(start);
    if (!block) return;
    void copyText(block.text).then((ok) => {
      if (!ok) return;
      setCopyDone(block.start);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyDone(null), 1000);
    });
  }

  /**
   * Clic sobre lo que el overlay dibuja encima del fondo (celdas de tabla y
   * botones «copiar»): el overlay va por debajo del textarea, así que esos
   * elementos se detectan por coordenadas en este evento.
   */
  /** Celda dibujada bajo el punto (x, y), o null si el punto cae fuera de una. */
  function cellAt(clientX: number, clientY: number): HTMLElement | null {
    // La lista se mantiene al día con el overlay; si aun no está (o el overlay
    // no se ha dibujado), se busca en el DOM.
    const cells =
      tableCellsRef.current.length > 0
        ? tableCellsRef.current
        : Array.from(
            overlayRef.current?.querySelectorAll<HTMLElement>("[data-cell]") ?? [],
          );
    return cells.find((element) => insideRect(element, clientX, clientY)) ?? null;
  }

  /**
   * Desplazamiento del texto bajo el punto cuando cae dentro de una celda. La
   * celda se mide en pantalla y su ancho se reparte en caracteres, de modo que el
   * cursor cae donde se ha hecho clic y el arrastre selecciona texto como en
   * cualquier editor (en vez de quedarse con la celda entera).
   */
  function cellOffsetAt(clientX: number, clientY: number): number | null {
    const cell = cellAt(clientX, clientY);
    const area = textareaRef.current;
    if (!cell || !area) return null;

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    if (Number.isNaN(line) || Number.isNaN(col)) return null;
    const range = tableCellRange(sourceInfo, line, col);
    if (!range) return null;

    const span = splitTableCells(sourceInfo[line]?.text ?? "")[col];
    const text = span?.text ?? "";
    const char = charWidthPx(area);
    if (!char) return null;

    // El div interno es el que lleva el texto: su borde izquierdo cae justo en el
    // primer carácter de la celda.
    const inner = (cell.firstElementChild ?? cell) as HTMLElement;
    const box = inner.getBoundingClientRect();
    const perLine = Math.max(1, Math.floor(box.width / char));
    return (
      range.start +
      cellIndexAtPointer(
        text,
        clientX - box.left,
        clientY - box.top,
        char,
        perLine,
        rowPitch,
      )
    );
  }

  /**
   * Ratón en movimiento: resalta el «copiar» del bloque, enseña las barras «+»
   * y el asa de columna, y —si hay un arrastre en marcha— mueve el extremo de la
   * selección que sigue al puntero. El otro extremo (el del clic) queda fijo, así
   * que arrastrar selecciona texto como en cualquier editor. Si el puntero sale
   * de la tabla se sigue con la cuenta geométrica de siempre y la selección
   * continúa hacia el texto de alrededor sin saltos.
   */
  function handleOverlayMouseMove(event: MouseEvent<HTMLTextAreaElement>) {
    const drag = cellDragRef.current;
    if (drag && event.buttons !== 0) {
      const area = textareaRef.current;
      if (!area) return;
      const at =
        cellOffsetAt(event.clientX, event.clientY) ??
        offsetAtPointer(area, event.clientX, event.clientY, driftBeforeLine(drag.line));
      if (at === null) return;
      if (at === area.selectionStart && area.selectionEnd === drag.anchor) return;
      if (at === area.selectionEnd && area.selectionStart === drag.anchor) return;

      // La celda del clic sigue siendo el ancla: Mayús+flechas y Supr la usan.
      tableAnchorRef.current = { line: drag.line, col: drag.col };
      area.setSelectionRange(Math.min(drag.anchor, at), Math.max(drag.anchor, at));
      // El recuadro se repinta aquí y no solo al soltar: mientras el motor está
      // con el arrastre no siempre llega el «select», y sin esto las celdas se
      // iban marcando de golpe al levantar el ratón, sin poder ver qué se cogía.
      handleCaretMove();
      // Arrastrando texto no se enseñan ni las barras «+» ni el asa de columna:
      // están cuatro píxeles más allá de donde va la selección.
      return;
    }

    // Resalta el botón «copiar» del bloque bajo el cursor.
    const line = copyChipAt(event.clientX, event.clientY);
    setCopyHover((prev) => (prev === line ? prev : line));
    // Las barras «+» de las tablas solo se enseñan con el ratón encima de la
    // barra, no de la tabla.
    const bar = tableBarAtPoint(event.clientX, event.clientY);
    setHoverBar((prev) =>
      prev && bar && prev.block === bar.block && prev.part === bar.part ? prev : bar,
    );
    // El borde de una columna se agarra para cambiar su anchura. Durante el
    // arrastre se sigue a la columna que se está moviendo, que el render puede
    // ir un paso por detrás del puntero: así ni la línea ni el cursor de
    // redimensionado parpadean.
    const dragged = resizeDragRef.current;
    const resize = dragged
      ? { block: dragged.block, col: dragged.col }
      : resizeHandleAt(event.clientX, event.clientY);
    setHoverResize((prev) =>
      prev && resize && prev.block === resize.block && prev.col === resize.col ? prev : resize,
    );
  }

  function handleOverlayMouseDown(event: MouseEvent<HTMLTextAreaElement>) {
    // El clic derecho puede colapsar la selección en WebKit: se guarda antes
    // de que el motor la toque, para que el menú sepa qué filas había marcadas.
    if (event.button === 2) {
      const area = textareaRef.current;
      rightClickSelRef.current = area ? [area.selectionStart, area.selectionEnd] : null;
      traza("mousedown-derecho", {
        seleccion: rightClickSelRef.current,
        rectPintado: markedRectRef.current,
      });
      return;
    }
    if (event.button !== 0) return;
    // Empieza otra selección: lo marcado antes ya no cuenta.
    markedRectRef.current = null;

    // Clic corriente: rompe la ancla de la selección multifila. Con Mayús se
    // conserva, porque el clic es una extensión de esa misma selección.
    if (!event.shiftKey) tableAnchorRef.current = null;
    rightClickSelRef.current = null;
    if (!inlineActive) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const chipLine = copyChipAt(event.clientX, event.clientY);
    if (chipLine !== null && codeBlockMap.has(chipLine)) {
      // Copiar no mueve el cursor ni deshace la selección.
      event.preventDefault();
      copyCodeBlock(chipLine);
      return;
    }

    // Los dos «+» del bloque: el del costado añade columna, el de abajo fila.
    const badge = addBadgeAt(event.clientX, event.clientY);
    if (badge) {
      event.preventDefault();
      textareaRef.current?.focus();
      const col = badge.dataset.addCol;
      const blockStart = badge.dataset.addBlock;
      if (col !== undefined && blockStart !== undefined) {
        addTableColumnAt(Number(blockStart), Number(col));
      } else if (badge.dataset.addRow !== undefined) {
        addTableRowAt(Number(badge.dataset.addRow));
      }
      return;
    }

    // Asa de columna: al arrastrarla se cambia la anchura de esa columna.
    const resize = resizeHandleAt(event.clientX, event.clientY);
    if (resize && !resizeDragRef.current) {
      event.preventDefault();
      textareaRef.current?.focus();
      const widths = measureTableColumns(resize.block);
      if (widths) startColumnResize(resize.block, resize.col, event.clientX, widths);
      return;
    }

    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) {
      cellDragRef.current = null;
      return;
    }

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    const range = tableCellRange(sourceInfo, line, col);
    const area = textareaRef.current;
    if (!range || !area) return;

    event.preventDefault();
    area.focus();

    // Clic sobre la casilla de una celda de tarea («- [ ]»): la marca o la
    // desmarca. Más a la derecha, el cursor entra en el texto como siempre.
    const cellText = splitTableCells(sourceInfo[line]?.text ?? "")[col]?.text ?? "";
    if (!event.shiftKey && isTableTaskCell(cellText)) {
      const box = cell.getBoundingClientRect();
      if (event.clientX - box.left <= TASK_CHECKBOX_PX) {
        cellDragRef.current = null;
        applyTableEdit(toggleTableTask(currentLines(), line, col));
        return;
      }
    }

    if (event.shiftKey) {
      // Mayús+clic: la selección va desde la celda ancla hasta esta, completas.
      cellDragRef.current = null;
      const anchor = selectionAnchorCell(area);
      if (anchor) selectCellBlock(anchor, { line, col });
      else area.setSelectionRange(range.start, range.end);
      handleCaretMove();
      return;
    }

    // Clic llano: el cursor cae donde se ha pulsado (como en cualquier editor) y
    // la celda pasa a ser el ancla de Mayús+flechas. La selección la llevamos
    // nosotros —el motor pondría el cursor en el crudo, no en la celda— así que
    // el arrastre se resuelve en handleOverlayMouseMove.
    const at = cellOffsetAt(event.clientX, event.clientY) ?? range.start;
    tableAnchorRef.current = { line, col };
    setTableRect(null);
    area.setSelectionRange(at, at);
    cellDragRef.current = { anchor: at, line, col };
    handleCaretMove();
  }

  /** Doble clic en una celda: marca la palabra, como en cualquier editor. */
  function handleOverlayCellDoubleClick(event: MouseEvent<HTMLTextAreaElement>) {
    const cell = cellAt(event.clientX, event.clientY);
    const area = textareaRef.current;
    if (!cell || !area) return;

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    const range = tableCellRange(sourceInfo, line, col);
    if (!range) return;

    const span = splitTableCells(sourceInfo[line]?.text ?? "")[col];
    const inside = cellOffsetAt(event.clientX, event.clientY);
    if (!span || inside === null) return;

    const [from, to] = wordRangeAt(span.text, inside - range.start);
    event.preventDefault();
    tableAnchorRef.current = { line, col };
    area.setSelectionRange(range.start + from, range.start + to);
    cellDragRef.current = null;
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

  /**
   * Enlaza imágenes en la nota: las que ya están en el vault se referen tal
   * cual y las del equipo se copian antes junto a la nota (si no, el enlace
   * apuntaría a una ruta que vive fuera del vault y se rompería al moverlo).
   *
   * La selección debe haberse colapsado ya en `from` cuando lo que se trae es
   * un arrastre; con el menú «/» abierto, en cambio, `from` es la barra y el
   * cursor sigue al final de la consulta, que es el texto que hay que sustituir.
   */
  async function insertImageFiles(
    sources: string[],
    from: number,
  ): Promise<ImageInsertResult> {
    if (sources.length === 0) return { inserted: 0, failed: 0 };

    const dentro: string[] = [];
    const fuera: string[] = [];
    for (const source of sources) {
      (vaultPath && isInsidePath(source, vaultPath) ? dentro : fuera).push(source);
    }

    const destinos = [...dentro];

    if (fuera.length > 0) {
      const carpeta = parentPath(path);
      if (carpeta) {
        try {
          const items = await importFilesIntoVault(fuera, carpeta);
          for (const item of items) if (item.path) destinos.push(item.path);
        } catch {
          // Sin vault o sin permisos: no se enlaza nada de lo que venía de fuera.
        }
      }
    }

    if (destinos.length === 0) return { inserted: 0, failed: sources.length };

    const enlaces = destinos.map((destino) =>
      imageMarkdown(imageAlt(destino), imageDest(path, destino)),
    );
    // Cada imagen en su línea: sueltas tres y las tres quedan repartidas.
    const texto = enlaces.join("\n");
    replaceRange(from, texto, texto.length);

    return { inserted: destinos.length, failed: sources.length - destinos.length };
  }

  /**
   * Inserta imágenes en el punto `at` (ya en px de documento) o, sin punto, en
   * el cursor. La selección se colapsa antes: si no, lo que se suelta encima
   * de un texto marcado se comería ese texto.
   */
  async function insertImagesDropped(
    sources: string[],
    at: number | null,
  ): Promise<ImageInsertResult> {
    const area = textareaRef.current;
    if (!area) {
      // Vista previa: no hay campo de texto, así que la imagen entra al final.
      return insertImageFiles(sources, stripFrontmatter(content).length);
    }

    const from = at ?? area.selectionStart;
    area.setSelectionRange(from, from);
    return insertImageFiles(sources, from);
  }

  /**
   * Lo que llama App cuando sueltas archivos encima del editor: `point` llega
   * en píxeles físicos, como los da Tauri.
   */
  async function insertImagesAt(
    sources: string[],
    point?: { x: number; y: number },
  ): Promise<ImageInsertResult> {
    const dpr = window.devicePixelRatio || 1;
    const at = point ? caretAtPoint(point.x / dpr, point.y / dpr) : null;
    return insertImagesDropped(sources, at);
  }

  /**
   * Imagen del equipo: se elige en el diálogo del sistema, se copia junto a la
   * nota y se enlaza empezando en `from` (la barra del «/» o el cursor).
   */
  async function insertImagesFromComputer(from: number): Promise<ImageInsertResult> {
    if (!vaultPath) return { inserted: 0, failed: 0 };

    let picked: string | string[] | null = null;
    try {
      picked = await open({ multiple: true, filters: imageFilters() });
    } catch {
      return { inserted: 0, failed: 0 };
    }
    // Cancelar el diálogo no es un error: simplemente no se inserta nada.
    if (!picked) return { inserted: 0, failed: 0 };

    const sources = Array.isArray(picked) ? picked : [picked];
    return insertImageFiles(sources, from);
  }

  /** Imagen elegida en el selector del vault: se enlaza relativa a la nota. */
  function insertVaultImage(image: VaultImage) {
    const area = textareaRef.current;
    const start =
      menu?.kind === "images" ? menu.start : (area?.selectionStart ?? stripFrontmatter(content).length);
    const texto = imageMarkdown(imageAlt(image.name), imageDest(path, image.path));
    replaceRange(start, texto, texto.length);
  }

  /** Entrada del explorador que se arrastra, si es que lo es. */
  function readExplorerEntry(dataTransfer: DataTransfer): DragEntry | null {
    try {
      const raw = dataTransfer.getData(DRAG_ENTRY_MIME);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "kind" in parsed &&
        "path" in parsed &&
        (parsed.kind === "file" || parsed.kind === "folder") &&
        typeof parsed.path === "string"
      ) {
        return { kind: parsed.kind, path: parsed.path };
      }
    } catch {
      // Ni JSON del explorador ni nada que interpretar.
    }
    return null;
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

  useEffect(() => {
    contextMenuOpenRef.current = contextMenu !== null;
  }, [contextMenu]);

  function openEditorMenu(clientX: number, clientY: number) {
    const area = textareaRef.current;
    if (!area) return;
    contextMenuOpenRef.current = true;
    traza("abre-menu", {
      picked: rightClickSelRef.current,
      rectEstado: tableRect,
      rectEspejo: markedRectRef.current,
      seleccionActual: area ? [area.selectionStart, area.selectionEnd] : null,
    });

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

    traza("info-menu", { rect: marked, line, col: resolved.col });

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
   * Rango que borraría Supr/Backspace. Con Ctrl/Meta se aproxima al borrado
   * de palabra, que nunca cruza el salto de línea.
   */
  function deletionRangeFor(
    area: HTMLTextAreaElement,
    backspace: boolean,
    mod: boolean,
  ): [number, number] {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    if (end > start) return [start, end];

    const value = area.value;
    if (backspace) {
      if (start === 0) return [0, 0];
      if (!mod) return [start - 1, start];
      let at = start;
      while (at > 0 && /\s/.test(value[at - 1]) && value[at - 1] !== "\n") at -= 1;
      while (at > 0 && !/\s/.test(value[at - 1])) at -= 1;
      return [at, start];
    }

    if (start >= value.length) return [start, start];
    if (!mod) return [start, start + 1];
    let at = start;
    while (at < value.length && !/\s/.test(value[at])) at += 1;
    return [start, at];
  }

  /**
   * Posición de cursor segura tras un borrado protegido: si cae justo antes de
   * la «|» de una fila (o dentro del separador), se mete dentro de la primera
   * celda para que el siguiente texto no rompa la fila.
   */
  function safeTableCaret(text: string, offset: number): number {
    const rowLines = text.split("\n").map((row) => ({ text: row, code: false }));
    const line = lineIndexOf(text, offset);
    const block = tableBlockAt(rowLines, line);
    if (!block) return offset;
    if (line !== block.start + 1 && offset > lineStartOffset(rowLines, line)) return offset;

    const target = line === block.start + 1 ? block.start : line;
    const range = tableCellRange(rowLines, target, 0);
    return range ? range.start : offset;
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
    const [start, end] = deletionRangeFor(area, backspace, event.metaKey || event.ctrlKey);
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
    if (!edit) {
      traza("edicion-descartada", {});
      return;
    }

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

    traza("aplica-edicion", { vacia: edit.lines.length === 0 });
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

  const statusLabel =
    saveState === "dirty"
      ? t("editor.saving")
      : saveState === "saved"
        ? t("editor.saved")
        : saveState === "error"
          ? t("editor.saveFailed")
          : t("editor.noChanges");

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

  // Primera línea de cada bloque de código: es la clave del botón «copiar»
  // que pinta el overlay, y por ella se sabe qué contenido llevarse.
  const codeBlockMap = useMemo(() => {
    const map = new Map<number, CodeBlockInfo>();
    for (const block of codeBlocks(sourceInfo)) map.set(block.start, block);
    return map;
  }, [sourceInfo]);

  /** ¿Son las dos listas de anchuras la misma? */
  function sameWidths(a: number[] | undefined, b: number[]): boolean {
    if (!a || a.length !== b.length) return false;
    return a.every((width, index) => width === b[index]);
  }

  /**
   * Entra en caja una lista de anchuras en el ancho de la fila. Si se pasan, se
   * encogen **en la misma proporción** (no solo la más ancha): así, al estrechar
   * la ventana todas las columnas ceden un poco y la tabla sigue leyéndose, en
   * vez de aplastar unas contra el mínimo y dejar otras enormes. Ninguna baja del
   * mínimo y, si con eso todavía no cabe, se sale (mandará el resto del texto).
   */
  function clampColumnWidths(widths: number[], limit: number): number[] {
    if (widths.length === 0) return widths;
    let next = [...widths];
    for (let round = 0; round < 24; round += 1) {
      const total = next.reduce((sum, width) => sum + width, 0);
      if (total <= limit) return next;
      const ratio = limit / total;
      let moved = false;
      next = next.map((width) => {
        const scaled = Math.max(MIN_COL_WIDTH, Math.round(width * ratio));
        if (scaled !== width) moved = true;
        return scaled;
      });
      // El redondeo puede dejar el total un par de píxeles por encima (si son
      // muchas columnas, uno por columna): se corrige de la más ancha.
      let sum = next.reduce((acc, width) => acc + width, 0);
      while (sum > limit) {
        let widest = 0;
        for (let i = 1; i < next.length; i += 1) if (next[i] > next[widest]) widest = i;
        if (next[widest] <= MIN_COL_WIDTH) break;
        next[widest] -= 1;
        sum -= 1;
        moved = true;
      }
      // Todas están ya en el mínimo: no queda nada que ceder.
      if (!moved) break;
    }
    return next;
  }

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

  // Alto que gana cada tabla al envolver sus celdas: a partir de su última fila
  // el overlay queda más abajo que el textarea, así que se mide para poder
  // compensarlo (scroll, clic y cursor).
  //
  // Esta medición depende de que el efecto anterior ya haya pintado los anchos
  // y de que R haya fijado la altura de fila: la cadena de efectos es el
  // propósito (medir el resultado de lo anterior), no un accidente de renders.
  // eslint-disable-next-line react-doctor/no-effect-chain
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !inlineActive || tableCols === null) {
      setTableDrift(EMPTY_DRIFT);
      return;
    }
    const next = new Map<number, TableDrift>();
    for (const segment of sourceSegments(sourceInfo, false, tableCols)) {
      if (segment.kind !== "table") continue;
      const element = overlay.querySelector<HTMLElement>(`[data-table-block="${segment.start}"]`);
      if (!element) continue;
      const extra = element.offsetHeight - (segment.end - segment.start + 1) * rowPitch;
      // offsetHeight viene entero: se ignoran los restos de subpíxel.
      if (extra > 1) next.set(segment.start, { end: segment.end, extra });
    }
    setTableDrift((prev) => (sameDrift(prev, next) ? prev : next));
  }, [sourceInfo, inlineActive, tableCols, rowPitch, tableWidths]);

  // Con una tabla crecida por encima, el overlay ya no coincide con el textarea:
  // el cursor y la selección los dibuja el overlay (el textarea los pone
  // transparentes) para que no queden descolocados.
  // Con la selección marcándose desde el overlay, el caret y la selección
  // nativos se ocultan (clase «gus-mark-edit»): pasa cuando el cursor está en
  // una tabla, cuando la selección abarca una (la tarjeta manda sobre el texto
  // crudo) y cuando una tabla de arriba ha crecido y lo dejaría descolocado.
  const overlayMark =
    !composing &&
    (tableCaret !== null || tableSelection !== null || driftBeforeLine(caretLine) > 0);

  /** Píxeles que las tablas ya superadas dejan más abajo en el overlay. */
  function driftBeforeLine(line: number): number {
    let extra = 0;
    for (const drift of tableDriftRef.current.values()) {
      if (drift.end < line) extra += drift.extra;
    }
    return extra;
  }

  /** Igual, pero medido sobre el overlay: sirve para compensar el scroll. */
  function driftBeforeScroll(scrollTop: number): number {
    const overlay = overlayRef.current;
    if (!overlay || tableDriftRef.current.size === 0) return 0;
    let extra = 0;
    for (const [block, drift] of tableDriftRef.current) {
      const element = overlay.querySelector<HTMLElement>(`[data-table-block="${block}"]`);
      if (element && element.offsetTop + element.offsetHeight <= scrollTop) extra += drift.extra;
    }
    return extra;
  }

  /**
   * Desplazamiento que las tablas crecidas añaden a un punto del ratón. El
   * textarea no lo sabe, así que se lo pasamos al cálculo geométrico del offset
   * (el nativo ya acierta por su cuenta).
   */
  function driftAtPointer(clientY: number): number {
    const area = textareaRef.current;
    if (!area || tableDriftRef.current.size === 0) return 0;
    const rect = area.getBoundingClientRect();
    const padTop = Number.parseFloat(getComputedStyle(area).paddingTop) || 0;
    const y = toLocalCoord(clientY) - toLocalCoord(rect.top) - padTop + area.scrollTop;
    return driftBeforeScroll(y);
  }

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
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);
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
                ? t("editor.wikiOpen", { name: wikiTarget })
                : t("editor.wikiCreate", { name: wikiTarget })
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
    img: (props) => (
      <PreviewImage
        src={props.src}
        alt={props.alt}
        notePath={path}
        vaultPath={vaultPath ?? null}
      />
    ),
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
            aria-label={t(checked ? "editor.taskPending" : "editor.taskDone")}
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
    pre: ({ children }) => {
      const block = readCodeBlock(children);

      // Mermaid: el diagrama ocupa el bloque y no tiene código que copiar.
      if (block.mermaid) {
        return <pre className={clsx(PRE_CLASS, "my-4")}>{children}</pre>;
      }

      // Envoltorio «group» para que el botón de copiar aparezca al pasar el
      // ratón, igual que en Obsidian (que lo oculta con :not(:hover)).
      return (
        <div className="group relative my-4">
          <pre className={PRE_CLASS}>{children}</pre>
          <CopyCodeButton text={block.text} />
        </div>
      );
    },
    code: ({ className, children }) => {
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <MermaidDiagram code={String(children).replace(/\n+$/, "")} />;
      }

      if (language) {
        // Resaltado con Prism, el motor que usa Obsidian en la vista de
        // lectura; si el lenguaje no tiene gramática, texto plano.
        const html = highlightCode(String(children), language);
        if (html !== null) {
          return (
            <code
              className={clsx("gus-code font-mono", className)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return <code className={clsx("font-mono", className)}>{children}</code>;
      }

      // Código en línea al estilo Obsidian: color de texto normal (el acento
      // queda para los enlaces), con el fondo del bloque.
      return (
        <code className="rounded bg-gus-card px-1 py-0.5 font-mono text-[0.9em] text-gus-text">
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border">
        <table className="w-full text-left text-sm">{applyPreviewMerges(children)}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gus-card text-[11px] tracking-wide text-gus-muted uppercase">
        {children}
      </thead>
    ),
    // `style` trae la alineación de la columna (remark-gfm) y colSpan/rowSpan
    // los suya applyPreviewMerges (celdas combinadas): sin propagarlos aquí
    // se quedaban en el props y no se pintaban.
    th: ({ children, colSpan, rowSpan, style }) => (
      <th colSpan={colSpan} rowSpan={rowSpan} style={style} className="border-b border-gus-border px-3 py-2 font-semibold text-gus-text">
        {children}
      </th>
    ),
    tr: ({ children }) => <tr className="odd:bg-gus-card/40">{children}</tr>,
    td: ({ children, colSpan, rowSpan, style }) => (
      <td colSpan={colSpan} rowSpan={rowSpan} style={style} className="border-b border-gus-border/60 px-3 py-2 align-top text-gus-text">
        {children}
      </td>
    ),
    input: () => null,
  };

  function previewPane() {
    return (
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={t("editor.previewPane")}
        className="gus-scrollbar min-h-0 flex-1 overflow-y-auto bg-gus-bg px-6 py-5 focus:outline-none"
      >
        {body.trim() === "" ? (
          <p className="text-sm text-gus-muted">{t("editor.emptyNoteHint")}</p>
        ) : (
          <article className="mx-auto max-w-3xl pb-10">
            <Suspense fallback={<p className="text-sm text-gus-muted">{t("editor.previewLoading")}</p>}>
              <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
            </Suspense>
          </article>
        )}
      </div>
    );
  }

  return (
    <div data-tour="editor" className={clsx("flex h-full min-h-0 flex-col bg-gus-bg", className)}>
      <header className="shrink-0 border-b border-gus-border px-6 py-4">
        <div className="flex items-start gap-3">
          <input
            value={title}
            onChange={(event) => editTitle(event.target.value)}
            placeholder={t("common.untitled")}
            aria-label={t("editor.title")}
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-gus-text outline-none placeholder:text-gus-muted"
          />

          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setViewMode(viewMode === "edit" ? "preview" : "edit");
            }}
            aria-label={t(viewMode === "edit" ? "editor.previewAria" : "editor.editAria")}
            title={t(viewMode === "edit" ? "editor.preview" : "editor.edit")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-3 py-1.5 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
          >
            {viewMode === "edit" ? (
              <>
                <Eye className="h-4 w-4" aria-hidden="true" />
                {t("editor.preview")}
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {t("editor.edit")}
              </>
            )}
          </button>

          <div ref={headerMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setHeaderMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={headerMenu}
              aria-label={t("editor.moreOptionsAria")}
              title={t("editor.moreOptions")}
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
                  {t("editor.exportPdf")}
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
                aria-label={t("tasks.removeTag", { tag })}
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
              placeholder={t(noteTags.length > 0 ? "editor.tagPlaceholder" : "editor.tagPlaceholderLong")}
              aria-label={t("editor.tags")}
              role="combobox"
              aria-expanded={tagMenuOpen}
              aria-controls="gus-tag-menu"
              className="w-full rounded-full border border-transparent bg-gus-card/60 px-2.5 py-0.5 text-[11px] text-gus-text outline-none transition-colors placeholder:text-gus-muted/70 focus:border-gus-accent/50"
            />

            {tagMenuOpen && (
              <div
                id="gus-tag-menu"
                role="listbox"
                aria-label={t("editor.vaultTags")}
                className="absolute left-0 top-full z-30 mt-1 max-h-56 w-64 min-w-full overflow-y-auto rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
              >
                {tagOptionList.length === 0 ? (
                  <p className="px-3 py-1.5 text-[11px] text-gus-muted">
                    {t(tagInput ? "editor.tagCreateHint" : "editor.noVaultTags", {
                      tag: tagInput,
                    })}
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
                        {t("editor.tagUseCount", { count: entry.count })}
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
            {t("editor.words", { count: words })} · {t("editor.chars", { count: body.length })}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-gus-muted/70">{t("editor.saveHint", { combo: saveCombo })}</span>
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
              caretAt={overlayMark ? (caretMark?.at ?? null) : null}
              caretSel={overlayMark ? (caretMark?.sel ?? null) : null}
              copiedLine={copyDone}
              hoverLine={copyHover}
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
              );
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
              fontSize || overlayMark
                ? {
                    ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
                    ...(overlayMark ? { caretColor: "transparent" } : {}),
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
              "gus-scrollbar relative h-full w-full resize-none whitespace-break-spaces px-10 py-4 font-mono text-sm leading-[23px] text-gus-text outline-none placeholder:text-gus-muted focus:outline-none",
              inlineActive && "gus-source-area",
              tableCaret && !composing && "gus-cell-edit",
              overlayMark && "gus-mark-edit",
              copyHover !== null && "cursor-pointer",
              // El puntero cae en el textarea (el overlay no recibe eventos),
              // así que el cursor de redimensionado lo pone el propio campo
              // mientras hay un borde de columna justo debajo.
              hoverResize !== null && "cursor-col-resize",
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
