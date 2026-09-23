import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListTodo, StickyNote, type LucideIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import FileExplorer, { type NoteFile } from "./components/FileExplorer";
import MarkdownEditor, {
  type EditorDraft,
  type MarkdownEditorHandle,
} from "./components/MarkdownEditor";
import TaskList, { type Task } from "./components/TaskList";
import "./App.css";

type TabId = "notes" | "tasks";
type NoteStatus = "idle" | "loading" | "ready" | "error";

interface OpenNote {
  path: string;
  title: string;
  content: string;
}

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: "notes", label: "Notas", Icon: StickyNote },
  { id: "tasks", label: "Tareas", Icon: ListTodo },
];

const INITIAL_TASKS: Task[] = [
  { id: "task-1", title: "Montar el explorador de archivos", tags: ["dev"], completes: true },
  { id: "task-2", title: "Conectar read_vault_dir", tags: ["rust"], completes: false },
  { id: "task-3", title: "Diseñar el editor de notas", tags: ["ui"], completes: false },
];

function titleFromFileName(name: string): string {
  return name.replace(/\.md$/i, "");
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>("notes");
  const [note, setNote] = useState<OpenNote | null>(null);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [vaultRefresh, setVaultRefresh] = useState(0);

  const notePathRef = useRef<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  /** Abre la nota seleccionada en el FileExplorer leyendo su contenido de disco. */
  function handleSelectNote(file: NoteFile) {
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
      });
  }

  /** Autoguardado del editor: sincroniza el estado y refresca la lista si hubo rename. */
  function handleAutoSave(draft: EditorDraft) {
    if (notePathRef.current && notePathRef.current !== draft.path) {
      setVaultRefresh((key) => key + 1);
    }
    notePathRef.current = draft.path;
    setNote((prev) => (prev ? { ...prev, ...draft } : prev));
  }

  /** La nota activa fue eliminada desde el explorador: se cierra el editor. */
  function handleFileDeleted(path: string) {
    if (notePathRef.current !== path) return;
    notePathRef.current = null;
    setNote(null);
    setNoteError(null);
    setNoteStatus("idle");
  }

  /**
   * El explorador va a renombrar/mover/borrar `path`: se vuelca lo pendiente
   * mientras el archivo todavía existe, para que el desmontaje posterior del
   * editor no lo recrie en la ruta vieja. Si el volcado falla, la acción se
   * aborta (este handler rechaza y el explorador muestra el error).
   */
  async function handleBeforeFileAction(path: string): Promise<void> {
    if (notePathRef.current !== path) return;

    const saved = await editorRef.current?.flush() ?? true;
    if (!saved) {
      throw new Error("No se pudieron guardar los cambios de la nota antes de modificarla.");
    }
  }

  const notesView = (
    <div className="flex h-full w-full">
      <FileExplorer
        activeId={note?.path ?? null}
        onSelect={handleSelectNote}
        refreshKey={vaultRefresh}
        onFileDeleted={handleFileDeleted}
        onBeforeFileAction={handleBeforeFileAction}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {noteStatus === "loading" && (
          <div className="flex h-full items-center justify-center text-sm text-gus-muted">
            Cargando nota…
          </div>
        )}

        {noteStatus === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gus-muted">
            <span>No se pudo abrir la nota</span>
            {noteError && <span className="break-words text-xs text-rose-400/80">{noteError}</span>}
          </div>
        )}

        {noteStatus === "idle" && (
          <div className="flex h-full items-center justify-center text-sm text-gus-muted">
            Selecciona una nota de la izquierda
          </div>
        )}

        {noteStatus === "ready" && note && (
          <MarkdownEditor
            ref={editorRef}
            path={note.path}
            title={note.title}
            content={note.content}
            autoSave={handleAutoSave}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gus-bg text-gus-text">
      {/* Sidebar fijo de 64px (w-16) */}
      <aside className="fixed inset-y-0 left-0 z-10 flex w-16 flex-col items-center gap-2 border-r border-gus-border bg-gus-panel py-4">
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
      </aside>

      {/* Contenido principal, desplazado el ancho del sidebar */}
      <main className="ml-16 h-screen w-[calc(100%-4rem)] overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={activeTab}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="h-full w-full overflow-hidden"
          >
            {activeTab === "notes" ? notesView : <TaskList tasks={INITIAL_TASKS} />}
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
