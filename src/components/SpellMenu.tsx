/**
 * Menú contextual del corrector (botón derecho sobre una palabra en rojo).
 *
 * Solo aparece cuando la palabra está mal escrita —con sus sugerencias y las
 * opciones de diccionario— o cuando es una palabra propia (para poder quitarla):
 * el resto del tiempo manda el menú del sistema, que ya trae cortar, copiar y
 * pegar. El `mousedown` del menú no se propaga para que el foco siga en el
 * textarea y la acción pueda sustituir el texto directamente.
 */

import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { BookPlus, BookX, EyeOff } from "lucide-react";
import clsx from "clsx";

export interface SpellMenuProps {
  /** Falta (con sugerencias) o palabra propia del usuario. */
  mode: "misspelled" | "personal";
  /** La palabra que se muestra y sobre la que se actúa. */
  word: string;
  /** Coordenadas del clic, en el sistema de la ventana (viewport). */
  x: number;
  y: number;
  /** Alternativas propuestas por el corrector (modo falta). */
  suggestions: string[];
  /** Sustituye la palabra por la sugerencia elegida. */
  onPick: (suggestion: string) => void;
  /** Agrega la palabra al diccionario personal. */
  onAdd: () => void;
  /** Deja de marcar la palabra durante esta sesión. */
  onIgnore: () => void;
  /** Quita la palabra del diccionario personal. */
  onRemove: () => void;
  /** Cierra el menú sin actuar. */
  onClose: () => void;
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gus-text outline-none hover:bg-gus-accent/15 hover:text-gus-accent focus-visible:bg-gus-accent/15";

export default function SpellMenu({
  mode,
  word,
  x,
  y,
  suggestions,
  onPick,
  onAdd,
  onIgnore,
  onRemove,
  onClose,
}: SpellMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Recorte al viewport: se mide tras el primer pintado y al variar el alto.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
    setPos((current) =>
      current.left === left && current.top === top ? current : { left, top },
    );
  }, [x, y, mode, suggestions.length]);

  /** El menú no debe robarle el foco al textarea (ni cerrarse solo). */
  const holdFocus = (event: ReactMouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Corrector: ${word}`}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={holdFocus}
        className="absolute min-w-56 rounded-xl border border-gus-border bg-gus-card py-1 shadow-2xl"
      >
        {mode === "misspelled" ? (
          <>
            {suggestions.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-gus-muted">Sin sugerencias</p>
            ) : (
              suggestions.map((item) => (
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
            )}

            <div className="my-1 border-t border-gus-border" />

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
      </div>
    </div>
  );
}
