import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  MoreVertical,
  Plus,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  baseName,
  isImageName,
  isInsidePath,
  joinPath,
  parentPath,
  renameTarget,
  safeFileName,
} from "../lib/fileName";

export interface NoteFile {
  id: string;
  name: string;
  kind?: "note" | "image";
  updatedAt?: string;
}

export interface FileExplorerProps {
  vaultPath: string;
  files?: NoteFile[];
  activeId?: string | null;
  onSelect?: (file: NoteFile) => void;
  onFilesChange?: (files: NoteFile[]) => void;
  refreshKey?: number;
  onFileDeleted?: (path: string) => void;
  expanded?: boolean;
  width?: number;
  onBeforeFileAction?: (path: string) => void | Promise<void>;
}

interface VaultEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms: number | null;
}

interface VaultDir {
  path: string;
  relative: string;
}

interface FolderEntry {
  name: string;
  path: string;
}

interface MenuState {
  id: string;
  kind: "file" | "folder";
  x: number;
  y: number;
}

interface DragEntry {
  kind: "file" | "folder";
  path: string;
}

const DRAG_ENTRY_MIME = "application/x-gus-explorer-entry";

const MENU_WIDTH = 208;
const MENU_MAX_HEIGHT = 280;

const RENAME_INPUT_CLASS =
  "min-w-0 flex-1 rounded-lg border border-gus-accent/50 bg-gus-card px-2 py-1.5 font-mono text-xs text-gus-text outline-none focus:ring-2 focus:ring-gus-accent/60";

function formatModified(ms: number | null | undefined): string | undefined {
  if (!ms) return undefined;

  const diff = Date.now() - ms;
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 604_800_000) return `hace ${Math.floor(diff / 86_400_000)} d`;
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function toNoteFile(entry: VaultEntry): NoteFile {
  return {
    id: entry.path,
    name: entry.name,
    kind: isImageName(entry.name) ? "image" : "note",
    updatedAt: formatModified(entry.modified_ms),
  };
}

function rootLabel(vaultPath: string): string {
  return baseName(vaultPath.replace(/[\\/]+$/, "")) || vaultPath || "vault";
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nextName(existing: NoteFile[]): string {
  const taken = new Set(existing.map((file) => file.name));
  for (let n = 1; ; n++) {
    const name = `nueva-nota-${n}.md`;
    if (!taken.has(name)) return name;
  }
}

function RenameField({
  initialValue,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const cancelledRef = useRef(false);

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      aria-label={ariaLabel}
      className={RENAME_INPUT_CLASS}
    />
  );
}

export default function FileExplorer({
  vaultPath,
  files,
  activeId,
  onSelect,
  onFilesChange,
  refreshKey = 0,
  onFileDeleted,
  onBeforeFileAction,
  expanded = false,
  width,
}: FileExplorerProps) {
  const staticMode = files !== undefined;

  const [trail, setTrail] = useState<FolderEntry[]>(() => [
    { name: rootLabel(vaultPath), path: vaultPath },
  ]);
  const currentDir = trail[trail.length - 1].path;
  const rootDir = trail[0];

  const [items, setItems] = useState<NoteFile[]>(() => (files ? [...files] : []));
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    staticMode ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => activeId ?? files?.[0]?.id ?? null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<FolderEntry[] | null>(null);
  const [dragEntry, setDragEntry] = useState<DragEntry | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    setReloadKey((key) => key + 1);
  }

  function closeMenu() {
    setMenu(null);
    setRenamingId(null);
    setConfirmId(null);
    setMovingId(null);
    setDestinations(null);
  }

  function menuFromButton(
    event: ReactMouseEvent<HTMLButtonElement>,
    id: string,
    kind: "file" | "folder",
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(id, kind, rect.left, rect.bottom + 4);
  }

  function menuFromContext(
    event: ReactMouseEvent<HTMLElement>,
    id: string,
    kind: "file" | "folder",
  ) {
    event.preventDefault();
    openMenu(id, kind, event.clientX, event.clientY);
  }

  function openMenu(id: string, kind: "file" | "folder", x: number, y: number) {
    const left = Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - MENU_MAX_HEIGHT - 8);

    setMenu({ id, kind, x: left, y: top });
    setRenamingId(null);
    setConfirmId(null);
    setMovingId(null);
    setDestinations(null);
  }

  function startDrag(event: ReactDragEvent<HTMLElement>, entry: DragEntry) {
    if (busy) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_ENTRY_MIME, JSON.stringify(entry));
    event.dataTransfer.setData("text/plain", entry.path);
    setDragEntry(entry);
  }

  function readDragEntry(event: ReactDragEvent<HTMLElement>): DragEntry | null {
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

  function dragOverFolder(event: ReactDragEvent<HTMLElement>, folder: FolderEntry) {
    const entry = readDragEntry(event);
    if (!entry || !canDropOnFolder(entry, folder)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverPath(folder.path);
  }

  function dropOnFolder(event: ReactDragEvent<HTMLElement>, folder: FolderEntry) {
    const entry = readDragEntry(event);
    setDragOverPath(null);
    setDragEntry(null);
    if (!entry || !canDropOnFolder(entry, folder)) return;

    event.preventDefault();
    event.stopPropagation();

    if (entry.kind === "file") {
      const file = items.find((item) => item.id === entry.path);
      if (file) void moveFile(file, folder);
      return;
    }

    const sourceFolder = folders.find((item) => item.path === entry.path);
    if (sourceFolder) void moveFolder(sourceFolder, folder);
  }

  function clearDrag() {
    setDragEntry(null);
    setDragOverPath(null);
  }

  function startRename(id: string) {
    setMenu(null);
    setConfirmId(null);
    setMovingId(null);
    setDestinations(null);
    setRenamingId(id);
  }

  useEffect(() => {
    setTrail([{ name: rootLabel(vaultPath), path: vaultPath }]);
    setMenu(null);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);

  useEffect(() => {
    if (!menu) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenu(null);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    if (staticMode) return;

    let cancelled = false;
    setStatus("loading");

    invoke<VaultEntry[]>("list_vault_entries", { path: currentDir })
      .then((entries) => {
        if (cancelled) return;
        const nextFolders = entries
          .filter((entry) => entry.is_dir)
          .map((entry) => ({ name: entry.name, path: entry.path }));
        const nextItems = entries.filter((entry) => !entry.is_dir).map(toNoteFile);

        setFolders(nextFolders);
        setItems(nextItems);
        setSelectedId((prev) =>
          prev && nextItems.some((file) => file.id === prev) ? prev : (nextItems[0]?.id ?? null),
        );
        setErrorMessage(null);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFolders([]);
        setItems([]);
        setSelectedId(null);
        setErrorMessage(String(error));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [staticMode, currentDir, vaultPath, reloadKey, refreshKey]);

  const currentId = activeId ?? selectedId;

  function select(file: NoteFile) {
    setSelectedId(file.id);
    onSelect?.(file);
  }

  function enterFolder(folder: FolderEntry) {
    closeMenu();
    clearDrag();
    setTrail((prev) => [...prev, folder]);
  }

  async function handleNewNote() {
    if (staticMode) {
      const file: NoteFile = { id: createId(), name: nextName(items), kind: "note" };
      const next = [file, ...items];
      setItems(next);
      setSelectedId(file.id);
      onFilesChange?.(next);
      onSelect?.(file);
      return;
    }

    setActionError(null);
    setBusyId("__new__");
    try {
      const path = await invoke<string>("create_vault_file", {
        path: joinPath(currentDir, "nueva-nota.md"),
        content: "# Nueva nota\n\n",
      });
      const file: NoteFile = {
        id: path,
        name: baseName(path),
        kind: "note",
        updatedAt: "ahora",
      };
      reload();
      setSelectedId(path);
      onSelect?.(file);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function handleNewFolder() {
    if (staticMode) return;

    setActionError(null);
    setBusyId("__folder__");
    try {
      await invoke<string>("create_vault_dir", {
        path: joinPath(currentDir, "nueva-carpeta"),
      });
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename(file: NoteFile, rawValue: string) {
    setRenamingId(null);

    const kind = file.kind === "image" ? "image" : "note";
    const target = renameTarget(file.id, rawValue, kind);
    if (target === file.id) return;

    setActionError(null);
    setBusyId(file.id);
    try {
      if (kind === "note") await onBeforeFileAction?.(file.id);

      const newPath = await invoke<string>("rename_vault_file", {
        from: file.id,
        to: target,
      });
      const finalName = baseName(newPath);
      closeMenu();
      reload();

      if (currentId === file.id) {
        onSelect?.({ ...file, id: newPath, name: finalName, updatedAt: "ahora" });
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function commitFolderRename(folder: FolderEntry, rawValue: string) {
    setRenamingId(null);

    const name = safeFileName(rawValue);
    if (name === safeFileName(folder.name)) return;

    setActionError(null);
    setBusyId(folder.path);
    try {
      const newPath = await invoke<string>("rename_vault_dir", {
        from: folder.path,
        to: joinPath(parentPath(folder.path), name),
      });
      closeMenu();
      setTrail((prev) =>
        prev.map((step) =>
          step.path === folder.path ? { name: baseName(newPath), path: newPath } : step,
        ),
      );
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function startMove(path: string) {
    setMovingId(path);
    setDestinations(null);
    setConfirmId(null);
    setActionError(null);

    try {
      const dirs = await invoke<VaultDir[]>("list_vault_dirs", { path: rootDir.path });
      setDestinations(
        [
          { name: rootDir.name, path: rootDir.path },
          ...dirs.map((dir) => ({ name: dir.relative, path: dir.path })),
        ].filter(
          (dest) => dest.path !== currentDir && !isInsidePath(dest.path, path),
        ),
      );
    } catch (error) {
      setActionError(String(error));
      setDestinations([]);
    }
  }

  async function moveFile(file: NoteFile, dest: FolderEntry) {
    setActionError(null);
    setBusyId(file.id);
    try {
      if (file.kind !== "image") await onBeforeFileAction?.(file.id);

      const newPath = await invoke<string>("move_vault_file", {
        from: file.id,
        toDir: dest.path,
      });
      clearDrag();
      closeMenu();
      reload();

      if (currentId === file.id) {
        onSelect?.({ ...file, id: newPath, name: baseName(newPath), updatedAt: "ahora" });
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  function rebasePath(path: string, from: string, to: string): string {
    const relative = path.slice(from.length).replace(/^[\\/]+/, "");
    return relative ? joinPath(to, relative) : to;
  }

  async function moveFolder(folder: FolderEntry, dest: FolderEntry) {
    setActionError(null);
    setBusyId(folder.path);
    try {
      const activeInside = activeId && isInsidePath(activeId, folder.path) ? activeId : null;
      if (activeInside && !isImageName(activeInside)) {
        await onBeforeFileAction?.(activeInside);
      }

      const newPath = await invoke<string>("rename_vault_dir", {
        from: folder.path,
        to: joinPath(dest.path, folder.name),
      });

      if (activeInside) {
        const movedActivePath = rebasePath(activeInside, folder.path, newPath);
        onSelect?.({
          id: movedActivePath,
          name: baseName(movedActivePath),
          kind: isImageName(movedActivePath) ? "image" : "note",
          updatedAt: "ahora",
        });
      }
      setTrail((prev) =>
        prev.map((step) =>
          isInsidePath(step.path, folder.path)
            ? { ...step, path: rebasePath(step.path, folder.path, newPath) }
            : step,
        ),
      );
      clearDrag();
      closeMenu();
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFile(file: NoteFile) {
    setActionError(null);
    setBusyId(file.id);
    try {
      if (file.kind !== "image") await onBeforeFileAction?.(file.id);

      await invoke("move_to_trash", { path: file.id });
      closeMenu();
      if (currentId === file.id) onFileDeleted?.(file.id);
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFolder(folder: FolderEntry) {
    setActionError(null);
    setBusyId(folder.path);
    try {
      // Si la nota abierta vive dentro, se vuelca antes de mover la carpeta.
      const activeInside = activeId && isInsidePath(activeId, folder.path) ? activeId : null;
      if (activeInside) await onBeforeFileAction?.(activeInside);

      await invoke("move_to_trash", { path: folder.path });
      closeMenu();
      if (activeInside) onFileDeleted?.(activeInside);
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  const busy = busyId !== null;
  const noteCount = items.filter((file) => file.kind !== "image").length;
  const imageCount = items.length - noteCount;
  const summary =
    status === "loading"
      ? "cargando…"
      : status === "error"
        ? "error al leer"
        : [
            `${folders.length} carpeta${folders.length === 1 ? "" : "s"}`,
            `${noteCount} archivo${noteCount === 1 ? "" : "s"} .md`,
            imageCount > 0 ? `${imageCount} imagen${imageCount === 1 ? "" : "es"}` : "",
          ]
            .filter(Boolean)
            .join(" · ");

  const menuButtonClass =
    "relative z-10 mr-1 shrink-0 rounded-md p-1 text-gus-muted opacity-0 transition hover:text-gus-text focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none group-hover:opacity-100";
  const menuItemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none";

  const menuFolder = menu?.kind === "folder" ? folders.find((f) => f.path === menu.id) : undefined;
  const menuFile = menu?.kind === "file" ? items.find((f) => f.id === menu.id) : undefined;
  const menuTarget = menuFolder ?? menuFile;

  return (
    <aside
      style={expanded ? undefined : { width }}
      className={clsx(
        "flex h-full shrink-0 flex-col gap-3 bg-gus-panel p-3",
        expanded ? "w-full" : "w-60 border-r border-gus-border",
      )}
    >
      <header className="flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
            Notas
          </h2>
          <p
            className="truncate text-[11px] text-gus-muted"
            title={staticMode ? "lista estática" : currentDir}
          >
            {summary}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {!staticMode && (
            <button
              type="button"
              onClick={() => void handleNewFolder()}
              disabled={busy}
              title="Nueva carpeta"
              aria-label="Nueva carpeta"
              className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleNewNote()}
            disabled={busy}
            title="Nueva nota"
            aria-label="Nueva nota"
            className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!staticMode && trail.length > 0 && (
        <nav
          aria-label="Carpeta actual"
          className="-mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[11px]"
        >
          {trail.map((folder, index) => (
            <Fragment key={folder.path}>
              {index > 0 && (
                <span aria-hidden="true" className="shrink-0 text-gus-muted/50">
                  /
                </span>
              )}
              <button
                type="button"
                onClick={() => setTrail(trail.slice(0, index + 1))}
                onDragOver={(event) => dragOverFolder(event, folder)}
                onDragLeave={() => {
                  if (dragOverPath === folder.path) setDragOverPath(null);
                }}
                onDrop={(event) => dropOnFolder(event, folder)}
                title={`${folder.path}\nTambién puedes soltar aquí para mover`}
                aria-current={index === trail.length - 1 ? "true" : undefined}
                className={clsx(
                  "min-w-0 max-w-full truncate rounded px-1 py-0.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                  dragOverPath === folder.path && "bg-gus-accent/20 text-gus-accent ring-1 ring-gus-accent/50",
                  index === trail.length - 1
                    ? "text-gus-text"
                    : "text-gus-muted hover:text-gus-text",
                )}
              >
                {folder.name}
              </button>
            </Fragment>
          ))}
        </nav>
      )}

      {actionError && (
        <p
          role="alert"
          className="flex items-start justify-between gap-2 rounded-md border border-rose-400/30 bg-rose-400/5 px-2 py-1.5 text-[11px] text-rose-300"
        >
          <span className="min-w-0 break-words">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Descartar error"
            className="shrink-0 rounded px-1 text-rose-300/70 transition-colors hover:text-rose-200 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none"
          >
            ×
          </button>
        </p>
      )}

      {menu !== null && (
        <div
          className="fixed inset-0 z-20"
          onMouseDown={closeMenu}
          onContextMenu={(event) => event.preventDefault()}
          aria-hidden="true"
        />
      )}

      <ul className="gus-scrollbar flex-1 space-y-1 overflow-y-auto pr-1">
        {folders.map((folder) => (
          <li
            key={folder.path}
            draggable={!staticMode && renamingId !== folder.path}
            onDragStart={(event) => startDrag(event, { kind: "folder", path: folder.path })}
            onDragEnd={clearDrag}
            onDragOver={(event) => dragOverFolder(event, folder)}
            onDragLeave={() => {
              if (dragOverPath === folder.path) setDragOverPath(null);
            }}
            onDrop={(event) => dropOnFolder(event, folder)}
            className={clsx(
              "group relative rounded-lg transition-opacity",
              dragEntry?.path === folder.path && "opacity-50",
              dragOverPath === folder.path && "bg-gus-accent/15 ring-1 ring-gus-accent/50",
            )}
            onContextMenu={(event) => menuFromContext(event, folder.path, "folder")}
          >
            <div className="flex items-center">
              {renamingId === folder.path ? (
                <RenameField
                  initialValue={safeFileName(folder.name)}
                  ariaLabel={`Nuevo nombre para ${folder.name}`}
                  onCommit={(value) => void commitFolderRename(folder, value)}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => enterFolder(folder)}
                  title={`${folder.path}\nArrastra para mover`}
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none active:cursor-grabbing"
                >
                  <Folder
                    className="h-4 w-4 shrink-0 text-gus-muted group-hover:text-gus-accent"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {folder.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ›
                  </span>
                </button>
              )}

              {!staticMode && (
                <button
                  type="button"
                  onClick={(event) => menuFromButton(event, folder.path, "folder")}
                  title="Opciones"
                  aria-label={`Opciones de ${folder.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.id === folder.path}
                  className={clsx(
                    menuButtonClass,
                    menu?.id === folder.path && "opacity-100",
                  )}
                >
                  <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </li>
        ))}

        <AnimatePresence initial={false}>
          {items.map((file) => {
            const isCurrent = file.id === currentId;
            const isActive = isCurrent;
            const isRenaming = renamingId === file.id;
            const isMenuOpen = menu?.id === file.id;

            return (
              <motion.li
                key={file.id}
                layout
                initial={false}
                exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
                transition={{
                  duration: 0.18,
                  ease: "easeOut",
                  layout: { type: "spring", stiffness: 500, damping: 45 },
                }}
                className={clsx(
                  "group relative rounded-lg transition-opacity",
                  dragEntry?.path === file.id && "opacity-50",
                )}
                onContextMenu={(event) => menuFromContext(event, file.id, "file")}
              >
                <div
                  className="overflow-hidden"
                  draggable={!staticMode && !isRenaming}
                  onDragStart={(event) => startDrag(event, { kind: "file", path: file.id })}
                  onDragEnd={clearDrag}
                >
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="flex items-center"
                  >
                    {isRenaming ? (
                      <RenameField
                        initialValue={safeFileName(file.name)}
                        ariaLabel={`Nuevo nombre para ${file.name}`}
                        onCommit={(value) => void commitRename(file, value)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => select(file)}
                        title={`${file.name}\nArrastra para mover`}
                        aria-current={isCurrent ? "true" : undefined}
                        className={clsx(
                          "relative flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 text-left outline-none transition-colors active:cursor-grabbing",
                          "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                          isActive
                            ? "border-transparent text-gus-text"
                            : "border-transparent text-gus-muted hover:bg-gus-card hover:text-gus-text",
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="file-active"
                            className="absolute inset-0 rounded-lg border border-gus-accent/40 bg-gus-card"
                            transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          />
                        )}
                        {file.kind === "image" ? (
                          <ImageIcon
                            className={clsx(
                              "relative h-4 w-4 shrink-0",
                              isActive ? "text-gus-accent" : "text-gus-muted",
                            )}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        ) : (
                          <FileText
                            className={clsx(
                              "relative h-4 w-4 shrink-0",
                              isActive ? "text-gus-accent" : "text-gus-muted",
                            )}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        )}
                        <span className="relative min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs">{file.name}</span>
                          <span className="block truncate text-[10px] text-gus-muted">
                            {file.kind === "image" ? "imagen" : (file.updatedAt ?? "")}
                          </span>
                        </span>
                      </button>
                    )}

                    {!staticMode && (
                      <button
                        type="button"
                        onClick={(event) => menuFromButton(event, file.id, "file")}
                        title="Opciones"
                        aria-label={`Opciones de ${file.name}`}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        className={clsx(menuButtonClass, isMenuOpen && "opacity-100")}
                      >
                        <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </motion.div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>

        {status === "loading" && (
          <li className="rounded-lg border border-dashed border-gus-border px-3 py-6 text-center text-xs text-gus-muted">
            Leyendo vault…
          </li>
        )}

        {status === "error" && (
          <li className="flex flex-col items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-3 text-xs text-rose-300">
            <span className="break-words">
              No se pudo leer <span className="font-mono">{currentDir}</span>
              {errorMessage && <span className="block text-rose-400/80">{errorMessage}</span>}
            </span>
            <button
              type="button"
              onClick={reload}
              className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Reintentar
            </button>
          </li>
        )}

        {status === "ready" && items.length === 0 && folders.length === 0 && (
          <li className="rounded-lg border border-dashed border-gus-border px-3 py-6 text-center text-xs text-gus-muted">
            Carpeta vacía. Crea una nota con{" "}
            <strong className="font-medium text-gus-text">+</strong> o agrupa con{" "}
            <strong className="font-medium text-gus-text">nueva carpeta</strong>.
          </li>
        )}
      </ul>

      {menu && menuTarget && (
        <div
          role="menu"
          aria-label={`Opciones de ${menuTarget.name}`}
          className="fixed z-30 w-52 overflow-hidden rounded-lg border border-gus-border bg-gus-card shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
        >
          {confirmId === menu.id ? (
            <div className="p-3 text-xs">
              <p className="text-gus-text">
                {menu.kind === "folder" ? "¿Mover la carpeta " : "¿Mover "}
                <span className="font-mono break-all">{menuTarget.name}</span> a la papelera?
              </p>
              <p className="mt-1 text-[11px] text-gus-muted">
                {menu.kind === "folder"
                  ? "Se irá con TODO su contenido a ~/gus-vault/.gus-trash; se puede restaurar desde el menú lateral."
                  : "Se moverá a la papelera de Gus (~/gus-vault/.gus-trash); se puede restaurar desde el menú lateral."}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (menuFolder) void deleteFolder(menuFolder);
                    else if (menuFile) void deleteFile(menuFile);
                  }}
                  disabled={busy}
                  className="rounded-md border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-300 transition-colors hover:bg-rose-400/20 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none disabled:opacity-50"
                >
                  Mover a la papelera
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="rounded-md border border-gus-border px-2 py-1 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : movingId === menu.id && menuTarget ? (
            <div>
              <p className="border-b border-gus-border px-3 py-2 text-[10px] tracking-wider text-gus-muted uppercase">
                Mover {menu.kind === "folder" ? "carpeta" : "archivo"} a…
              </p>
              <ul className="gus-scrollbar max-h-44 overflow-y-auto py-1">
                {destinations === null && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">Cargando carpetas…</li>
                )}
                {destinations?.length === 0 && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">
                    No hay carpetas de destino disponibles.
                  </li>
                )}
                {destinations?.map((dest) => (
                  <li key={dest.path}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (menuFolder) void moveFolder(menuFolder, dest);
                        else if (menuFile) void moveFile(menuFile, dest);
                      }}
                      disabled={busy}
                      title={dest.path}
                      className={clsx(
                        menuItemClass,
                        "text-gus-muted hover:bg-gus-panel hover:text-gus-text disabled:opacity-50",
                      )}
                    >
                      <Folder
                        className="h-3.5 w-3.5 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{dest.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setMovingId(null);
                  setDestinations(null);
                }}
                className={clsx(
                  menuItemClass,
                  "w-full border-t border-gus-border text-gus-muted hover:text-gus-text",
                )}
              >
                ← Volver
              </button>
            </div>
          ) : menuFolder ? (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => startRename(menu.id)}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                Renombrar
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void startMove(menuFolder.path)}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                Mover a…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmId(menu.id)}
                className={clsx(
                  menuItemClass,
                  "border-t border-gus-border text-rose-300 hover:bg-rose-400/10",
                )}
              >
                Eliminar…
              </button>
            </div>
          ) : menuFile ? (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => startRename(menu.id)}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                Renombrar
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void startMove(menuFile.id)}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                Mover a…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirmId(menu.id)}
                className={clsx(
                  menuItemClass,
                  "border-t border-gus-border text-rose-300 hover:bg-rose-400/10",
                )}
              >
                Eliminar…
              </button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
