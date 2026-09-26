import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Check, FileText, Flag, ListTodo, Plus, RefreshCw, SquareKanban, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { normalizeTags, parseTagInput, setTaskChecked } from "../lib/markdownTasks";
import { parseMarkdownTasks, type ParsedMarkdownTask } from "../utils/taskParser";
import { createTaskId, loadTaskStore, type Task } from "../lib/taskStore";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  isTaskPriority,
  nextPriority,
} from "../lib/taskPriority";
import { NEW_TASK_EVENT, type NewTask } from "../lib/newTask";
import KanbanBoard, { type KanbanColumnId } from "./KanbanBoard";

export type { Task };

export interface TaskListProps {
  tasks?: Task[];
  vaultPath?: string | null;
  onTasksChange?: (tasks: Task[]) => void;
  hideCompleted?: boolean;
  onNewTask: () => void;
  onOpenNote?: (path: string, name: string) => void;
}

const TAG_COLORS = [
  "border-gus-accent/40 bg-gus-accent/15 text-gus-accent",
  "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  "border-sky-400/30 bg-sky-400/10 text-sky-300",
  "border-amber-400/30 bg-amber-400/10 text-amber-300",
  "border-rose-400/30 bg-rose-400/10 text-rose-300",
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

interface NoteRef {
  name: string;
  path: string;
  relative: string;
}

interface NoteTask extends ParsedMarkdownTask {
  id: string;
  notePath: string;
  noteName: string;
  noteFolder: string;
}

function sortNoteTasks(tasks: NoteTask[]): NoteTask[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      a.noteName.localeCompare(b.noteName, "es") ||
      a.line - b.line,
  );
}

function locateNoteTask(content: string, task: ParsedMarkdownTask): ParsedMarkdownTask | null {
  const parsed = parseMarkdownTasks(content);
  const key = (row: ParsedMarkdownTask) => row.raw.replace(/\[([ xX])\]/, "[ ]");
  const wanted = key(task);

  return (
    parsed.find((row) => row.line === task.line && key(row) === wanted) ??
    parsed.find((row) => key(row) === wanted) ??
    null
  );
}

function hoyIso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
    hoy.getDate(),
  ).padStart(2, "0")}`;
}

function formatoFecha(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return iso;

  return fecha.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    ...(fecha.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function dueState(task: { completes: boolean; due?: string }): {
  due: string;
  title: string;
  className: string;
} | null {
  const due = task.due;
  if (!due) return null;

  const normal = "border-gus-border bg-gus-panel text-gus-muted";
  if (task.completes) {
    return { due, title: `Plazo: ${formatoFecha(due)}`, className: normal };
  }

  const hoy = hoyIso();
  if (due < hoy) {
    return { due, title: "Plazo vencido", className: "border-rose-400/40 bg-rose-400/10 text-rose-300" };
  }
  if (due === hoy) {
    return { due, title: "Vence hoy", className: "border-amber-400/40 bg-amber-400/10 text-amber-300" };
  }
  return { due, title: `Plazo: ${formatoFecha(due)}`, className: normal };
}

function CheckboxVisual({ checked }: { checked: boolean }) {
  return (
    <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md border border-gus-border bg-gus-panel transition-colors peer-checked:border-gus-accent peer-checked:bg-gus-accent peer-focus-visible:ring-2 peer-focus-visible:ring-gus-accent/60">
      <motion.span
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        <Check className="h-3.5 w-3.5 text-gus-bg" strokeWidth={3} aria-hidden="true" />
      </motion.span>
    </span>
  );
}

export default function TaskList({
  tasks = [],
  vaultPath,
  onTasksChange,
  hideCompleted = false,
  onNewTask,
  onOpenNote,
}: TaskListProps) {
  const fileMode = vaultPath != null && vaultPath !== "";

  const [items, setItems] = useState<Task[]>(() =>
    fileMode ? [] : tasks.map((task) => ({ ...task })),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    fileMode ? "loading" : "ready",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  /** Edición en curso de las etiquetas de una fila (null = ninguna). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editInput, setEditInput] = useState("");
  /** Esc durante la edición: el blur posterior no debe guardar. */
  const editCancelledRef = useRef(false);

  const [reloadKey, setReloadKey] = useState(0);

  /** Etiqueta por la que se filtra la vista (null = sin filtro). */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  /**
   * Vista activa: **el tablero Kanban es el que aparece primero** al entrar
   * en la zona de tareas; la lista clásica queda como opción alternativa.
   */
  const [view, setView] = useState<"list" | "board">("board");

  // --- Tareas escritas en las notas `.md` del vault -----------------
  const [noteTasks, setNoteTasks] = useState<NoteTask[]>([]);
  const [noteStatus, setNoteStatus] = useState<"loading" | "ready" | "error">("loading");
  const [noteError, setNoteError] = useState<string | null>(null);
  /** Error al escribir la casilla en el `.md` de una nota. */
  const [noteSyncError, setNoteSyncError] = useState<string | null>(null);
  const [notesReloadKey, setNotesReloadKey] = useState(0);

  /** Serializa las escrituras para no pisar cambios rápidos. */
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Ídem para las escrituras en los `.md` de las notas. */
  const noteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const onTasksChangeRef = useRef(onTasksChange);
  onTasksChangeRef.current = onTasksChange;

  // Carga el JSON oculto e importa el `tareas.md` antiguo una sola vez.
  useEffect(() => {
    if (!fileMode || !vaultPath) return;

    let cancelled = false;
    setStatus("loading");

    loadTaskStore(vaultPath)
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setLoadError(null);
        setStatus("ready");
        onTasksChangeRef.current?.(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        setLoadError(String(error));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [fileMode, vaultPath, reloadKey]);

  /**
   * Lee todas las notas del vault y extrae sus líneas `- [ ]` / `- [x]` con
   * `parseMarkdownTasks`. Se relee en cada montaje para no perder lo que el
   * editor haya cambiado en la pestaña Notas.
   */
  useEffect(() => {
    if (!fileMode || !vaultPath) return;

    let cancelled = false;
    setNoteTasks([]);
    setNoteStatus("loading");
    setNoteError(null);

    (async () => {
      try {
        const notes = await invoke<NoteRef[]>("list_vault_notes", { path: vaultPath });
        const collected: NoteTask[] = [];
        const BATCH = 8;

        for (let index = 0; index < notes.length; index += BATCH) {
          const batch = notes.slice(index, index + BATCH);
          const contents = await Promise.all(
            batch.map((note) =>
              invoke<string>("read_vault_file", { path: note.path }).catch(() => null),
            ),
          );
          if (cancelled) return;

          batch.forEach((note, offset) => {
            const content = contents[offset];
            if (content == null) return; // borrada entre medias ⇒ se ignora

            const slash = note.relative.lastIndexOf("/");
            const folder = slash === -1 ? "" : note.relative.slice(0, slash);
            for (const task of parseMarkdownTasks(content)) {
              collected.push({
                ...task,
                id: `${note.path}#${task.line}`,
                notePath: note.path,
                noteName: note.name,
                noteFolder: folder,
              });
            }
          });
        }

        if (cancelled) return;
        setNoteTasks(sortNoteTasks(collected));
        setNoteStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setNoteTasks([]);
        setNoteError(String(error));
        setNoteStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileMode, vaultPath, notesReloadKey]);

  function notify(next: Task[]) {
    onTasksChangeRef.current?.(next);
  }

  /** Estado local para el modo estático (sin vault). */
  function updateLocal(next: Task[]) {
    setItems(next);
    notify(next);
  }

  /** Actualiza la interfaz y encola el guardado en `.gus-tasks.json`. */
  function commitTasks(next: Task[]) {
    setItems(next);
    setSyncError(null);
    notify(next);

    if (fileMode && vaultPath) {
      const path = vaultPath;
      writeQueueRef.current = writeQueueRef.current
        .then(() => invoke("save_tasks", { vaultPath: path, tasks: next }))
        .catch((error: unknown) => setSyncError(String(error)));
    }
  }

  // ------------------------------------------------------------------
  // Ventana nativa: crear tarea (el formulario vive en una ventana aparte)
  // ------------------------------------------------------------------

  /** Inserta la tarea que envía el menú de creación (evento `task-created`). */
  function addTaskFromWindow(task: NewTask) {
    const cleanTitle = task.title.trim();
    if (!cleanTitle) return;
    // Sin almacén leído no se escribe nada (mejor esperar a que recargue).
    if (fileMode && status !== "ready") return;

    const tags = normalizeTags(task.tags);
    const description = task.description?.trim() || undefined;
    const due = task.due ?? undefined;
    const priority = isTaskPriority(task.priority) ? task.priority : undefined;

    const nextTask: Task = {
      id: createTaskId(),
      title: cleanTitle,
      tags,
      completes: false,
      ...(description ? { description } : {}),
      ...(due ? { due } : {}),
      ...(priority ? { priority } : {}),
    };

    if (fileMode) {
      commitTasks([nextTask, ...items]);
    } else {
      updateLocal([nextTask, ...items]);
    }
  }

  /** Callback más reciente, para que la suscripción única no quede obsoleto. */
  const addTaskRef = useRef(addTaskFromWindow);
  addTaskRef.current = addTaskFromWindow;

  // Escucha la tarea creada en la ventana nativa. En el navegador
  // (`pnpm dev` sin Tauri) no hay eventos y la lista queda como está.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<NewTask>(NEW_TASK_EVENT, (event) => {
      addTaskRef.current(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Fuera de Tauri no hay eventos.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ------------------------------------------------------------------
  // Edición de etiquetas de una fila
  // ------------------------------------------------------------------

  function startEditTags(task: Task) {
    if (editingId === task.id) return; // ya está abierto: no perder lo tecleado

    editCancelledRef.current = false;
    setEditingId(task.id);
    setEditTags([...task.tags]);
    setEditInput("");
  }

  /** Guarda las etiquetas editadas (o las descarta si `cancel` es true). */
  function closeEditTags(cancel: boolean) {
    const id = editingId;
    setEditingId(null);
    if (cancel || id == null) return;

    const row = items.find((task) => task.id === id);
    if (!row) return;

    const tags = normalizeTags([...editTags, ...parseTagInput(editInput)]);
    if (tags.join("\u0000") === normalizeTags(row.tags).join("\u0000")) return;

    commitTasks(items.map((task) => (task.id === id ? { ...task, tags } : task)));
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      editCancelledRef.current = true;
      setEditingId(null); // cierra sin guardar
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseTagInput(editInput);
      if (parsed.length > 0) {
        setEditTags((prev) => normalizeTags([...prev, ...parsed]));
        setEditInput("");
      } else {
        event.currentTarget.blur(); // ⇒ blur = guardar y cerrar
      }
      return;
    }

    if (event.key === "Backspace" && editInput === "" && editTags.length > 0) {
      setEditTags((prev) => prev.slice(0, -1));
    }
  }

  function handleEditBlur() {
    if (editCancelledRef.current) {
      editCancelledRef.current = false;
      return;
    }
    closeEditTags(false);
  }

  // ------------------------------------------------------------------
  // Toggle / borrar
  // ------------------------------------------------------------------

  function toggle(id: string) {
    const row = items.find((task) => task.id === id);
    if (!row) return;

    const completes = !row.completes;

    commitTasks(
      items.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task, completes };
        // Al completar, «En progreso» deja de tener sentido.
        if (completes) delete next.doing;
        return next;
      }),
    );
  }

  /**
   * Cicla la bandera de prioridad de una fila del almacén:
   * sin prioridad → baja → media → alta → urgente → sin prioridad.
   */
  function cyclePriority(id: string) {
    const row = items.find((task) => task.id === id);
    if (!row) return;

    const priority = nextPriority(row.priority);
    commitTasks(
      items.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task };
        delete next.priority;
        return priority ? { ...next, priority } : next;
      }),
    );
  }

  /** Mueve una tarea a otra columna del tablero Kanban. */
  function moveTask(id: string, column: KanbanColumnId) {
    commitTasks(
      items.map((task) => {
        if (task.id !== id) return task;
        const next: Task = {
          ...task,
          completes: column === "done",
          doing: column === "doing",
        };
        if (!next.doing) delete next.doing; // «en progreso» solo si lo está
        return next;
      }),
    );
  }

  /** Activa o desactiva el filtro de una etiqueta (clic en cualquier chip). */
  function toggleTagFilter(tag: string) {
    setTagFilter((current) =>
      current?.toLowerCase() === tag.toLowerCase() ? null : tag,
    );
  }

  /** ¿La tarea encaja con el filtro de etiqueta activo? (sin filtro = sí). */
  function matchesTag(tags: string[]): boolean {
    if (!tagFilter) return true;
    const wanted = tagFilter.toLowerCase();
    return tags.some((tag) => tag.toLowerCase() === wanted);
  }

  function remove(id: string) {
    const row = items.find((task) => task.id === id);
    if (!row) return;

    commitTasks(items.filter((task) => task.id !== id));
  }

  /**
   * Marca/desmarca una tarea de nota: solo se reescribe la checkbox dentro de
   * su `.md` (texto, `#tag`s y `📅` quedan intactos). La actualización es
   * optimista y, si la escritura falla, se deshace mostrando el error.
   */
  function toggleNoteTask(task: NoteTask) {
    const completes = !task.completed;
    const previous = noteTasks;

    setNoteSyncError(null);
    setNoteTasks((prev) =>
      prev.map((row) => (row.id === task.id ? { ...row, completed: completes } : row)),
    );

    noteQueueRef.current = noteQueueRef.current.then(async () => {
      try {
        const content = await invoke<string>("read_vault_file", { path: task.notePath });
        const target = locateNoteTask(content, task);
        if (!target) throw new Error("la línea cambió en la nota");

        const next = setTaskChecked(content, target.line, completes);
        if (next !== content) {
          await invoke("write_vault_file", { path: task.notePath, content: next });
        }

        // Relee la nota entera: al cambiar la checkbox los índices pueden moverse.
        setNoteTasks((prev) =>
          sortNoteTasks([
            ...prev.filter((row) => row.notePath !== task.notePath),
            ...parseMarkdownTasks(next).map((row) => ({
              ...row,
              id: `${task.notePath}#${row.line}`,
              notePath: task.notePath,
              noteName: task.noteName,
              noteFolder: task.noteFolder,
            })),
          ]),
        );
      } catch (error) {
        setNoteTasks(previous); // deshacer el optimismo
        setNoteSyncError(String(error));
      }
    });
  }

  // Las pendientes arriba, las completadas al final (stable sort ⇒ reordenamiento animado).
  const visible = [...items]
    .filter((task) => (!hideCompleted || !task.completes) && matchesTag(task.tags))
    .sort((a, b) => Number(a.completes) - Number(b.completes));
  const done = items.filter((task) => task.completes).length;

  // El tablero ignora «ocultar completadas»: su columna es el resumen de eso.
  const boardItems = items.filter((task) => matchesTag(task.tags));

  // Tareas de las notas: pendientes primero (el orden ya viene del parser).
  const noteVisible = noteTasks.filter(
    (task) => (!hideCompleted || !task.completed) && matchesTag(task.tags),
  );
  const noteDone = noteTasks.filter((task) => task.completed).length;

  // Etiquetas usadas por todas las tareas, con recuento, para la barra de filtro.
  const tagCounts = new Map<string, { label: string; count: number }>();
  for (const task of [...items, ...noteTasks]) {
    for (const tag of task.tags) {
      const key = tag.toLowerCase();
      const slot = tagCounts.get(key);
      if (slot) slot.count += 1;
      else tagCounts.set(key, { label: tag, count: 1 });
    }
  }
  const tagEntries = [...tagCounts.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "es"),
  );

  const chipClass = "rounded-full border px-2 py-0.5 text-[11px] capitalize";

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className="text-sm font-semibold uppercase tracking-wider text-gus-muted"
          title={vaultPath ? `Almacén oculto · ${vaultPath}` : "lista estática"}
        >
          Tareas
        </h2>
        <div className="flex items-center gap-3">
          <div
            role="tablist"
            aria-label="Vista de tareas"
            className="flex rounded-lg border border-gus-border bg-gus-card p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "board"}
              onClick={() => setView("board")}
              title="Tablero Kanban: arrastra las tarjetas entre columnas"
              className={clsx(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                view === "board"
                  ? "bg-gus-panel text-gus-text"
                  : "text-gus-muted hover:text-gus-text",
              )}
            >
              <SquareKanban className="h-3.5 w-3.5" aria-hidden="true" />
              Tablero
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => setView("list")}
              title="Vista lista: las tareas una debajo de otra"
              className={clsx(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                view === "list"
                  ? "bg-gus-panel text-gus-text"
                  : "text-gus-muted hover:text-gus-text",
              )}
            >
              <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
              Lista
            </button>
          </div>
          <span className="text-xs text-gus-muted">
            {status === "loading"
              ? "cargando…"
              : `${done + noteDone}/${items.length + noteTasks.length} completadas`}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        {/* El formulario de creación vive en un menú superpuesto global. */}
        <button
          type="button"
          onClick={onNewTask}
          disabled={status === "loading" || status === "error"}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gus-accent px-3 py-2 text-sm font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva tarea
        </button>

        {syncError && (
          <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
            No se pudo guardar en el almacén oculto: {syncError}
          </p>
        )}

      </div>

      {/* Filtro por etiquetas: clic en un chip = filtrar por esa etiqueta. */}      {tagEntries.length > 0 && (
        <div
          role="group"
          aria-label="Filtrar tareas por etiqueta"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11px] text-gus-muted">Etiquetas:</span>
          {tagEntries.map(({ label, count }) => {
            const active =
              !!tagFilter && tagFilter.toLowerCase() === label.toLowerCase();
            return (
              <button
                key={label.toLowerCase()}
                type="button"
                onClick={() => toggleTagFilter(label)}
                aria-pressed={active}
                title={`Filtrar por #${label} · ${count} ${
                  count === 1 ? "tarea" : "tareas"
                }`}
                className={clsx(
                  chipClass,
                  "inline-flex items-center gap-1 transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                  tagColor(label),
                  active && "ring-2 ring-gus-accent/70",
                )}
              >
                {label}
                <span className="opacity-60">{count}</span>
              </button>
            );
          })}
          {tagFilter && (
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              title="Quitar el filtro de etiqueta"
              className="flex items-center gap-1 rounded-full border border-gus-border px-2 py-0.5 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              Todas <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="gus-scrollbar flex-1 space-y-6 overflow-y-auto pr-1">
        {/* ---------------------------------------------------------- */}
        {/* Vista «Tablero» (Kanban): columnas con tarjetas arrastrables  */}
        {/* ---------------------------------------------------------- */}
        {view === "board" && (
          <div className="space-y-3">
            {status === "loading" && (
              <p className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
                Leyendo tareas del archivo…
              </p>
            )}

            {status === "error" && (
              <p className="break-words rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
                No se pudo leer el almacén oculto de tareas
                {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                {loadError && <span className="block text-rose-400/80">{loadError}</span>}
              </p>
            )}

            {status === "ready" && (
              <KanbanBoard
                tasks={boardItems}
                onMove={moveTask}
                onTagClick={toggleTagFilter}
                tagFilter={tagFilter}
              />
            )}
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Tareas rápidas: almacén oculto `.gus-tasks.json`             */}
        {/* ---------------------------------------------------------- */}
        {view === "list" && (
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gus-muted">
          Rápidas
        </h3>
        )}
        {view === "list" && (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.map((task) => {
              const isEditing = editingId === task.id;
              const plazo = dueState(task);

              return (
                <motion.li
                  key={task.id}
                  layout
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, x: -24 }}
                  transition={{
                    duration: 0.2,
                    ease: "easeOut",
                    layout: { type: "spring", stiffness: 500, damping: 45 },
                  }}
                  className={clsx(
                    "group relative flex items-center gap-3 overflow-hidden rounded-xl border border-gus-border bg-gus-card px-3 py-2.5",
                    isEditing && "z-30",
                  )}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={task.completes}
                      onChange={() => toggle(task.id)}
                      className="peer sr-only"
                    />
                    <CheckboxVisual checked={task.completes} />
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={clsx(
                          "truncate text-sm transition-colors",
                          task.completes ? "text-gus-muted line-through" : "text-gus-text",
                        )}
                      >
                        {task.title}
                      </span>
                      {task.description && (
                        <span
                          className="truncate text-[11px] text-gus-muted"
                          title={task.description}
                        >
                          {task.description.replace(/\n+/g, " · ")}
                        </span>
                      )}
                    </span>
                  </label>

                  {/* Bandera de prioridad: clic para subir de nivel. */}
                  <button
                    type="button"
                    onClick={() => cyclePriority(task.id)}
                    title={
                      task.priority
                        ? `Prioridad ${PRIORITY_LABEL[task.priority]} · clic para cambiar`
                        : "Sin prioridad · clic para subir a baja"
                    }
                    aria-label={`Prioridad de "${task.title}": ${
                      task.priority ? PRIORITY_LABEL[task.priority] : "ninguna"
                    }. Cambiar.`}
                    className={clsx(
                      "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                      task.priority
                        ? PRIORITY_CLASS[task.priority]
                        : "border-dashed border-gus-border text-gus-muted hover:border-gus-accent/50 hover:text-gus-accent",
                    )}
                  >
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {task.priority}
                  </button>

                  {plazo && (
                    <span
                      title={plazo.title}
                      className={clsx(
                        "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        plazo.className,
                      )}
                    >
                      <Calendar className="h-3 w-3" aria-hidden="true" />
                      {plazo.due ? formatoFecha(plazo.due) : null}
                    </span>
                  )}

                  {isEditing ? (
                    /* Editor desplegable: chips con × + campo para escribir. */
                    <div className="absolute top-full right-11 z-30 mt-1 w-60 rounded-xl border border-gus-border bg-gus-card p-2 shadow-xl shadow-black/40">
                      <p className="mb-1.5 text-[10px] tracking-wider text-gus-muted uppercase">
                        Etiquetas de "{task.title}"
                      </p>
                      <div
                        className="flex flex-wrap gap-1.5"
                        // El ratón no debe quitarle el foco al input (se guarda al salir).
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {editTags.map((tag) => (
                          <span
                            key={tag}
                            className={clsx(
                              "inline-flex items-center gap-1 capitalize",
                              chipClass,
                              tagColor(tag),
                            )}
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => setEditTags((prev) => prev.filter((t) => t !== tag))}
                              aria-label={`Quitar etiqueta ${tag}`}
                              className="-mr-1 rounded-full px-1 opacity-60 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                        {editTags.length === 0 && (
                          <span className="text-[11px] text-gus-muted">Sin etiquetas</span>
                        )}
                      </div>
                      <input
                        autoFocus
                        value={editInput}
                        onChange={(event) => setEditInput(event.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={handleEditBlur}
                        placeholder="añadir… (Enter o coma)"
                        title="Enter añade · Esc cancela · al salir se guarda"
                        aria-label={`Nueva etiqueta para ${task.title}`}
                        className="mt-2 w-full rounded-md border border-gus-border bg-gus-panel px-2 py-1 text-xs text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60"
                      />
                    </div>
                  ) : (
                    /* Chips = filtro por la etiqueta; el «+» abre el editor. */
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {task.tags.map((tag) => {
                        const active =
                          !!tagFilter && tagFilter.toLowerCase() === tag.toLowerCase();
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagFilter(tag)}
                            title={`Filtrar por #${tag}`}
                            aria-pressed={active}
                            className={clsx(
                              chipClass,
                              "transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                              tagColor(tag),
                              active && "ring-2 ring-gus-accent/70",
                            )}
                          >
                            {tag}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => startEditTags(task)}
                        title="Editar etiquetas"
                        aria-label={`Etiquetas de "${task.title}"`}
                        aria-haspopup="dialog"
                        className="rounded-full border border-dashed border-gus-border px-2 py-0.5 text-[11px] text-gus-muted transition-colors group-hover:border-gus-accent/50 group-hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                      >
                        +
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => remove(task.id)}
                    aria-label={`Eliminar "${task.title}"`}
                    className="shrink-0 rounded-md p-1.5 text-gus-muted opacity-0 transition hover:bg-rose-400/10 hover:text-rose-400 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>

          {status === "loading" && (
            <li className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
              Leyendo tareas del archivo…
            </li>
          )}

          {status === "error" && (
            <li className="flex flex-col items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
              <span className="break-words">
                No se pudo leer el almacén oculto de tareas
                {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                {loadError && <span className="block text-rose-400/80">{loadError}</span>}
              </span>
              <button
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
                className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Reintentar
              </button>
            </li>
          )}

          {status === "ready" && visible.length === 0 && (
            <li className="rounded-xl border border-dashed border-gus-border px-4 py-10 text-center text-sm text-gus-muted">
              {tagFilter
                ? `Ninguna tarea rápida con la etiqueta «${tagFilter}».`
                : "Sin tareas todavía. ¡Añade la primera!"}
            </li>
          )}
        </ul>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Tareas escritas en las notas `.md` del vault                 */}
        {/* ---------------------------------------------------------- */}
        {fileMode && view === "list" && (
          <section aria-labelledby="notas-tareas-heading">
            <h3
              id="notas-tareas-heading"
              className="text-[11px] font-semibold uppercase tracking-wider text-gus-muted"
            >
              Notas del vault
              {noteStatus === "ready" && (
                <span className="ml-2 font-normal normal-case">
                  · {noteDone}/{noteTasks.length}
                </span>
              )}
            </h3>

            {noteSyncError && (
              <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
                No se pudo escribir en la nota: {noteSyncError}
              </p>
            )}

            <ul className="mt-2 space-y-2">
              {noteStatus === "loading" && (
                <li className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
                  Leyendo tareas de las notas…
                </li>
              )}

              {noteStatus === "error" && (
                <li className="flex flex-col items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
                  <span className="break-words">
                    No se pudieron leer las notas del vault
                    {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                    {noteError && <span className="block text-rose-400/80">{noteError}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNotesReloadKey((key) => key + 1)}
                    className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Reintentar
                  </button>
                </li>
              )}

              <AnimatePresence initial={false}>
                {noteVisible.map((task) => {
                  const plazo = dueState({ completes: task.completed, due: task.due });

                  return (
                    <motion.li
                      key={task.id}
                      layout
                      initial={{ opacity: 0, height: 0, y: -8 }}
                      animate={{ opacity: 1, height: "auto", y: 0 }}
                      exit={{ opacity: 0, height: 0, x: -24 }}
                      transition={{
                        duration: 0.2,
                        ease: "easeOut",
                        layout: { type: "spring", stiffness: 500, damping: 45 },
                      }}
                      className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-gus-border bg-gus-card px-3 py-2.5"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={() => void toggleNoteTask(task)}
                          className="peer sr-only"
                        />
                        <CheckboxVisual checked={task.completed} />
                        <span className="flex min-w-0 flex-col">
                          <span
                            className={clsx(
                              "truncate text-sm transition-colors",
                              task.completed
                                ? "text-gus-muted line-through"
                                : "text-gus-text",
                            )}
                          >
                            {task.title || "(tarea sin texto)"}
                          </span>
                          <span className="truncate text-[11px] text-gus-muted">
                            {task.noteName.replace(/\.md$/i, "")}
                            {task.noteFolder ? ` · ${task.noteFolder}` : ""}
                          </span>
                        </span>
                      </label>

                      {task.priority && (
                        <span
                          title={`Prioridad ${PRIORITY_LABEL[task.priority]}`}
                          className={clsx(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] capitalize",
                            PRIORITY_CLASS[task.priority],
                          )}
                        >
                          !{task.priority}
                        </span>
                      )}

                      {plazo && (
                        <span
                          title={plazo.title}
                          className={clsx(
                            "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                            plazo.className,
                          )}
                        >
                          <Calendar className="h-3 w-3" aria-hidden="true" />
                          {plazo.due ? formatoFecha(plazo.due) : null}
                        </span>
                      )}

                      {task.tags.length > 0 && (
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {task.tags.map((tag) => {
                            const active =
                              !!tagFilter && tagFilter.toLowerCase() === tag.toLowerCase();
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTagFilter(tag)}
                                title={`Filtrar por #${tag}`}
                                aria-pressed={active}
                                className={clsx(
                                  chipClass,
                                  "transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                                  tagColor(tag),
                                  active && "ring-2 ring-gus-accent/70",
                                )}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </span>
                      )}

                      {onOpenNote && (
                        <button
                          type="button"
                          onClick={() => onOpenNote(task.notePath, task.noteName)}
                          title={`Abrir «${task.noteName}»`}
                          aria-label={`Abrir la nota ${task.noteName}`}
                          className="shrink-0 rounded-md p-1.5 text-gus-muted opacity-0 transition hover:text-gus-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none group-hover:opacity-100"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </motion.li>
                  );
                })}
              </AnimatePresence>

              {noteStatus === "ready" && noteVisible.length === 0 && (
                <li className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
                  {tagFilter
                    ? `Ninguna tarea de notas con la etiqueta «${tagFilter}».`
                    : "Ninguna nota tiene tareas pendientes."}
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
