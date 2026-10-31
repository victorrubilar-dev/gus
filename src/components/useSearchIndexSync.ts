import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relativeNotePath } from "../lib/searchIndex";

/**
 * Mantiene al día el índice de búsqueda cuando se guarda una nota. Solo lo toca
 * si ya existe (la vista de búsqueda avisa con `handleSearchIndexReady`).
 */
export function useSearchIndexSync(currentVault: string | null) {
  /**
   * El índice de búsqueda existe ya en el vault: solo entonces merece la pena
   * mantenerlo al guardar. Si nadie ha buscado nunca, no se crea el archivo.
   */
  const searchIndexTimerRef = useRef<number | null>(null);
  const searchIndexReadyRef = useRef(false);

  /** La vista de búsqueda avisa cuando el índice ya está levantado. */
  const handleSearchIndexReady = useCallback(() => {
    searchIndexReadyRef.current = true;
  }, []);

  useEffect(() => {
    // Cambiar de vault deja el índice de la anterior sesión fuera de juego.
    searchIndexReadyRef.current = false;
    if (searchIndexTimerRef.current !== null) {
      window.clearTimeout(searchIndexTimerRef.current);
      searchIndexTimerRef.current = null;
    }
  }, [currentVault]);

  useEffect(
    () => () => {
      if (searchIndexTimerRef.current !== null) {
        window.clearTimeout(searchIndexTimerRef.current);
      }
    },
    [],
  );

  /** Reindexa (con retardo) la nota que acaba de guardarse. */
  function indexSavedNote(draft: { path: string; content: string }) {
    // El índice se toca solo si ya existe: así buscar sigue reflejando lo que
    // se escribe sin crear `.gus-index` en vaults donde nadie ha buscado.
    if (!searchIndexReadyRef.current || !currentVault) return;

    const vault = currentVault;
    const notePath = draft.path;
    const text = draft.content;
    const relative = relativeNotePath(vault, notePath);
    if (relative === null) return;

    if (searchIndexTimerRef.current !== null) {
      window.clearTimeout(searchIndexTimerRef.current);
    }
    searchIndexTimerRef.current = window.setTimeout(() => {
      searchIndexTimerRef.current = null;
      invoke("update_index_note", {
        path: vault,
        relative,
        text,
        modifiedMs: Date.now(),
      }).catch(() => {
        // Un fallo al reindexar no interrumpe el guardado: la próxima
        // reconstrucción completa lo pone al día.
      });
    }, 800);
  }

  return { handleSearchIndexReady, indexSavedNote };
}
