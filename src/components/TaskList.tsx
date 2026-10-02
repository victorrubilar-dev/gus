import { useEffect, useLayoutEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Calendar, Check, Flag, ListTodo, Plus, RefreshCw, SquareKanban, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { normalizeTags, parseTagInput } from "../lib/markdownTasks";
import { createTaskId, loadTaskStore, type Task } from "../lib/taskStore";
import {
  PRIORITY_CLASS,
  priorityLabel,
  isTaskPriority,
  nextPriority,
} from "../lib/taskPriority";
import { useT } from "../lib/i18n";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";
import { NEW_TASK_EVENT, type NewTask } from "../lib/newTask";
import KanbanBoard, { type KanbanColumnId } from "./KanbanBoard";

export type { Task };

type Translator = (key: MessageKey, params?: TranslateParams) => string;

export interface TaskListProps {
  tasks?: Task[];
  vaultPath?: string | null;
  onTasksChange?: (tasks: Task[]) => void;
  hideCompleted?: boolean;
  onNewTask: () => void;
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

function hoyIso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(
    hoy.getDate(),
  ).padStart(2, "0")}`;
}

function formatoFecha(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return iso;

  return fecha.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(fecha.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function dueState(
  task: { completes: boolean; due?: string },
  t: Translator,
): { due: string; title: string; className: string } | null {
  const due = task.due;
  if (!due) return null;

  const normal = "border-gus-border bg-gus-panel text-gus-muted";
  const plain = `${t("tasks.dueLabel")}: ${formatoFecha(due)}`;
  if (task.completes) {
    return { due, title: plain, className: normal };
  }

  const hoy = hoyIso();
  if (due < hoy) {
    return {
      due,
      title: t("tasks.dueOverdue"),
      className: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    };
  }
  if (due === hoy) {
    return {
      due,
      title: t("tasks.dueToday"),
      className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    };
  }
  return { due, title: plain, className: normal };
}

function CheckboxVisual({ checked }: { checked: boolean }) {
  return (
    <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md border border-gus-border bg-gus-panel transition-colors peer-checked:border-gus-accent peer-checked:bg-gus-accent peer-focus-visible:ring-2 peer-focus-visible:ring-gus-accent/60">
      <m.span
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        <Check className="h-3.5 w-3.5 text-gus-bg" strokeWidth={3} aria-hidden="true" />
      </m.span>
    </span>
  );
}

export default function TaskList({
  tasks = [],
  vaultPath,
  onTasksChange,
  hideCompleted = false,
  onNewTask,
}: TaskListProps) {
  const t = useT();
  const fileMode = vaultPath != null && vaultPath !== "";

  const [items, setItems] = useState<Task[]>(() =>
    fileMode ? [] : tasks.map((task) => ({ ...task })),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    fileMode ? "loading" : "ready",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editInput, setEditInput] = useState("");
  const editCancelledRef = useRef(false);

  const [reloadKey, setReloadKey] = useState(0);

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "board">("board");

  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Último callback del padre. Al llamarse también desde handlers (no solo
  // desde efectos) hace falta el espejo de ref, sincronizado tras el commit.
  const onTasksChangeRef = useRef(onTasksChange);
  useLayoutEffect(() => {
    onTasksChangeRef.current = onTasksChange;
  });

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

  function notify(next: Task[]) {
    onTasksChangeRef.current?.(next);
  }

  function updateLocal(next: Task[]) {
    setItems(next);
    notify(next);
  }

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

  function addTaskFromWindow(task: NewTask) {
    const cleanTitle = task.title.trim();
    if (!cleanTitle) return;
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

  const onNewTaskEvent = useEffectEvent(addTaskFromWindow);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<NewTask>(NEW_TASK_EVENT, (event) => {
      onNewTaskEvent(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function startEditTags(task: Task) {
    if (editingId === task.id) return;

    editCancelledRef.current = false;
    setEditingId(task.id);
    setEditTags([...task.tags]);
    setEditInput("");
  }

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
      setEditingId(null);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseTagInput(editInput);
      if (parsed.length > 0) {
        setEditTags((prev) => normalizeTags([...prev, ...parsed]));
        setEditInput("");
      } else {
        event.currentTarget.blur();
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

  function toggle(id: string) {
    const row = items.find((task) => task.id === id);
    if (!row) return;

    const completes = !row.completes;

    commitTasks(
      items.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task, completes };
        if (completes) delete next.doing;
        return next;
      }),
    );
  }

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

  function toggleTagFilter(tag: string) {
    setTagFilter((current) =>
      current?.toLowerCase() === tag.toLowerCase() ? null : tag,
    );
  }

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

  const visible = [...items]
    .filter((task) => (!hideCompleted || !task.completes) && matchesTag(task.tags))
    .sort((a, b) => Number(a.completes) - Number(b.completes));
  const done = items.filter((task) => task.completes).length;

  const boardItems = items.filter((task) => matchesTag(task.tags));


  const tagCounts = new Map<string, { label: string; count: number }>();
  for (const task of items) {
    for (const tag of task.tags) {
      const key = tag.toLowerCase();
      const slot = tagCounts.get(key);
      if (slot) slot.count += 1;
      else tagCounts.set(key, { label: tag, count: 1 });
    }
  }
  const tagEntries = [...tagCounts.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const chipClass = "rounded-full border px-2 py-0.5 text-[11px] capitalize";

  return (
    <section data-tour="tasks" className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className="text-sm font-semibold uppercase tracking-wider text-gus-muted"
          title={vaultPath ? t("tasks.storeTitle", { path: vaultPath }) : t("tasks.staticList")}
        >
          {t("tasks.title")}
        </h2>
        <div className="flex items-center gap-3">
          <div
            role="tablist"
            aria-label={t("tasks.title")}
            className="flex rounded-lg border border-gus-border bg-gus-card p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "board"}
              onClick={() => setView("board")}
              title={t("tasks.kanban")}
              className={clsx(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                view === "board"
                  ? "bg-gus-panel text-gus-text"
                  : "text-gus-muted hover:text-gus-text",
              )}
            >
              <SquareKanban className="h-3.5 w-3.5" aria-hidden="true" />
              {t("tasks.viewBoard")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => setView("list")}
              title={t("tasks.list")}
              className={clsx(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                view === "list"
                  ? "bg-gus-panel text-gus-text"
                  : "text-gus-muted hover:text-gus-text",
              )}
            >
              <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
              {t("tasks.viewList")}
            </button>
          </div>
          <span className="text-xs text-gus-muted">
            {status === "loading"
              ? t("common.loading")
              : t("tasks.doneCount", { done, total: items.length })}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onNewTask}
          disabled={status === "loading" || status === "error"}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gus-accent px-3 py-2 text-sm font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("tasks.new")}
        </button>

        {syncError && (
          <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
            {t("tasks.syncError", { error: syncError })}
          </p>
        )}

      </div>

      {tagEntries.length > 0 && (
        <div
          role="group"
          aria-label={t("tasks.filterTag")}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-[11px] text-gus-muted">{t("tasks.tagsLabel")}</span>
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
              title={t("tasks.removeFilter")}
              className="flex items-center gap-1 rounded-full border border-gus-border px-2 py-0.5 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              {t("common.all")} <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="gus-scrollbar flex-1 space-y-6 overflow-y-auto pr-1">
        {/* La frontera vive fuera de las condiciones de vista: al cambiar de
            vista observa la salida (los `m.li` anidados corren su `exit`) y la
            lista espera a terminar antes de enseñar el tablero. */}
        <AnimatePresence mode="wait" initial={false}>
        {view === "board" && (
          <div key="board" className="space-y-3">
            {status === "loading" && (
              <p className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
                {t("tasks.loading")}
              </p>
            )}

            {status === "error" && (
              <p className="break-words rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
                {t("tasks.loadError")}
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

        {view === "list" && (
        <ul key="list" className="space-y-2">
            {visible.map((task) => {
              const isEditing = editingId === task.id;
              const plazo = dueState(task, t);

              return (
                <m.li
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -24 }}
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

                  <button
                    type="button"
                    onClick={() => cyclePriority(task.id)}
                    title={
                      task.priority
                        ? t("tasks.priorityChange", { name: priorityLabel(task.priority) })
                        : t("tasks.priorityHint")
                    }
                    aria-label={t("tasks.priorityAria", {
                      title: task.title,
                      name: task.priority ? priorityLabel(task.priority) : t("priority.none"),
                    })}
                    className={clsx(
                      "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                      task.priority
                        ? PRIORITY_CLASS[task.priority]
                        : "border-dashed border-gus-border text-gus-muted hover:border-gus-accent/50 hover:text-gus-accent",
                    )}
                  >
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {task.priority ? priorityLabel(task.priority) : null}
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
                    <div className="absolute top-full right-11 z-30 mt-1 w-60 rounded-xl border border-gus-border bg-gus-card p-2 shadow-xl shadow-black/40">
                      <p className="mb-1.5 text-[10px] tracking-wider text-gus-muted uppercase">
                        {t("tasks.tagsOf", { title: task.title })}
                      </p>
                      <div
                        className="flex flex-wrap gap-1.5"
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
                              aria-label={t("tasks.removeTag", { tag })}
                              className="-mr-1 rounded-full px-1 opacity-60 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                        {editTags.length === 0 && (
                          <span className="text-[11px] text-gus-muted">{t("tasks.noTags")}</span>
                        )}
                      </div>
                      <input
                        autoFocus
                        value={editInput}
                        onChange={(event) => setEditInput(event.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={handleEditBlur}
                        placeholder={t("tasks.addTagPlaceholder")}
                        title={t("tasks.editHint")}
                        aria-label={t("tasks.newTagFor", { title: task.title })}
                        className="mt-2 w-full rounded-md border border-gus-border bg-gus-panel px-2 py-1 text-xs text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60"
                      />
                    </div>
                  ) : (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {task.tags.map((tag) => {
                        const active =
                          !!tagFilter && tagFilter.toLowerCase() === tag.toLowerCase();
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagFilter(tag)}
                            title={t("tasks.filterByTag", { tag })}
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
                        title={t("tasks.editTags")}
                        aria-label={t("tasks.tagsOf", { title: task.title })}
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
                    aria-label={t("tasks.deleteNamed", { title: task.title })}
                    className="shrink-0 rounded-md p-1.5 text-gus-muted opacity-0 transition hover:bg-rose-400/10 hover:text-rose-400 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </m.li>
              );
            })}

          {status === "loading" && (
            <li className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
              {t("tasks.loading")}
            </li>
          )}

          {status === "error" && (
            <li className="flex flex-col items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
              <span className="break-words">
                {t("tasks.loadError")}
                {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                {loadError && <span className="block text-rose-400/80">{loadError}</span>}
              </span>
              <button
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
                className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                {t("editor.retry")}
              </button>
            </li>
          )}

          {status === "ready" && visible.length === 0 && (
            <li className="rounded-xl border border-dashed border-gus-border px-4 py-10 text-center text-sm text-gus-muted">
              {tagFilter
                ? t("tasks.emptyFiltered", { tag: tagFilter })
                : t("tasks.empty")}
            </li>
          )}
        </ul>
        )}
        </AnimatePresence>

      </div>
    </section>
  );
}
