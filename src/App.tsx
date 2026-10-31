import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LucideProvider } from "lucide-react";
import { AnimatePresence, domMax, LazyMotion, m, MotionConfig } from "framer-motion";
import { Upload } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { externalAction } from "./lib/externalChange";
import { toggleNoteTaskText, type NoteTask } from "./lib/noteTasks";
import clsx from "clsx";
import CalendarView from "./components/CalendarView";
import BacklinksPanel from "./components/BacklinksPanel";
import GraphView from "./components/GraphView";
import SearchView from "./components/SearchView";
import CommandPalette from "./components/CommandPalette";
import NewTaskDialog from "./components/NewTaskDialog";
import DashboardView from "./components/DashboardView";
import FileExplorer, { type FileExplorerHandle, type NoteFile } from "./components/FileExplorer";
import MarkdownEditor, {
  type EditorDraft,
  type MarkdownEditorHandle,
} from "./components/MarkdownEditor";
import SettingsPanel from "./components/SettingsPanel";
import DailyNoteBar from "./components/DailyNoteBar";
import HabitsView from "./components/HabitsView";
import BoardsView from "./components/BoardsView";
import NoteTabs, { type NoteTab } from "./components/NoteTabs";
import TaskList from "./components/TaskList";
import TrashView from "./components/TrashView";
import VaultPicker from "./components/VaultPicker";
import WelcomePanel from "./components/WelcomePanel";
import { baseName, isInsidePath, joinPath } from "./lib/fileName";
import { dailyNoteDateFor, dailyRelativePath, renderDailyTemplate } from "./lib/dailyNotes";
import { relativeFolderLabel } from "./lib/importFiles";
import { findWikiNote, wikiTargetToPath, type WikiNote } from "./lib/wikiLink";
import { relativeNotePath } from "./lib/searchIndex";
import { accentHex, DEFAULT_SETTINGS, type AppSettings } from "./lib/settings";
import { themeDefinition, type ThemeScheme } from "./lib/themes";
import { APP_VERSION } from "./lib/version";
import { useAppUpdates } from "./components/useAppUpdates";
import { globalShortcutFor } from "./lib/shortcuts";
import {
  I18nProvider,
  readStoredLanguage,
  storeLanguage,
  useT,
  type Language,
} from "./lib/i18n";
import { toLocalCoord } from "./lib/uiZoom";
import { useFileDrop } from "./components/useFileDrop";
import { useVaults } from "./components/useVaults";
import { useAppearance } from "./components/useAppearance";
import { useLinkGraph } from "./components/useLinkGraph";
import { useStartupNotifications } from "./components/useStartupNotifications";
import { DEFAULT_BASE_DIR } from "./lib/vaultConfig";
import { usePanelWidth } from "./components/usePanelWidth";
import Sidebar, { useSidebarWidth, type TabId } from "./components/Sidebar";
import Tour, { type TourTab } from "./components/Tour";
import UpdateNotice from "./components/UpdateNotice";
import gusIcon from "./assets/gus-icon-512.png";
import "./App.css";

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


/**
 * Estado del recorrido guiado: «pending» cuando la primera bienvenida lo deja
 * para cuando haya vault abierto y «done» cuando ya se ha visto (o saltado).
 */
const TOUR_KEY = "gus.tour";

function readTourPending(): boolean {
  try {
    return window.localStorage.getItem(TOUR_KEY) === "pending";
  } catch {
    return false;
  }
}

function storeTourStatus(status: "pending" | "done"): void {
  try {
    window.localStorage.setItem(TOUR_KEY, status);
  } catch {
    // Sin memoria entre sesiones el tour podrá lanzarse desde Ajustes.
  }
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

function titleFromFileName(name: string): string {
  return name.replace(/\.md$/i, "");
}

// Visor de PDF: carga pdf.js solo cuando se abre el primer documento.
const PdfViewer = lazy(() => import("./components/PdfViewer"));
const LibraryView = lazy(() => import("./components/LibraryView"));

/**
 * Raíz de la app: solo monta el proveedor de idioma con lo que hay en
 * `localStorage` (la ventana aparece ya en el idioma elegido, sin parpadeo) y,
 * al salir, no toca nada más.
 */
function AppRoot() {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  return (
    <I18nProvider language={language}>
      <App language={language} onLanguageChange={setLanguageState} />
    </I18nProvider>
  );
}

function App({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (lang: Language) => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabId>("notes");
  /** Con el panel derecho oculto solo se ve el explorador, a lo ancho. */
  const [rightHidden, setRightHidden] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  /**
   * Key del diálogo de nueva tarea: solo cambia al abrir. Así cada apertura
   * remonta el componente (estado limpio, sin frame con datos viejos) y
   * cerrar sigue pasando por el mismo montaje, que es lo que permite la
   * animación de salida.
   */
  const [newTaskSeq, setNewTaskSeq] = useState(0);
  const openNewTask = () => {
    setNewTaskSeq((value) => value + 1);
    setNewTaskOpen(true);
  };
  const [note, setNote] = useState<OpenNote | null>(null);
  /** Notas abiertas, en el orden en que se abrieron; la visible es `note`. */
  const [tabs, setTabs] = useState<NoteTab[]>([]);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  /**
   * Mientras se abre o se crea la nota de un día, los botones de día esperan
   * (el ref corta el segundo clic en el mismo instante, antes de que React pinte).
   */
  const [dailyBusy, setDailyBusy] = useState(false);
  const dailyBusyRef = useRef(false);
  /** Nota que debe abrir el diálogo de exportación a PDF en cuanto cargue. */
  const [pendingExport, setPendingExport] = useState<string | null>(null);
  const [image, setImage] = useState<OpenImage | null>(null);
  const [imageStatus, setImageStatus] = useState<NoteStatus>("idle");
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const [pdfStatus, setPdfStatus] = useState<NoteStatus>("idle");
  const [vaultRefresh, setVaultRefresh] = useState(0);
  /** Aviso de que la nota abierta cambió fuera de la app (REQ-13). */
  const [externalNotice, setExternalNotice] = useState<{
    path: string;
    kind: "reloaded" | "conflict";
  } | null>(null);
  const externalNoticeTimerRef = useRef<number | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkErrorTimerRef = useRef<number | null>(null);
  /**
   * El índice de búsqueda existe ya en el vault: solo entonces merece la pena
   * mantenerlo al guardar. Si nadie ha buscado nunca, no se crea el archivo.
   */
  const searchIndexTimerRef = useRef<number | null>(null);
  const searchIndexReadyRef = useRef(false);
  const sidebar = useSidebarWidth();
  const sidebarWidth = sidebar.width;
  const explorer = usePanelWidth({
    storageKey: EXPLORER_WIDTH_KEY,
    min: EXPLORER_MIN_WIDTH,
    max: EXPLORER_MAX_WIDTH,
    fallback: EXPLORER_DEFAULT_WIDTH,
    clamp: clampExplorerWidth,
  });
  const explorerWidth = explorer.width;


  const {
    bootStatus,
    vaultConfig,
    currentVault,
    vaultBusy,
    vaultError,
    saveVaultConfig,
    openVault: openVaultBase,
    leaveVault,
    handleCreateVault,
    handleAddExistingVault,
    handleRenameVault,
    handleSetVaultCover,
    handleRemoveVaults,
    handleSelectBaseDir,
  } = useVaults({ onVaultSwitch: closeOpenNote });

  /** Recorrido guiado: se abre solo al primer vault y también desde Ajustes. */
  const [tourOpen, setTourOpen] = useState(false);
  const { updateState, updateNotice, selfUpdate, checkNow, retryDownload, restartAndInstall, dismissNotice } =
    useAppUpdates(bootStatus === "ready");

  const settings = vaultConfig?.settings ?? DEFAULT_SETTINGS;

  const notePathRef = useRef<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  /** Para que el panel de bienvenida cree notas igual que el «+» del explorador. */
  const explorerRef = useRef<FileExplorerHandle>(null);

  const { importNotice, droppingFiles, dropFolder, dropOnNote } = useFileDrop({
    currentVault,
    editorRef,
    explorerRef,
    onFilesChanged: () => setVaultRefresh((key) => key + 1),
  });
  useAppearance(settings, vaultConfig !== null);
  useStartupNotifications(bootStatus === "ready", currentVault, settings);
  const { linkGraph, linkGraphStatus, linkGraphError, linkRefs } = useLinkGraph(
    currentVault,
    vaultRefresh,
    note?.path,
  );
  /** Solo la última petición de imagen puede escribir en el estado. */
  const imageRequestRef = useRef(0);
  /** Solo la última petición de PDF puede escribir en el estado. */
  const pdfRequestRef = useRef(0);

  /**
   * El recorrido guiado queda pendiente en la primera bienvenida (entonces
   * todavía no hay vault): se lanza en cuanto se abre el primero.
   */
  useEffect(() => {
    if (bootStatus !== "ready" || currentVault === null) return;
    if (!readTourPending()) return;
    setTourOpen(true);
  }, [bootStatus, currentVault]);

  /**
   * Marca o desmarca un checkbox de una nota desde la lista de tareas (REQ-09).
   * Vuelca antes lo que haya sin guardar en esa nota y, si es la abierta, la
   * recarga: si no, el editor guardaría luego su texto viejo encima.
   */
  async function toggleNoteTask(task: NoteTask): Promise<void> {
    await handleBeforeFileAction(task.notePath);
    const text = await invoke<string>("read_vault_file", { path: task.notePath });
    const next = toggleNoteTaskText(text, task);
    if (next === null) throw new Error(t("tasks.noteChanged", { name: task.noteName }));

    await invoke("write_vault_file", { path: task.notePath, content: next });
    if (notePathRef.current === task.notePath) {
      handleSelectNote({ id: task.notePath, name: baseName(task.notePath), kind: "note" });
    }
    setVaultRefresh((key) => key + 1);
  }

  /**
   * Cambios hechos fuera de la app (REQ-13): el backend vigila el vault y avisa
   * con las rutas tocadas, ya sin el ruido ni las escrituras propias.
   */
  const handleVaultChangedEvent = useEffectEvent(async (paths: string[]) => {
    setVaultRefresh((key) => key + 1);

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
      handleSelectNote({ id: open, name: baseName(open), kind: "note" });
      setExternalNotice({ path: open, kind: "reloaded" });
      externalNoticeTimerRef.current = window.setTimeout(() => setExternalNotice(null), 6000);
    } else {
      setExternalNotice({ path: open, kind: "conflict" });
    }
  });

  useEffect(() => {
    if (bootStatus !== "ready" || currentVault === null) return;

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
  }, [bootStatus, currentVault]);

  /**
   * Atajos globales de la ventana. Los lee de los ajustes, así que cambiarlos
   * en Ajustes → Atajos los cambia aquí también. El editor tiene los suyos
   * (Ctrl+S, deshacer…), que se atienden antes porque viven en el textarea.
   */
  // `handleSettingsChange` se recrea en cada render: llamarlo desde este
  // efecto con useEffectEvent evita meterlo en las deps (re-registraría el
  // listener en cada render) y siempre ejecuta la última versión.
  const onSettingsChangeEvent = useEffectEvent(handleSettingsChange);
  // La nota del día usa los últimos ajustes (carpeta/plantilla) sin volver a
  // registrar el listener de teclado en cada render.
  const openDailyNoteEvent = useEffectEvent(openDailyNote);

  useEffect(() => {
    function handleGlobalKey(event: KeyboardEvent) {
      const id = globalShortcutFor(event, settings.shortcuts);
      if (!id) return;

      switch (id) {
        case "zoomIn":
        case "zoomOut":
        case "zoomReset": {
          // El «+» y el «−» del teclado numérico llegan como código, no como tecla.
          const factor = id === "zoomIn" ? 10 : id === "zoomOut" ? -10 : 0;
          const zoom =
            factor === 0
              ? 100
              : Math.min(200, Math.max(50, settings.uiZoom + factor));
          event.preventDefault();
          if (zoom !== settings.uiZoom) onSettingsChangeEvent({ ...settings, uiZoom: zoom });
          return;
        }
        case "newTask":
          if (!currentVault) return;
          event.preventDefault();
          openNewTask();
          return;
        case "openDailyNote":
          if (!currentVault) return;
          event.preventDefault();
          void openDailyNoteEvent();
          return;
        case "focusSearch":
          // «Buscar nota» de la pantalla de bienvenida, con atajo propio.
          event.preventDefault();
          setActiveTab("notes");
          setPaletteOpen(true);
          return;
        case "togglePanel":
          // Muestra u oculta el contenido de la derecha, como un visor de lado.
          event.preventDefault();
          setRightHidden((hidden) => !hidden);
          return;
        case "commandPalette":
          if (!currentVault) return;
          event.preventDefault();
          setPaletteOpen((open) => !open);
          return;
        default:
      }
    }

    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [settings, currentVault]);

  // Menú nativo (macOS): sus etiquetas siguen el idioma de la app y cada
  // entrada propia llega aquí como `menu-action`. Fuera de macOS no hace nada.
  useEffect(() => {
    invoke("set_app_menu", { lang: language }).catch(() => {});
  }, [language]);

  const onMenuAction = useEffectEvent((id: string) => {
    if (!currentVault) return;
    if (id === "new-task") openNewTask();
    else if (id === "search") {
      setActiveTab("notes");
      setPaletteOpen(true);
    } else if (id.startsWith("tab-")) setActiveTab(id.slice(4) as TabId);
  });

  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => onMenuAction(event.payload));
    return () => void unlisten.then((off) => off());
  }, []);

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
        const title = titleFromFileName(file.name);
        setNote({ path: file.id, title, content });
        setTabs((open) => (open.some((tab) => tab.path === file.id) ? open : [...open, { path: file.id, title }]));
        setNoteStatus("ready");
      })
      .catch((error: unknown) => {
        setTabs((open) => open.filter((tab) => tab.path !== file.id));
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
  /** Cambia de pestaña guardando antes lo que haya sin guardar en la nota actual. */
  async function handleSelectTab(tab: NoteTab) {
    if (tab.path === note?.path) return;
    try {
      if (notePathRef.current) await handleBeforeFileAction(notePathRef.current);
    } catch (error: unknown) {
      setNoteError(String(error));
      return;
    }
    handleSelectNote({ id: tab.path, name: baseName(tab.path), kind: "note" });
  }

  async function handleCloseTab(tab: NoteTab) {
    if (tab.path !== note?.path) {
      setTabs((open) => open.filter((other) => other.path !== tab.path));
      return;
    }
    try {
      await handleBeforeFileAction(tab.path);
    } catch (error: unknown) {
      setNoteError(String(error));
      return;
    }
    const index = tabs.findIndex((other) => other.path === tab.path);
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (!next) {
      closeOpenNote();
      return;
    }
    setTabs((open) => open.filter((other) => other.path !== tab.path));
    handleSelectNote({ id: next.path, name: baseName(next.path), kind: "note" });
  }

  function handleExportPdf(file: NoteFile) {
    // Nota ya abierta: el evento va directo al editor montado. En otro caso la
    // petición viaja como prop y el editor la consume al montarse.
    if (note?.path === file.id && noteStatus === "ready") {
      editorRef.current?.requestExport();
      return;
    }
    setPendingExport(file.id);
    handleSelectNote(file);
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
      const previous = notePathRef.current;
      setTabs((open) => open.map((tab) => (tab.path === previous ? { path: draft.path, title: draft.title } : tab)));
      setVaultRefresh((key) => key + 1);
    }
    notePathRef.current = draft.path;
    setNote((prev) => (prev ? { ...prev, ...draft } : prev));

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

  function handleFileDeleted(path: string) {
    setTabs((open) => open.filter((tab) => !isInsidePath(tab.path, path)));
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
      throw new Error(t("app.saveBeforeAction"));
    }
  }

  function showLinkError(message: string) {
    setLinkError(message);
    if (linkErrorTimerRef.current !== null) window.clearTimeout(linkErrorTimerRef.current);
    linkErrorTimerRef.current = window.setTimeout(() => setLinkError(null), 6000);
  }

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

  useEffect(() => {
    return () => {
      if (linkErrorTimerRef.current !== null) window.clearTimeout(linkErrorTimerRef.current);
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
      if (!relative) throw new Error(t("app.badNoteName", { name: target }));

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

  /**
   * Abre la nota de un día (la de hoy si no se pasa fecha). Si todavía no
   * existe se crea con la plantilla de Ajustes y se abre recién nacida.
   */
  async function openDailyNote(date: Date = new Date()) {
    if (!currentVault || dailyBusyRef.current) return;

    dailyBusyRef.current = true;
    setDailyBusy(true);
    try {
      const activePath = notePathRef.current;
      if (activePath) await handleBeforeFileAction(activePath);

      const path = joinPath(currentVault, dailyRelativePath(settings.dailyNotesFolder, date));
      let target = path;

      try {
        await invoke<string>("read_vault_file", { path });
      } catch {
        // No existe todavía: se crea con la plantilla del día.
        const content = renderDailyTemplate(settings.dailyNotesTemplate, date, language);
        target = await invoke<string>("create_vault_file", { path, content });
        setVaultRefresh((key) => key + 1);
      }

      setActiveTab("notes");
      handleSelectNote({ id: target, name: baseName(target), kind: "note" });
    } catch (error: unknown) {
      showLinkError(String(error));
    } finally {
      dailyBusyRef.current = false;
      setDailyBusy(false);
    }
  }

  function closeOpenNote() {
    setTabs([]);
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
    openVaultBase(path);
    setActiveTab(settings.alwaysNotesTab ? "notes" : "home");
  }

  /** El idioma no va en el archivo del vault: se guarda aparte, en el equipo. */
  function handleLanguageChange(lang: Language) {
    onLanguageChange(lang);
    storeLanguage(lang);
  }

  /**
   * La primera bienvenida solo ofrece claro u oscuro y cada elección aplica su
   * tema por defecto; el resto de paletas se siguen eligiendo en Ajustes.
   */
  function handleSchemeChange(scheme: ThemeScheme) {
    handleSettingsChange({ ...settings, theme: scheme === "light" ? "gus-claro" : "gus-oscuro" });
  }

  /** Estilo actual, para marcar la tarjeta elegida en la bienvenida. */
  const scheme: ThemeScheme = themeDefinition(settings.theme).scheme;

  /** La bienvenida deja el tour pendiente: se lanza al abrir el primer vault. */
  function markTourPending() {
    storeTourStatus("pending");
  }

  function finishTour() {
    setTourOpen(false);
    storeTourStatus("done");
  }

  /** Identidad estable: el tour no debe reiniciarse si App re-renderiza. */
  const handleTourStepChange = useCallback((tab: TourTab) => setActiveTab(tab), []);

  function handleSettingsChange(next: AppSettings) {
    if (!vaultConfig) return;
    // Cambiar de tema estrena el acento propio del tema; después se puede cambiar a mano.
    const normalized: AppSettings =
      next.theme !== settings.theme ? { ...next, accent: "tema" } : next;
    saveVaultConfig({ ...vaultConfig, settings: normalized });
  }

  const showEntryPanel =
    !rightHidden &&
    (image !== null ||
      pdf !== null ||
      note !== null ||
      noteStatus === "loading" ||
      noteStatus === "error");

  /**
   * Día de la nota abierta, o `null` si lo que hay abierto no es una nota
   * diaria (entonces la barra de navegación no aparece).
   */
  const dailyNoteDate =
    note && currentVault
      ? dailyNoteDateFor(note.path, currentVault, settings.dailyNotesFolder)
      : null;

  const notesView = currentVault === null ? null : (
    <div className="flex h-full w-full">
      <FileExplorer
        key={currentVault}
        ref={explorerRef}
        vaultPath={currentVault}
        activeId={note?.path ?? image?.path ?? pdf?.path ?? null}
        onSelect={handleSelectNote}
        refreshKey={vaultRefresh}
        onOpenDailyNote={() => void openDailyNote()}
        onOpenSearch={() => setActiveTab("search")}
        onFileDeleted={handleFileDeleted}
        onBeforeFileAction={handleBeforeFileAction}
        onExportPdf={handleExportPdf}
        width={explorerWidth}
        shortcuts={settings.shortcuts}
      />

      {!rightHidden && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("app.resizeExplorer")}
        aria-valuenow={explorerWidth}
        aria-valuemin={EXPLORER_MIN_WIDTH}
        aria-valuemax={EXPLORER_MAX_WIDTH}
        tabIndex={0}
        title={t("app.resizeHint")}
        onPointerDown={explorer.onResizeStart}
        onDoubleClick={() => explorer.change(EXPLORER_DEFAULT_WIDTH)}
          onKeyDown={explorer.onResizeKeyDown}
          className="w-1.5 shrink-0 cursor-col-resize touch-none transition-colors hover:bg-gus-accent/40 focus-visible:bg-gus-accent/60 focus-visible:outline-none"
        />
      )}

      {showEntryPanel && (
        <div className="flex min-w-0 flex-1 flex-col">
          {tabs.length > 0 && (
            <NoteTabs tabs={tabs} activePath={note?.path ?? null} onSelect={(tab) => void handleSelectTab(tab)} onClose={(tab) => void handleCloseTab(tab)} />
          )}
          {image ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-gus-border bg-gus-panel px-4 py-2">
                <span className="truncate font-mono text-body text-gus-muted">{image.title}</span>
                <span className="shrink-0 gus-chip uppercase tracking-wide">
                  {t("app.badge.image")}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20 p-4">
                {imageStatus === "loading" && (
                  <p className="text-sm text-white/60">{t("app.loadingImage")}</p>
                )}

                {imageStatus === "error" && (
                  <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                    <p className="text-sm text-gus-muted">{t("app.imageError")}</p>
                    {image.error && (
                      <p className="break-words text-body text-rose-300">{image.error}</p>
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
                        error: t("app.imageDecodeError", { name: image.title }),
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
                <span className="truncate font-mono text-body text-gus-muted">{pdf.title}</span>
                <span className="shrink-0 gus-chip uppercase tracking-wide">
                  PDF
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-black/20">
                {pdfStatus === "loading" && (
                  <p className="text-sm text-white/60">{t("app.loadingPdf")}</p>
                )}

                {pdfStatus === "error" && (
                  <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
                    <p className="text-sm text-gus-muted">{t("app.pdfError")}</p>
                    {pdf.error && (
                      <p className="break-words text-body text-rose-300">{pdf.error}</p>
                    )}
                  </div>
                )}

                {pdfStatus === "ready" && pdf.src && (
                  <Suspense fallback={<p className="text-sm text-white/60">{t("app.loadingViewer")}</p>}>
                    <PdfViewer src={pdf.src} title={pdf.title} path={pdf.path} />
                  </Suspense>
                )}
              </div>
            </div>
          ) : (
            <>
              {noteStatus === "loading" && (
                <div className="flex h-full items-center justify-center text-sm text-gus-muted">
                  {t("app.loadingNote")}
                </div>
              )}

              {noteStatus === "error" && (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gus-muted">
                  <span>{t("app.noteError")}</span>
                  {noteError && (
                    <span className="break-words text-body text-rose-400/80">{noteError}</span>
                  )}
                </div>
              )}

              {noteStatus === "ready" && note && (
                <div className="flex min-h-0 flex-1 flex-col">
                  {dailyNoteDate && (
                    <DailyNoteBar
                      date={dailyNoteDate}
                      busy={dailyBusy}
                      onNavigate={(date) => void openDailyNote(date)}
                    />
                  )}

                  {externalNotice?.path === note.path && (
                    <div
                      role="status"
                      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-400/40 bg-gus-panel px-4 py-2 text-body text-amber-300"
                    >
                      <span className="min-w-0 flex-1">
                        {t(
                          externalNotice.kind === "conflict"
                            ? "app.externalConflict"
                            : "app.externalReloaded",
                          { title: note.title },
                        )}
                      </span>
                      {externalNotice.kind === "conflict" && (
                        <>
                          <button
                            type="button"
                            className="rounded-md border border-amber-400/40 px-2 py-1 hover:bg-white/5"
                            onClick={() => {
                              editorRef.current?.discardChanges();
                              handleSelectNote({ id: note.path, name: baseName(note.path), kind: "note" });
                              setExternalNotice(null);
                            }}
                          >
                            {t("app.externalReload")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-amber-400/40 px-2 py-1 hover:bg-white/5"
                            onClick={() => setExternalNotice(null)}
                          >
                            {t("app.externalKeep")}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <MarkdownEditor
                    ref={editorRef}
                    path={note.path}
                    title={note.title}
                    content={note.content}
                    vaultPath={currentVault}
                    onOpenWikiLink={handleOpenWikiLink}
                    linkRefs={linkRefs}
                    autoSave={handleAutoSave}
                    autoSaveEnabled={settings.autoSave}
                    fontSize={settings.editorFontSize}
                    spellLangs={settings.spellLangs}
                    shortcuts={settings.shortcuts}
                    spellWords={settings.spellWords}
                    onSpellWordsChange={(words) =>
                      handleSettingsChange({ ...settings, spellWords: words })
                    }
                    autoExportPath={pendingExport}
                    onAutoExportShown={() => setPendingExport(null)}
                    className="min-h-0 flex-1"
                  />

                  <BacklinksPanel
                    graph={linkGraph}
                    status={linkGraphStatus}
                    error={linkGraphError}
                    notePath={note.path}
                    onOpenNote={(selected) =>
                      handleSelectNote({
                        id: selected.path,
                        name: selected.name,
                        kind: "note",
                      })
                    }
                    onOpenWikiTarget={(target) => void handleOpenWikiLink(target)}
                  />
                </div>
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
    // LazyMotion + m: solo se empaqueta el motor que se usa (domMax incluye
    // animaciones, gestos y la prop `layout` de las listas).
    <LucideProvider strokeWidth={1.75}>
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion={settings.animations ? "user" : "always"}>
        <div
          className={clsx(
            "flex gus-app-root overflow-hidden bg-gus-bg text-gus-text",
            !settings.animations && "gus-no-motion",
          )}
          style={
            { "--color-gus-accent": accentHex(settings.accent, settings.theme) } as CSSProperties
          }
        >
          {showSidebar && (
            <Sidebar
              sidebar={sidebar}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              onLeaveVault={leaveVault}
            />
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
                {t("app.loading")}
              </div>
            ) : currentVault === null ? (
              <VaultPicker
                vaults={vaultConfig?.vaults ?? []}
                baseDir={vaultConfig?.baseDir ?? DEFAULT_BASE_DIR}
                lastVault={vaultConfig?.lastVault ?? null}
                busy={vaultBusy}
                error={vaultError}
                language={language}
                onLanguageChange={handleLanguageChange}
                scheme={scheme}
                onSchemeChange={handleSchemeChange}
                onWelcomeFinish={markTourPending}
                onOpen={openVault}
                onCreate={handleCreateVault}
                onAddExisting={handleAddExistingVault}
                onRename={handleRenameVault}
                onSetCover={handleSetVaultCover}
                onRemoveMany={handleRemoveVaults}
                onSelectBaseDir={handleSelectBaseDir}
              />
            ) : null}
            <AnimatePresence mode="wait" initial={false}>
              {/* La frontera queda fuera de la condición para poder observar la
                  salida de la sección (cierre de bóveda / arranque); el picker
                  y el spinner ocupan su sitio enseguida. */}
              {bootStatus !== "loading" && currentVault !== null && (
                <m.section
                  key={activeTab}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
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
                      onNewTask={openNewTask}
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
                      onNewTask={openNewTask}
                      onToggleNoteTask={toggleNoteTask}
                      onOpenNote={(path) => {
                        setActiveTab("notes");
                        handleSelectNote({ id: path, name: baseName(path), kind: "note" });
                      }}
                    />
                  ) : activeTab === "calendar" ? (
                    <CalendarView
                      vaultPath={currentVault}
                      onOpenTasks={() => setActiveTab("tasks")}
                      onNewTask={openNewTask}
                      showCompleted={settings.calendarShowCompleted}
                    />
                  ) : activeTab === "boards" ? (
                    <BoardsView vaultPath={currentVault} />
                  ) : activeTab === "habits" ? (
                    <HabitsView vaultPath={currentVault} />
                  ) : activeTab === "library" ? (
                    <Suspense fallback={<p className="p-6 text-sm text-gus-muted">{t("app.loadingViewer")}</p>}>
                      <LibraryView
                        vaultPath={currentVault}
                        refreshKey={vaultRefresh}
                        onOpenPdf={(pdf) => {
                          setActiveTab("notes");
                          handleSelectNote({ id: pdf.path, name: pdf.name, kind: "pdf" });
                        }}
                      />
                    </Suspense>
                  ) : activeTab === "graph" ? (
                    <GraphView
                      vaultPath={currentVault}
                      refreshKey={vaultRefresh}
                      onOpenNote={(file) => {
                        setActiveTab("notes");
                        handleSelectNote({
                          id: file.path,
                          name: file.name.split("/").pop() ?? file.name,
                          kind: "note",
                        });
                      }}
                    />
                  ) : activeTab === "search" ? (
                    <SearchView
                      vaultPath={currentVault}
                      refreshKey={vaultRefresh}
                      onIndexReady={handleSearchIndexReady}
                      onOpenNote={(file) => {
                        setActiveTab("notes");
                        handleSelectNote({
                          id: file.path,
                          name: file.name.split("/").pop() ?? file.name,
                          kind: "note",
                        });
                      }}
                    />
                  ) : activeTab === "trash" ? (
                    <TrashView
                      vaultPath={currentVault}
                      onRestore={() => setVaultRefresh((key) => key + 1)}
                    />
                  ) : (
                    <SettingsPanel
                      settings={settings}
                      onChange={handleSettingsChange}
                      language={language}
                      onLanguageChange={handleLanguageChange}
                      onStartTour={() => setTourOpen(true)}
                      onCheckUpdate={() => void checkNow()}
                      updateState={updateState}
                    />
                  )}
                </m.section>
              )}
            </AnimatePresence>
          </main>

          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            vaultPath={currentVault}
            onSelectNote={handlePaletteSelectNote}
            onOpenSearch={() => setActiveTab("search")}
            shortcuts={settings.shortcuts}
          />

          <NewTaskDialog
            key={newTaskSeq}
            open={newTaskOpen}
            onOpenChange={setNewTaskOpen}
          />

          <Tour
            open={tourOpen}
            onFinish={finishTour}
            onStepChange={handleTourStepChange}
          />

          <AnimatePresence>
            {updateNotice && (
              <UpdateNotice
                info={updateNotice}
                current={APP_VERSION}
                // A la derecha del menú lateral para no tapar sus botones.
                offsetLeft={currentVault ? sidebarWidth + 16 : 16}
                self={selfUpdate}
                onRestart={() => void restartAndInstall()}
                onRetry={() => void retryDownload()}
                onDismiss={dismissNotice}
              />
            )}
          </AnimatePresence>

          {linkError && (
            <div
              role="status"
              aria-live="polite"
              className={clsx(
                "fixed right-4 z-50 max-w-sm rounded-xl border border-rose-400/40 bg-gus-panel px-4 py-3 text-body text-rose-300 shadow-2xl shadow-black/40",
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
                "fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border bg-gus-panel px-4 py-3 text-body shadow-2xl shadow-black/40",
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
                {!currentVault
                  ? t("app.dropNoVault")
                  : dropOnNote
                    ? t("app.dropNote")
                    : t("app.dropVault")}
              </p>
              {currentVault && !dropOnNote && (
                <p className="max-w-md break-words text-body text-gus-muted">
                  {t("app.dropEnter", {
                    folder: relativeFolderLabel(dropFolder ?? currentVault, currentVault),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </MotionConfig>
    </LazyMotion>
    </LucideProvider>
  );
}

export default AppRoot;
