import { useState, type FormEvent } from "react";
import { useT } from "../lib/i18n";
import type { Task } from "../lib/taskStore";
import { canBlockBy, canSetParent } from "../lib/taskTree";

export interface TaskRelationsProps {
  task: Task;
  tasks: readonly Task[];
  onSetParent: (parentId: string | null) => void;
  onToggleBlocker: (blockerId: string) => void;
  onAddSubtask: (title: string) => void;
}

/** Panel de una tarea: de quién es subtarea, qué la bloquea y alta de subtareas (REQ-11). */
export default function TaskRelations({ task, tasks, onSetParent, onToggleBlocker, onAddSubtask }: TaskRelationsProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const others = tasks.filter((other) => other.id !== task.id);
  const parents = others.filter((other) => canSetParent(tasks, task.id, other.id));
  const blockers = others.filter(
    (other) => task.blockedBy?.includes(other.id) || canBlockBy(tasks, task.id, other.id),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    onAddSubtask(clean);
    setTitle("");
  }

  const field = "rounded-lg border border-gus-border bg-gus-panel px-2 py-1 text-body text-gus-text outline-none focus:border-gus-accent/60";

  return (
    <div className="space-y-3 rounded-xl border border-gus-border bg-gus-panel px-4 py-3 text-body">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("tasks.newSubtask")}
          aria-label={t("tasks.newSubtaskFor", { title: task.title })}
          className={`${field} min-w-0 flex-1`}
        />
        <button type="submit" className="gus-btn gus-btn-secondary" disabled={!title.trim()}>
          {t("tasks.addSubtask")}
        </button>
      </form>

      <label className="flex items-center gap-2 text-gus-muted">
        {t("tasks.parentOf")}
        <select
          value={task.parentId ?? ""}
          onChange={(event) => onSetParent(event.target.value || null)}
          className={`${field} min-w-0 flex-1`}
        >
          <option value="">{t("tasks.noParent")}</option>
          {parents.map((other) => (
            <option key={other.id} value={other.id}>
              {other.title}
            </option>
          ))}
        </select>
      </label>

      {blockers.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-gus-muted">{t("tasks.blockedByLabel")}</legend>
          <div className="gus-scrollbar max-h-32 space-y-1 overflow-y-auto">
            {blockers.map((other) => (
              <label key={other.id} className="flex cursor-pointer items-center gap-2 text-gus-text">
                <input
                  type="checkbox"
                  checked={task.blockedBy?.includes(other.id) ?? false}
                  onChange={() => onToggleBlocker(other.id)}
                  className="accent-[var(--color-gus-accent)]"
                />
                <span className="truncate">{other.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
