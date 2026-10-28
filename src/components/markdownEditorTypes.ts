/** Tipos internos del editor de Markdown. */
import type { CaretAnchor } from "../lib/caretPosition";
import type { ContextSpell, TableMenuInfo } from "./EditorContextMenu";


/** Alto que un bloque ha ganado por encima de su markdown: una tabla al
 *  envolver sus celdas o una imagen de bloque a tamaño real. A partir de su
 *  última línea el overlay queda más abajo que el texto del textarea, y hay
 *  que compensarlo (scroll, clic y cursor). */
export interface BlockDrift {
  /** Última línea del bloque de tabla. */
  end: number;
  /** Píxeles de más que ocupa el bloque. */
  extra: number;
}

/** Estado del arrastre de una imagen para redimensionarla (ver `ImageLine`). */
export interface ImageResizeDrag {
  /** Línea de origen que se está redimensionando. */
  line: number;
  startX: number;
  startY: number;
  /** Anchura inicial de la imagen (px), para detectar clic sin arrastre. */
  startW: number;
  /** Anchura actual (px): es la que se guarda al soltar. */
  width: number;
  minW: number;
  maxW: number;
  move: (event: globalThis.MouseEvent) => void;
  up: () => void;
}

export type SaveState = "idle" | "dirty" | "saved" | "error";

export type ViewMode = "edit" | "preview";

export interface EditorMenu {
  kind: "wiki" | "slash" | "images";
  start: number;
  query: string;
  index: number;
  anchor: CaretAnchor;
  /** Grupo del menú «/»: el normal o el de tamaños de tabla. */
}

export interface ContextMenuState {
  spell: ContextSpell | null;
  hasSelection: boolean;
  /** Tabla bajo el clic derecho (null si el clic no cayó en una). */
  table: TableMenuInfo | null;
  x: number;
  y: number;
}

/** Cuadro de correcciones que se despliega sobre la palabra mal escrita. */
export interface SpellPopup {
  start: number;
  end: number;
  word: string;
  suggestions: string[];
  /** Índice recorrido con ↑/↓; -1 mientras la lista no se ha tocado. */
  index: number;
  anchor: CaretAnchor;
}
