import { useRef, type RefObject } from "react";
import { createHistory, type EditorHistory, type HistorySnapshot } from "../lib/editorHistory";

/**
 * Historial de deshacer del editor: las refs que dicen si el próximo cambio
 * se agrupa, se fuerza o se salta, y la instantánea del estado actual (texto,
 * selección y hora). Quién registra o restaura un paso lo decide el editor.
 */
export function useEditorHistory(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  contentRef: RefObject<string>,
) {
  const historyRef = useRef<EditorHistory>(createHistory());
  const pendingRestoreRef = useRef<HistorySnapshot | null>(null);
  const forceHistoryRef = useRef(false);
  const skipHistoryRef = useRef(false);

  function historySnapshot(): HistorySnapshot {
    const area = textareaRef.current;
    const texto = contentRef.current;
    return {
      content: texto,
      start: area?.selectionStart ?? texto.length,
      end: area?.selectionEnd ?? texto.length,
      at: Date.now(),
    };
  }

  return { historyRef, pendingRestoreRef, forceHistoryRef, skipHistoryRef, historySnapshot };
}
