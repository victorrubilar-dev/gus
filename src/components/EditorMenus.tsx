/** Menús flotantes del editor: autocompletado `[[notas]]` y menú `/` (bloques).
 *
 * Comparten la misma carcasa posicionada sobre el cursor y el mismo estilo de
 * lista; lo único que cambia son los elementos y la acción al elegirlos.
 */

import { type ReactNode } from "react";
import clsx from "clsx";
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
  type LucideIcon,
} from "lucide-react";
import type { CaretAnchor } from "../lib/caretPosition";
import { normalizeWikiText, wikiNoteBaseTitle, wikiNoteFolder, type WikiNote } from "../lib/wikiLink";

/** Un bloque del menú `/`: qué inserta y con qué icono se muestra. */
export interface SlashItem {
  /** Identificador estable (para la `key` y para las pruebas). */
  id: string;
  /** Nombre visible en el menú. */
  label: string;
  /** Avance del snippet a la derecha (monoespaciado). */
  hint: string;
  /** Texto markdown que se inserta al elegirlo. */
  snippet: string;
  /** Dónde queda el cursor dentro del texto insertado. */
  caretOffset: number;
  /** Icono de lucide. */
  Icon: LucideIcon;
}

/** Bloques del menú `/` (estilo Notion): se insertan en el cursor. */
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
    hint: "| a | b |",
    snippet: "| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |",
    caretOffset: "| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |".length,
    Icon: Table,
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

/** Bloques que empiezan por `query` (sin acentos ni mayúsculas). */
export function filterSlashItems(query: string): SlashItem[] {
  const wanted = normalizeWikiText(query);
  if (!wanted) return SLASH_ITEMS;

  return SLASH_ITEMS.filter(
    (item) =>
      normalizeWikiText(item.label).includes(wanted) ||
      normalizeWikiText(item.hint).includes(wanted),
  );
}

/** Máximo de alto del menú: si no cabe debajo del cursor, se pone encima. */
const MENU_MAX_HEIGHT = 256;
const MENU_WIDTH = 320;

/** Carcasa común: caja `fixed` anclada al cursor, con scroll propio. */
function MenuShell({ anchor, label, children }: { label: string; anchor: CaretAnchor; children: ReactNode }) {
  const flip = anchor.top + MENU_MAX_HEIGHT + 12 > window.innerHeight;
  const top = flip
    ? Math.max(8, anchor.top - MENU_MAX_HEIGHT)
    : anchor.top + anchor.height + 6;
  const left = Math.min(
    Math.max(8, anchor.left),
    Math.max(8, window.innerWidth - MENU_WIDTH - 8),
  );

  return (
    <motion.div
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

/** Pie con las teclas del menú (compartido por ambos desplegables). */
function MenuHints() {
  return (
    <p className="mt-1 border-t border-gus-border px-3 pt-1.5 pb-1 text-[10px] text-gus-muted/70">
      ↑↓ mover · Intro elegir · Esc cerrar
    </p>
  );
}

export interface WikiLinkMenuProps {
  /** Ancla del cursor en el textarea. */
  anchor: CaretAnchor;
  /** Notas filtradas (ya limitadas) para mostrar. */
  notes: WikiNote[];
  /** La lista del vault todavía se está pidiendo. */
  loading: boolean;
  /** Texto escrito entre los corchetes dobles. */
  query: string;
  /** Elemento resaltado. */
  index: number;
  /** Elige una nota y escribe su enlace. */
  onPick: (note: WikiNote) => void;
  /** Resalta con el ratón. */
  onHover: (index: number) => void;
}

/** Desplegable de notas que aparece al escribir `[[`. */
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
    <MenuShell anchor={anchor} label="Notas para enlazar">
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
            /* Sin evitar el mousedown el textarea pierde el foco y el menú se cierra. */
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
  /** Ancla del cursor en el textarea. */
  anchor: CaretAnchor;
  /** Bloques filtrados por lo escrito tras la `/`. */
  items: SlashItem[];
  /** Elemento resaltado. */
  index: number;
  /** Inserta el bloque elegido. */
  onPick: (item: SlashItem) => void;
  /** Resalta con el ratón. */
  onHover: (index: number) => void;
}

/** Menú `/` con los bloques insertables (tablas, listas, código…). */
export function SlashMenu({ anchor, items, index, onPick, onHover }: SlashMenuProps) {
  const active = items.length > 0 ? Math.min(index, items.length - 1) : -1;

  return (
    <MenuShell anchor={anchor} label="Bloques para insertar">
      {items.length === 0 && (
        <p className="px-3 py-2 text-xs text-gus-muted">Ningún bloque coincide.</p>
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
            /* Sin evitar el mousedown el textarea pierde el foco y el menú se cierra. */
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
