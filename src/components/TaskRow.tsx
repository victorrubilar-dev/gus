import clsx from "clsx";
import { m } from "framer-motion";
import { Calendar, Flag, GitBranch, Lock, Trash2 } from "lucide-react";
import { useT } from "../lib/i18n";
import { PRIORITY_CLASS, priorityLabel } from "../lib/taskPriority";
import { shortDate } from "../lib/taskDue";
import type { Task } from "../lib/taskStore";
import CheckboxVisual from "./CheckboxVisual";
import { TAG_CHIP_CLASS, TagEditor, tagColor } from "./TaskTags";

export interface TaskRowProps {
  task: Task;
  /** Nivel de subtarea: sangra la fila. */
  depth: number;
  /** Plazo ya clasificado (texto y clases), o `null` si no tiene. */
  due: { due: string; title: string; className: string } | null;
  progress: { done: number; total: number };
  /** Tareas que aún bloquean a esta. */
  waiting: Task[];
  tagFilter: string | null;
  isEditingTags: boolean;
  relationsOpen: boolean;
  onToggle: () => void;
  onCyclePriority: () => void;
  onToggleTagFilter: (tag: string) => void;
  onStartEditingTags: () => void;
  onCommitTags: (tags: string[]) => void;
  onStopEditingTags: () => void;
  onToggleRelations: () => void;
  onRemove: () => void;
}

/** Fila de una tarea en la vista de lista. */
export default function TaskRow({
  task,
  depth,
  due: plazo,
  progress,
  waiting,
  tagFilter,
  isEditingTags: isEditing,
  relationsOpen,
  onToggle,
  onCyclePriority,
  onToggleTagFilter,
  onStartEditingTags,
  onCommitTags,
  onStopEditingTags,
  onToggleRelations,
  onRemove,
}: TaskRowProps) {
  const t = useT();

  return (
    <m.li
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={{
        duration: 0.15,
        ease: "easeOut",
        layout: { type: "spring", stiffness: 500, damping: 45 },
      }}
      style={{ marginLeft: depth * 24 }}
      className={clsx(
        "group relative flex items-center gap-3 overflow-hidden rounded-xl border border-gus-border bg-gus-card px-3 py-2.5",
        isEditing && "z-30",
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={task.completes}
          onChange={onToggle}
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
              className="truncate text-meta text-gus-muted"
              title={task.description}
            >
              {task.description.replace(/\n+/g, " · ")}
            </span>
          )}
        </span>
      </label>

      {progress.total > 0 && (
        <span
          title={t("tasks.subtaskProgress", { done: progress.done, total: progress.total })}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-gus-border bg-gus-panel px-2 py-0.5 text-meta text-gus-muted"
        >
          <span aria-hidden="true" className="h-1 w-8 overflow-hidden rounded-full bg-gus-border">
            <span
              className="block h-full bg-gus-accent"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </span>
          {progress.done}/{progress.total}
        </span>
      )}

      {waiting.length > 0 && (
        <span
          title={t("tasks.waitingFor", { names: waiting.map((blocker) => blocker.title).join(", ") })}
          className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-meta text-amber-300"
        >
          <Lock className="h-3 w-3" aria-hidden="true" />
          {waiting.length}
        </span>
      )}

      <button
        type="button"
        onClick={onCyclePriority}
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
          "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-meta capitalize transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
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
            "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-meta",
            plazo.className,
          )}
        >
          <Calendar className="h-3 w-3" aria-hidden="true" />
          {plazo.due ? shortDate(plazo.due) : null}
        </span>
      )}

      {isEditing ? (
        <TagEditor task={task} onCommit={onCommitTags} onClose={onStopEditingTags} />
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {task.tags.map((tag) => {
            const active =
              !!tagFilter && tagFilter.toLowerCase() === tag.toLowerCase();
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTagFilter(tag)}
                title={t("tasks.filterByTag", { tag })}
                aria-pressed={active}
                className={clsx(
                  TAG_CHIP_CLASS,
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
            onClick={onStartEditingTags}
            title={t("tasks.editTags")}
            aria-label={t("tasks.tagsOf", { title: task.title })}
            aria-haspopup="dialog"
            className="rounded-full border border-dashed border-gus-border px-2 py-0.5 text-meta text-gus-muted transition-colors group-hover:border-gus-accent/50 group-hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            +
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleRelations}
        aria-expanded={relationsOpen}
        aria-label={t("tasks.relationsOf", { title: task.title })}
        title={t("tasks.relations")}
        className="shrink-0 rounded-md p-1.5 text-gus-muted opacity-0 transition hover:bg-gus-panel hover:text-gus-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none group-hover:opacity-100"
      >
        <GitBranch className="h-4 w-4" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t("tasks.deleteNamed", { title: task.title })}
        className="shrink-0 rounded-md p-1.5 text-gus-muted opacity-0 transition hover:bg-rose-400/10 hover:text-rose-400 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </m.li>
  );
}
