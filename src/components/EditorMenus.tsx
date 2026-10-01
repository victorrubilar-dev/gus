import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { toLocalCoord } from "../lib/uiZoom";
import { motion } from "framer-motion";
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
  Trash,
  SplitSquareHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { CaretAnchor } from "../lib/caretPosition";
import { normalizeWikiText, wikiNoteBaseTitle, wikiNoteFolder, type WikiNote } from "../lib/wikiLink";

/** Acciones sobre la tabla del cursor: las del menú contextual y las del «/». */
export type TableAction =
  | "add-row"
  | "add-col"
  | "del-row"
  | "del-col"
  | "del-table"
  | "merge"
  | "unmerge"
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
  | "toggle-task";

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  snippet: string;
  caretOffset: number;
  Icon: LucideIcon;
  /** Acción de tabla: no inserta texto, opera sobre la tabla del cursor. */
  tableAction?: TableAction;
  /** Al elegirlo el menú cambia a este grupo en vez de insertar. */
  stage?: "table-size";
  /** Tamaño (columnas × filas) del grupo de tamaños de tabla. */
  size?: { cols: number; rows: number };
  /** Convierte el texto seleccionado en tabla (no inserta un bloque). */
  convertSelection?: boolean;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "h1",
    label: "Título 1",
    hint: "# Título",
    snippet: "# ",
    caretOffset: "# ".length,
    Icon: Heading1,
  },
  {
    id: "h2",
    label: "Título 2",
    hint: "## Título",
    snippet: "## ",
    caretOffset: "## ".length,
    Icon: Heading2,
  },
  {
    id: "h3",
    label: "Título 3",
    hint: "### Título",
    snippet: "### ",
    caretOffset: "### ".length,
    Icon: Heading3,
  },
  {
    id: "ul",
    label: "Lista con viñetas",
    hint: "- Ítem",
    snippet: "- ",
    caretOffset: "- ".length,
    Icon: List,
  },
  {
    id: "ol",
    label: "Lista numerada",
    hint: "1. Ítem",
    snippet: "1. ",
    caretOffset: "1. ".length,
    Icon: ListOrdered,
  },
  {
    id: "task",
    label: "Lista de tareas",
    hint: "- [ ]",
    snippet: "- [ ] ",
    caretOffset: "- [ ] ".length,
    Icon: ListChecks,
  },
  {
    id: "quote",
    label: "Cita",
    hint: "> Cita",
    snippet: "> ",
    caretOffset: "> ".length,
    Icon: Quote,
  },
  {
    id: "code",
    label: "Bloque de código",
    hint: "```…```",
    snippet: "```md\n\n```",
    caretOffset: "```md\n".length,
    Icon: Code,
  },
  {
    id: "table",
    label: "Tabla",
    hint: "elige el tamaño",
    // Al elegirlo el menú pasa al grupo de tamaños (columnas × filas) en vez de
    // insertar: así la tabla nace con las medidas que quieres.
    snippet: "| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |",
    caretOffset: "| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |".length,
    Icon: Table,
    stage: "table-size",
  },
  {
    id: "table-from-text",
    label: "Tabla desde el texto",
    hint: "convierte lo seleccionado",
    snippet: "",
    caretOffset: 0,
    Icon: Table,
    convertSelection: true,
  },
  {
    id: "hr",
    label: "Separador",
    hint: "---",
    snippet: "\n---\n",
    caretOffset: "\n---\n".length,
    Icon: Minus,
  },
  {
    id: "image",
    label: "Imagen",
    hint: "![alt](ruta)",
    snippet: "![descripción](ruta/imagen.png)",
    caretOffset: "![descripción](ruta/imagen.png)".length,
    Icon: ImageIcon,
  },
  {
    id: "math",
    label: "Fórmula (KaTeX)",
    hint: "$x^2 + y^2 = z^2$",
    snippet: "$x^2 + y^2 = z^2$",
    caretOffset: "$x^2 + y^2 = z^2$".length,
    Icon: Sigma,
  },
  {
    id: "mathblock",
    label: "Bloque de fórmulas",
    hint: "$$…$$",
    snippet: "$$\n\n$$",
    caretOffset: "$$\n".length,
    Icon: Sigma,
  },
  {
    id: "mermaid",
    label: "Diagrama (Mermaid)",
    hint: "```mermaid",
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
  { id: "t-add-row", label: "Agregar fila", hint: "debajo", snippet: "", caretOffset: 0, Icon: Rows3, tableAction: "add-row" },
  { id: "t-add-col", label: "Agregar columna", hint: "a la derecha", snippet: "", caretOffset: 0, Icon: Columns3, tableAction: "add-col" },
  { id: "t-del-row", label: "Eliminar fila", hint: "la del cursor", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-row" },
  { id: "t-del-col", label: "Eliminar columna", hint: "la del cursor", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-col" },
  { id: "t-del-table", label: "Eliminar tabla", hint: "solo aquí se quita", snippet: "", caretOffset: 0, Icon: Trash, tableAction: "del-table" },
  { id: "t-merge", label: "Combinar celdas", hint: "las marcadas", snippet: "", caretOffset: 0, Icon: TableCellsMerge, tableAction: "merge" },
  { id: "t-unmerge", label: "Descombinar celdas", hint: "vuelve a separarlas", snippet: "", caretOffset: 0, Icon: SplitSquareHorizontal, tableAction: "unmerge" },
  { id: "t-toggle-task", label: "Marcar / desmarcar", hint: "casilla de tarea", snippet: "", caretOffset: 0, Icon: CheckSquare2, tableAction: "toggle-task" },
  { id: "t-sort-asc", label: "Ordenar A→Z", hint: "por esta columna", snippet: "", caretOffset: 0, Icon: ArrowDownUp, tableAction: "sort-asc" },
  { id: "t-sort-desc", label: "Ordenar Z→A", hint: "por esta columna", snippet: "", caretOffset: 0, Icon: ArrowUpDown, tableAction: "sort-desc" },
  { id: "t-align-left", label: "Alinear a la izquierda", hint: "columna", snippet: "", caretOffset: 0, Icon: AlignLeft, tableAction: "align-left" },
  { id: "t-align-center", label: "Centrar columna", hint: "columna", snippet: "", caretOffset: 0, Icon: AlignCenter, tableAction: "align-center" },
  { id: "t-align-right", label: "Alinear a la derecha", hint: "columna", snippet: "", caretOffset: 0, Icon: AlignRight, tableAction: "align-right" },
  { id: "t-move-up", label: "Subir fila", hint: "Alt+↑", snippet: "", caretOffset: 0, Icon: ArrowUp, tableAction: "move-up" },
  { id: "t-move-down", label: "Bajar fila", hint: "Alt+↓", snippet: "", caretOffset: 0, Icon: ArrowDown, tableAction: "move-down" },
  { id: "t-dup-up", label: "Duplicar fila arriba", hint: "Mayús+Alt+↑", snippet: "", caretOffset: 0, Icon: Copy, tableAction: "dup-up" },
  { id: "t-dup-down", label: "Duplicar fila abajo", hint: "Mayús+Alt+↓", snippet: "", caretOffset: 0, Icon: Copy, tableAction: "dup-down" },
  { id: "t-clipboard", label: "Copiar celdas", hint: "al portapapeles", snippet: "", caretOffset: 0, Icon: ClipboardCopy, tableAction: "clipboard" },
];

/** Tamaños del grupo al que lleva «Tabla»: columnas × filas. */
export const TABLE_SIZE_ITEMS: SlashItem[] = [
  { id: "s-2x2", label: "2 × 2", hint: "pequeña", snippet: "", caretOffset: 0, Icon: Table, size: { cols: 2, rows: 2 } },
  { id: "s-3x3", label: "3 × 3", hint: "la de siempre", snippet: "", caretOffset: 0, Icon: Table, size: { cols: 3, rows: 3 } },
  { id: "s-4x3", label: "4 × 3", hint: "ancha", snippet: "", caretOffset: 0, Icon: Table, size: { cols: 4, rows: 3 } },
  { id: "s-3x5", label: "3 × 5", hint: "alta", snippet: "", caretOffset: 0, Icon: Table, size: { cols: 3, rows: 5 } },
  { id: "s-5x5", label: "5 × 5", hint: "grande", snippet: "", caretOffset: 0, Icon: Table, size: { cols: 5, rows: 5 } },
];

/**
 * Elementos del menú «/». Dentro de una tabla solo van las acciones de la
 * propia tabla; fuera, los bloques de siempre más el grupo de tamaños.
 */
export function filterSlashItems(
  query: string,
  insideTable = false,
  stage: "root" | "table-size" = "root",
): SlashItem[] {
  const pool = stage === "table-size" ? TABLE_SIZE_ITEMS : insideTable ? TABLE_SLASH_ITEMS : SLASH_ITEMS;
  const wanted = normalizeWikiText(query);
  if (!wanted) return pool;

  return pool.filter(
    (item) =>
      normalizeWikiText(item.label).includes(wanted) ||
      normalizeWikiText(item.hint).includes(wanted),
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
    <motion.div
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
    </motion.div>
  );
}

function MenuHints() {
  return (
    <p className="mt-1 border-t border-gus-border px-3 pt-1.5 pb-1 text-[10px] text-gus-muted/70">
      ↑↓ mover · Intro elegir · Esc cerrar
    </p>
  );
}

export interface SpellSuggestMenuProps {
  anchor: CaretAnchor;
  suggestions: string[];
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
}: SpellSuggestMenuProps) {
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
    <motion.div
      ref={boxRef}
      role="listbox"
      aria-label="Correcciones sugeridas"
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
        {index >= 0
          ? "↑↓ elegir · Intro o 1-9 aplicar · Esc cerrar"
          : "Alt+Intro aplicar · ↑↓ para elegir · Esc cerrar"}
      </p>
    </motion.div>
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
  const active = notes.length > 0 ? Math.min(index, notes.length - 1) : -1;

  return (
    <MenuShell anchor={anchor} label="Notas para enlazar" activeIndex={active}>
      {loading && notes.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">Buscando notas del vault…</p>
      )}

      {!loading && notes.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">
          Ninguna nota coincide con «{query}». Pulsa Intro para escribir el
          enlace a mano.
        </p>
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
  const active = items.length > 0 ? Math.min(index, items.length - 1) : -1;
  const title = label ?? (insideTable ? "Acciones de la tabla" : "Bloques para insertar");

  return (
    <MenuShell anchor={anchor} label={title} activeIndex={active}>
      {items.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">
          {insideTable ? "Ninguna acción coincide." : "Ningún bloque coincide."}
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
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="max-w-32 shrink-0 truncate font-mono text-[10px] text-gus-muted/70">
              {item.hint}
            </span>
          </button>
        );
      })}

      <MenuHints />
    </MenuShell>
  );
}
