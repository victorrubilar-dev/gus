import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { baseName } from "../lib/fileName";
import { externalAction } from "../lib/externalChange";
import type { NoteFile } from "./FileExplorer";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import type { OpenNote } from "./useOpenEntries";

interface ExternalChangesOptions {
  ready: boolean;
  currentVault: string | null;
  note: OpenNote | null;
  notePathRef: RefObject<string | null>;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  selectNote: (file: NoteFile) => void;
  /** Algo cambió en el vault: el explorador debe releer. */
  onFilesChanged: () => void;
}

/** Vigila el vault y reacciona a lo que otros programas cambian (REQ-13). */
export function useExternalChanges({
  ready,
  currentVault,
  note,
  notePathRef,
  editorRef,
  selectNote,
  onFilesChanged,
}: ExternalChangesOptions) {
  /** Aviso de que la nota abierta cambió fuera de la app (REQ-13). */
  const [externalNotice, setExternalNotice] = useState<{
    path: string;
    kind: "reloaded" | "conflict";
  } | null>(null);
  const externalNoticeTimerRef = useRef<number | null>(null);

  /**
   * Cambios hechos fuera de la app (REQ-13): el backend vigila el vault y avisa
   * con las rutas tocadas, ya sin el ruido ni las escrituras propias.
   */
  const handleVaultChangedEvent = useEffectEvent(async (paths: string[]) => {
    onFilesChanged();

    const open = notePathRef.current;
    if (!open || !note || !paths.includes(open)) return;

    let disk: string;
    try {
      disk = await invoke<string>("read_vault_file", { path: open });
    } catch {
      return; // borrada o ilegible: el explorador ya lo refleja
    }
    if (notePathRef.current !== open) return;

    const action = externalAction(disk, note.content, editorRef.current?.isDirty() ?? false);
    if (action === "ignore") return;

    if (externalNoticeTimerRef.current !== null) window.clearTimeout(externalNoticeTimerRef.current);
    if (action === "reload") {
      selectNote({ id: open, name: baseName(open), kind: "note" });
      setExternalNotice({ path: open, kind: "reloaded" });
      externalNoticeTimerRef.current = window.setTimeout(() => setExternalNotice(null), 6000);
    } else {
      setExternalNotice({ path: open, kind: "conflict" });
    }
  });

  useEffect(() => {
    if (!ready || currentVault === null) return;

    const unlisten = listen<string[]>("vault-changed", (event) => {
      void handleVaultChangedEvent(event.payload);
    });
    invoke("watch_vault", { path: currentVault }).catch(() => {
      // Sin vigilancia la app funciona igual; solo no se enteraría de cambios externos.
    });

    return () => {
      void unlisten.then((off) => off());
      void invoke("unwatch_vault").catch(() => {});
    };
  }, [ready, currentVault]);

  useEffect(
    () => () => {
      if (externalNoticeTimerRef.current !== null) window.clearTimeout(externalNoticeTimerRef.current);
    },
    [],
  );

  return { externalNotice, setExternalNotice };
}
