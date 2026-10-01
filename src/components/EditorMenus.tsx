import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { toLocalCoord } from "../lib/uiZoom";
import { m } from "framer-motion";
import {
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  Table,
  Workflow,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpDown,
  CheckSquare2,
  ClipboardCopy,
  Columns3,
  Copy,
  Rows3,
  TableCellsMerge,
  TableCellsSplit,
  Trash,
  type LucideIcon,
} from "lucide-react";
import type { CaretAnchor } from "../lib/caretPosition";
import { normalizeWikiText, wikiNoteBaseTitle, wikiNoteFolder, type WikiNote } from "../lib/wikiLink";
import { t as activeT, useT } from "../lib/i18n";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";

/** Acciones sobre la tabla del cursor: las del menú contextual y las del «/». */
export type TableAction =
  | "add-row"
  | "add-col"
  | "del-row"
  | "del-col"
  | "del-table"
  | "sort-asc"
  | "sort-desc"
  | "clipboard"
  | "align-left"
  | "align-center"
  | "align-right"
  | "move-up"
  | "move-down"
  | "dup-up"
  | "dup-down"
  | "toggle-task"
  | "merge-cells"
  | "unmerge-cells";

export interface SlashItem {
  id: string;
  /** Texto del menú y pista lateral, con su clave de traducción. */
  labelKey: MessageKey;
  hintKey: MessageKey;
  snippet: string;
  caretOffset: number;
  Icon: LucideIcon;
  /** Acción de tabla: no inserta texto, opera sobre la tabla del cursor. */
  tableAction?: TableAction;
  /** Tamaño (columnas × filas) con el que entra la tabla al elegirlo. */
  size?: { cols: number; rows: number };
  /** Convierte el texto seleccionado en tabla (no inserta un bloque). */
  convertSelection?: boolean;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "h1",
    labelKey: "menu.h1",
    hintKey: "menu.hint.h1",
    snippet: "# ",
    caretOffset: "# ".length,
    Icon: Heading1,
  },
  {
    id: "h2",
    labelKey: "menu.h2",
    hintKey: "menu.hint.h2",
    snippet: "## ",
    caretOffset: "## ".length,
    Icon: Heading2,
  },
  {
    id: "h3",
    labelKey: "menu.h3",
    hintKey: "menu.hint.h3",
    snippet: "### ",
    caretOffset: "### ".length,
    Icon: Heading3,
  },
  {
    id: "ul",
    labelKey: "menu.bulletList",
    hintKey: "menu.hint.ul",
    snippet: "- ",
    caretOffset: "- ".length,
    Icon: List,
  },
  {
    id: "ol",
    labelKey: "menu.numberedList",
    hintKey: "menu.hint.ol",
    snippet: "1. ",
    caretOffset: "1. ".length,
    Icon: ListOrdered,
  },
  {
    id: "task",
    labelKey: "menu.taskList",
    hintKey: "menu.hint.task",
    snippet: "- [ ] ",
    caretOffset: "- [ ] ".length,
    Icon: ListChecks,
  },
  {
    id: "quote",
    labelKey: "menu.quote",
    hintKey: "menu.hint.quote",
    snippet: "> ",
    caretOffset: "> ".length,
    Icon: Quote,
  },
  {
    id: "code",
    labelKey: "menu.code",
    hintKey: "menu.hint.code",
    snippet: "```md\n\n```",
    caretOffset: "```md\n".length,
    Icon: Code,
  },
  {
    // La tabla entra directa, de 3×5: el grupo de tamaños con dos pasos se
    // quitó porque al elegirlo no siempre caía en la casilla correcta.
    id: "table",
    labelKey: "menu.table",
    hintKey: "menu.hint.table",
    snippet: "",
    caretOffset: 0,
    Icon: Table,
    size: { cols: 3, rows: 5 },
  },
  {
    id: "table-from-text",
    labelKey: "table.fromSelection",
    hintKey: "menu.hint.tableFromText",
    snippet: "",
    caretOffset: 0,
    Icon: Table,
    convertSelection: true,
  },
  {
    id: "hr",
    labelKey: "menu.hr",
    hintKey: "menu.hint.hr",
    snippet: "\n---\n",
    caretOffset: "\n---\n".length,
    Icon: Minus,
  },
  {
    id: "image",
    labelKey: "menu.image",
    hintKey: "menu.hint.image",
    snippet: "![descripción](ruta/imagen.png)",
    caretOffset: "![descripción](ruta/imagen.png)".length,
    Icon: ImageIcon,
  },
  {
    id: "math",
    labelKey: "menu.math",
    hintKey: "menu.hint.math",
    snippet: "$x^2 + y^2 = z^2$",
    caretOffset: "$x^2 + y^2 = z^2$".length,
    Icon: Sigma,
  },
  {
    id: "mathblock",
    labelKey: "menu.mathblock",
    hintKey: "menu.hint.mathblock",
    snippet: "$$\n\n$$",
    caretOffset: "$$\n".length,
    Icon: Sigma,
  },
  {
    id: "mermaid",
    labelKey: "menu.mermaid",
    hintKey: "menu.hint.mermaid",
    snippet: "```mermaid\nflowchart LR\n  A --> B\n```",
    caretOffset: "```mermaid\nflowchart LR".length,
    Icon: Workflow,
  },
];

/**
 * Acciones de tabla del menú «/». Solo se ofrecen con el cursor dentro de una
 * tabla: allí los bloques (listas, código, otra tabla…) no caben y se
 * rechazarían, así que el menú se vuelve de la propia tabla.
 */
export const TABLE_SLASH_ITEMS: SlashItem[] = [
  { id: "t-add-row", labelKey: "table.addRow", hintKey: "menu.hint.below", snippet: "", caretOffset: 0, Icon: Rows3, tableAction: "add-row" },
  { id: "t-add-col", labelKey: "table.addColumn", hintKey: "menu.hint.right", snippet: "", caretOffset: 0, Icon: Columns3, tableAction: "add-col" },
  { id: "t-del-row", labelKey: "table.deleteRow", hintKey: "menu.hint.cursorRow", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-row" },
  { id: "t-del-col", labelKey: "table.deleteColumn", hintKey: "menu.hint.cursorColumn", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-col" },
  { id: "t-del-table", labelKey: "table.deleteTable", hintKey: "menu.hint.onlyHere", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-table" },
  { id: "t-toggle-task", labelKey: "table.toggleTask", hintKey: "menu.hint.taskBox", snippet: "", caretOffset: 0, Icon: CheckSquare2, tableAction: "toggle-task" },
  { id: "t-sort-asc", labelKey: "table.sortAsc", hintKey: "menu.hint.thisColumn", snippet: "", caretOffset: 0, Icon: ArrowDownUp, tableAction: "sort-asc" },
  { id: "t-sort-desc", labelKey: "table.sortDesc", hintKey: "menu.hint.thisColumn", snippet: "", caretOffset: 0, Icon: ArrowUpDown, tableAction: "sort-desc" },
  { id: "t-align-left", labelKey: "table.alignLeft", hintKey: "menu.hint.column", snippet: "", caretOffset: 0, Icon: AlignLeft, tableAction: "align-left" },
  { id: "t-align-center", labelKey: "table.alignCenter", hintKey: "menu.hint.column", snippet: "", caretOffset: 0, Icon: AlignCenter, tableAction: "align-center" },
  { id: "t-align-right", labelKey: "table.alignRight", hintKey: "menu.hint.column", snippet: "", caretOffset: 0, Icon: AlignRight, tableAction: "align-right" },
  { id: "t-move-up", labelKey: "table.moveRowUp", hintKey: "menu.hint.shortcutUp", snippet: "", caretOffset: 0, Icon: ArrowUp, tableAction: "move-up" },
  { id: "t-move-down", labelKey: "table.moveRowDown", hintKey: "menu.hint.shortcutDown", snippet: "", caretOffset: 0, Icon: ArrowDown, tableAction: "move-down" },
  { id: "t-dup-up", labelKey: "table.duplicateRowUp", hintKey: "menu.hint.duplicateUp", snippet: "", caretOffset: 0, Icon: Copy, tableAction: "dup-up" },
  { id: "t-dup-down", labelKey: "table.duplicateRowDown", hintKey: "menu.hint.duplicateDown", snippet: "", caretOffset: 0, Icon: Copy, tableAction: "dup-down" },
  { id: "t-merge-cells", labelKey: "table.mergeCells", hintKey: "menu.hint.mergeCells", snippet: "", caretOffset: 0, Icon: TableCellsMerge, tableAction: "merge-cells" },
  { id: "t-unmerge-cells", labelKey: "table.unmergeCells", hintKey: "menu.hint.unmergeCells", snippet: "", caretOffset: 0, Icon: TableCellsSplit, tableAction: "unmerge-cells" },
  { id: "t-clipboard", labelKey: "table.copyCells", hintKey: "menu.hint.clipboard", snippet: "", caretOffset: 0, Icon: ClipboardCopy, tableAction: "clipboard" },
];

/** Traductor que lee el idioma activo: lo usan funciones que no son componentes. */
function getTranslator() {
  return activeT;
}

type Translator = (key: MessageKey, params?: TranslateParams) => string;

/** Etiqueta de un elemento del menú. */
export function itemLabel(t: Translator, item: SlashItem): string {
  return t(item.labelKey);
}

/**
 * Elementos del menú «/». Dentro de una tabla solo van las acciones de la
 * propia tabla; fuera, los bloques de siempre —la tabla ya entra directa, sin
 * pantalla de tamaños—.
 */
export function filterSlashItems(query: string, insideTable = false): SlashItem[] {
  const t = getTranslator();
  const pool = insideTable ? TABLE_SLASH_ITEMS : SLASH_ITEMS;
  const wanted = normalizeWikiText(query);
  if (!wanted) return pool;

  return pool.filter(
    (item) =>
      normalizeWikiText(t(item.labelKey)).includes(wanted) ||
      normalizeWikiText(t(item.hintKey)).includes(wanted),
  );
}

const MENU_MAX_HEIGHT = 256;
const MENU_WIDTH = 320;

function MenuShell({
  anchor,
  label,
  activeIndex,
  children,
}: {
  label: string;
  anchor: CaretAnchor;
  activeIndex?: number;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Navegar con ↑↓ mantiene visible la opción activa dentro del cuadro
  // (si no, sale del área recortada y solo se ve con la rueda del ratón).
  useEffect(() => {
    if (activeIndex === undefined || activeIndex < 0) return;
    scrollRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, children]);

  const viewWidth = toLocalCoord(window.innerWidth);
  const viewHeight = toLocalCoord(window.innerHeight);
  const flip = anchor.top + MENU_MAX_HEIGHT + 12 > viewHeight;
  const top = flip
    ? Math.max(8, anchor.top - MENU_MAX_HEIGHT)
    : anchor.top + anchor.height + 6;
  const left = Math.min(
    Math.max(8, anchor.left),
    Math.max(8, viewWidth - MENU_WIDTH - 8),
  );

  return (
    <m.div
      ref={scrollRef}
      role="listbox"
      aria-label={label}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ position: "fixed", top, left, width: MENU_WIDTH }}
      className="gus-scrollbar z-50 max-h-64 overflow-y-auto rounded-xl border border-gus-border bg-gus-panel/95 py-1 shadow-2xl shadow-black/50 backdrop-blur"
    >
      {children}
    </m.div>
  );
}

/**
 * Pista del pie del menú: a la izquierda, cómo se maneja; a la derecha, el
 * atajo corto de la tabla, escrito tal cual se teclea.
 */
function MenuHints({ corner }: { corner?: string }) {
  const t = useT();
  return (
    <p className="mt-1 flex items-center gap-2 border-t border-gus-border px-3 pt-1.5 pb-1 text-[10px] text-gus-muted/70">
      <span className="min-w-0 flex-1 truncate">{t("menu.hints")}</span>
      {corner && (
        <span className="shrink-0 font-mono text-gus-muted" aria-hidden="true">
          {corner}
        </span>
      )}
    </p>
  );
}

export interface SpellSuggestMenuProps {
  anchor: CaretAnchor;
  suggestions: string[];
  /** Combinación que aplica la corrección, tal y como se haya configurado. */
  applyCombo?: string;
  /** Índice recorrido con ↑/↓; -1 mientras nadie ha tocado la lista. */
  index: number;
  onPick: (suggestion: string) => void;
}

/**
 * Cuadro de correcciones que se despliega justo encima de la palabra mal
 * escrita (estilo Google Docs): solo sugerencias, sin acciones. Se mide al
 * montar para anclarse encima de la palabra; si no cabe arriba, cae debajo.
 */
export function SpellSuggestMenu({
  anchor,
  suggestions,
  index,
  onPick,
  applyCombo = "Alt+Enter",
}: SpellSuggestMenuProps) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const viewWidth = toLocalCoord(window.innerWidth);
    const viewHeight = toLocalCoord(window.innerHeight);
    const left = Math.min(
      Math.max(8, anchor.left),
      Math.max(8, viewWidth - box.offsetWidth - 8),
    );
    const above = anchor.top - box.offsetHeight - 6;
    const top =
      above >= 8
        ? above
        : Math.min(anchor.top + anchor.height + 6, Math.max(8, viewHeight - box.offsetHeight - 8));
    setPos((current) =>
      current && current.top === top && current.left === left ? current : { top, left },
    );
  }, [anchor, suggestions, index]);

  return (
    <m.div
      ref={boxRef}
      role="listbox"
      aria-label={t("menu.spellLabel")}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        position: "fixed",
        top: pos?.top ?? anchor.top,
        left: pos?.left ?? anchor.left,
        visibility: pos ? "visible" : "hidden",
      }}
      // Sin el mousedown el textarea pierde el foco al usar el ratón.
      onMouseDown={(event) => event.preventDefault()}
      className="z-50 w-max max-w-72 rounded-xl border border-gus-border bg-gus-panel/95 py-1 shadow-2xl shadow-black/50 backdrop-blur"
    >
      {suggestions.map((item, position) => (
        <button
          key={item}
          type="button"
          role="option"
          aria-selected={position === index}
          onClick={() => onPick(item)}
          className={clsx(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none transition-colors hover:bg-gus-accent/15 hover:text-gus-accent",
            position === index && "bg-gus-accent/15 font-medium text-gus-accent",
          )}
        >
          {item}
        </button>
      ))}

      <p className="mt-1 border-t border-gus-border px-3 pt-1.5 pb-1 text-[10px] text-gus-muted/70">
        {t(index >= 0 ? "menu.spellHintPicking" : "menu.spellHintIdle", { combo: applyCombo })}
      </p>
    </m.div>
  );
}

export interface WikiLinkMenuProps {
  anchor: CaretAnchor;
  notes: WikiNote[];
  loading: boolean;
  query: string;
  index: number;
  onPick: (note: WikiNote) => void;
  onHover: (index: number) => void;
}

export function WikiLinkMenu({
  anchor,
  notes,
  loading,
  query,
  index,
  onPick,
  onHover,
}: WikiLinkMenuProps) {
  const t = useT();
  const active = notes.length > 0 ? Math.min(index, notes.length - 1) : -1;

  return (
    <MenuShell anchor={anchor} label={t("menu.wikiLabel")} activeIndex={active}>
      {loading && notes.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">{t("menu.wikiSearching")}</p>
      )}

      {!loading && notes.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">{t("menu.wikiEmpty", { query })}</p>
      )}

      {notes.map((note, position) => {
        const isActive = position === active;

        return (
          <button
            key={note.path}
            type="button"
            role="option"
            aria-selected={isActive}
            onClick={() => onPick(note)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(position)}
            className={clsx(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors",
              isActive
                ? "bg-gus-accent/15 text-gus-text"
                : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
            )}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{wikiNoteBaseTitle(note)}</span>
            <span className="max-w-24 shrink-0 truncate rounded border border-gus-border px-1 py-0.5 text-[10px] text-gus-muted/70">
              {wikiNoteFolder(note)}
            </span>
          </button>
        );
      })}

      <MenuHints />
    </MenuShell>
  );
}

export interface SlashMenuProps {
  anchor: CaretAnchor;
  items: SlashItem[];
  index: number;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
  /** Título del grupo: cambia en el de tamaños de tabla. */
  label?: string;
  /** Con el cursor en una tabla el menú ofrece acciones, no bloques. */
  insideTable?: boolean;
}

export function SlashMenu({
  anchor,
  items,
  index,
  onPick,
  onHover,
  label,
  insideTable = false,
}: SlashMenuProps) {
  const t = useT();
  const active = items.length > 0 ? Math.min(index, items.length - 1) : -1;
  const title =
    label ?? t(insideTable ? "menu.tableActions" : "menu.blocks");

  return (
    <MenuShell anchor={anchor} label={title} activeIndex={active}>
      {items.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">
          {t(insideTable ? "menu.tableNoMatch" : "menu.blockNoMatch")}
        </p>
      )}

      {items.map((item, position) => {
        const isActive = position === active;
        const { Icon } = item;

        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isActive}
            onClick={() => onPick(item)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(position)}
            className={clsx(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none transition-colors",
              isActive
                ? "bg-gus-accent/15 text-gus-text"
                : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{itemLabel(t, item)}</span>
            <span className="max-w-32 shrink-0 truncate font-mono text-[10px] text-gus-muted/70">
              {t(item.hintKey)}
            </span>
          </button>
        );
      })}

      <MenuHints corner="/ta" />
    </MenuShell>
  );
}
