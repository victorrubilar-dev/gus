import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useT } from "../lib/i18n";
import { isInsidePath } from "../lib/fileName";
import { isImagePath } from "../lib/imageLinks";
import {
  importFilesIntoVault,
  relativeFolderLabel,
  summarizeImageInsert,
  summarizeImport,
  type ImportSummary,
} from "../lib/importFiles";
import { toLocalCoord } from "../lib/uiZoom";
import type { FileExplorerHandle } from "./FileExplorer";
import type { MarkdownEditorHandle } from "./MarkdownEditor";

interface FileDropOptions {
  currentVault: string | null;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  explorerRef: RefObject<FileExplorerHandle | null>;
  /** Se llama cuando el drop ha creado archivos en el vault: el explorador debe releer. */
  onFilesChanged: () => void;
}

/**
 * Arrastre de archivos del sistema sobre la ventana: estado del aviso mientras se
 * arrastra, carpeta de destino bajo el cursor e importación al soltar.
 */
export function useFileDrop({ currentVault, editorRef, explorerRef, onFilesChanged }: FileDropOptions) {
  const t = useT();
  /** Aviso del resultado de arrastrar archivos desde el explorador del sistema. */
  const [importNotice, setImportNotice] = useState<ImportSummary | null>(null);
  const importNoticeTimerRef = useRef<number | null>(null);
  /** true mientras el usuario trae archivos del sistema sobre la ventana. */
  const [droppingFiles, setDroppingFiles] = useState(false);
  /** Carpeta bajo el cursor durante el arrastre: allí caerán los archivos. */
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  /** true si el arrastre cae sobre el texto de la nota abierta. */
  const [dropOnNote, setDropOnNote] = useState(false);
  /**
   * Lo que hace el arrastre nativo, guardado en un ref para que el listener —
   * enganchado una sola vez— siempre vea las últimas funciones y estados.
   */
  const dragDropRef = useRef<{
    folder: (position: { x: number; y: number }) => string | null;
    editor: (position: { x: number; y: number }) => boolean;
    drop: (paths: string[], position: { x: number; y: number }) => Promise<void>;
  }>({ folder: () => null, editor: () => false, drop: async () => {} });

  function showImportNotice(summary: ImportSummary) {
    setImportNotice(summary);
    if (importNoticeTimerRef.current !== null) window.clearTimeout(importNoticeTimerRef.current);
    importNoticeTimerRef.current = window.setTimeout(() => setImportNotice(null), 8000);
  }

  /**
   * Carpeta que recibiría un arrastre: la fila bajo el cursor del explorador o,
   * si no la hay, la carpeta que se está viendo (la raíz si no hay explorador).
   *
   * Tauri da la posición en píxeles físicos: se pasa a px de CSS y se comprueba
   * con las dos cuentas posibles (con y sin el zoom de la interfaz). Si no
   * coinciden no se arriesga: se usa la carpeta visible, que es la que anuncia
   * el aviso antes de soltar.
   */
  function resolveDropFolder(position: { x: number; y: number }): string | null {
    const vault = currentVault;
    if (!vault) return null;

    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;

    const bajo = (px: number, py: number): string | null => {
      try {
        const element = document.elementFromPoint(px, py);
        const folder =
          element instanceof Element ? element.closest<HTMLElement>("[data-drop-folder]") : null;
        const path = folder?.dataset.dropFolder ?? null;
        return path && isInsidePath(path, vault) ? path : null;
      } catch {
        return null;
      }
    };

    const directo = bajo(x, y);
    const conZoom = bajo(toLocalCoord(x), toLocalCoord(y));
    const bajoCursor = directo !== null && directo === conZoom ? directo : null;

    return bajoCursor ?? explorerRef.current?.currentDir() ?? vault;
  }

  /**
   * ¿El arrastre cae sobre el campo de texto de la nota? Tauri da la posición
   * en píxeles físicos: se comprueba con las dos cuentas posibles (con y sin
   * el zoom de la interfaz), como se hace con las carpetas. Siempre que una
   * de las dos dé en el editor, se enlaza ahí.
   */
  function overEditorAt(position: { x: number; y: number }): boolean {
    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;

    const bajo = (px: number, py: number): boolean => {
      try {
        const element = document.elementFromPoint(px, py);
        return element instanceof Element && element.closest("[data-drop-editor]") !== null;
      } catch {
        return false;
      }
    };

    return bajo(x, y) || bajo(toLocalCoord(x), toLocalCoord(y));
  }

  /**
   * Importa los archivos soltados y cuenta lo que ha dado de sí. Las imágenes
   * que caen sobre el texto de la nota no van a una carpeta: se enlazan en la
   * nota que está abierta (copiándolas junto a ella si vienen de fuera).
   */
  async function handleDroppedFiles(paths: string[], position: { x: number; y: number }) {
    if (paths.length === 0) return;

    const imagenes = paths.filter(isImagePath);
    const resto = paths.filter((ruta) => !isImagePath(ruta));

    if (imagenes.length > 0 && currentVault && overEditorAt(position)) {
      const resultado =
        (await editorRef.current?.insertImages(imagenes, position)) ?? {
          inserted: 0,
          failed: imagenes.length,
        };
      showImportNotice(summarizeImageInsert(resultado));
      // Copiar una imagen al vault crea un archivo nuevo: el explorador lo
      // tiene que enseñar (aunque solo se insertaran enlaces de vault).
      if (resultado.inserted > 0) onFilesChanged();
      if (resto.length === 0) return;
    }

    const dest = resolveDropFolder(position);
    if (!dest) {
      showImportNotice({ ok: false, message: t("app.noVaultForFiles") });
      return;
    }

    try {
      const items = await importFilesIntoVault(resto, dest);
      showImportNotice(summarizeImport(items, relativeFolderLabel(dest, currentVault ?? dest)));
      onFilesChanged();
    } catch (error: unknown) {
      showImportNotice({ ok: false, message: String(error) });
    }
  }

  // El ref siempre apunta a la versión más reciente de las funciones de arriba.
  useEffect(() => {
    dragDropRef.current = {
      folder: resolveDropFolder,
      editor: overEditorAt,
      drop: handleDroppedFiles,
    };
  });

  /**
   * Arrastre desde el explorador de archivos del sistema: Tauri intercepta ese
   * drop nativo (el webview no recibe el `drop` de HTML5), así que se escucha
   * aquí. Al entrar o al moverse se actualiza la carpeta que anuncia el aviso.
   */
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "drop") {
            setDroppingFiles(false);
            setDropFolder(null);
            setDropOnNote(false);
            void dragDropRef.current.drop(payload.paths, payload.position);
          } else if (payload.type === "enter" || payload.type === "over") {
            setDroppingFiles(true);
            setDropFolder(dragDropRef.current.folder(payload.position));
            setDropOnNote(dragDropRef.current.editor(payload.position));
          } else {
            setDroppingFiles(false);
            setDropFolder(null);
            setDropOnNote(false);
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(() => {});
    } catch {
      // Fuera de Tauri (navegador al desarrollar) no hay arrastre nativo.
    }

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (importNoticeTimerRef.current !== null) window.clearTimeout(importNoticeTimerRef.current);
    };
  }, []);

  return { importNotice, droppingFiles, dropFolder, dropOnNote };
}
