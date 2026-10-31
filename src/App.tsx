import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { LucideProvider } from "lucide-react";
import { AnimatePresence, domMax, LazyMotion, m, MotionConfig } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
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
  type MarkdownEditorHandle,
} from "./components/MarkdownEditor";
import SettingsPanel from "./components/SettingsPanel";
import DailyNoteBar from "./components/DailyNoteBar";
import HabitsView from "./components/HabitsView";
import BoardsView from "./components/BoardsView";
import NoteTabs from "./components/NoteTabs";
import TaskList from "./components/TaskList";
import TrashView from "./components/TrashView";
import VaultPicker from "./components/VaultPicker";
import WelcomePanel from "./components/WelcomePanel";
import { baseName, joinPath } from "./lib/fileName";
import { dailyNoteDateFor, dailyRelativePath, renderDailyTemplate } from "./lib/dailyNotes";
import { findWikiNote, wikiTargetToPath, type WikiNote } from "./lib/wikiLink";
import { accentHex, DEFAULT_SETTINGS, type AppSettings } from "./lib/settings";
import { themeDefinition, type ThemeScheme } from "./lib/themes";
import { APP_VERSION } from "./lib/version";
import { useAppUpdates } from "./components/useAppUpdates";
import {
  I18nProvider,
  readStoredLanguage,
  storeLanguage,
  useT,
  type Language,
} from "./lib/i18n";
import { toLocalCoord } from "./lib/uiZoom";
import { useFileDrop } from "./components/useFileDrop";
import ImagePane from "./components/ImagePane";
import PdfPane from "./components/PdfPane";
import ExternalNoticeBar from "./components/ExternalNoticeBar";
import AppOverlays from "./components/AppOverlays";
import { useGlobalShortcuts } from "./components/useGlobalShortcuts";
import { useExternalChanges } from "./components/useExternalChanges";
import { useOpenEntries } from "./components/useOpenEntries";
import { useSearchIndexSync } from "./components/useSearchIndexSync";
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

// Visor de PDF: carga pdf.js solo cuando se abre el primer documento.
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
  /**
   * Mientras se abre o se crea la nota de un día, los botones de día esperan
   * (el ref corta el segundo clic en el mismo instante, antes de que React pinte).
   */
  const [dailyBusy, setDailyBusy] = useState(false);
  const dailyBusyRef = useRef(false);
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkErrorTimerRef = useRef<number | null>(null);
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


  const editorRef = useRef<MarkdownEditorHandle>(null);
  /** Para que el panel de bienvenida cree notas igual que el «+» del explorador. */
  const explorerRef = useRef<FileExplorerHandle>(null);

  const {
    note,
    tabs,
    noteStatus,
    noteError,
    pendingExport,
    setPendingExport,
    image,
    imageStatus,
    pdf,
    pdfStatus,
    notePathRef,
    handleSelectNote,
    handleSelectTab,
    handleCloseTab,
    handleAutoSave,
    handleFileDeleted,
    handleBeforeFileAction,
    closeOpenNote,
    failImage,
  } = useOpenEntries({
    editorRef,
    onFilesChanged: () => setVaultRefresh((key) => key + 1),
    onNoteSaved: (draft) => searchIndex.indexSavedNote(draft),
  });
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

  const { externalNotice, setExternalNotice } = useExternalChanges({
    ready: bootStatus === "ready",
    currentVault,
    note,
    notePathRef,
    editorRef,
    selectNote: handleSelectNote,
    onFilesChanged: () => setVaultRefresh((key) => key + 1),
  });
  const searchIndex = useSearchIndexSync(currentVault);
  const handleSearchIndexReady = searchIndex.handleSearchIndexReady;

  /** Recorrido guiado: se abre solo al primer vault y también desde Ajustes. */
  const [tourOpen, setTourOpen] = useState(false);
  const { updateState, updateNotice, selfUpdate, checkNow, retryDownload, restartAndInstall, dismissNotice } =
    useAppUpdates(bootStatus === "ready");

  const settings = vaultConfig?.settings ?? DEFAULT_SETTINGS;

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

  useGlobalShortcuts(settings, currentVault, language, {
    changeSettings: handleSettingsChange,
    openNewTask,
    openDailyNote: () => openDailyNote(),
    openPalette: () => {
      setActiveTab("notes");
      setPaletteOpen(true);
    },
    togglePalette: () => setPaletteOpen((open) => !open),
    togglePanel: () => setRightHidden((hidden) => !hidden),
    selectTab: setActiveTab,
  });

  /**
   * «Exportar a PDF» desde el explorador: se abre la nota (si no lo estaba) y
   * el editor muestra el diálogo con la vista previa ya montada.
   */
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
            <ImagePane
              image={image}
              status={imageStatus}
              onDecodeError={failImage}
            />
          ) : pdf ? (
            <PdfPane pdf={pdf} status={pdfStatus} />
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
                    <ExternalNoticeBar
                      notice={externalNotice}
                      title={note.title}
                      onReload={() => {
                        editorRef.current?.discardChanges();
                        handleSelectNote({ id: note.path, name: baseName(note.path), kind: "note" });
                        setExternalNotice(null);
                      }}
                      onKeep={() => setExternalNotice(null)}
                    />
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

          <AppOverlays
            currentVault={currentVault}
            linkError={linkError}
            importNotice={importNotice}
            droppingFiles={droppingFiles}
            dropFolder={dropFolder}
            dropOnNote={dropOnNote}
          />
        </div>
      </MotionConfig>
    </LazyMotion>
    </LucideProvider>
  );
}

export default AppRoot;
