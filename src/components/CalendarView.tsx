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
import { PRIORITY_CLASS, PRIORITY_LABEL, isTaskPriority, priorityRank } from "../lib/taskPriority";
import {
  WEEKDAYS,
  fromIso,
  longDayLabel,
  monthCells,
  monthLabel,
  pad,
  toIso,
} from "../lib/calendarDate";

const INPUT_CLASS =
  "rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60";

/** Pendientes primero; después, de mayor a menor prioridad y por orden
 * alfabético (así lo que urge se ve primero en el detalle del día). */
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completes) - Number(b.completes) ||
      priorityRank(b.priority) - priorityRank(a.priority) ||
      a.title.localeCompare(b.title, "es"),
  );
}

export interface CalendarViewProps {
  /** Vault cuyo almacén oculto de tareas se muestra en el calendario. */
  vaultPath: string;
  /** Cambia a la pestaña completa de tareas (p. ej. para editar sin fecha). */
  onOpenTasks: () => void;
  /** Abre el menú superpuesto de «Nueva tarea» (lo monta la app). */
  onNewTask: () => void;
  /** Muestra las tareas completadas (viene de los ajustes; por defecto sí). */
  showCompleted?: boolean;
}

/**
 * Vista resumen de calendario: mese actual, vencimientos y detalle del día
 * seleccionado. Lee y escribe exclusivamente el JSON oculto `.gus-tasks.json`.
 */
export default function CalendarView({
  vaultPath,
  onOpenTasks,
  onNewTask,
  showCompleted = true,
}: CalendarViewProps) {
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

  /** Etiqueta por la que se filtra el calendario (null = sin filtro). */
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const itemsRef = useRef<Task[]>([]);
  const loadedRef = useRef(false);
  /** Tareas creadas por la ventana nativa mientras el almacén aún cargaba. */
  const pendingNewTasksRef = useRef<Task[]>([]);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const todayIso = toIso(new Date());

  // ------------------------------------------------------------------
  // Almacén de tareas
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Ventana nativa de creación (si se crea una tarea con el calendario abierto)
  // ------------------------------------------------------------------

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
        // Fuera de Tauri no hay eventos.
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

  // ------------------------------------------------------------------
  // Resumen y calendario
  // ------------------------------------------------------------------

  const monthPrefix = `${visibleMonth.getFullYear()}-${pad(visibleMonth.getMonth() + 1)}`;

  // Lo que se muestra: si los ajustes ocultan las completadas, no aparecen ni
  // en las casillas del mes ni en el detalle del día. El filtro de etiqueta
  // (si hay) recorta también las cifras del resumen.
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

  // Etiquetas del almacén, con recuento, para la barra de filtro.
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
    a.label.localeCompare(b.label, "es"),
  );

  /** Activa o desactiva el filtro de una etiqueta (clic en cualquier chip). */
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

  const summary = [
    { label: "Vencidas", value: overdue.length, className: "text-rose-300" },
    { label: "Para hoy", value: dueToday.length, className: "text-amber-300" },
    { label: "Este mes", value: dueThisMonth.length, className: "text-gus-accent" },
    { label: "Sin fecha", value: undated.length, className: "text-sky-300" },
  ];

  return (
    <section className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gus-accent/40 bg-gus-accent/15 text-gus-accent">
            <CalendarDays className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
              Calendario
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
            title="Recargar tareas"
            aria-label="Recargar tareas"
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

      {/* Filtro por etiquetas: clic en un chip = filtrar todo el calendario. */}
      {tagEntries.length > 0 && (
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
              title="Quitar el filtro de etiqueta"
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
          Cargando calendario…
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-gus-muted">No se pudieron cargar las tareas.</p>
          {loadError && (
            <p className="max-w-xl break-words text-xs text-rose-400/80">{loadError}</p>
          )}
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={INPUT_CLASS}>
            Reintentar
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          {/* Resumen rápido */}
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
            {/* Calendario del mes */}
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gus-border bg-gus-card px-3 py-2">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  title="Mes anterior"
                  aria-label="Mes anterior"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="text-center">
                  <h3 className="text-sm font-semibold">{monthLabel(visibleMonth)}</h3>
                  <p className="text-[11px] text-gus-muted">
                    {displayItems.filter((task) => task.due?.startsWith(monthPrefix)).length}{" "}
                    tareas con fecha
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={goToday}
                    className="rounded-lg border border-gus-border px-2 py-1 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    title="Mes siguiente"
                    aria-label="Mes siguiente"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-gus-border bg-gus-border">
                {WEEKDAYS.map((weekday) => (
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
                      aria-label={`${longDayLabel(iso)}, ${dayTasks.length} tareas`}
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
                            +{dayTasks.length - 2} más
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Detalle del día seleccionado */}
            <aside className="flex min-h-0 flex-col gap-3 rounded-xl border border-gus-border bg-gus-card p-4 min-[900px]:h-[calc(100%-3.25rem)]">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gus-muted">
                  Día seleccionado
                </p>
                <h3 className="mt-0.5 text-sm font-semibold first-letter:uppercase">
                  {longDayLabel(selectedIso)}
                </h3>
              </div>

              <div className="flex items-center justify-between text-xs text-gus-muted">
                <span>
                  {selectedTasks.filter((task) => !task.completes).length} pendientes
                </span>
                <span>{selectedTasks.length} en total</span>
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
                        ? "No hay tareas con plazo hoy."
                        : "No hay tareas con plazo este día."}
                    </p>
                    <button
                      type="button"
                      onClick={onOpenTasks}
                      className="text-xs text-gus-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                    >
                      Ver todas las tareas
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
                              ? `Marcar «${task.title}» como pendiente`
                              : `Marcar «${task.title}» como completada`
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
                                  title={`Prioridad ${PRIORITY_LABEL[task.priority]}`}
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
