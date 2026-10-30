import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Calendar, ListTodo } from "lucide-react";
import CheckboxVisual from "./CheckboxVisual";
import EmptyState from "./EmptyState";
import { useT } from "../lib/i18n";
import {
  filterByOrigin,
  groupByNote,
  noteTasksFrom,
  type NoteTask,
  type NoteWithText,
} from "../lib/noteTasks";

export interface NoteTasksViewProps {
  vaultPath: string;
  hideCompleted: boolean;
  /** Marca o desmarca la tarea en su nota; rechaza si la nota cambió. */
  onToggle: (task: NoteTask) => Promise<void>;
  onOpenNote?: (path: string) => void;
}

/**
 * Checkboxes `- [ ]` de todas las notas, agrupados por nota de origen (REQ-09).
 * No hay copia: marcar uno reescribe su línea en la nota.
 */
export default function NoteTasksView({ vaultPath, hideCompleted, onToggle, onOpenNote }: NoteTasksViewProps) {
  const t = useT();
  const [tasks, setTasks] = useState<NoteTask[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    invoke<NoteWithText[]>("list_notes_with_checkboxes", { path: vaultPath })
      .then((notes) => {
        if (cancelled) return;
        setTasks(noteTasksFrom(notes));
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(String(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, reload]);

  async function toggle(task: NoteTask) {
    setError(null);
    try {
      await onToggle(task);
    } catch (reason) {
      setError(String(reason));
    }
    // Recargar siempre: si falló es porque la nota cambió y la lista está vieja.
    setReload((key) => key + 1);
  }

  const origins = useMemo(() => groupByNote(tasks), [tasks]);
  // Si la nota elegida ya no tiene checkboxes, el filtro no se queda atascado.
  const activeOrigin = origin !== null && origins.some((group) => group.relative === origin) ? origin : null;
  const groups = useMemo(
    () =>
      groupByNote(filterByOrigin(tasks, activeOrigin)).map((group) => ({
        ...group,
        shown: group.tasks.filter((task) => !hideCompleted || !task.completes),
      })),
    [tasks, activeOrigin, hideCompleted],
  );
  const shownGroups = groups.filter((group) => group.shown.length > 0);

  return (
    <div key="notes" className="space-y-4">
      {origins.length > 1 && (
        <label className="flex items-center gap-2 text-body text-gus-muted">
          {t("tasks.origin")}
          <select
            value={activeOrigin ?? ""}
            onChange={(event) => setOrigin(event.target.value || null)}
            className="rounded-lg border border-gus-border bg-gus-panel px-2 py-1 text-body text-gus-text outline-none focus:border-gus-accent/60"
          >
            <option value="">{t("tasks.originAll")}</option>
            {origins.map((group) => (
              <option key={group.relative} value={group.relative}>
                {group.relative} ({group.tasks.length})
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="break-words rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">
          {error}
        </p>
      )}

      {status === "loading" && <p className="text-body text-gus-muted">{t("tasks.loading")}</p>}

      {status === "ready" && shownGroups.length === 0 && (
        <div className="rounded-xl border border-dashed border-gus-border">
          <EmptyState icon={ListTodo} title={t("tasks.notesEmpty")} />
        </div>
      )}

      {shownGroups.map((group) => (
        <section key={group.relative} className="space-y-2">
          <h3 className="flex items-baseline gap-2 text-body font-medium text-gus-text">
            <button
              type="button"
              onClick={() => onOpenNote?.(group.notePath)}
              title={group.relative}
              className="truncate hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              {group.noteName}
            </button>
            <span className="text-meta font-normal text-gus-muted">
              {group.tasks.filter((task) => task.completes).length}/{group.tasks.length}
            </span>
          </h3>
          <ul className="space-y-2">
            {group.shown.map((task) => (
              <li
                key={`${task.relative}:${task.line}`}
                className="flex items-center gap-3 rounded-xl border border-gus-border bg-gus-card px-3 py-2.5"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={task.completes}
                    onChange={() => void toggle(task)}
                    className="peer sr-only"
                  />
                  <CheckboxVisual checked={task.completes} />
                  <span
                    className={clsx(
                      "truncate text-sm transition-colors",
                      task.completes ? "text-gus-muted line-through" : "text-gus-text",
                    )}
                  >
                    {task.title}
                  </span>
                </label>
                {task.due && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-gus-border bg-gus-panel px-2 py-0.5 text-meta text-gus-muted">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {task.due}
                  </span>
                )}
                {task.tags.map((tag) => (
                  <span key={tag} className="shrink-0 rounded-full border border-gus-border px-2 py-0.5 text-meta text-gus-muted">
                    {tag}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
