import { useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Flag } from "lucide-react";
import clsx from "clsx";
import type { Task } from "../lib/taskStore";
import { PRIORITY_CLASS, PRIORITY_LABEL } from "../lib/taskPriority";

export type KanbanColumnId = "todo" | "doing" | "done";

const COLUMNS: { id: KanbanColumnId; label: string; hint: string }[] = [
  { id: "todo", label: "Por hacer", hint: "Arrastra aquí lo que aún no empieces" },
  { id: "doing", label: "En progreso", hint: "Arrastra aquí lo que estés haciendo" },
  { id: "done", label: "Completadas", hint: "Arrastra aquí lo que termines" },
];

export function columnOf(task: Task): KanbanColumnId {
  if (task.completes) return "done";
  return task.doing ? "doing" : "todo";
}

function todayIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
}

function shortDue(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export interface KanbanBoardProps {
  tasks: Task[];
  onMove: (id: string, column: KanbanColumnId) => void;
  onTagClick?: (tag: string) => void;
  tagFilter?: string | null;
}

export default function KanbanBoard({
  tasks,
  onMove,
  onTagClick,
  tagFilter = null,
}: KanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<KanbanColumnId | null>(null);
  const now = todayIso();

  function handleDragStart(event: DragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }

  function handleDrop(event: DragEvent<HTMLUListElement>, column: KanbanColumnId) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    setOverColumn(null);
    setDraggingId(null);
    if (id) onMove(id, column);
  }

  return (
    <div className="grid min-h-40 gap-3 md:grid-cols-3">
      {COLUMNS.map((column) => {
        const cards = tasks.filter((task) => columnOf(task) === column.id);
        const isOver = overColumn === column.id;

        return (
          <section
            key={column.id}
            aria-label={`Columna ${column.label}`}
            className={clsx(
              "flex min-h-40 flex-col gap-2 rounded-xl border p-2.5 transition-colors",
              isOver ? "border-gus-accent/60 bg-gus-accent/5" : "border-gus-border bg-gus-panel/40",
            )}
          >
            <header className="flex items-center justify-between px-0.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gus-muted">
                {column.label}
              </h3>
              <span className="rounded-full border border-gus-border bg-gus-card px-1.5 py-px text-[10px] text-gus-muted">
                {cards.length}
              </span>
            </header>

            <ul
              className="flex flex-1 flex-col gap-2"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overColumn !== column.id) setOverColumn(column.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setOverColumn((prev) => (prev === column.id ? null : prev));
                }
              }}
              onDrop={(event) => handleDrop(event, column.id)}
            >
              <AnimatePresence initial={false}>
                {cards.map((task) => {
                  const overdue =
                    !task.completes && !!task.due && task.due < now;

                  return (
                    <motion.li
                      key={task.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                    >
                      <div
                        draggable
                        onDragStart={(event) => handleDragStart(event, task.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setOverColumn(null);
                        }}
                        className={clsx(
                          "cursor-grab rounded-lg border bg-gus-card p-2.5 transition-colors active:cursor-grabbing",
                          draggingId === task.id
                            ? "border-gus-accent/50 opacity-40"
                            : "border-gus-border hover:border-gus-accent/40",
                          task.completes && "opacity-70",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <p
                            className={clsx(
                              "min-w-0 flex-1 break-words text-xs leading-relaxed",
                              task.completes
                                ? "text-gus-muted line-through"
                                : "text-gus-text",
                            )}
                          >
                            {task.title}
                          </p>
                          {task.priority && (
                            <span
                              title={`Prioridad ${PRIORITY_LABEL[task.priority]}`}
                              className={clsx(
                                "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] capitalize",
                                PRIORITY_CLASS[task.priority],
                              )}
                            >
                              <Flag className="h-2.5 w-2.5" aria-hidden="true" />
                              {task.priority}
                            </span>
                          )}
                        </div>

                        {task.description && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-gus-muted">
                            {task.description}
                          </p>
                        )}

                        {(task.due || task.tags.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {task.due && (
                              <span
                                title={`Plazo: ${task.due}`}
                                className={clsx(
                                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                                  overdue
                                    ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
                                    : "border-gus-border bg-gus-panel text-gus-muted",
                                )}
                              >
                                <Calendar className="h-2.5 w-2.5" aria-hidden="true" />
                                {shortDue(task.due)}
                              </span>
                            )}
                            {task.tags.map((tag) => {
                              const active =
                                !!tagFilter && tagFilter.toLowerCase() === tag.toLowerCase();
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  disabled={!onTagClick}
                                  onClick={() => onTagClick?.(tag)}
                                  title={`Filtrar por #${tag}`}
                                  aria-pressed={active}
                                  className={clsx(
                                    "rounded-full border px-1.5 py-0.5 text-[10px] capitalize transition-colors",
                                    active
                                      ? "border-gus-accent/60 bg-gus-accent/20 text-gus-accent"
                                      : "border-gus-accent/40 bg-gus-accent/15 text-gus-accent hover:opacity-80",
                                    onTagClick &&
                                      "focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                                    !onTagClick && "cursor-default",
                                  )}
                                >
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>

              {cards.length === 0 && (
                <li className="rounded-lg border border-dashed border-gus-border px-3 py-6 text-center text-[11px] text-gus-muted">
                  {column.hint}
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
