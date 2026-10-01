import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Flag,
  LayoutDashboard,
  ListTodo,
  Plus,
  RefreshCw,
  Settings,
  StickyNote,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import type { NoteFile } from "./FileExplorer";
import { NEW_TASK_EVENT } from "../lib/newTask";
import { loadTaskStore, type Task } from "../lib/taskStore";
import { PRIORITY_CLASS, priorityLabel, priorityRank } from "../lib/taskPriority";
import { useT } from "../lib/i18n";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";

type Translator = (key: MessageKey, params?: TranslateParams) => string;

export type DashboardTab = "notes" | "tasks" | "calendar" | "settings";

interface RecentNote {
  name: string;
  path: string;
  relative: string;
  modified_ms: number | null;
}

export interface DashboardViewProps {
  vaultPath: string;
  vaultName: string;
  onNavigate: (tab: DashboardTab) => void;
  onNewTask: () => void;
  onOpenNote: (file: NoteFile) => void;
}

const ICON_BOX =
  "flex h-10 w-10 items-center justify-center rounded-xl border border-gus-accent/40 bg-gus-accent/15 text-gus-accent";

const CARD = "rounded-xl border border-gus-border bg-gus-card";

function todayIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function dueChip(due: string, t: Translator): { label: string; title: string; className: string } {
  const today = todayIso();
  if (due < today) {
    return {
      label: shortDate(due),
      title: t("tasks.dueOverdue"),
      className: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    };
  }
  if (due === today) {
    return {
      label: t("common.today"),
      title: t("tasks.dueToday"),
      className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    };
  }
  return {
    label: shortDate(due),
    title: `${t("tasks.dueLabel")}: ${shortDate(due)}`,
    className: "border-gus-border bg-gus-panel text-gus-muted",
  };
}

function relativeTime(ms: number | null, t: Translator): string {
  if (ms == null) return t("dashboard.noDate");

  const diff = Date.now() - ms;
  if (diff < 60_000) return t("welcome.time.now");
  if (diff < 3_600_000) {
    return t("welcome.time.minutes", { count: Math.max(1, Math.floor(diff / 60_000)) });
  }
  if (diff < 86_400_000) return t("welcome.time.hours", { count: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t("welcome.time.days", { count: Math.floor(diff / 86_400_000) });

  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function folderOf(relative: string, t: Translator): string {
  const parts = relative.split("/");
  parts.pop();
  return parts.join("/") || t("welcome.vaultRoot");
}

export default function DashboardView({
  vaultPath,
  vaultName,
  onNavigate,
  onNewTask,
  onOpenNote,
}: DashboardViewProps) {
  const t = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStatus, setTasksStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [notes, setNotes] = useState<RecentNote[]>([]);
  const [notesStatus, setNotesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notesError, setNotesError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const tasksRef = useRef<Task[]>([]);
  /** Cancela cargas de notas obsoletas al cambiar de vault o recargar. */
  const notesRequestRef = useRef(0);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setTasksStatus("loading");

    loadTaskStore(vaultPath)
      .then((next) => {
        if (cancelled) return;
        tasksRef.current = next;
        setTasks(next);
        setTasksError(null);
        setTasksStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        tasksRef.current = [];
        setTasks([]);
        setTasksError(String(error));
        setTasksStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [vaultPath, reloadKey]);

  useEffect(() => {
    const token = ++notesRequestRef.current;
    setNotesStatus("loading");

    invoke<RecentNote[]>("list_recent_notes", { path: vaultPath, limit: 6 })
      .then((next) => {
        if (token !== notesRequestRef.current) return;
        setNotes(next);
        setNotesError(null);
        setNotesStatus("ready");
      })
      .catch((error: unknown) => {
        if (token !== notesRequestRef.current) return;
        setNotes([]);
        setNotesError(String(error));
        setNotesStatus("error");
      });
  }, [vaultPath, reloadKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen(NEW_TASK_EVENT, () => setReloadKey((key) => key + 1))
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
    const next = tasksRef.current.map((task) =>
      task.id === id ? { ...task, completes: !task.completes } : task,
    );
    tasksRef.current = next;
    setTasks(next);
    setSyncError(null);

    writeQueueRef.current = writeQueueRef.current
      .then(() => invoke("save_tasks", { vaultPath, tasks: next }))
      .catch((error: unknown) => setSyncError(String(error)));
  }

  const today = todayIso();
  const pending = tasks.filter((task) => !task.completes);
  const overdue = pending.filter((task) => task.due && task.due < today);
  const dueToday = pending.filter((task) => task.due === today);
  const done = tasks.length - pending.length;

  const upcoming = [...pending]
    .sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99"),
    )
    .slice(0, 6);

  const progress = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);

  const stats = [
    { label: t("dashboard.pending"), value: pending.length, className: "text-gus-text", tab: "tasks" as const },
    { label: t("calendar.overdue"), value: overdue.length, className: "text-rose-300", tab: "calendar" as const },
    { label: t("calendar.dueToday"), value: dueToday.length, className: "text-amber-300", tab: "calendar" as const },
    { label: t("dashboard.done"), value: done, className: "text-emerald-300", tab: "tasks" as const },
  ];

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section
      data-tour="dashboard"
      className="gus-scrollbar h-full overflow-y-auto p-6"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={ICON_BOX}>
              <LayoutDashboard className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
                {t("app.tab.home")}
              </h2>
              <p className="text-xs text-gus-muted first-letter:uppercase">
                {vaultName} · {todayLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            title={t("dashboard.reload")}
            aria-label={t("dashboard.reload")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gus-border bg-gus-card text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {syncError && (
          <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
            {syncError}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4">
          {stats.map(({ label, value, className, tab }, index) => (
            <motion.button
              key={label}
              type="button"
              onClick={() => onNavigate(tab)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.04 }}
              className={clsx(
                CARD,
                "group flex items-center justify-between px-3 py-2.5 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              )}
            >
              <span>
                <span className={clsx("block text-lg font-semibold", className)}>{value}</span>
                <span className="block text-[11px] uppercase tracking-wide text-gus-muted">
                  {label}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-gus-muted transition-transform group-hover:translate-x-0.5 group-hover:text-gus-accent"
                aria-hidden="true"
              />
            </motion.button>
          ))}
        </div>

        <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className={clsx(CARD, "flex flex-col gap-3 p-4")}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{t("dashboard.nextTasks")}</h3>
                  {upcoming.length > 0 && (
                    <span className="rounded-full border border-gus-border bg-gus-panel px-2 py-0.5 text-[10px] text-gus-muted">
                      {upcoming.length}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate("tasks")}
                  className="text-xs text-gus-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  {t("dashboard.openTasks")}
                </button>
              </div>

              {tasksStatus === "loading" && (
                <p className="py-6 text-center text-xs text-gus-muted">{t("dashboard.loadingTasks")}</p>
              )}

              {tasksStatus === "error" && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-xs text-gus-muted">{t("calendar.loadError")}</p>
                  {tasksError && (
                    <p className="max-w-md break-words text-[11px] text-rose-400/80">{tasksError}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => setReloadKey((key) => key + 1)}
                    className="rounded-lg border border-gus-border px-3 py-1.5 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {t("editor.retry")}
                  </button>
                </div>
              )}

              {tasksStatus === "ready" && upcoming.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gus-border py-8 text-center">
                  <p className="text-xs text-gus-muted">
                    {tasks.length === 0
                      ? t("dashboard.noTasks")
                      : t("dashboard.allDone")}
                  </p>
                  <button
                    type="button"
                    onClick={onNewTask}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gus-accent px-3 py-1.5 text-xs font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("dashboard.createTask")}
                  </button>
                </div>
              )}

              {tasksStatus === "ready" && upcoming.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {upcoming.map((task) => {
                    const chip = task.due ? dueChip(task.due, t) : null;

                    return (
                      <li
                        key={task.id}
                        className="flex items-center gap-3 rounded-lg border border-gus-border bg-gus-panel px-3 py-2"
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={task.completes}
                          aria-label={t("calendar.markDone", { title: task.title })}
                          onClick={() => toggle(task.id)}
                          className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gus-muted/60 text-transparent outline-none transition-colors hover:border-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                        >
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onNavigate("tasks")}
                          title={t("dashboard.seeInTasks")}
                          className="min-w-0 flex-1 truncate text-left text-sm text-gus-text outline-none transition-colors hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                        >
                          {task.title}
                        </button>

                        {task.priority && (
                          <span
                            title={t("tasks.priorityLabel", { name: priorityLabel(task.priority) })}
                            className={clsx(
                              "flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] capitalize",
                              PRIORITY_CLASS[task.priority],
                            )}
                          >
                            <Flag className="h-2.5 w-2.5" aria-hidden="true" />
                            {priorityLabel(task.priority)}
                          </span>
                        )}

                        {chip && (
                          <span
                            title={chip.title}
                            className={clsx(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[11px]",
                              chip.className,
                            )}
                          >
                            {chip.label}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={clsx(CARD, "flex flex-col gap-3 p-4")}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{t("dashboard.recentNotes")}</h3>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate("notes")}
                  className="text-xs text-gus-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                >
                  Ver todas
                </button>
              </div>

              {notesStatus === "loading" && (
                <p className="py-6 text-center text-xs text-gus-muted">{t("dashboard.loadingNotes")}</p>
              )}

              {notesStatus === "error" && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-xs text-gus-muted">{t("dashboard.notesError")}</p>
                  {notesError && (
                    <p className="max-w-md break-words text-[11px] text-rose-400/80">{notesError}</p>
                  )}
                </div>
              )}

              {notesStatus === "ready" && notes.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gus-border py-8 text-center">
                  <p className="text-xs text-gus-muted">{t("dashboard.emptyVault")}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate("notes")}
                    className="rounded-lg border border-gus-border px-3 py-1.5 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {t("dashboard.openExplorer")}
                  </button>
                </div>
              )}

              {notesStatus === "ready" && notes.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {notes.map((note) => (
                    <li key={note.path}>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenNote({ id: note.path, name: note.name, kind: "note" })
                        }
                        title={note.relative}
                        className="flex w-full items-center gap-3 rounded-lg border border-gus-border bg-gus-panel px-3 py-2 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                      >
                        <FileText
                          className="h-4 w-4 shrink-0 text-gus-muted"
                          strokeWidth={1.75}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gus-text">
                            {note.name.replace(/\.md$/i, "")}
                          </span>
                          <span className="block truncate text-[11px] text-gus-muted">
                            {folderOf(note.relative, t)}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-gus-muted">
                          {relativeTime(note.modified_ms, t)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className={clsx(CARD, "p-4")}>
              <h3 className="text-sm font-semibold">{t("dashboard.progress")}</h3>
              <p className="mt-1 text-xs text-gus-muted">
                {tasks.length === 0
                  ? t("dashboard.noTasksRegistered")
                  : t("tasks.doneCount", { done, total: tasks.length })}
              </p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gus-panel">
                <div
                  className="h-full rounded-full bg-gus-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-right text-[11px] text-gus-muted">{progress}%</p>
            </div>

            <div className={clsx(CARD, "flex flex-col gap-2 p-4")}>
              <h3 className="text-sm font-semibold">{t("dashboard.quickActions")}</h3>

              <button
                type="button"
                onClick={onNewTask}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-gus-accent px-3 py-2 text-sm font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("tasks.new")}
              </button>

              {(
                [
                  { tab: "notes" as const, label: t("app.tab.notes"), Icon: StickyNote },
                  { tab: "tasks" as const, label: t("dashboard.allTasks"), Icon: ListTodo },
                  { tab: "calendar" as const, label: t("app.tab.calendar"), Icon: CalendarDays },
                  { tab: "settings" as const, label: t("app.settings"), Icon: Settings },
                ]
              ).map(({ tab, label, Icon }) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onNavigate(tab)}
                  className="flex items-center gap-2.5 rounded-lg border border-gus-border bg-gus-panel px-3 py-2 text-sm text-gus-muted outline-none transition-colors hover:border-gus-accent/40 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
