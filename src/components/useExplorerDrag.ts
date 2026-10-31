import { useState, type DragEvent } from "react";
import { isInsidePath, parentPath } from "../lib/fileName";
import type { FolderEntry } from "../lib/explorerTrail";
import type { NoteFile } from "./FileExplorer";

export interface DragEntry {
  kind: "file" | "folder";
  path: string;
}

/**
 * MIME con el que el explorador arrastra sus filas. El editor lo reconoce al
 * soltar: una imagen enlaza en la nota en vez de moverse de carpeta.
 */
export const DRAG_ENTRY_MIME = "application/x-gus-explorer-entry";

interface ExplorerDragOptions {
  busy: boolean;
  renamingId: string | null;
  items: NoteFile[];
  folders: FolderEntry[];
  onMoveFile: (file: NoteFile, dest: FolderEntry) => void;
  onMoveFolder: (folder: FolderEntry, dest: FolderEntry) => void;
}

/** Arrastrar filas del explorador sobre una carpeta (de la lista o de la ruta) para moverlas. */
export function useExplorerDrag({ busy, renamingId, items, folders, onMoveFile, onMoveFolder }: ExplorerDragOptions) {
  const [dragEntry, setDragEntry] = useState<DragEntry | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  function startDrag(event: DragEvent<HTMLElement>, entry: DragEntry) {
    if (busy) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_ENTRY_MIME, JSON.stringify(entry));
    event.dataTransfer.setData("text/plain", entry.path);
    setDragEntry(entry);
  }

  function readDragEntry(event: DragEvent<HTMLElement>): DragEntry | null {
    try {
      const raw = event.dataTransfer.getData(DRAG_ENTRY_MIME);
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "kind" in parsed &&
        "path" in parsed &&
        (parsed.kind === "file" || parsed.kind === "folder") &&
        typeof parsed.path === "string"
      ) {
        return { kind: parsed.kind, path: parsed.path };
      }
    } catch {
    }

    return dragEntry;
  }

  function canDropOnFolder(entry: DragEntry, folder: FolderEntry): boolean {
    if (busy || renamingId === folder.path || entry.path === folder.path) return false;
    if (entry.kind === "folder" && isInsidePath(folder.path, entry.path)) return false;
    if (parentPath(entry.path) === folder.path) return false;
    return true;
  }

  function dragOverFolder(event: DragEvent<HTMLElement>, folder: FolderEntry) {
    const entry = readDragEntry(event);
    if (!entry || !canDropOnFolder(entry, folder)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverPath(folder.path);
  }

  function dropOnFolder(event: DragEvent<HTMLElement>, folder: FolderEntry) {
    const entry = readDragEntry(event);
    setDragOverPath(null);
    setDragEntry(null);
    if (!entry || !canDropOnFolder(entry, folder)) return;

    event.preventDefault();
    event.stopPropagation();

    if (entry.kind === "file") {
      const file = items.find((item) => item.id === entry.path);
      if (file) onMoveFile(file, folder);
      return;
    }

    const sourceFolder = folders.find((item) => item.path === entry.path);
    if (sourceFolder) onMoveFolder(sourceFolder, folder);
  }

  function clearDrag() {
    setDragEntry(null);
    setDragOverPath(null);
  }

  return { dragEntry, dragOverPath, setDragOverPath, startDrag, dragOverFolder, dropOnFolder, clearDrag };
}
