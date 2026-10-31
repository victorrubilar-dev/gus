import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { uiZoomFactor } from "../lib/uiZoom";

interface PanelWidthOptions {
  storageKey: string;
  /** Extremos para Inicio/Fin; `clamp` aplica además los límites que dependan de la ventana. */
  min: number;
  max: number;
  fallback: number;
  clamp: (width: number) => number;
}

/** Ancho de un panel redimensionable con el ratón o el teclado, recordado entre sesiones. */
export function usePanelWidth({ storageKey, min, max, fallback, clamp }: PanelWidthOptions) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null) return clamp(Number.parseInt(stored, 10));
    } catch {
      // Sin almacenamiento se usa el ancho por defecto.
    }
    return fallback;
  });
  const widthRef = useRef(width);

  function store(value: number) {
    try {
      window.localStorage.setItem(storageKey, String(value));
    } catch {
      // Sin almacenamiento el ancho solo dura la sesión.
    }
  }

  function change(next: number, persist = true) {
    const value = clamp(next);
    widthRef.current = value;
    setWidth(value);
    if (persist) store(value);
  }

  function onResizeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = widthRef.current;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const previousSelection = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      change(startWidth + (moveEvent.clientX - startX) / uiZoomFactor(), false);
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      document.body.style.userSelect = previousSelection;
      store(widthRef.current);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;

    switch (event.key) {
      case "ArrowLeft":
        change(width - step);
        break;
      case "ArrowRight":
        change(width + step);
        break;
      case "Home":
        change(min);
        break;
      case "End":
        change(max);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return { width, widthRef, change, onResizeStart, onResizeKeyDown };
}
