import {
  Fragment,
  useEffect,
  useRef,
  useState,
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
  /** Nombre del archivo, con extensión. */
  name: string;
  /** "note" = .md abrible en el editor; "image" = visible en el visor. */
  kind?: "note" | "image";
  updatedAt?: string;
}

export interface FileExplorerProps {
  /** Directorio a leer vía `list_vault_entries`. Por defecto `~/gus-vault`. */
  vaultPath?: string;
  /** Lista estática: si se pasa, no se llama a Rust (útil para pruebas/previsualización). */
  files?: NoteFile[];
  /** Nota activa controlada por el padre (opcional). */
  activeId?: string | null;
  /** Se dispara al seleccionar una nota (incluida la recién creada). */
  onSelect?: (file: NoteFile) => void;
  /** Se dispara con la lista completa cuando cambia (solo modo estático). */
  onFilesChange?: (files: NoteFile[]) => void;
  /** Cambia para forzar la recarga (p. ej. tras renombrar una nota). */
  refreshKey?: number;
  /** Se dispara al borrar la nota activa, para que el padre cierre el editor. */
  onFileDeleted?: (path: string) => void;
  /**
   * Se *awaitea* antes de renombrar/mover/borrar: el padre aprovecha para
   * volcar cambios pendientes mientras el archivo aún existe en la ruta vieja.
   */
  onBeforeFileAction?: (path: string) => void | Promise<void>;
}

/** Entrada del comando `list_vault_entries` (carpeta, .md o imagen). */
interface VaultEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms: number | null;
}

/** Carpeta devuelta por `list_vault_dirs` (destino al mover). */
interface VaultDir {
  path: string;
  relative: string;
}

interface FolderEntry {
  name: string;
  path: string;
}

/** Menú contextual abierto y su posición (en coordenadas de pantalla). */
interface MenuState {
  id: string;
  kind: "file" | "folder";
  x: number;
  y: number;
}

/** Visor de imagen: data URL en `src` mientras carga, `error` si falla. */
interface PreviewState {
  path: string;
  name: string;
  src: string | null;
  error: string | null;
}

const DEFAULT_VAULT_PATH = "~/gus-vault";

/** Tamaño del menú (w-52) usado para mantenerlo dentro de la ventana. */
const MENU_WIDTH = 208;
const MENU_MAX_HEIGHT = 280;

const RENAME_INPUT_CLASS =
  "min-w-0 flex-1 rounded-lg border border-gus-accent/50 bg-gus-card px-2 py-1.5 font-mono text-xs text-gus-text outline-none focus:ring-2 focus:ring-gus-accent/60";

/** `modified_ms` → etiqueta corta: "ahora", "hace 2 h", "hace 3 d", "12 sep". */
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

/** Etiqueta para la raíz del vault: su último segmento (`gus-vault`). */
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

/** Input inline de renombrar: Enter guarda, Esc cancela, al salir guarda. */
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
  vaultPath = DEFAULT_VAULT_PATH,
  files,
  activeId,
  onSelect,
  onFilesChange,
  refreshKey = 0,
  onFileDeleted,
  onBeforeFileAction,
}: FileExplorerProps) {
  const staticMode = files !== undefined;

  /** Carpeta actual = último elemento de la migaja de pan (breadcrumb). */
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

  // Menú contextual compartido por archivos y carpetas (⋮ o clic derecho).
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  /** `null` = aún cargando los destinos; lista vacía = sin carpetas. */
  const [destinations, setDestinations] = useState<FolderEntry[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Visor de imágenes (lightbox a pantalla completa). */
  const [preview, setPreview] = useState<PreviewState | null>(null);

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

  /** Abre el menú anclado a un botón ⋮ (posición del rectángulo). */
  function menuFromButton(
    event: ReactMouseEvent<HTMLButtonElement>,
    id: string,
    kind: "file" | "folder",
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(id, kind, rect.left, rect.bottom + 4);
  }

  /** Abre el menú bajo el cursor del clic derecho. */
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

  /** Abre el campo de renombrar de la entrada (archivo o carpeta). */
  function startRename(id: string) {
    setMenu(null);
    setConfirmId(null);
    setMovingId(null);
    setDestinations(null);
    setRenamingId(id);
  }

  // Cambiar de vault vuelve a empezar en la raíz.
  useEffect(() => {
    setTrail([{ name: rootLabel(vaultPath), path: vaultPath }]);
    setMenu(null);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);

  // Escape cierra el menú y el visor de imágenes.
  useEffect(() => {
    if (!menu && !preview) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenu(null);
      setPreview(null);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, preview]);

  // Carga carpetas, .md e imágenes reales (se omite en modo estático).
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

  // ------------------------------------------------------------------
  // Selección e imágenes
  // ------------------------------------------------------------------

  function select(file: NoteFile) {
    setSelectedId(file.id);
    if (file.kind === "image") {
      openPreview(file);
      return;
    }
    onSelect?.(file);
  }

  /** Carga los bytes de la imagen como data URL (solo el último clic gana). */
  function openPreview(file: NoteFile) {
    const path = file.id;
    setPreview({ path, name: file.name, src: null, error: null });

    invoke<string>("read_vault_image", { path })
      .then((src) => setPreview((prev) => (prev?.path === path ? { ...prev, src } : prev)))
      .catch((error: unknown) =>
        setPreview((prev) => (prev?.path === path ? { ...prev, error: String(error) } : prev)),
      );
  }

  /** Sigue a la entrada cuando rename/move le cambian la ruta. */
  function trackPathChange(from: string, to: string, toName: string) {
    setPreview((prev) => (prev?.path === from ? { ...prev, path: to, name: toName } : prev));
  }

  function enterFolder(folder: FolderEntry) {
    closeMenu();
    setTrail((prev) => [...prev, folder]);
  }

  // ------------------------------------------------------------------
  // Crear
  // ------------------------------------------------------------------

  async function handleNewNote() {
    // Modo estático: solo en memoria (pruebas / previsualización).
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
      // Rust decide el nombre final (nunca pisa un archivo existente).
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

  // ------------------------------------------------------------------
  // Renombrar
  // ------------------------------------------------------------------

  async function commitRename(file: NoteFile, rawValue: string) {
    setRenamingId(null);

    const kind = file.kind === "image" ? "image" : "note";
    const target = renameTarget(file.id, rawValue, kind);
    if (target === file.id) return; // sin cambios

    setActionError(null);
    setBusyId(file.id);
    try {
      // Solo las notas .md tienen ediciones pendientes que volcar.
      if (kind === "note") await onBeforeFileAction?.(file.id);

      const newPath = await invoke<string>("rename_vault_file", {
        from: file.id,
        to: target,
      });
      const finalName = baseName(newPath);
      trackPathChange(file.id, newPath, finalName);
      closeMenu();
      reload();

      // Si era la nota abierta, avisar al padre para que actualice la ruta.
      // (Las imágenes no viven en el editor: se ignora a propósito.)
      if (kind === "note" && currentId === file.id) {
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
      // Si la carpeta renombrada está en la ruta abierta, hay que seguirla.
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

  // ------------------------------------------------------------------
  // Mover (solo archivos .md)
  // ------------------------------------------------------------------

  async function startMove(file: NoteFile) {
    setMovingId(file.id);
    setDestinations(null);
    setConfirmId(null);
    setActionError(null);

    try {
      const dirs = await invoke<VaultDir[]>("list_vault_dirs", { path: rootDir.path });
      setDestinations([
        { name: rootDir.name, path: rootDir.path },
        ...dirs.map((dir) => ({ name: dir.relative, path: dir.path })),
      ].filter((dest) => dest.path !== currentDir));
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
        to_dir: dest.path,
      });
      trackPathChange(file.id, newPath, baseName(newPath));
      closeMenu();
      reload();

      if (file.kind !== "image" && currentId === file.id) {
        onSelect?.({ ...file, id: newPath, name: baseName(newPath), updatedAt: "ahora" });
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  // ------------------------------------------------------------------
  // Eliminar
  // ------------------------------------------------------------------

  async function deleteFile(file: NoteFile) {
    setActionError(null);
    setBusyId(file.id);
    try {
      if (file.kind !== "image") await onBeforeFileAction?.(file.id);

      await invoke("delete_vault_file", { path: file.id });
      closeMenu();
      setPreview((prev) => (prev?.path === file.id ? null : prev));
      if (file.kind !== "image" && currentId === file.id) onFileDeleted?.(file.id);
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
      await invoke("delete_vault_dir", { path: folder.path });
      closeMenu();
      // El visor mostraba una imagen de dentro: ya no existe.
      setPreview((prev) =>
        prev && isInsidePath(prev.path, folder.path) ? null : prev,
      );
      reload();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  // ------------------------------------------------------------------
  // Derivados y clases
  // ------------------------------------------------------------------

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

  // Objetos del menú abierto (carpeta y archivo comparten id-único = ruta).
  const menuFolder = menu?.kind === "folder" ? folders.find((f) => f.path === menu.id) : undefined;
  const menuFile = menu?.kind === "file" ? items.find((f) => f.id === menu.id) : undefined;
  const menuTarget = menuFolder ?? menuFile;

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-3 border-r border-gus-border bg-gus-panel p-3">
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

      {/* Ruta actual: raíz / carpeta1 / carpeta2 */}
      {!staticMode && trail.length > 0 && (
        <nav
          aria-label="Carpeta actual"
          className="gus-scrollbar -mt-1 flex items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[11px]"
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
                aria-current={index === trail.length - 1 ? "true" : undefined}
                className={clsx(
                  "shrink-0 rounded px-1 py-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
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

      {/* Cierra el menú al hacer clic (o clic derecho) fuera de él. */}
      {menu !== null && (
        <div
          className="fixed inset-0 z-20"
          onMouseDown={closeMenu}
          onContextMenu={(event) => event.preventDefault()}
          aria-hidden="true"
        />
      )}

      <ul className="gus-scrollbar flex-1 space-y-1 overflow-y-auto pr-1">
        {/* Carpetas: clic = entrar, ⋮ / clic derecho = opciones. */}
        {folders.map((folder) => (
          <li
            key={folder.path}
            className="group relative"
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
                  title={folder.path}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
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

        {/* Archivos .md e imágenes. */}
        <AnimatePresence initial={false}>
          {items.map((file) => {
            const isCurrent = file.id === currentId;
            const isPreviewing = preview?.path === file.id;
            const isActive = isCurrent || isPreviewing;
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
                className="group relative"
                onContextMenu={(event) => menuFromContext(event, file.id, "file")}
              >
                {/* El clip vive aquí para que el menú pueda sobresalir. */}
                <div className="overflow-hidden">
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
                        aria-current={isCurrent ? "true" : undefined}
                        className={clsx(
                          "relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors outline-none",
                          "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                          isActive
                            ? "border-transparent text-gus-text"
                            : "border-transparent text-gus-muted hover:bg-gus-card hover:text-gus-text",
                        )}
                      >
                        {isActive &&
                          (isCurrent ? (
                            <motion.span
                              layoutId="file-active"
                              className="absolute inset-0 rounded-lg border border-gus-accent/40 bg-gus-card"
                              transition={{ type: "spring", stiffness: 500, damping: 40 }}
                            />
                          ) : (
                            // Previsualizando esta imagen con otra nota abierta:
                            // mismo resaltado pero sin layoutId duplicado.
                            <span
                              aria-hidden="true"
                              className="absolute inset-0 rounded-lg border border-gus-accent/40 bg-gus-card"
                            />
                          ))}
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

      {/* Menú contextual ( ⋮ o clic derecho ), fijo en pantalla. */}
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
                {menu.kind === "folder" ? "¿Eliminar la carpeta " : "¿Eliminar "}
                <span className="font-mono break-all">{menuTarget.name}</span>?
              </p>
              <p className="mt-1 text-[11px] text-gus-muted">
                {menu.kind === "folder"
                  ? "Se borrará del disco con TODO su contenido y no se puede deshacer."
                  : "Se borra del disco y no se puede deshacer."}
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
                  Eliminar
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
          ) : menuFolder ? (
            /* ------------------------- carpeta ------------------------- */
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
                onClick={() => setConfirmId(menu.id)}
                className={clsx(
                  menuItemClass,
                  "border-t border-gus-border text-rose-300 hover:bg-rose-400/10",
                )}
              >
                Eliminar…
              </button>
            </div>
          ) : menuFile && movingId === menu.id ? (
            /* ------------------ archivo: mover a… ------------------ */
            <div>
              <p className="border-b border-gus-border px-3 py-2 text-[10px] tracking-wider text-gus-muted uppercase">
                Mover a…
              </p>
              <ul className="gus-scrollbar max-h-44 overflow-y-auto py-1">
                {destinations === null && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">Cargando carpetas…</li>
                )}
                {destinations?.length === 0 && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">
                    Sin otras carpetas todavía.
                  </li>
                )}
                {destinations?.map((dest) => (
                  <li key={dest.path}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void moveFile(menuFile, dest)}
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
          ) : menuFile ? (
            /* ------------------------- archivo ------------------------- */
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
                onClick={() => void startMove(menuFile)}
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

      {/* Visor de imágenes (lightbox): clic o Esc para cerrar. */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${preview.name}`}
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/85 p-6"
        >
          <div className="flex max-h-full w-full max-w-3xl flex-col items-center gap-3">
            <div className="flex w-full items-center justify-between gap-3 text-xs text-white/70">
              <span className="truncate font-mono">{preview.name}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="shrink-0 rounded-md border border-white/20 px-2 py-1 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                Cerrar · Esc
              </button>
            </div>

            {preview.src ? (
              <img
                src={preview.src}
                alt={preview.name}
                className="max-h-[70vh] max-w-full rounded-lg border border-white/10 object-contain"
              />
            ) : preview.error ? (
              <p className="max-w-md text-center text-sm break-words text-rose-300">
                {preview.error}
              </p>
            ) : (
              <p className="text-sm text-white/60">Cargando imagen…</p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
