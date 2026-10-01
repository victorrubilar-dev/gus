import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Import as ImportIcon,
  Plus,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { toLocalCoord } from "../lib/uiZoom";
import {
  baseName,
  isImageName,
  isInsidePath,
  isPdfName,
  joinPath,
  parentPath,
  renameTarget,
  safeFileName,
} from "../lib/fileName";
import { useT } from "../lib/i18n";
import {
  comboFor,
  comboLabel,
  explorerShortcutFor,
  type ShortcutMap,
} from "../lib/shortcuts";
import {
  importFilters,
  importFilesIntoVault,
  relativeFolderLabel,
  summarizeImport,
} from "../lib/importFiles";

export interface NoteFile {
  id: string;
  name: string;
  kind?: "note" | "image" | "pdf";
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
  width?: number;
  onBeforeFileAction?: (path: string) => void | Promise<void>;
  /** Exporta la nota a PDF (la abre en el editor con el diálogo listo). */
  onExportPdf?: (file: NoteFile) => void;
  /** Atajos vigentes: solo para los textos de ayuda de la barra de ruta. */
  shortcuts?: ShortcutMap;
}

/** Acciones imperativas que el explorador expone a la app (botón de bienvenida). */
export interface FileExplorerHandle {
  /** Crea una nota en la carpeta actual y la abre. */
  newNote: () => void;
  /** Carpeta que se está viendo: destino por defecto al arrastrar archivos. */
  currentDir: () => string;
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

/** Ruta actual más el historial que alimenta los botones «atrás»/«adelante». */
interface TrailState {
  /** Carpetas desde la raíz hasta la que estás viendo. */
  trail: FolderEntry[];
  /** Pasos anteriores (pila de «atrás»), el último es el inmediatamente previo. */
  past: FolderEntry[][];
  /** Pasos deshechos al retroceder (pila de «adelante»). */
  future: FolderEntry[][];
}

/** Un tramo de la ruta con su posición real, para cortarla ahí donde se pulsa. */
interface TrailPart {
  folder: FolderEntry;
  index: number;
}

interface MenuState {
  /** `""` cuando el menú es el de la lista (no apunta a ninguna entrada). */
  id: string;
  kind: "file" | "folder" | "panel";
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
/** Altura real del menú de la lista: solo 4 filas, sin reservar como el de fila. */
const PANEL_MENU_HEIGHT = 120;

/** Pasos de historial que se conservan para «atrás»/«adelante». */
const TRAIL_HISTORY_LIMIT = 50;

const TRAIL_BUTTON_CLASS =
  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

/** `shrink-0` es clave: si algo no cabe, la barra prefiere ocultar tramos antes que encogerlos. */
const TRAIL_SEGMENT_CLASS =
  "min-w-0 max-w-full shrink-0 truncate rounded px-1 py-0.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none";

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
    kind: isImageName(entry.name) ? "image" : isPdfName(entry.name) ? "pdf" : "note",
    updatedAt: formatModified(entry.modified_ms),
  };
}

function rootLabel(vaultPath: string): string {
  return baseName(vaultPath.replace(/[\\/]+$/, "")) || vaultPath || "vault";
}

function TrailSeparator() {
  return (
    <span aria-hidden="true" className="shrink-0 text-gus-muted/60">
      ›
    </span>
  );
}

/**
 * Reparte la ruta en tramos visibles y ocultos (el «…»), de más a menos detalle:
 * todo → raíz, penúltimo y actual → raíz y actual → penúltimo y actual → solo la
 * actual. `level` decide cuánto se colapsa y lo sube la medición del ancho real de
 * la barra, así la ruta siempre cabe en una línea pase lo que pase con el ancho.
 */
function splitTrail(trail: FolderEntry[], level: number): {
  visible: TrailPart[];
  hidden: TrailPart[];
  maxLevel: number;
} {
  const parts = trail.map((folder, index) => ({ folder, index }));
  const last = parts.length - 1;

  if (parts.length < 2) return { visible: parts, hidden: [], maxLevel: 0 };

  const combos: number[][] = [
    parts.map((part) => part.index),
    ...(parts.length >= 3 ? [[0, last - 1, last]] : []),
    [0, last],
    ...(parts.length >= 3 ? [[last - 1, last]] : []),
    [last],
  ];
  // Sin repetidos: con pocas carpetas varias opciones coinciden y solo harían parpadear la barra.
  const distinct = combos.filter(
    (combo, index, all) => all.findIndex((other) => other.join(",") === combo.join(",")) === index,
  );

  const chosen = distinct[Math.min(level, distinct.length - 1)];
  const visible = chosen.map((index) => parts[index]);
  const hidden = parts.filter((part) => !chosen.includes(part.index));

  return { visible, hidden, maxLevel: distinct.length - 1 };
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

const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(function FileExplorer(
  {
    vaultPath,
    files,
    activeId,
    onSelect,
    onFilesChange,
    refreshKey = 0,
    onFileDeleted,
    onBeforeFileAction,
    onExportPdf,
    width,
    shortcuts,
  },
  ref,
) {
  const t = useT();
  const staticMode = files !== undefined;
  /** Combinaciones vigentes, para los textos de ayuda de los botones de la ruta. */
  const backCombo = comboLabel(comboFor(shortcuts, "back")) || "Alt+←";
  const forwardCombo = comboLabel(comboFor(shortcuts, "forward")) || "Alt+→";

  /** El botón «Nueva nota» de la pantalla de bienvenida hace lo mismo que «+». */
  useImperativeHandle(ref, () => ({
    newNote: () => void handleNewNote(),
    currentDir: () => currentDir,
  }));

  const [nav, setNav] = useState<TrailState>(() => ({
    trail: [{ name: rootLabel(vaultPath), path: vaultPath }],
    past: [],
    future: [],
  }));
  const trail = nav.trail;
  /** Clave de la ruta: al cambiarla la barra vuelve a intentar mostrarla entera. */
  const trailKey = trail.map((step) => step.path).join("\n");
  const currentDir = trail[trail.length - 1].path;
  const rootDir = trail[0];

  const [items, setItems] = useState<NoteFile[]>(() => (files ? [...files] : []));
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    staticMode ? "ready" : "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Aviso del resultado de «Añadir archivos»: se apaga solo a los pocos segundos. */
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => activeId ?? files?.[0]?.id ?? null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [trailMenuOpen, setTrailMenuOpen] = useState(false);
  /** Nivel de colapso de la ruta, dictado por la medición del ancho (ver efecto). */
  const [collapse, setCollapse] = useState({ key: "", level: 0 });
  /** Ancho medido de la barra: cambia al redimensionar el explorador. */
  const [boxWidth, setBoxWidth] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<FolderEntry[] | null>(null);
  const [dragEntry, setDragEntry] = useState<DragEntry | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Handler más reciente de Supr: el listener de window se engancha una sola vez. */
  const deleteKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  /** Botones del confirm de papelera: tener el foco en uno es la opción marcada. */
  const confirmTrashRef = useRef<HTMLButtonElement | null>(null);
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  /** Raíz de la lista de filas: para anclar el menú a la fila bajo el teclado. */
  const listRef = useRef<HTMLUListElement | null>(null);
  /** Barra de ruta: mide su ancho para decidir cuántos tramos mostrar. */
  const trailRef = useRef<HTMLDivElement | null>(null);
  /** Temporizador del aviso de importación. */
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  function reload() {
    setReloadKey((key) => key + 1);
  }

  function showNotice(message: string, ok: boolean) {
    setNotice(message);
    setNoticeOk(ok);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 8000);
  }

  function closeMenu() {
    setMenu(null);
    setRenamingId(null);
    setConfirmId(null);
    setMovingId(null);
    setDestinations(null);
  }

  function menuFromContext(
    event: ReactMouseEvent<HTMLElement>,
    id: string,
    kind: "file" | "folder",
  ) {
    event.preventDefault();
    openMenu(id, kind, event.clientX, event.clientY);
  }

  /**
   * Clic derecho en la lista pero fuera de las filas (huecos, mensaje de carpeta
   * vacía): menú de la carpeta actual. Las filas tienen el suyo y se saltan este.
   */
  function panelFromContext(event: ReactMouseEvent<HTMLUListElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-entry-id]")) return;

    event.preventDefault();
    if (staticMode) return;

    openMenu("", "panel", event.clientX, event.clientY);
  }

  function openMenu(id: string, kind: MenuState["kind"], x: number, y: number) {
    const localX = toLocalCoord(x);
    const localY = toLocalCoord(y);
    const maxHeight = kind === "panel" ? PANEL_MENU_HEIGHT : MENU_MAX_HEIGHT;
    const left = Math.min(Math.max(8, localX), toLocalCoord(window.innerWidth) - MENU_WIDTH - 8);
    const top = Math.min(Math.max(8, localY), toLocalCoord(window.innerHeight) - maxHeight - 8);

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
    setNav({
      trail: [{ name: rootLabel(vaultPath), path: vaultPath }],
      past: [],
      future: [],
    });
    setTrailMenuOpen(false);
    setMenu(null);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath]);

  useEffect(() => {
    if (!menu && !trailMenuOpen) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenu(null);
      setTrailMenuOpen(false);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, trailMenuOpen]);

  // El desplegable «…» de la ruta se cierra al pulsar fuera de él.
  useEffect(() => {
    if (!trailMenuOpen) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-trail-menu]")) return;
      setTrailMenuOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [trailMenuOpen]);

  /**
   * Recorrer el historial y subir al padre con los atajos configurados. Se saltan
   * los campos de texto porque el editor ya usa Alt+↑/↓ para mover líneas.
   */
  useEffect(() => {
    if (staticMode) return;

    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable], [role='separator']")
      ) {
        return;
      }

      const id = explorerShortcutFor(event, shortcuts);
      if (!id) return;

      event.preventDefault();
      if (id === "back") goBack();
      else if (id === "forward") goForward();
      else if (id === "parentFolder") goUp();
      else if (id === "newNote") void handleNewNote();
      else if (id === "newFolder") void handleNewFolder();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticMode, shortcuts]);

  // El manejador siempre refleja el último render (menú, confirmación y props vivos).
  useEffect(() => {
    deleteKeyRef.current = handleDeleteKey;
  });

  /** Localiza la fila en el DOM para anclar el menú en la posición del teclado. */
  function findRowElement(id: string): HTMLElement | null {
    for (const row of listRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? []) {
      if (row.dataset.entryId === id) return row;
    }
    return null;
  }

  /**
   * Supr: borra el archivo o carpeta resaltado en dos pasos — la primera pulsación
   * abre el confirm del menú anclado a la fila; la segunda lo mueve a la papelera.
   */
  function handleDeleteKey(event: KeyboardEvent) {
    if (event.key !== "Delete" || event.repeat || event.defaultPrevented) return;
    if (staticMode || busy) return;

    // No interceptar teclas dentro de campos (renombrado, editor, paleta…).
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable]")
    ) {
      return;
    }

    // Paso 2: el confirm está abierto → otra vez Supr activa lo marcado. Por
    // defecto el foco está en «Mover a la papelera», así que el pulso de
    // siempre (Supr, Supr) sigue borrando; si las flechas han ido a «Cancelar»,
    // Supr cancela, igual que haría Intro.
    if (menu && confirmId === menu.id) {
      event.preventDefault();
      if (document.activeElement === confirmCancelRef.current) {
        setConfirmId(null);
        return;
      }
      if (menuFolder) void deleteFolder(menuFolder);
      else if (menuFile) void deleteFile(menuFile);
      return;
    }

    // Con el menú ya abierto, Supr marca «Eliminar…» en ese mismo menú.
    if (menu) {
      event.preventDefault();
      setConfirmId(menu.id);
      return;
    }

    // Destino: la fila bajo el evento o, en su defecto, la resaltada.
    const row = target instanceof Element ? target.closest<HTMLElement>("[data-entry-id]") : null;
    let id: string | null = row ? (row.dataset.entryId ?? null) : currentId;
    let kind: "file" | "folder" | null = null;

    if (row) kind = row.dataset.entryKind === "folder" ? "folder" : "file";
    if (!id) return;
    if (!kind) {
      if (items.some((file) => file.id === id)) kind = "file";
      else if (folders.some((folder) => folder.path === id)) kind = "folder";
      else return;
    }

    const element = findRowElement(id);
    if (!element) return;

    event.preventDefault();
    const rect = element.getBoundingClientRect();
    openMenu(id, kind, rect.left, rect.bottom + 4);
    setConfirmId(id);
  }

  useEffect(() => {
    if (staticMode) return;

    function onKey(event: KeyboardEvent) {
      deleteKeyRef.current(event);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [staticMode]);

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
    navigateTo([...trail, folder]);
  }

  /** Cambia de carpeta guardando el paso anterior: habilita «atrás» y limpia «adelante». */
  function navigateTo(next: FolderEntry[]) {
    setTrailMenuOpen(false);
    setNav((prev) => {
      const unchanged =
        prev.trail.length === next.length &&
        prev.trail.every((step, index) => step.path === next[index].path);
      if (unchanged) return prev;

      return {
        trail: next,
        past: [...prev.past, prev.trail].slice(-TRAIL_HISTORY_LIMIT),
        future: [],
      };
    });
  }

  /** Un paso atrás en el historial (Alt+←). */
  function goBack() {
    setTrailMenuOpen(false);
    setNav((prev) => {
      const previous = prev.past[prev.past.length - 1];
      if (!previous) return prev;

      return {
        trail: previous,
        past: prev.past.slice(0, -1),
        future: [...prev.future, prev.trail].slice(-TRAIL_HISTORY_LIMIT),
      };
    });
  }

  /** Un paso adelante, lo que se deshizo al retroceder (Alt+→). */
  function goForward() {
    setTrailMenuOpen(false);
    setNav((prev) => {
      const next = prev.future[prev.future.length - 1];
      if (!next) return prev;

      return {
        trail: next,
        past: [...prev.past, prev.trail].slice(-TRAIL_HISTORY_LIMIT),
        future: prev.future.slice(0, -1),
      };
    });
  }

  /** Sube a la carpeta padre (Alt+↑). */
  function goUp() {
    setTrailMenuOpen(false);
    setNav((prev) => {
      if (prev.trail.length < 2) return prev;

      return {
        trail: prev.trail.slice(0, -1),
        past: [...prev.past, prev.trail].slice(-TRAIL_HISTORY_LIMIT),
        future: [],
      };
    });
  }

  /**
   * Reescribe la ruta tras renombrar o mover carpetas. No crea un paso de historial,
   * pero sí corrige los guardados, para que «atrás» no apunte a rutas ya inexistentes.
   */
  function rewriteTrail(mapTrail: (trail: FolderEntry[]) => FolderEntry[]) {
    setNav((prev) => ({
      trail: mapTrail(prev.trail),
      past: prev.past.map(mapTrail),
      future: prev.future.map(mapTrail),
    }));
  }

  /**
   * Copia archivos del equipo a la carpeta que se está viendo y refresca la lista.
   * Es lo que hace el botón «Añadir archivos»; el arrastre desde el explorador
   * del sistema lo gestiona la app, que ya sabe dónde quiere meterlos.
   */
  async function importFiles(paths: string[]) {
    if (staticMode || paths.length === 0) return;

    setActionError(null);
    setBusyId("__import__");
    try {
      const items = await importFilesIntoVault(paths, currentDir);
      const summary = summarizeImport(items, relativeFolderLabel(currentDir, vaultPath));
      showNotice(summary.message, summary.ok);
      reload();
    } catch (error: unknown) {
      setActionError(String(error));
    } finally {
      setBusyId(null);
    }
  }

  /** Botón «Añadir archivos»: diálogo del sistema y de ahí a la carpeta actual. */
  async function handleImportFiles() {
    if (staticMode || busy) return;

    try {
      const picked = await open({
        directory: false,
        multiple: true,
        title: t("explorer.addFiles"),
        filters: importFilters(),
      });
      if (!picked) return;

      await importFiles(typeof picked === "string" ? [picked] : picked);
    } catch (error: unknown) {
      setActionError(String(error));
    }
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

    const kind = file.kind === "image" || file.kind === "pdf" ? file.kind : "note";
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
      rewriteTrail((prev) =>
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
      if (file.kind !== "image" && file.kind !== "pdf") await onBeforeFileAction?.(file.id);

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
      if (activeInside && !isImageName(activeInside) && !isPdfName(activeInside)) {
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
          kind: isImageName(movedActivePath) ? "image" : isPdfName(movedActivePath) ? "pdf" : "note",
          updatedAt: "ahora",
        });
      }
      rewriteTrail((prev) =>
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
      if (file.kind !== "image" && file.kind !== "pdf") await onBeforeFileAction?.(file.id);

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
  const noteCount = items.filter((file) => file.kind !== "image" && file.kind !== "pdf").length;
  const imageCount = items.length - noteCount;
  const summary =
    status === "loading"
      ? t("common.loading")
      : status === "error"
        ? t("explorer.readError")
        : [
            t("explorer.folderCount", { count: folders.length }),
            t("explorer.noteCount", { count: noteCount }),
            imageCount > 0 ? t("explorer.images", { count: imageCount }) : "",
          ]
            .filter(Boolean)
            .join(" · ");

  const menuItemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none";

  const collapseLevel = collapse.key === trailKey ? collapse.level : 0;
  const { visible: trailParts, hidden: hiddenParts, maxLevel } = splitTrail(trail, collapseLevel);

  /** Si la raíz quedó fuera, el «…» abre la fila («… › carpeta actual»); si no, va tras la raíz. */
  const abreConEllipsis = hiddenParts.length > 0 && !trailParts.some((part) => part.index === 0);

  const ellipsisButton = (
    <button
      type="button"
      onClick={() => setTrailMenuOpen((open) => !open)}
      aria-haspopup="menu"
      aria-expanded={trailMenuOpen}
      aria-label={t("explorer.hiddenFolders", { count: hiddenParts.length })}
      title={t("explorer.trailEarlier")}
      className={clsx(
        "shrink-0 rounded px-0.5 py-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
        trailMenuOpen ? "text-gus-accent" : "text-gus-muted hover:text-gus-text",
      )}
    >
      …
    </button>
  );

  /**
   * La barra mide su ancho real: si los tramos visibles no caben, se oculta alguno
   * —nunca se encogen todos juntos, que era lo que se veía tosco—. Al cambiar de
   * carpeta o de ancho de explorador se vuelve a intentar con la ruta entera.
   */
  useLayoutEffect(() => {
    const box = trailRef.current;
    if (!box) return;

    // Solo falta sitio: se oculta un tramo más (nunca se encogen todos juntos).
    if (box.scrollWidth > box.clientWidth + 1 && collapseLevel < maxLevel) {
      setCollapse({ key: trailKey, level: collapseLevel + 1 });
    }

    let ancho = box.clientWidth;
    const observer = new ResizeObserver(() => {
      // El primer disparo no es un cambio real; después, con otro ancho se
      // vuelve a intentar con la ruta entera y la medición de arriba repliega.
      if (box.clientWidth === ancho) return;
      ancho = box.clientWidth;
      setBoxWidth(box.clientWidth);
      setCollapse({ key: trailKey, level: 0 });
    });
    observer.observe(box);

    return () => observer.disconnect();
  }, [trailKey, collapseLevel, maxLevel, boxWidth]);

  const menuFolder = menu?.kind === "folder" ? folders.find((f) => f.path === menu.id) : undefined;
  const menuFile = menu?.kind === "file" ? items.find((f) => f.id === menu.id) : undefined;
  const menuTarget = menuFolder ?? menuFile;

  /** El menú está mostrando el confirm de borrado (la pregunta de la papelera). */
  const confirmOpen = menu !== null && confirmId === menu.id && menuTarget !== null;

  // Al abrir el confirm el foco cae en «Mover a la papelera»: es la opción que
  // siempre ha confirmado Supr y por la que parten las flechas.
  useEffect(() => {
    if (!confirmOpen) return;
    confirmTrashRef.current?.focus();
  }, [confirmOpen]);

  /**
   * El confirm se recorre con el teclado: las flechas alternan entre las dos
   * opciones (y devuelven el foco al diálogo si se había ido) e Intro activa lo
   * marcado. Si el foco está fuera, Intro solo lo vuelve a traer.
   */
  useEffect(() => {
    if (!confirmOpen) return;

    function onKey(event: KeyboardEvent) {
      const flecha =
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight";
      if (!flecha && event.key !== "Enter") return;
      if (event.repeat || event.defaultPrevented) return;
      // Alt+←/→ es el historial de carpetas y Ctrl/Cmd+Intro otros diálogos.
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Nada de flechas sobre campos de texto ni dentro de otro diálogo (paleta,
      // tarea nueva…) aunque el confirm siga abierto detrás.
      if (target.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;

      const trash = confirmTrashRef.current;
      const cancel = confirmCancelRef.current;
      if (!trash || !cancel) return;

      const activo = document.activeElement;
      const dentro = activo === trash || activo === cancel;

      if (flecha) {
        event.preventDefault();
        if (!dentro) {
          // El foco se había ido (p. ej. clic en el texto del diálogo): la
          // primera flecha entra por la opción que toca según el sentido.
          if (event.key === "ArrowUp" || event.key === "ArrowLeft") trash.focus();
          else cancel.focus();
          return;
        }
        // Dos opciones: cualquier flecha pasa a la otra.
        if (activo === trash) cancel.focus();
        else trash.focus();
        return;
      }

      // Intro: con el foco en el confirm la recoge el propio botón (el clic
      // nativo); estando fuera, la primera solo devuelve el foco al diálogo.
      if (!dentro) {
        event.preventDefault();
        trash.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  return (
    <aside
      data-tour="explorer"
      style={{ width }}
      className="flex h-full w-60 shrink-0 flex-col gap-3 border-r border-gus-border bg-gus-panel p-3"
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
              onClick={() => void handleImportFiles()}
              disabled={busy}
              title={t("explorer.addFilesHint")}
              aria-label={t("explorer.addFiles")}
              className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
            >
              <ImportIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {!staticMode && (
            <button
              type="button"
              onClick={() => void handleNewFolder()}
              disabled={busy}
              title={t("explorer.newFolder")}
              aria-label={t("explorer.newFolder")}
              className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleNewNote()}
            disabled={busy}
            title={t("explorer.newNote")}
            aria-label={t("explorer.newNote")}
            className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!staticMode && trail.length > 0 && (
        <nav
          aria-label={t("explorer.currentFolder")}
          data-trail-menu="true"
          className="relative -mt-1 flex items-center gap-1 text-[11px]"
        >
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={goBack}
              disabled={nav.past.length === 0}
              title={t("explorer.backHint", { combo: backCombo })}
              aria-label={t("explorer.back")}
              className={TRAIL_BUTTON_CLASS}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goForward}
              disabled={nav.future.length === 0}
              title={t("explorer.forwardHint", { combo: forwardCombo })}
              aria-label={t("explorer.forward")}
              className={TRAIL_BUTTON_CLASS}
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div
            ref={trailRef}
            className="flex min-w-0 flex-1 items-center gap-x-0.5 overflow-hidden"
          >
            {abreConEllipsis && ellipsisButton}
            {trailParts.map((part, position) => (
              <Fragment key={part.folder.path}>
                {(position > 0 || abreConEllipsis) && <TrailSeparator />}
                <button
                  type="button"
                  data-drop-folder={part.folder.path}
                  onClick={() => navigateTo(trail.slice(0, part.index + 1))}
                  onDragOver={(event) => dragOverFolder(event, part.folder)}
                  onDragLeave={() => {
                    if (dragOverPath === part.folder.path) setDragOverPath(null);
                  }}
                  onDrop={(event) => dropOnFolder(event, part.folder)}
                  title={t("explorer.trailDropHint", { path: part.folder.path })}
                  aria-current={part.index === trail.length - 1 ? "true" : undefined}
                  className={clsx(
                    TRAIL_SEGMENT_CLASS,
                    dragOverPath === part.folder.path &&
                      "bg-gus-accent/20 text-gus-accent ring-1 ring-gus-accent/50",
                    part.index === trail.length - 1
                      ? "font-medium text-gus-text"
                      : "text-gus-muted hover:text-gus-text",
                  )}
                >
                  {part.folder.name}
                </button>

                {position === 0 && hiddenParts.length > 0 && !abreConEllipsis && (
                  <>
                    <TrailSeparator />
                    {ellipsisButton}
                  </>
                )}
              </Fragment>
            ))}
          </div>

          {trailMenuOpen && hiddenParts.length > 0 && (
            <div
              role="menu"
              aria-label={t("explorer.trailEarlier")}
              className="absolute top-full right-0 left-11 z-30 mt-1 overflow-hidden rounded-lg border border-gus-border bg-gus-card shadow-xl shadow-black/40"
            >
              <ul className="gus-scrollbar max-h-52 overflow-y-auto py-1">
                {hiddenParts.map((part) => (
                  <li key={part.folder.path}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => navigateTo(trail.slice(0, part.index + 1))}
                      onDragOver={(event) => dragOverFolder(event, part.folder)}
                      onDragLeave={() => {
                        if (dragOverPath === part.folder.path) setDragOverPath(null);
                      }}
                      onDrop={(event) => dropOnFolder(event, part.folder)}
                      title={t("explorer.trailDropHint", { path: part.folder.path })}
                      className={clsx(
                        menuItemClass,
                        "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                      )}
                    >
                      <Folder
                        className="h-3.5 w-3.5 shrink-0"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{part.folder.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      )}

      {notice && (
        <p
          role="status"
          aria-live="polite"
          className={clsx(
            "flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px]",
            noticeOk
              ? "border-gus-accent/40 bg-gus-accent/10 text-gus-accent"
              : "border-amber-400/30 bg-amber-400/10 text-amber-300",
          )}
        >
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("common.close")}
            className={clsx(
              "shrink-0 rounded px-1 transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:outline-none",
              noticeOk
                ? "text-gus-accent/70 focus-visible:ring-gus-accent/60"
                : "text-amber-300/70 focus-visible:ring-amber-300/60",
            )}
          >
            ×
          </button>
        </p>
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
            aria-label={t("common.close")}
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

      <ul
        ref={listRef}
        onContextMenu={panelFromContext}
        className="gus-scrollbar flex-1 space-y-1 overflow-y-auto pr-1"
      >
        {folders.map((folder) => (
          <li
            key={folder.path}
            data-entry-id={folder.path}
            data-entry-kind="folder"
            data-drop-folder={folder.path}
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
                  ariaLabel={t("explorer.renameField", { name: folder.name })}
                  onCommit={(value) => void commitFolderRename(folder, value)}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => enterFolder(folder)}
                  title={t("explorer.folderHint", { path: folder.path })}
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
            </div>
          </li>
        ))}

        <AnimatePresence initial={false}>
          {items.map((file) => {
            const isCurrent = file.id === currentId;
            const isActive = isCurrent;
            const isRenaming = renamingId === file.id;

            return (
              <motion.li
                key={file.id}
                data-entry-id={file.id}
                data-entry-kind="file"
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
                        ariaLabel={t("explorer.renameField", { name: file.name })}
                        onCommit={(value) => void commitRename(file, value)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => select(file)}
                        title={t("explorer.folderHint", { path: file.name })}
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
                        ) : file.kind === "pdf" ? (
                          <FileIcon
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
                            {file.kind === "image"
                              ? "imagen"
                              : file.kind === "pdf"
                                ? "pdf"
                                : (file.updatedAt ?? "")}
                          </span>
                        </span>
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
              {t("editor.retry")}
            </button>
          </li>
        )}

        {status === "ready" && items.length === 0 && folders.length === 0 && (
          <li className="rounded-lg border border-dashed border-gus-border px-3 py-6 text-center text-xs text-gus-muted">
            {t("explorer.emptyHintBefore")}{" "}
            <strong className="font-medium text-gus-text">+</strong>
            {t("explorer.emptyHintMid")}{" "}
            <strong className="font-medium text-gus-text">{t("explorer.newFolder")}</strong>
            {t("explorer.emptyHintAfter")}
          </li>
        )}
      </ul>

      {menu && (menuTarget || menu.kind === "panel") && (
        <div
          role="menu"
          aria-label={t(
            menu.kind === "panel" ? "explorer.panelOptions" : "explorer.itemOptions",
            { name: menuTarget?.name ?? "" },
          )}
          className="fixed z-30 w-52 overflow-hidden rounded-lg border border-gus-border bg-gus-card shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
        >
          {confirmId === menu.id && menuTarget ? (
            <div className="p-3 text-xs">
              <p className="text-gus-text">
                {t(menu.kind === "folder" ? "explorer.trashFolderAsk" : "explorer.trashItemAsk", {
                  name: "",
                })}
                <span className="font-mono break-all">{menuTarget.name}</span>
                {t("explorer.trashToBin")}
              </p>
              <p className="mt-1 text-[11px] text-gus-muted">
                {menu.kind === "folder"
                  ? t("explorer.trashFolderBody")
                  : t("explorer.trashItemBody")}
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  ref={confirmTrashRef}
                  onClick={() => {
                    if (menuFolder) void deleteFolder(menuFolder);
                    else if (menuFile) void deleteFile(menuFile);
                  }}
                  disabled={busy}
                  className="rounded-md border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-300 transition-colors hover:bg-rose-400/20 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none disabled:opacity-50"
                >
                  {t("explorer.moveToTrash")}
                </button>
                <button
                  type="button"
                  ref={confirmCancelRef}
                  onClick={() => setConfirmId(null)}
                  className="rounded-md border border-gus-border px-2 py-1 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : movingId === menu.id && menuTarget ? (
            <div>
              <p className="border-b border-gus-border px-3 py-2 text-[10px] tracking-wider text-gus-muted uppercase">
                {t(menu.kind === "folder" ? "explorer.moveFolderTo" : "explorer.moveFileTo")}
              </p>
              <ul className="gus-scrollbar max-h-44 overflow-y-auto py-1">
                {destinations === null && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">{t("common.loading")}</li>
                )}
                {destinations?.length === 0 && (
                  <li className="px-3 py-2 text-[11px] text-gus-muted">
                    {t("explorer.noDestinations")}
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
                {t("common.rename")}
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
                {t("explorer.move")}
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
                {t("explorer.deleteEllipsis")}
              </button>
            </div>
          ) : menuFile ? (
            <div className="py-1">
              {!isImageName(menuFile.name) && !isPdfName(menuFile.name) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const target = menuFile;
                    setMenu(null);
                    onExportPdf?.(target);
                  }}
                  className={clsx(
                    menuItemClass,
                    "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                  )}
                >
                  {t("explorer.export")}
                </button>
              )}
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
          ) : menu.kind === "panel" ? (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void handleNewNote();
                }}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                {t("explorer.newNote")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void handleNewFolder();
                }}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                {t("explorer.newFolder")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  void handleImportFiles();
                }}
                className={clsx(
                  menuItemClass,
                  "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                {t("explorer.addFromPc")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  reload();
                }}
                className={clsx(
                  menuItemClass,
                  "border-t border-gus-border text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                {t("explorer.refresh")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
});

export default FileExplorer;
