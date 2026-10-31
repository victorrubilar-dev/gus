import clsx from "clsx";
import { Check, Flag, ListTodo, Plus } from "lucide-react";
import { useT } from "../lib/i18n";
import { PRIORITY_CLASS, priorityLabel } from "../lib/taskPriority";
import { DUE_CLASS, dueKind, shortDate } from "../lib/taskDue";
import type { TodayTasks } from "../lib/dashboard";
import type { Task } from "../lib/taskStore";
import DashboardCard, { CardLink } from "./DashboardCard";

interface DashboardTodayProps {
  status: "loading" | "ready" | "error";
  error: string | null;
  tasks: Task[];
  split: TodayTasks;
  onToggle: (id: string) => void;
  onRetry: () => void;
  onOpenTasks: () => void;
  onNewTask: () => void;
}

function TaskRow({ task, onToggle, onOpen }: { task: Task; onToggle: () => void; onOpen: () => void }) {
  const t = useT();

  return (
    <li className="flex items-center gap-3 rounded-lg border border-gus-border bg-gus-panel px-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.completes}
        aria-label={t("calendar.markDone", { title: task.title })}
        onClick={onToggle}
        className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gus-muted/60 text-transparent outline-none transition-colors hover:border-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/70"
      >
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={onOpen}
        title={t("dashboard.seeInTasks")}
        className="-my-1 min-w-0 flex-1 truncate py-1 text-left text-sm text-gus-text outline-none transition-colors hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/70"
      >
        {task.title}
      </button>

      {task.priority && (
        <span
          title={t("tasks.priorityLabel", { name: priorityLabel(task.priority) })}
          className={clsx("flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-meta capitalize", PRIORITY_CLASS[task.priority])}
        >
          <Flag className="h-2.5 w-2.5" aria-hidden="true" />
          {priorityLabel(task.priority)}
        </span>
      )}

      {task.due && (
        <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-meta", DUE_CLASS[dueKind(task, task.due)])}>
          {shortDate(task.due)}
        </span>
      )}
    </li>
  );
}

function Group({ label, tone, tasks, onToggle, onOpen }: { label: string; tone?: string; tasks: Task[]; onToggle: (id: string) => void; onOpen: () => void }) {
  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className={clsx("text-meta font-medium uppercase tracking-wide", tone ?? "text-gus-muted")}>
        {label} · {tasks.length}
      </p>
      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={() => onToggle(task.id)} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

/** Lo que hay que hacer hoy: tareas vencidas y de hoy, y lo siguiente si hay poco. */
export default function DashboardToday({ status, error, tasks, split, onToggle, onRetry, onOpenTasks, onNewTask }: DashboardTodayProps) {
  const t = useT();
  const nothingNow = split.overdue.length === 0 && split.today.length === 0;

  return (
    <DashboardCard
      icon={ListTodo}
      title={t("dashboard.todayTitle")}
      action={<CardLink onClick={onOpenTasks}>{t("dashboard.openTasksLong")}</CardLink>}
    >
      {status === "loading" && <p className="py-6 text-center text-body text-gus-muted">{t("dashboard.loadingTasks")}</p>}

      {status === "error" && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-body text-gus-muted">{t("calendar.loadError")}</p>
          {error && <p className="max-w-md break-words text-meta text-rose-400/80">{error}</p>}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-gus-border px-3 py-1.5 text-body text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            {t("editor.retry")}
          </button>
        </div>
      )}

      {status === "ready" && tasks.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gus-border py-8 text-center">
          <p className="text-body text-gus-muted">{t("dashboard.noTasks")}</p>
          <button type="button" onClick={onNewTask} className="gus-btn gus-btn-primary">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("dashboard.createTask")}
          </button>
        </div>
      )}

      {status === "ready" && tasks.length > 0 && (
        <div className="flex flex-col gap-4">
          <Group label={t("dashboard.overdueGroup")} tone="text-rose-300" tasks={split.overdue} onToggle={onToggle} onOpen={onOpenTasks} />
          <Group label={t("dashboard.todayGroup")} tone="text-amber-300" tasks={split.today} onToggle={onToggle} onOpen={onOpenTasks} />
          {nothingNow && <p className="text-body text-gus-muted">{t("dashboard.nothingDue")}</p>}
          <Group label={t("dashboard.upNext")} tasks={split.upcoming} onToggle={onToggle} onOpen={onOpenTasks} />
          {nothingNow && split.upcoming.length === 0 && <p className="text-body text-gus-muted">{t("dashboard.allDone")}</p>}
          <div>
            <button type="button" onClick={onNewTask} className="gus-btn gus-btn-secondary">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("dashboard.createTask")}
            </button>
          </div>
        </div>
      )}
    </DashboardCard>
  );
}
