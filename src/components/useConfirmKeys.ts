import { useEffect, type RefObject } from "react";

/**
 * Teclado del confirm de papelera: al abrirse el foco cae en «Mover a la
 * papelera» y las flechas alternan entre sus dos botones.
 */
export function useConfirmKeys(
  confirmOpen: boolean,
  confirmTrashRef: RefObject<HTMLButtonElement | null>,
  confirmCancelRef: RefObject<HTMLButtonElement | null>,
) {
  // Al abrir el confirm el foco cae en «Mover a la papelera»: es la opción que
  // siempre ha confirmado Supr y por la que parten las flechas.
  useEffect(() => {
    if (!confirmOpen) return;
    confirmTrashRef.current?.focus();
  }, [confirmOpen]);

  /**
   * El confirm se recorre con el teclado: las flechas alternan entre las dos
   * opciones (y devuelven el foco al diálogo si se había ido) e Intro activa lo
   * marcado. Si el foco está fuera, Intro solo lo vuelve a traer.
   */
  useEffect(() => {
    if (!confirmOpen) return;

    function onKey(event: KeyboardEvent) {
      const flecha =
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight";
      if (!flecha && event.key !== "Enter") return;
      if (event.repeat || event.defaultPrevented) return;
      // Alt+←/→ es el historial de carpetas y Ctrl/Cmd+Intro otros diálogos.
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Nada de flechas sobre campos de texto ni dentro de otro diálogo (paleta,
      // tarea nueva…) aunque el confirm siga abierto detrás.
      if (target.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;

      const trash = confirmTrashRef.current;
      const cancel = confirmCancelRef.current;
      if (!trash || !cancel) return;

      const activo = document.activeElement;
      const dentro = activo === trash || activo === cancel;

      if (flecha) {
        event.preventDefault();
        if (!dentro) {
          // El foco se había ido (p. ej. clic en el texto del diálogo): la
          // primera flecha entra por la opción que toca según el sentido.
          if (event.key === "ArrowUp" || event.key === "ArrowLeft") trash.focus();
          else cancel.focus();
          return;
        }
        // Dos opciones: cualquier flecha pasa a la otra.
        if (activo === trash) cancel.focus();
        else trash.focus();
        return;
      }

      // Intro: con el foco en el confirm la recoge el propio botón (el clic
      // nativo); estando fuera, la primera solo devuelve el foco al diálogo.
      if (!dentro) {
        event.preventDefault();
        trash.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);
}
