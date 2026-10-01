import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { toLocalCoord } from "../lib/uiZoom";
import type { TableCellRect } from "../lib/tableLayout";
import {
  Blocks,
  ArrowDownUp,
  ArrowUpDown,
  BookPlus,
  BookX,
  Bold,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Columns3,
  Copy,
  Eraser,
  EyeOff,
  Italic,
  Link,
  Minus,
  Pilcrow,
  Rows3,
  Scissors,
  SplitSquareHorizontal,
  SquareDashedMousePointer,
  Strikethrough,
  Table,
  TableCellsMerge,
  Trash,
  Type,
} from "lucide-react";
import clsx from "clsx";
import { SLASH_ITEMS, type SlashItem, type TableAction } from "./EditorMenus";

export type FormatKind = "bold" | "italic" | "strike" | "code" | "link";

/** Acciones sobre la tabla bajo el clic derecho. */
export type { TableAction };

/** Contexto de la tabla en la que se ha pulsado el clic derecho. */
export interface TableMenuInfo {
  block: { start: number; end: number };
  /** Fila sobre la que se pulsó (nunca la del separador). */
  line: number;
  /** Columna sobre la que se pulsó. */
  col: number;
  cols: number;
  /** Filas de cuerpo que abarca la selección (para combinar). */
  rows: number[];
  /** Rectángulo de celdas marcadas (para combinarlas en una, como en Excel). */
  rect: TableCellRect | null;
  canDeleteRow: boolean;
  canDeleteCol: boolean;
  /** Hay una combinación de celdas en pie (para deshacerla). */
  merged: boolean;
  /** Con dos filas o más de cuerpo, se puede ordenar. */
  canSort: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** La celda del cursor es una casilla de tarea («- [ ]»). */
  canToggleTask: boolean;
}

export interface ContextSpell {
  mode: "misspelled" | "personal";
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

export interface EditorContextMenuProps {
  x: number;
  y: number;
  spell: ContextSpell | null;
  hasSelection: boolean;
  /** Tabla bajo el clic derecho; null si el clic no cayó en una. */
  table: TableMenuInfo | null;
  onTableAction: (action: TableAction) => void;
  onPick: (suggestion: string) => void;
  onAdd: () => void;
  onIgnore: () => void;
  onRemove: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: (plain: boolean) => void;
  onSelectAll: () => void;
  onFormat: (kind: FormatKind) => void;
  onInsert: (item: SlashItem) => void;
  onClose: () => void;
  onReopen: (x: number, y: number) => void;
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gus-text outline-none hover:bg-gus-accent/15 hover:text-gus-accent focus-visible:bg-gus-accent/15";

const SUB_WIDTH = 232;
const SUB_ROW = 32;

const INSERT_IDS = new Set(["code", "table", "image", "math", "mathblock", "mermaid", "hr"]);
const TEXT_IDS = new Set(["h1", "h2", "h3", "ul", "ol", "task", "quote"]);

const INSERT_ITEMS = SLASH_ITEMS.filter((item) => INSERT_IDS.has(item.id));
const TEXT_ITEMS = SLASH_ITEMS.filter((item) => TEXT_IDS.has(item.id));

const FORMAT_ITEMS: { kind: FormatKind; label: string; Icon: typeof Bold }[] = [
  { kind: "bold", label: "Negrita", Icon: Bold },
  { kind: "italic", label: "Cursiva", Icon: Italic },
  { kind: "strike", label: "Tachado", Icon: Strikethrough },
  { kind: "code", label: "Código en línea", Icon: Code },
  { kind: "link", label: "Enlace", Icon: Link },
];

type Group = "insert" | "text" | "format";

/** Filas del submenú de tabla, en el orden en que las pide el usuario. */
const TABLE_ITEMS: {
  action: TableAction;
  label: string;
  Icon: typeof Blocks;
  /** Indica si la opción está disponible en este bloque. */
  enabled: (table: TableMenuInfo) => boolean;
}[] = [
  { action: "add-row", label: "Agregar fila", Icon: Rows3, enabled: () => true },
  { action: "add-col", label: "Agregar columna", Icon: Columns3, enabled: () => true },
  {
    action: "del-row",
    label: "Eliminar fila",
    Icon: Minus,
    enabled: (table) => table.canDeleteRow,
  },
  {
    action: "del-col",
    label: "Eliminar columna",
    Icon: Minus,
    enabled: (table) => table.canDeleteCol,
  },
  { action: "del-table", label: "Eliminar tabla", Icon: Trash, enabled: () => true },
  {
    action: "merge",
    label: "Combinar celdas",
    Icon: TableCellsMerge,
    // Con un rectángulo marcado se combinan esas celdas; si no, hacen falta dos
    // filas o más seleccionadas.
    enabled: (table) => table.rect !== null || table.rows.length >= 2,
  },
  {
    action: "unmerge",
    label: "Descombinar celdas",
    Icon: SplitSquareHorizontal,
    enabled: (table) => table.merged,
  },
  {
    action: "sort-asc",
    label: "Ordenar A→Z",
    Icon: ArrowDownUp,
    enabled: (table) => table.canSort,
  },
  {
    action: "sort-desc",
    label: "Ordenar Z→A",
    Icon: ArrowUpDown,
    enabled: (table) => table.canSort,
  },
  { action: "clipboard", label: "Copiar celdas", Icon: ClipboardCopy, enabled: () => true },
];

export default function EditorContextMenu({
  x,
  y,
  spell,
  hasSelection,
  table,
  onTableAction,
  onPick,
  onAdd,
  onIgnore,
  onRemove,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onFormat,
  onInsert,
  onClose,
  onReopen,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [group, setGroup] = useState<Group | null>(null);
  const [subPos, setSubPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const viewWidth = toLocalCoord(window.innerWidth);
    const viewHeight = toLocalCoord(window.innerHeight);
    const left = Math.max(8, Math.min(x, viewWidth - menu.offsetWidth - 8));
    const top = Math.max(8, Math.min(y, viewHeight - menu.offsetHeight - 8));
    setPos((current) =>
      current.left === left && current.top === top ? current : { left, top },
    );
  }, [x, y, spell?.mode, spell?.suggestions.length, hasSelection, table]);

  const holdFocus = (event: ReactMouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  function openSub(next: Group, event: ReactMouseEvent<HTMLButtonElement>, rows: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    const subRight = toLocalCoord(rect.right);
    const subLeft = toLocalCoord(rect.left);
    const subTop = toLocalCoord(rect.top);
    const viewWidth = toLocalCoord(window.innerWidth);
    const height = rows * SUB_ROW + 10;
    const left =
      subRight + 4 + SUB_WIDTH > viewWidth - 8 ? subLeft - SUB_WIDTH - 4 : subRight + 4;
    const top = Math.min(
      Math.max(8, subTop - 4),
      Math.max(8, toLocalCoord(window.innerHeight) - height - 8),
    );
    setSubPos({ left, top });
    setGroup(next);
  }

  const groupRow = (
    next: Group,
    label: string,
    Icon: typeof Blocks,
    rows: number,
  ) => (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={group === next}
      onMouseEnter={(event) => openSub(next, event, rows)}
      onClick={(event) => openSub(next, event, rows)}
      className={clsx(ITEM, group === next && "bg-gus-accent/15 text-gus-accent")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
  );

  const subShell = (active: boolean, children: ReactNode) =>
    active ? (
      <div
        role="menu"
        style={{ left: subPos.left, top: subPos.top, width: SUB_WIDTH }}
        onMouseDown={holdFocus}
        className="fixed z-50 rounded-xl border border-gus-border bg-gus-card py-1 shadow-2xl"
      >
        {children}
      </div>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onReopen(event.clientX, event.clientY);
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Menú del editor"
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={holdFocus}
        className="absolute min-w-56 rounded-xl border border-gus-border bg-gus-card py-1 shadow-2xl"
      >
        {table && (
          <>
            <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-gus-muted">
              <Table className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Tabla
            </div>

            {TABLE_ITEMS.filter(
              (item) =>
                item.action !== "merge" || table.rect !== null || table.rows.length >= 2,
            ).map((item) => {
              const enabled = item.enabled(table);
              return (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  disabled={!enabled}
                  onClick={() => onTableAction(item.action)}
                  className={clsx(ITEM, "disabled:pointer-events-none disabled:opacity-40")}
                >
                  <item.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}

            <div className="my-1 border-t border-gus-border" />
          </>
        )}

        {spell && (
          <>
            {spell.mode === "misspelled" &&
              (spell.suggestions.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-gus-muted">Sin sugerencias</p>
              ) : (
                spell.suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="menuitem"
                    onClick={() => onPick(item)}
                    className={clsx(ITEM, "font-medium")}
                  >
                    {item}
                  </button>
                ))
              ))}

            <div className="my-1 border-t border-gus-border" />

            {spell.mode === "misspelled" ? (
              <>
                <button type="button" role="menuitem" onClick={onAdd} className={ITEM}>
                  <BookPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Agregar al diccionario
                </button>
                <button type="button" role="menuitem" onClick={onIgnore} className={ITEM}>
                  <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Ignorar esta sesión
                </button>
              </>
            ) : (
              <button type="button" role="menuitem" onClick={onRemove} className={ITEM}>
                <BookX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Quitar del diccionario
              </button>
            )}

            <div className="my-1 border-t border-gus-border" />
          </>
        )}

        <button
          type="button"
          role="menuitem"
          title={hasSelection ? "Cortar la selección" : "Cortar la línea entera"}
          onClick={onCut}
          className={ITEM}
        >
          <Scissors className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Cortar
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!hasSelection}
          onClick={onCopy}
          className={clsx(ITEM, "disabled:pointer-events-none disabled:opacity-40")}
        >
          <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Copiar
        </button>
        <button type="button" role="menuitem" onClick={() => onPaste(false)} className={ITEM}>
          <ClipboardPaste className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Pegar
        </button>
        <button type="button" role="menuitem" onClick={() => onPaste(true)} className={ITEM}>
          <Eraser className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Pegar sin formato
        </button>
        <button type="button" role="menuitem" onClick={onSelectAll} className={ITEM}>
          <SquareDashedMousePointer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Seleccionar todo
        </button>

        <div className="my-1 border-t border-gus-border" />

        {groupRow("insert", "Insertar", Blocks, INSERT_ITEMS.length)}
        {groupRow("text", "Texto", Type, TEXT_ITEMS.length)}
        {groupRow("format", "Formato", Pilcrow, FORMAT_ITEMS.length)}
      </div>

      {subShell(
        group === "insert",
        INSERT_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => onInsert(item)}
            className={ITEM}
          >
            <item.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        )),
      )}

      {subShell(
        group === "text",
        TEXT_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => onInsert(item)}
            className={ITEM}
          >
            <item.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        )),
      )}

      {subShell(
        group === "format",
        FORMAT_ITEMS.map((item) => (
          <button
            key={item.kind}
            type="button"
            role="menuitem"
            onClick={() => onFormat(item.kind)}
            className={ITEM}
          >
            <item.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        )),
      )}
    </div>
  );
}
