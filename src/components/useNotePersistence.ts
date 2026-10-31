import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pathWithTitle, safeFileName } from "../lib/fileName";
import type { EditorDraft } from "./MarkdownEditor";
import type { SaveState } from "./markdownEditorTypes";

interface NotePersistenceDeps {
  path: string;
  title: string;
  content: string;
  saveState: SaveState;
  setSaveState: Dispatch<SetStateAction<SaveState>>;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  autoSave?: (draft: EditorDraft) => void;
  autoSaveEnabled: boolean;
  debounceMs: number;
}

/**
 * Guardado de la nota: renombra el archivo según el título, escribe el contenido
 * (descartando lo que llegue tarde), autoguarda con retardo y vuelca lo pendiente
 * al desmontar. `flush` sirve al padre para guardar antes de cambiar de nota.
 */
export function useNotePersistence({
  path,
  title,
  content,
  saveState,
  setSaveState,
  setSaveError,
  autoSave,
  autoSaveEnabled,
  debounceMs,
}: NotePersistenceDeps) {
  const ownPathRef = useRef(path);
  const sequenceRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveRef = useRef(autoSave);
  // Espejos sincronizados tras el commit y antes del paint: no se escribe en
  // un ref durante el render y, como persist/autoSave se llaman también desde
  // handlers, la ref es la vía válida (useEffectEvent solo sirve en efectos).
  useLayoutEffect(() => {
    autoSaveRef.current = autoSave;
    dirtyRef.current = saveState === "dirty";
  });

  async function persist(): Promise<boolean> {
    const sequence = ++sequenceRef.current;
    const from = ownPathRef.current;
    let target = from;

    try {
      const wanted = pathWithTitle(from, title);
      if (wanted !== from) {
        target = await invoke<string>("rename_vault_file", { from, to: wanted });
      }
      await invoke("write_vault_file", { path: target, content });
    } catch (error) {
      if (sequence === sequenceRef.current) {
        setSaveState("error");
        setSaveError(String(error));
      }
      return false;
    }

    // La nota cambió mientras se guardaba: no tocar el estado de la nueva.
    if (sequence !== sequenceRef.current) return false;

    ownPathRef.current = target;
    autoSaveRef.current?.({ path: target, title: safeFileName(title), content });
    setSaveState("saved");
    setSaveError(null);
    return true;
  }

  const persistRef = useRef(persist);
  useLayoutEffect(() => {
    persistRef.current = persist;
  });

  // `flush` solo lee refs: con useCallback su identidad deja de cambiar en
  // cada render y useImperativeHandle no se vuelve a ejecutar sin motivo.
  const flush = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;

    dirtyRef.current = false;
    const saved = await persistRef.current();
    if (!saved) dirtyRef.current = true;
    return saved;
  }, []);

  useEffect(() => {
    if (saveState !== "dirty" || !autoSaveEnabled) return;

    const timer = setTimeout(() => void persistRef.current(), debounceMs);
    return () => clearTimeout(timer);
  }, [title, content, saveState, debounceMs, autoSaveEnabled]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void persistRef.current();
      }
    };
  }, []);

  return { dirtyRef, persistRef, flush };
}
