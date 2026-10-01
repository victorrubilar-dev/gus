import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { normalizeTags } from "../lib/markdownTasks";
import { createTaskId, loadTaskStore, type Task } from "../lib/taskStore";
import { NEW_TASK_EVENT, type NewTask } from "../lib/newTask";
import { PRIORITY_CLASS, priorityLabel, isTaskPriority, priorityRank } from "../lib/taskPriority";
import { useT } from "../lib/i18n";
import {
  weekdayLabels,
  fromIso,
  longDayLabel,
  monthCells,
  monthLabel,
  pad,
  toIso,
} from "../lib/calendarDate";

const INPUT_CLASS =
  "rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60";

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completes) - Number(b.completes) ||
      priorityRank(b.priority) - priorityRank(a.priority) ||
      a.title.localeCompare(b.title),
  );
}

export interface CalendarViewProps {
  vaultPath: string;
  onOpenTasks: () => void;
  onNewTask: () => void;
  showCompleted?: boolean;
}

export default function CalendarView({
  vaultPath,
  onOpenTasks,
  onNewTask,
  showCompleted = true,
}: CalendarViewProps) {
  const t = useT();
  const [items, setItems] = useState<Task[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedIso, setSelectedIso] = useState(() => toIso(new Date()));
  const [reloadKey, setReloadKey] = useState(0);

  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const itemsRef = useRef<Task[]>([]);
  const loadedRef = useRef(false);
  const pendingNewTasksRef = useRef<Task[]>([]);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const todayIso = toIso(new Date());

  function commit(next: Task[]) {
    itemsRef.current = next;
    setItems(next);
    setSyncError(null);

    writeQueueRef.current = writeQueueRef.current
      .then(() => invoke("save_tasks", { vaultPath, tasks: next }))
      .catch((error: unknown) => setSyncError(String(error)));
  }

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    pendingNewTasksRef.current = [];
    setStatus("loading");

    loadTaskStore(vaultPath)
      .then((next) => {
        if (cancelled) return;
        itemsRef.current = next;
        setItems(next);
        setLoadError(null);
        loadedRef.current = true;
        setStatus("ready");

        const pending = pendingNewTasksRef.current.splice(0);
        if (pending.length > 0) {
          commit([...pending, ...itemsRef.current]);
        }
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
    // `commit` cierra sobre este `vaultPath`, no hace falta añadirlo a las deps.
  }, [vaultPath, reloadKey]);

  function addTaskFromWindow(payload: NewTask) {
    const title = payload.title.trim();
    if (!title) return;

    const priority = isTaskPriority(payload.priority) ? payload.priority : undefined;
    const task: Task = {
      id: createTaskId(),
      title,
      tags: normalizeTags(payload.tags),
      completes: false,
      ...(payload.description?.trim() ? { description: payload.description.trim() } : {}),
      ...(payload.due ? { due: payload.due } : {}),
      ...(priority ? { priority } : {}),
    };

    if (!loadedRef.current) {
      pendingNewTasksRef.current.push(task);
      return;
    }

    commit([task, ...itemsRef.current]);
  }

  const addTaskRef = useRef(addTaskFromWindow);
  addTaskRef.current = addTaskFromWindow;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<NewTask>(NEW_TASK_EVENT, (event) => addTaskRef.current(event.payload))
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

  function toggle(id: string) {
    const task = itemsRef.current.find((item) => item.id === id);
    if (!task) return;

    commit(
      itemsRef.current.map((item) =>
        item.id === id ? { ...item, completes: !item.completes } : item,
      ),
    );
  }

  const monthPrefix = `${visibleMonth.getFullYear()}-${pad(visibleMonth.getMonth() + 1)}`;

  const matchesTag = (task: Task) =>
    !tagFilter ||
    task.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase());

  const displayItems = (
    showCompleted ? items : items.filter((task) => !task.completes)
  ).filter(matchesTag);

  const pending = items.filter((task) => !task.completes && matchesTag(task));
  const overdue = pending.filter((task) => task.due && task.due < todayIso);
  const dueToday = displayItems.filter((task) => task.due === todayIso);
  const dueThisMonth = pending.filter((task) => task.due?.startsWith(monthPrefix));
  const undated = pending.filter((task) => !task.due);

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

  function toggleTagFilter(tag: string) {
    setTagFilter((current) =>
      current?.toLowerCase() === tag.toLowerCase() ? null : tag,
    );
  }

  const tasksByDay = new Map<string, Task[]>();
  for (const task of displayItems) {
    if (!task.due) continue;
    const bucket = tasksByDay.get(task.due);
    if (bucket) bucket.push(task);
    else tasksByDay.set(task.due, [task]);
  }

  const selectedTasks = sortTasks(tasksByDay.get(selectedIso) ?? []);
  const cells = monthCells(visibleMonth);

  function shiftMonth(delta: number) {
    const next = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + delta,
      1,
    );
    setVisibleMonth(next);

    const selected = fromIso(selectedIso) ?? new Date();
    const day = Math.min(
      selected.getDate(),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    );
    setSelectedIso(toIso(new Date(next.getFullYear(), next.getMonth(), day)));
  }

  function goToday() {
    const now = new Date();
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedIso(toIso(now));
  }

  const summary: { label: string; value: number; className: string }[] = [
    { label: t("calendar.overdue"), value: overdue.length, className: "text-rose-300" },
    { label: t("calendar.dueToday"), value: dueToday.length, className: "text-amber-300" },
    { label: t("calendar.thisMonth"), value: dueThisMonth.length, className: "text-gus-accent" },
    { label: t("calendar.undated"), value: undated.length, className: "text-sky-300" },
  ];

  return (
    <section data-tour="calendar" className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gus-accent/40 bg-gus-accent/15 text-gus-accent">
            <CalendarDays className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
              {t("calendar.title")}
            </h2>
            <p className="text-xs text-gus-muted">
              Resumen de vencimientos de tus tareas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            title={t("calendar.reload")}
            aria-label={t("calendar.reload")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gus-border bg-gus-card text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNewTask}
            disabled={status !== "ready"}
            className="flex items-center gap-1.5 rounded-lg bg-gus-accent px-3 py-2 text-sm font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nueva tarea
          </button>
        </div>
      </header>

      {tagEntries.length > 0 && (
        <div
          role="group"
          aria-label={t("calendar.filterTags")}
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
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] capitalize transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                  active
                    ? "border-gus-accent/60 bg-gus-accent/20 text-gus-accent ring-2 ring-gus-accent/70"
                    : "border-gus-accent/40 bg-gus-accent/15 text-gus-accent",
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
              Todas <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {syncError && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
          No se pudo guardar en el almacén oculto: {syncError}
        </p>
      )}

      {status === "loading" && (
        <div className="flex flex-1 items-center justify-center text-sm text-gus-muted">
          {t("calendar.loading")}
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-gus-muted">{t("calendar.loadError")}</p>
          {loadError && (
            <p className="max-w-xl break-words text-xs text-rose-400/80">{loadError}</p>
          )}
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={INPUT_CLASS}>
            {t("editor.retry")}
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <div className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4">
            {summary.map(({ label, value, className }) => (
              <div
                key={label}
                className="rounded-xl border border-gus-border bg-gus-card px-3 py-2.5"
              >
                <p className={clsx("text-lg font-semibold", className)}>{value}</p>
                <p className="text-[11px] uppercase tracking-wide text-gus-muted">
                  {label}
                </p>
              </div>
            ))}
          </div>

          <div className="grid min-h-0 gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gus-border bg-gus-card px-3 py-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  title={t("calendar.previousMonth")}
                  aria-label={t("calendar.previousMonth")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="text-center">
                  <h3 className="text-sm font-semibold">{monthLabel(visibleMonth)}</h3>
                  <p className="text-[11px] text-gus-muted">
                    {t("calendar.datedCount", {
                      count: displayItems.filter((task) => task.due?.startsWith(monthPrefix))
                        .length,
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={goToday}
                    className="rounded-lg border border-gus-border px-2 py-1 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {t("common.today")}
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    title={t("calendar.nextMonth")}
                    aria-label={t("calendar.nextMonth")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-gus-border bg-gus-border">
                {weekdayLabels().map((weekday) => (
                  <div
                    key={weekday}
                    className="bg-gus-panel px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-gus-muted"
                  >
                    {weekday}
                  </div>
                ))}

                {cells.map((date, index) => {
                  if (!date) {
                    return (
                      <div
                        key={`empty-${index}`}
                        className="min-h-20 bg-gus-bg/40"
                        aria-hidden="true"
                      />
                    );
                  }

                  const iso = toIso(date);
                  const dayTasks = sortTasks(tasksByDay.get(iso) ?? []);
                  const isSelected = iso === selectedIso;
                  const isToday = iso === todayIso;
                  const isPast = iso < todayIso;
                  const hasPending = dayTasks.some((task) => !task.completes);

                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSelectedIso(iso)}
                      aria-pressed={isSelected}
                      aria-label={t("calendar.dayAria", { day: longDayLabel(iso), count: dayTasks.length })}
                      className={clsx(
                        "min-h-20 bg-gus-bg p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent",
                        isSelected && "bg-gus-accent/10 ring-1 ring-inset ring-gus-accent/60",
                      )}
                    >
                      <span
                        className={clsx(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-medium",
                          isToday
                            ? "bg-gus-accent text-gus-bg"
                            : isPast && hasPending
                              ? "text-rose-300"
                              : "text-gus-muted",
                        )}
                      >
                        {date.getDate()}
                      </span>

                      <span className="mt-1 flex flex-col gap-0.5">
                        {dayTasks.slice(0, 2).map((task) => (
                          <span
                            key={task.id}
                            title={task.title}
                            className={clsx(
                              "truncate rounded px-1 py-0.5 text-[10px] leading-tight",
                              task.completes
                                ? "text-gus-muted line-through opacity-60"
                                : "bg-gus-accent/10 text-gus-accent",
                            )}
                          >
                            {task.title}
                          </span>
                        ))}
                        {dayTasks.length > 2 && (
                          <span className="px-1 text-[9px] text-gus-muted">
                            {t("calendar.more", { count: dayTasks.length - 2 })}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="flex min-h-0 flex-col gap-3 rounded-xl border border-gus-border bg-gus-card p-4 min-[900px]:h-[calc(100%-3.25rem)]">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gus-muted">
                  {t("calendar.selectedDay")}
                </p>
                <h3 className="mt-0.5 text-sm font-semibold first-letter:uppercase">
                  {longDayLabel(selectedIso)}
                </h3>
              </div>

              <div className="flex items-center justify-between text-xs text-gus-muted">
                <span>
                  {t("calendar.pendingCount", {
                    count: selectedTasks.filter((task) => !task.completes).length,
                  })}
                </span>
                <span>{t("calendar.totalCount", { count: selectedTasks.length })}</span>
              </div>

              <AnimatePresence initial={false}>
                {selectedTasks.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gus-border px-3 py-6 text-center"
                  >
                    <p className="text-xs text-gus-muted">
                      {selectedIso === todayIso
                        ? t("calendar.noTasksToday")
                        : t("calendar.noTasksDay")}
                    </p>
                    <button
                      type="button"
                      onClick={onOpenTasks}
                      className="text-xs text-gus-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                    >
                      {t("calendar.allTasks")}
                    </button>
                  </motion.div>
                ) : (
                  <motion.ul
                    key={selectedIso}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
                  >
                    {selectedTasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-start gap-2 rounded-lg border border-gus-border bg-gus-panel p-2"
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={task.completes}
                          aria-label={
                            task.completes
                              ? t("calendar.markPending", { title: task.title })
                              : t("calendar.markDone", { title: task.title })
                          }
                          onClick={() => toggle(task.id)}
                          className={clsx(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                            task.completes
                              ? "border-gus-accent bg-gus-accent text-gus-bg"
                              : "border-gus-muted/60 text-transparent hover:border-gus-accent",
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                        </button>

                        <div className="min-w-0 flex-1">
                          <p
                            className={clsx(
                              "break-words text-xs",
                              task.completes
                                ? "text-gus-muted line-through"
                                : "text-gus-text",
                            )}
                          >
                            {task.title}
                          </p>
                          {task.description && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-gus-muted">
                              {task.description}
                            </p>
                          )}
                          {(task.priority || task.tags.length > 0) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {task.priority && (
                                <span
                                  title={t("tasks.priorityLabel", { name: priorityLabel(task.priority) })}
                                  className={clsx(
                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9px] capitalize",
                                    PRIORITY_CLASS[task.priority],
                                  )}
                                >
                                  <Flag className="h-2.5 w-2.5" aria-hidden="true" />
                                  {task.priority}
                                </span>
                              )}
                              {task.tags.map((tag) => {
                                const active =
                                  !!tagFilter &&
                                  tagFilter.toLowerCase() === tag.toLowerCase();
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => toggleTagFilter(tag)}
                                    title={`Filtrar por #${tag}`}
                                    aria-pressed={active}
                                    className={clsx(
                                      "rounded-full border px-1.5 py-px text-[9px] transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                                      active
                                        ? "border-gus-accent/60 bg-gus-accent/20 text-gus-accent ring-2 ring-gus-accent/70"
                                        : "border-gus-accent/40 bg-gus-accent/15 text-gus-accent",
                                    )}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={onOpenTasks}
                className="rounded-lg border border-gus-border px-3 py-2 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                Gestionar todas las tareas
              </button>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
