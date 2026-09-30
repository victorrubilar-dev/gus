import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  CalendarDays,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Settings as SettingsIcon,
  StickyNote,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import clsx from "clsx";
import CalendarView from "./components/CalendarView";
import CommandPalette from "./components/CommandPalette";
import NewTaskDialog from "./components/NewTaskDialog";
import DashboardView from "./components/DashboardView";
import FileExplorer, { type FileExplorerHandle, type NoteFile } from "./components/FileExplorer";
import MarkdownEditor, {
  type EditorDraft,
  type MarkdownEditorHandle,
} from "./components/MarkdownEditor";
import SettingsPanel from "./components/SettingsPanel";
import TaskList from "./components/TaskList";
import TrashView from "./components/TrashView";
import VaultPicker, { type VaultAppConfig, type VaultInfo } from "./components/VaultPicker";
import WelcomePanel from "./components/WelcomePanel";
import { baseName, isInsidePath, joinPath, safeFileName } from "./lib/fileName";
import {
  importFilesIntoVault,
  relativeFolderLabel,
  summarizeImport,
  type ImportSummary,
} from "./lib/importFiles";
import { findWikiNote, wikiTargetToPath, type WikiNote } from "./lib/wikiLink";
import { accentHex, DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from "./lib/settings";
import { applyTheme } from "./lib/themes";
import { setPersonalWords } from "./lib/spellCheck";
import { toLocalCoord, uiZoomFactor } from "./lib/uiZoom";
import gusIcon from "./assets/gus-icon-512.png";
import "./App.css";

type TabId = "home" | "notes" | "tasks" | "calendar" | "settings" | "trash";
type NoteStatus = "idle" | "loading" | "ready" | "error";

interface OpenNote {
  path: string;
  title: string;
  content: string;
}

interface OpenImage {
  path: string;
  title: string;
  src: string | null;
  error?: string;
}

interface OpenPdf {
  path: string;
  title: string;
  src: string | null;
  error?: string;
}

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: "home", label: "Resumen", Icon: LayoutDashboard },
  { id: "notes", label: "Notas", Icon: StickyNote },
  { id: "tasks", label: "Tareas", Icon: ListTodo },
  { id: "calendar", label: "Calendario", Icon: CalendarDays },
];

const DEFAULT_BASE_DIR = "~/Documents/gus-vaults";

const SIDEBAR_MIN_WIDTH = 64;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 96;
const SIDEBAR_WIDTH_KEY = "gus.sidebar-width";

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readStoredSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored !== null) return clampSidebarWidth(Number.parseInt(stored, 10));
  } catch {
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

const EXPLORER_MIN_WIDTH = 200;
const EXPLORER_MAX_WIDTH = 560;
const EXPLORER_DEFAULT_WIDTH = 240;
const EXPLORER_WIDTH_KEY = "gus.explorer-width";

function clampExplorerWidth(width: number): number {
  if (!Number.isFinite(width)) return EXPLORER_DEFAULT_WIDTH;
  // De sitio para el editor (y el menú, en su ancho máximo) siempre queda.
  const hardMax = Math.max(EXPLORER_MIN_WIDTH, toLocalCoord(window.innerWidth) - 700);
  return Math.max(EXPLORER_MIN_WIDTH, Math.round(Math.min(width, hardMax)));
}

function readStoredExplorerWidth(): number {
  try {
    const stored = window.localStorage.getItem(EXPLORER_WIDTH_KEY);
    if (stored !== null) return clampExplorerWidth(Number.parseInt(stored, 10));
  } catch {
  }
  return EXPLORER_DEFAULT_WIDTH;
}

interface VaultConfig {
  baseDir: string;
  vaults: VaultInfo[];
  lastVault: string | null;
  settings: AppSettings;
}

function normalizeConfig(raw: VaultAppConfig | null | undefined): VaultConfig {
  return {
    baseDir: raw?.baseDir?.trim() || DEFAULT_BASE_DIR,
    vaults: raw?.vaults ?? [],
    lastVault: raw?.lastVault ?? null,
    settings: normalizeSettings(raw?.settings),
  };
}

function titleFromFileName(name: string): string {
  return name.replace(/\.md$/i, "");
}

// Visor de PDF: carga pdf.js solo cuando se abre el primer documento.
const PdfViewer = lazy(() => import("./components/PdfViewer"));

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [note, setNote] = useState<OpenNote | null>(null);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  /** Nota que debe abrir el diálogo de exportación a PDF en cuanto cargue. */
  const [pendingExport, setPendingExport] = useState<string | null>(null);
  const [image, setImage] = useState<OpenImage | null>(null);
  const [imageStatus, setImageStatus] = useState<NoteStatus>("idle");
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const [pdfStatus, setPdfStatus] = useState<NoteStatus>("idle");
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkErrorTimerRef = useRef<number | null>(null);
  /** Aviso del resultado de arrastrar archivos desde el explorador del sistema. */
  const [importNotice, setImportNotice] = useState<ImportSummary | null>(null);
  const importNoticeTimerRef = useRef<number | null>(null);
  /** true mientras el usuario trae archivos del sistema sobre la ventana. */
  const [droppingFiles, setDroppingFiles] = useState(false);
  /** Carpeta bajo el cursor durante el arrastre: allí caerán los archivos. */
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  /**
   * Lo que hace el arrastre nativo, guardado en un ref para que el listener —
   * enganchado una sola vez— siempre vea las últimas funciones y estados.
   */
  const dragDropRef = useRef<{
    folder: (position: { x: number; y: number }) => string | null;
    drop: (paths: string[], position: { x: number; y: number }) => Promise<void>;
  }>({ folder: () => null, drop: async () => {} });

  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [explorerWidth, setExplorerWidth] = useState(readStoredExplorerWidth);
  const explorerWidthRef = useRef(explorerWidth);

  const [bootStatus, setBootStatus] = useState<"loading" | "ready">("loading");
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [currentVault, setCurrentVault] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  const settings = vaultConfig?.settings ?? DEFAULT_SETTINGS;

  const notePathRef = useRef<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  /** Para que el panel de bienvenida cree notas igual que el «+» del explorador. */
  const explorerRef = useRef<FileExplorerHandle>(null);
  /** Solo la última petición de imagen puede escribir en el estado. */
  const imageRequestRef = useRef(0);
  /** Solo la última petición de PDF puede escribir en el estado. */
  const pdfRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await invoke<VaultAppConfig>("load_app_config");
        if (cancelled) return;
        const next = normalizeConfig(raw);

        let openPath: string | null = null;
        if (next.lastVault && next.settings.openLastVault) {
          const exists = await invoke<boolean>("vault_dir_exists", { path: next.lastVault });
          if (cancelled) return;
          openPath = exists ? next.lastVault : null;
        }

        if (cancelled) return;
        setVaultConfig(next);
        setCurrentVault(openPath);
        setBootStatus("ready");
      } catch (error: unknown) {
        if (cancelled) return;
        setVaultConfig(normalizeConfig(null));
        setVaultError(String(error));
        setBootStatus("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPersonalWords(settings.spellWords);
  }, [settings.spellWords]);

  /** Escala global de la interfaz (Ajustes o atajos Ctrl + «+»/«−»/0). */
  useEffect(() => {
    document.documentElement.style.setProperty("zoom", String(settings.uiZoom / 100));
    window.dispatchEvent(new Event("gus:zoom"));
  }, [settings.uiZoom]);

  /** Paleta activa: variables de color, esquema y acento de todo el documento. */
  useEffect(() => {
    // Sin configuración leída aún se respeta el tema de main.tsx (sesión anterior).
    if (!vaultConfig) return;
    applyTheme(settings.theme);
  }, [settings.theme, vaultConfig]);

  useEffect(() => {
    function handleZoomKey(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      // Se acepta event.key y event.code: el layout latam no genera "=" en la tecla física.
      const zoomIn =
        event.key === "+" ||
        event.key === "=" ||
        event.code === "Equal" ||
        event.code === "NumpadAdd";
      const zoomOut =
        event.key === "-" ||
        event.key === "_" ||
        event.code === "Minus" ||
        event.code === "NumpadSubtract";
      const zoomReset = event.key === "0" || event.code === "Digit0";
      let next: number | null = null;
      if (zoomIn) next = settings.uiZoom + 10;
      else if (zoomOut) next = settings.uiZoom - 10;
      else if (zoomReset) next = 100;
      if (next === null) return;
      event.preventDefault();
      const zoom = Math.min(200, Math.max(50, Math.round(next)));
      if (zoom !== settings.uiZoom) handleSettingsChange({ ...settings, uiZoom: zoom });
    }

    window.addEventListener("keydown", handleZoomKey);
    return () => window.removeEventListener("keydown", handleZoomKey);
  }, [settings]);

  function handleSelectNote(file: NoteFile) {
    if (file.kind === "image") {
      handleSelectImage(file);
      return;
    }
    if (file.kind === "pdf") {
      handleSelectPdf(file);
      return;
    }

    imageRequestRef.current += 1;
    setImage(null);
    setImageStatus("idle");
    pdfRequestRef.current += 1;
    setPdf(null);
    setPdfStatus("idle");

    setNoteStatus("loading");
    setNoteError(null);

    invoke<string>("read_vault_file", { path: file.id })
      .then((content) => {
        notePathRef.current = file.id;
        setNote({ path: file.id, title: titleFromFileName(file.name), content });
        setNoteStatus("ready");
      })
      .catch((error: unknown) => {
        notePathRef.current = null;
        setNote(null);
        setNoteError(String(error));
        setNoteStatus("error");
        setPendingExport(null);
      });
  }

  /**
   * «Exportar a PDF» desde el explorador: se abre la nota (si no lo estaba) y
   * el editor muestra el diálogo con la vista previa ya montada.
   */
  function handleExportPdf(file: NoteFile) {
    setPendingExport(file.id);
    if (note?.path !== file.id || noteStatus !== "ready") handleSelectNote(file);
  }

  function handlePaletteSelectNote(file: { path: string; name: string }) {
    setPaletteOpen(false);
    setActiveTab("notes");
    handleSelectNote({ id: file.path, name: file.name, kind: "note" });
  }

  function handleSelectImage(file: NoteFile) {
    const token = ++imageRequestRef.current;
    pdfRequestRef.current += 1;
    setPdf(null);
    setPdfStatus("idle");
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);

    setImage({ path: file.id, title: file.name, src: null });
    setImageStatus("loading");

    invoke<string>("read_vault_image", { path: file.id })
      .then((src) => {
        if (token !== imageRequestRef.current) return;
        setImage({ path: file.id, title: file.name, src });
        setImageStatus("ready");
      })
      .catch((error: unknown) => {
        if (token !== imageRequestRef.current) return;
        setImage({ path: file.id, title: file.name, src: null, error: String(error) });
        setImageStatus("error");
      });
  }

  function handleSelectPdf(file: NoteFile) {
    const token = ++pdfRequestRef.current;
    imageRequestRef.current += 1;
    setImage(null);
    setImageStatus("idle");
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);

    setPdf({ path: file.id, title: file.name, src: null });
    setPdfStatus("loading");

    invoke<string>("read_vault_pdf", { path: file.id })
      .then((src) => {
        if (token !== pdfRequestRef.current) return;
        setPdf({ path: file.id, title: file.name, src });
        setPdfStatus("ready");
      })
      .catch((error: unknown) => {
        if (token !== pdfRequestRef.current) return;
        setPdf({ path: file.id, title: file.name, src: null, error: String(error) });
        setPdfStatus("error");
      });
  }

  function handleAutoSave(draft: EditorDraft) {
    if (notePathRef.current && notePathRef.current !== draft.path) {
      setVaultRefresh((key) => key + 1);
    }
    notePathRef.current = draft.path;
    setNote((prev) => (prev ? { ...prev, ...draft } : prev));
  }

  function handleFileDeleted(path: string) {
    if (image?.path === path) {
      imageRequestRef.current += 1;
      setImage(null);
      setImageStatus("idle");
      return;
    }

    if (pdf?.path === path) {
      pdfRequestRef.current += 1;
      setPdf(null);
      setPdfStatus("idle");
      return;
    }

    if (notePathRef.current !== path) return;
    notePathRef.current = null;
    setNote(null);
    setNoteError(null);
    setNoteStatus("idle");
  }

  // Volcado previo: evita que el editor recriba el archivo en la ruta vieja al desmontarse.
  async function handleBeforeFileAction(path: string): Promise<void> {
    if (notePathRef.current !== path) return;

    const saved = await editorRef.current?.flush() ?? true;
    if (!saved) {
      throw new Error("No se pudieron guardar los cambios de la nota antes de modificarla.");
    }
  }

  function showLinkError(message: string) {
    setLinkError(message);
    if (linkErrorTimerRef.current !== null) window.clearTimeout(linkErrorTimerRef.current);
    linkErrorTimerRef.current = window.setTimeout(() => setLinkError(null), 6000);
  }

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

  /** Importa los archivos soltados y cuenta lo que ha dado de sí. */
  async function handleDroppedFiles(paths: string[], position: { x: number; y: number }) {
    const dest = resolveDropFolder(position);
    if (!dest) {
      showImportNotice({ ok: false, message: "Abre un vault para añadir archivos." });
      return;
    }
    if (paths.length === 0) return;

    try {
      const items = await importFilesIntoVault(paths, dest);
      showImportNotice(summarizeImport(items, relativeFolderLabel(dest, currentVault ?? dest)));
      setVaultRefresh((key) => key + 1);
    } catch (error: unknown) {
      showImportNotice({ ok: false, message: String(error) });
    }
  }

  // El ref siempre apunta a la versión más reciente de las funciones de arriba.
  useEffect(() => {
    dragDropRef.current = { folder: resolveDropFolder, drop: handleDroppedFiles };
  });

  /**
   * El menú por defecto del webview (cortar/pegar, inspeccionar…) no es de Gus:
   * se cancela en toda la app y cada superficie abre el suyo —el editor, las
   * filas del explorador y la lista— con `preventDefault` sobre `contextmenu`.
   */
  useEffect(() => {
    const cancelDefaultMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", cancelDefaultMenu, { capture: true });
    return () => document.removeEventListener("contextmenu", cancelDefaultMenu, { capture: true });
  }, []);

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
            void dragDropRef.current.drop(payload.paths, payload.position);
          } else if (payload.type === "enter" || payload.type === "over") {
            setDroppingFiles(true);
            setDropFolder(dragDropRef.current.folder(payload.position));
          } else {
            setDroppingFiles(false);
            setDropFolder(null);
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
      if (linkErrorTimerRef.current !== null) window.clearTimeout(linkErrorTimerRef.current);
      if (importNoticeTimerRef.current !== null) {
        window.clearTimeout(importNoticeTimerRef.current);
      }
    };
  }, []);

  async function handleOpenWikiLink(target: string) {
    if (!currentVault) return;

    try {
      const activePath = notePathRef.current;
      if (activePath) await handleBeforeFileAction(activePath);

      const notes = await invoke<WikiNote[]>("list_vault_notes", { path: currentVault });
      const match = findWikiNote(notes, target);
      if (match) {
        handleSelectNote({ id: match.path, name: match.name, kind: "note" });
        return;
      }

      const relative = wikiTargetToPath(target);
      if (!relative) throw new Error(`Nombre de nota no válido: «${target}»`);

      const created = await invoke<string>("create_vault_file", {
        path: joinPath(currentVault, `${relative}.md`),
        content: `# ${baseName(relative)}\n\n`,
      });

      setVaultRefresh((key) => key + 1);
      handleSelectNote({ id: created, name: baseName(created), kind: "note" });
    } catch (error: unknown) {
      showLinkError(String(error));
    }
  }

  function saveVaultConfig(next: VaultConfig) {
    setVaultConfig(next);
    invoke("save_app_config", { config: next }).catch((error: unknown) => {
      setVaultError(String(error));
    });
  }

  function closeOpenNote() {
    imageRequestRef.current += 1;
    pdfRequestRef.current += 1;
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);
    setImage(null);
    setImageStatus("idle");
    setPdf(null);
    setPdfStatus("idle");
  }

  function openVault(path: string) {
    setCurrentVault(path);
    closeOpenNote();
    setVaultError(null);
    setActiveTab(settings.alwaysNotesTab ? "notes" : "home");
    if (vaultConfig) saveVaultConfig({ ...vaultConfig, lastVault: path });
  }

  function leaveVault() {
    setCurrentVault(null);
    closeOpenNote();
  }

  function storeSidebarWidth(width: number) {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
    }
  }

  function changeSidebarWidth(width: number, persist = true) {
    const next = clampSidebarWidth(width);
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
    if (persist) storeSidebarWidth(next);
  }

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const previousSelection = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      changeSidebarWidth(startWidth + (moveEvent.clientX - startX) / uiZoomFactor(), false);
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      document.body.style.userSelect = previousSelection;
      storeSidebarWidth(sidebarWidthRef.current);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function handleSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;

    switch (event.key) {
      case "ArrowLeft":
        changeSidebarWidth(sidebarWidth - step);
        break;
      case "ArrowRight":
        changeSidebarWidth(sidebarWidth + step);
        break;
      case "Home":
        changeSidebarWidth(SIDEBAR_MIN_WIDTH);
        break;
      case "End":
        changeSidebarWidth(SIDEBAR_MAX_WIDTH);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function storeExplorerWidth(width: number) {
    try {
      window.localStorage.setItem(EXPLORER_WIDTH_KEY, String(width));
    } catch {
    }
  }

  function changeExplorerWidth(width: number, persist = true) {
    const next = clampExplorerWidth(width);
    explorerWidthRef.current = next;
    setExplorerWidth(next);
    if (persist) storeExplorerWidth(next);
  }

  function handleExplorerResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = explorerWidthRef.current;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const previousSelection = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      changeExplorerWidth(startWidth + (moveEvent.clientX - startX) / uiZoomFactor(), false);
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      document.body.style.userSelect = previousSelection;
      storeExplorerWidth(explorerWidthRef.current);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  function handleExplorerResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;

    switch (event.key) {
      case "ArrowRight":
        changeExplorerWidth(explorerWidth + step);
        break;
      case "ArrowLeft":
        changeExplorerWidth(explorerWidth - step);
        break;
      case "Home":
        changeExplorerWidth(EXPLORER_MIN_WIDTH);
        break;
      case "End":
        changeExplorerWidth(EXPLORER_MAX_WIDTH);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  async function handleCreateVault(name: string, base: string): Promise<boolean> {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const finalBase = base.trim() || DEFAULT_BASE_DIR;
      const safeName = safeFileName(name);
      const path = await invoke<string>("create_vault", { base: finalBase, name: safeName });

      const source = vaultConfig ?? normalizeConfig(null);
      setCurrentVault(path);
      closeOpenNote();
      saveVaultConfig({
        ...source,
        baseDir: finalBase,
        vaults: [...source.vaults, { name: safeName, path }],
        lastVault: path,
      });
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleAddExistingVault(rawPath: string): Promise<boolean> {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const path = rawPath.trim();
      const exists = await invoke<boolean>("vault_dir_exists", { path });
      if (!exists) {
        setVaultError(`No existe la carpeta «${path}»`);
        return false;
      }

      const source = vaultConfig ?? normalizeConfig(null);
      setCurrentVault(path);
      closeOpenNote();

      if (source.vaults.some((vault) => vault.path === path)) {
        saveVaultConfig({ ...source, lastVault: path });
        return true;
      }

      const cleanPath = path.replace(/[\\/]+$/, "");
      saveVaultConfig({
        ...source,
        vaults: [...source.vaults, { name: baseName(cleanPath) || path, path }],
        lastVault: path,
      });
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleRenameVault(path: string, name: string): Promise<boolean> {
    if (!vaultConfig) return false;

    const cleanName = name.trim();
    if (!cleanName) {
      setVaultError("Ponle un nombre al vault.");
      return false;
    }

    setVaultBusy(true);
    setVaultError(null);

    const next: VaultConfig = {
      ...vaultConfig,
      vaults: vaultConfig.vaults.map((vault) =>
        vault.path === path ? { ...vault, name: cleanName } : vault,
      ),
    };

    try {
      await invoke("save_app_config", { config: next });
      setVaultConfig(next);
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleSetVaultCover(path: string, cover: string | null): Promise<boolean> {
    if (!vaultConfig) return false;

    setVaultBusy(true);
    setVaultError(null);

    const next: VaultConfig = {
      ...vaultConfig,
      vaults: vaultConfig.vaults.map((vault) =>
        vault.path === path ? { ...vault, cover: cover ?? undefined } : vault,
      ),
    };

    try {
      await invoke("save_app_config", { config: next });
      setVaultConfig(next);
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  function handleRemoveVaults(paths: string[]) {
    if (!vaultConfig || paths.length === 0) return;

    const removed = new Set(paths);
    const vaults = vaultConfig.vaults.filter((vault) => !removed.has(vault.path));
    const lastVault =
      vaultConfig.lastVault && removed.has(vaultConfig.lastVault)
        ? null
        : vaultConfig.lastVault;
    saveVaultConfig({ ...vaultConfig, vaults, lastVault });

    if (currentVault && removed.has(currentVault)) leaveVault();
  }

  function handleSelectBaseDir(dir: string) {
    const clean = dir.trim();
    if (!vaultConfig || !clean || clean === vaultConfig.baseDir) return;
    saveVaultConfig({ ...vaultConfig, baseDir: clean });
  }

  function handleSettingsChange(next: AppSettings) {
    if (!vaultConfig) return;
    // Cambiar de tema estrena el acento propio del tema; después se puede cambiar a mano.
    const normalized: AppSettings =
      next.theme !== settings.theme ? { ...next, accent: "tema" } : next;
    saveVaultConfig({ ...vaultConfig, settings: normalized });
  }

  const showEntryPanel =
    image !== null ||
    pdf !== null ||
    note !== null ||
    noteStatus === "loading" ||
    noteStatus === "error";

  const notesView = currentVault === null ? null : (
    <div className="flex h-full w-full">
      <FileExplorer
        ref={explorerRef}
        vaultPath={currentVault}
        activeId={note?.path ?? image?.path ?? pdf?.path ?? null}
        onSelect={handleSelectNote}
        refreshKey={vaultRefresh}
        onFileDeleted={handleFileDeleted}
        onBeforeFileAction={handleBeforeFileAction}
        onExportPdf={handleExportPdf}
        width={explorerWidth}
      />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar el explorador de notas"
        aria-valuenow={explorerWidth}
        aria-valuemin={EXPLORER_MIN_WIDTH}
        aria-valuemax={EXPLORER_MAX_WIDTH}
        tabIndex={0}
        title="Arrastra para redimensionar · doble clic: tamaño normal"
        onPointerDown={handleExplorerResizeStart}
        onDoubleClick={() => changeExplorerWidth(EXPLORER_DEFAULT_WIDTH)}
        onKeyDown={handleExplorerResizeKeyDown}
        className="w-1.5 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-gus-accent/40 focus-visible:bg-gus-accent/60 focus-visible:outline-none"
      />

      {showEntryPanel && (
        <div className="flex min-w-0 flex-1 flex-col">
          {image ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-gus-border bg-gus-panel px-4 py-2">
                <span className="truncate font-mono text-xs text-gus-muted">{image.title}</span>
                <span className="shrink-0 rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gus-accent">
                  Imagen
                </span>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20 p-4">
                {imageStatus === "loading" && (
                  <p className="text-sm text-white/60">Cargando imagen…</p>
                )}

                {imageStatus === "error" && (
                  <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                    <p className="text-sm text-gus-muted">No se pudo abrir la imagen</p>
                    {image.error && (
                      <p className="break-words text-xs text-rose-300">{image.error}</p>
                    )}
                  </div>
                )}

                {imageStatus === "ready" && image.src && (
                  <img
                    src={image.src}
                    alt={image.title}
                    onError={() => {
                      setImage({
                        ...image,
                        error: `Este navegador no sabe decodificar «${image.title}»; el archivo está intacto en el vault.`,
                      });
                      setImageStatus("error");
                    }}
                    className="max-h-full max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
                  />
                )}
              </div>
            </div>
          ) : pdf ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-gus-border bg-gus-panel px-4 py-2">
                <span className="truncate font-mono text-xs text-gus-muted">{pdf.title}</span>
                <span className="shrink-0 rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gus-accent">
                  PDF
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-black/20">
                {pdfStatus === "loading" && (
                  <p className="text-sm text-white/60">Cargando PDF…</p>
                )}

                {pdfStatus === "error" && (
                  <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                    <p className="text-sm text-gus-muted">No se pudo abrir el PDF</p>
                    {pdf.error && (
                      <p className="break-words text-xs text-rose-300">{pdf.error}</p>
                    )}
                  </div>
                )}

                {pdfStatus === "ready" && pdf.src && (
                  <Suspense fallback={<p className="text-sm text-white/60">Cargando visor…</p>}>
                    <PdfViewer src={pdf.src} title={pdf.title} />
                  </Suspense>
                )}
              </div>
            </div>
          ) : (
            <>
              {noteStatus === "loading" && (
                <div className="flex h-full items-center justify-center text-sm text-gus-muted">
                  Cargando nota…
                </div>
              )}

              {noteStatus === "error" && (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gus-muted">
                  <span>No se pudo abrir la nota</span>
                  {noteError && (
                    <span className="break-words text-xs text-rose-400/80">{noteError}</span>
                  )}
                </div>
              )}

              {noteStatus === "ready" && note && (
                <MarkdownEditor
                  ref={editorRef}
                  path={note.path}
                  title={note.title}
                  content={note.content}
                  vaultPath={currentVault}
                  onOpenWikiLink={handleOpenWikiLink}
                  autoSave={handleAutoSave}
                  autoSaveEnabled={settings.autoSave}
                  fontSize={settings.editorFontSize}
                  spellLang={settings.spellLang}
                  spellWords={settings.spellWords}
                  onSpellWordsChange={(words) =>
                    handleSettingsChange({ ...settings, spellWords: words })
                  }
                  autoExportPath={pendingExport}
                  onAutoExportShown={() => setPendingExport(null)}
                />
              )}
            </>
          )}
        </div>
      )}

      {!showEntryPanel && (
        <WelcomePanel
          vaultPath={currentVault}
          refreshKey={vaultRefresh}
          onNewNote={() => explorerRef.current?.newNote()}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenNote={handleSelectNote}
        />
      )}
    </div>
  );

  const showSidebar = bootStatus === "ready" && currentVault !== null;

  return (
    <MotionConfig reducedMotion={settings.animations ? "user" : "always"}>
      <div
        className={clsx(
          "flex h-screen w-screen overflow-hidden bg-gus-bg text-gus-text",
          !settings.animations && "gus-no-motion",
        )}
        style={
          { "--color-gus-accent": accentHex(settings.accent, settings.theme) } as CSSProperties
        }
      >
        {showSidebar && (
          <aside
            style={{ width: sidebarWidth }}
            className="relative flex h-full shrink-0 flex-col items-center gap-2 border-r border-gus-border bg-gus-panel py-4"
          >
            <img
              src={gusIcon}
              alt="Gus"
              title="Gus"
              draggable={false}
              className="h-9 w-9 select-none"
            />

            <div aria-hidden="true" className="my-1 h-px w-8 bg-gus-border" />

            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;

              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={isActive}
                  onClick={() => setActiveTab(id)}
                  className={clsx(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                    isActive
                      ? "text-gus-accent"
                      : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-tab"
                      className="absolute inset-0 rounded-xl border border-gus-accent/40 bg-gus-accent/15"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="relative h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>
              );
            })}

            <div className="mt-auto flex w-full flex-col items-center gap-2">
              <div aria-hidden="true" className="h-px w-8 bg-gus-border" />

              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  title="Salir del vault"
                  aria-label="Salir del vault"
                  onClick={leaveVault}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-gus-muted outline-none transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-gus-accent/60"
                >
                  <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  title="Papelera"
                  aria-label="Papelera"
                  aria-pressed={activeTab === "trash"}
                  onClick={() => setActiveTab("trash")}
                  className={clsx(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                    activeTab === "trash"
                      ? "text-gus-accent"
                      : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
                  )}
                >
                  {activeTab === "trash" && (
                    <motion.span
                      layoutId="sidebar-active-tab"
                      className="absolute inset-0 rounded-xl border border-gus-accent/40 bg-gus-accent/15"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Trash2 className="relative h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  title="Configuración"
                  aria-label="Configuración"
                  aria-pressed={activeTab === "settings"}
                  onClick={() => setActiveTab("settings")}
                  className={clsx(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                    activeTab === "settings"
                      ? "text-gus-accent"
                      : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
                  )}
                >
                  {activeTab === "settings" && (
                    <motion.span
                      layoutId="sidebar-active-tab"
                      className="absolute inset-0 rounded-xl border border-gus-accent/40 bg-gus-accent/15"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <SettingsIcon
                    className="relative h-5 w-5"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar el menú lateral"
              aria-valuenow={sidebarWidth}
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              tabIndex={0}
              title="Arrastra para redimensionar · doble clic: tamaño normal"
              onPointerDown={handleSidebarResizeStart}
              onDoubleClick={() => changeSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
              onKeyDown={handleSidebarResizeKeyDown}
              className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none rounded-r-sm transition-colors hover:bg-gus-accent/40 focus-visible:bg-gus-accent/60 focus-visible:outline-none"
            />
          </aside>
        )}

        <main className="h-full min-w-0 flex-1 overflow-hidden">
          {bootStatus === "loading" ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-gus-muted">
              <img
                src={gusIcon}
                alt=""
                draggable={false}
                className="h-20 w-20 animate-pulse select-none"
              />
              Cargando Gus…
            </div>
          ) : currentVault === null ? (
            <VaultPicker
              vaults={vaultConfig?.vaults ?? []}
              baseDir={vaultConfig?.baseDir ?? DEFAULT_BASE_DIR}
              lastVault={vaultConfig?.lastVault ?? null}
              busy={vaultBusy}
              error={vaultError}
              onOpen={openVault}
              onCreate={handleCreateVault}
              onAddExisting={handleAddExistingVault}
              onRename={handleRenameVault}
              onSetCover={handleSetVaultCover}
              onRemoveMany={handleRemoveVaults}
              onSelectBaseDir={handleSelectBaseDir}
            />
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.section
                key={activeTab}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="h-full w-full overflow-hidden"
              >
                {activeTab === "home" ? (
                  <DashboardView
                    vaultPath={currentVault}
                    vaultName={
                      vaultConfig?.vaults.find((vault) => vault.path === currentVault)?.name ??
                      baseName(currentVault)
                    }
                    onNavigate={setActiveTab}
                    onNewTask={() => setNewTaskOpen(true)}
                    onOpenNote={(file) => {
                      setActiveTab("notes");
                      handleSelectNote(file);
                    }}
                  />
                ) : activeTab === "notes" ? (
                  notesView
                ) : activeTab === "tasks" ? (
                  <TaskList
                    vaultPath={currentVault}
                    hideCompleted={settings.hideCompletedTasks}
                    onNewTask={() => setNewTaskOpen(true)}
                    onOpenNote={(path, name) => {
                      setActiveTab("notes");
                      handleSelectNote({ id: path, name, kind: "note" });
                    }}
                  />
                ) : activeTab === "calendar" ? (
                  <CalendarView
                    vaultPath={currentVault}
                    onOpenTasks={() => setActiveTab("tasks")}
                    onNewTask={() => setNewTaskOpen(true)}
                    showCompleted={settings.calendarShowCompleted}
                  />
                ) : activeTab === "trash" ? (
                  <TrashView onRestore={() => setVaultRefresh((key) => key + 1)} />
                ) : (
                  <SettingsPanel settings={settings} onChange={handleSettingsChange} />
                )}
              </motion.section>
            </AnimatePresence>
          )}
        </main>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          vaultPath={currentVault}
          onSelectNote={handlePaletteSelectNote}
        />

        <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />

        {linkError && (
          <div
            role="status"
            aria-live="polite"
            className={clsx(
              "fixed right-4 z-50 max-w-sm rounded-xl border border-rose-400/40 bg-gus-panel px-4 py-3 text-xs text-rose-300 shadow-2xl shadow-black/40",
              importNotice ? "bottom-20" : "bottom-4",
            )}
          >
            {linkError}
          </div>
        )}

        {importNotice && (
          <div
            role="status"
            aria-live="polite"
            className={clsx(
              "fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border bg-gus-panel px-4 py-3 text-xs shadow-2xl shadow-black/40",
              importNotice.ok
                ? "border-gus-accent/40 text-gus-accent"
                : "border-amber-400/40 text-amber-300",
            )}
          >
            {importNotice.message}
          </div>
        )}

        {droppingFiles && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-gus-accent bg-gus-bg/80 text-center shadow-2xl shadow-black/40"
          >
            <Upload className="h-10 w-10 text-gus-accent" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm font-semibold text-gus-text">
              {currentVault ? "Suelta para añadir al vault" : "Abre un vault para añadir archivos"}
            </p>
            {currentVault && (
              <p className="max-w-md break-words text-xs text-gus-muted">
                Entra en «{relativeFolderLabel(dropFolder ?? currentVault, currentVault)}»
              </p>
            )}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

export default App;
