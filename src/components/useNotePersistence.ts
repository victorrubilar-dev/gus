import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pathWithTitle, safeFileName } from "../lib/fileName";
import type { EditorDraft } from "./MarkdownEditor";
import type { SaveState } from "./markdownEditorTypes";

interface NotePersistenceDeps {
  path: string;
  /** Vault de la nota: antes de sobrescribirla se guarda una versión en su historial. */
  vaultPath?: string | null;
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
  vaultPath,
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
  /** Lo último escrito, para saber si cambió mientras se guardaba. */
  const latestRef = useRef({ title, content });
  // Espejos sincronizados tras el commit y antes del paint: no se escribe en
  // un ref durante el render y, como persist/autoSave se llaman también desde
  // handlers, la ref es la vía válida (useEffectEvent solo sirve en efectos).
  useLayoutEffect(() => {
    autoSaveRef.current = autoSave;
    latestRef.current = { title, content };
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
      if (vaultPath) {
        // Sin copia se guarda igual: el historial no puede impedir guardar.
        await invoke("snapshot_note", { vault: vaultPath, path: target, force: false }).catch(() => {});
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
    // Lo escrito mientras se guardaba sigue pendiente: marcarlo como guardado
    // cancelaría el autoguardado ya programado y `flush` no lo escribiría nunca.
    if (latestRef.current.content !== content || latestRef.current.title !== title) return true;
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
