import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  addTaskLine,
  normalizeTags,
  removeTaskLine,
  scanTaskLines,
  setTaskChecked,
  setTaskTags,
} from "../lib/markdownTasks";

export interface Task {
  id: string;
  title: string;
  /** Etiquetas de identificación libres: varias por tarea, en orden. */
  tags: string[];
  completes: boolean;
}

/** Tarea + su línea dentro del archivo (solo en modo archivo). */
interface Row extends Task {
  line?: number;
}

export interface TaskListProps {
  /** Lista inicial/estática. Se ignora si se pasa `filePath`. */
  tasks?: Task[];
  /** Archivo .md a sincronizar: lee y escribe las líneas `- [ ]` / `- [x]`. */
  filePath?: string | null;
  /** Se dispara con el arreglo completo cada vez que cambia. */
  onTasksChange?: (tasks: Task[]) => void;
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

/** Texto tecleado → etiquetas (se aceptan separadas por coma o espacio). */
function parseTagInput(text: string): string[] {
  return text.split(/[,，\s]+/).filter(Boolean);
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Convierte las líneas `- [ ]` / `- [x]` del archivo en tareas con id estable. */
function rowsFromMarkdown(markdown: string): Row[] {
  const seen = new Map<string, number>();

  return scanTaskLines(markdown).map((task) => {
    const occurrence = seen.get(task.title) ?? 0;
    seen.set(task.title, occurrence + 1);

    return {
      id: `${task.title}::${occurrence}`,
      title: task.title,
      tags: [...task.tags],
      completes: task.completes,
      line: task.line,
    };
  });
}

export default function TaskList({ tasks = [], filePath, onTasksChange }: TaskListProps) {
  const fileMode = filePath != null && filePath !== "";

  const [items, setItems] = useState<Row[]>(() =>
    fileMode ? [] : tasks.map((task) => ({ ...task })),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    fileMode ? "loading" : "ready",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  /** Formulario: título + etiquetas ya convertidas en chips + texto en curso. */
  const [title, setTitle] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  /** Edición en curso de las etiquetas de una fila (null = ninguna). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editInput, setEditInput] = useState("");
  /** Esc durante la edición: el blur posterior no debe guardar. */
  const editCancelledRef = useRef(false);

  const [reloadKey, setReloadKey] = useState(0);

  /** Último contenido del archivo (fuente de verdad para las mutaciones). */
  const markdownRef = useRef("");
  /** Serializa las escrituras para no pisar cambios rápidos. */
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const onTasksChangeRef = useRef(onTasksChange);
  onTasksChangeRef.current = onTasksChange;

  // Carga las líneas de tareas del archivo .md (solo en modo archivo).
  useEffect(() => {
    if (!fileMode || !filePath) return;

    let cancelled = false;
    setStatus("loading");

    invoke<string>("read_vault_file", { path: filePath })
      .then((markdown) => {
        if (cancelled) return;
        markdownRef.current = markdown;
        const rows = rowsFromMarkdown(markdown);
        setItems(rows);
        setLoadError(null);
        setStatus("ready");
        onTasksChangeRef.current?.(rows);
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
  }, [fileMode, filePath, reloadKey]);

  function notify(next: Row[]) {
    onTasksChangeRef.current?.(next);
  }

  /** Estado local para el modo estático (sin archivo). */
  function updateLocal(next: Row[]) {
    setItems(next);
    notify(next);
  }

  /** Aplica el nuevo contenido del markdown: reescanea, refresca y encola la escritura. */
  function commitMarkdown(nextMarkdown: string) {
    markdownRef.current = nextMarkdown;
    const rows = rowsFromMarkdown(nextMarkdown);
    setItems(rows);
    setSyncError(null);
    notify(rows);

    if (filePath) {
      const path = filePath;
      writeQueueRef.current = writeQueueRef.current
        .then(() => invoke("write_vault_file", { path, content: nextMarkdown }))
        .catch((error: unknown) => setSyncError(String(error)));
    }
  }

  // ------------------------------------------------------------------
  // Formulario: crear tarea
  // ------------------------------------------------------------------

  /** Vuelca el texto del campo de etiquetas a chips sin crear la tarea. */
  function commitDraftInput() {
    const parsed = parseTagInput(tagInput);
    if (parsed.length === 0) return;

    setDraftTags((prev) => normalizeTags([...prev, ...parsed]));
    setTagInput("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    const tags = normalizeTags([...draftTags, ...parseTagInput(tagInput)]);

    if (fileMode) {
      commitMarkdown(addTaskLine(markdownRef.current, cleanTitle, tags));
    } else {
      updateLocal([{ id: createId(), title: cleanTitle, tags, completes: false }, ...items]);
    }

    setTitle("");
    setDraftTags([]);
    setTagInput("");
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraftInput();
      return;
    }

    // Backspace en el campo vacío elimina el último chip.
    if (event.key === "Backspace" && tagInput === "" && draftTags.length > 0) {
      setDraftTags((prev) => prev.slice(0, -1));
    }
  }

  function handleTagInputChange(value: string) {
    // Escribir una coma confirma al instante lo que haya tecleado.
    if (/[,，]/.test(value)) {
      setDraftTags((prev) => normalizeTags([...prev, ...parseTagInput(value)]));
      setTagInput("");
      return;
    }
    setTagInput(value);
  }

  // ------------------------------------------------------------------
  // Edición de etiquetas de una fila
  // ------------------------------------------------------------------

  function startEditTags(task: Row) {
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

    if (fileMode && row.line !== undefined) {
      commitMarkdown(setTaskTags(markdownRef.current, row.line, tags));
    } else {
      updateLocal(items.map((task) => (task.id === id ? { ...task, tags } : task)));
    }
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

    if (fileMode && row.line !== undefined) {
      commitMarkdown(setTaskChecked(markdownRef.current, row.line, completes));
    } else {
      updateLocal(items.map((task) => (task.id === id ? { ...task, completes } : task)));
    }
  }

  function remove(id: string) {
    const row = items.find((task) => task.id === id);
    if (!row) return;

    if (fileMode && row.line !== undefined) {
      commitMarkdown(removeTaskLine(markdownRef.current, row.line));
    } else {
      updateLocal(items.filter((task) => task.id !== id));
    }
  }

  // Las pendientes arriba, las completadas al final (stable sort ⇒ reordenamiento animado).
  const visible = [...items].sort((a, b) => Number(a.completes) - Number(b.completes));
  const done = items.filter((task) => task.completes).length;

  const chipClass = "rounded-full border px-2 py-0.5 text-[11px] capitalize";

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-baseline justify-between">
        <h2
          className="text-sm font-semibold uppercase tracking-wider text-gus-muted"
          title={filePath ?? "lista estática"}
        >
          Tareas
        </h2>
        <span className="text-xs text-gus-muted">
          {status === "loading"
            ? "cargando…"
            : `${done}/${items.length} completadas`}
        </span>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Nueva tarea..."
            aria-label="Título de la tarea"
            className="min-w-0 flex-1 rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60"
          />
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gus-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Añadir
          </button>
        </div>

        {/* Etiquetas libres: varias por tarea (Enter o coma para añadir). */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-2.5 py-2 transition-colors focus-within:border-gus-accent/60">
          {draftTags.map((tag) => (
            <span
              key={tag}
              className={clsx("inline-flex items-center gap-1 capitalize", chipClass, tagColor(tag))}
            >
              {tag}
              <button
                type="button"
                onClick={() => setDraftTags((prev) => prev.filter((item) => item !== tag))}
                aria-label={`Quitar etiqueta ${tag}`}
                className="-mr-1 rounded-full px-1 opacity-60 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(event) => handleTagInputChange(event.target.value)}
            onKeyDown={handleTagInputKeyDown}
            placeholder={
              draftTags.length > 0
                ? "añadir otra…"
                : "etiquetas: #dev #ui (Enter o coma)"
            }
            aria-label="Etiquetas de la tarea"
            className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-gus-text outline-none placeholder:text-gus-muted"
          />
        </div>
      </form>

      {syncError && (
        <p className="-mt-2 rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
          No se pudo guardar en el archivo: {syncError}
        </p>
      )}

      <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {visible.map((task) => {
            const isEditing = editingId === task.id;

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
                  <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md border border-gus-border bg-gus-panel transition-colors peer-checked:border-gus-accent peer-checked:bg-gus-accent peer-focus-visible:ring-2 peer-focus-visible:ring-gus-accent/60">
                    <motion.span
                      initial={false}
                      animate={{
                        scale: task.completes ? 1 : 0,
                        opacity: task.completes ? 1 : 0,
                      }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    >
                      <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" />
                    </motion.span>
                  </span>
                  <span
                    className={clsx(
                      "truncate text-sm transition-colors",
                      task.completes ? "text-gus-muted line-through" : "text-gus-text",
                    )}
                  >
                    {task.title}
                  </span>
                </label>

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
                  <button
                    type="button"
                    onClick={() => startEditTags(task)}
                    title="Editar etiquetas"
                    aria-label={`Etiquetas de "${task.title}"`}
                    aria-haspopup="dialog"
                    aria-expanded={false}
                    className="flex shrink-0 flex-wrap items-center justify-end gap-1 rounded-md px-1 py-0.5 transition focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {task.tags.map((tag) => (
                      <span key={tag} className={clsx(chipClass, tagColor(tag))}>
                        {tag}
                      </span>
                    ))}
                    <span
                      aria-hidden="true"
                      className="rounded-full border border-dashed border-gus-border px-2 py-0.5 text-[11px] text-gus-muted transition-colors group-hover:border-gus-accent/50 group-hover:text-gus-accent"
                    >
                      +
                    </span>
                  </button>
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
              No se pudo leer <span className="font-mono">{filePath}</span>
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
            Sin tareas todavía. ¡Añade la primera!
          </li>
        )}
      </ul>
    </section>
  );
}
