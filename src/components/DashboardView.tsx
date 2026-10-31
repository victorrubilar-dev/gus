import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { NoteFile } from "./FileExplorer";
import { dailyRelativePath } from "../lib/dailyNotes";
import { greetingFor, mergeRecents, notePreview, splitTodayTasks, type RecentItem } from "../lib/dashboard";
import { joinPath } from "../lib/fileName";
import { toggleDay } from "../lib/habits";
import { useT } from "../lib/i18n";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";
import { NEW_TASK_EVENT } from "../lib/newTask";
import { todayIso } from "../lib/taskDue";
import { loadTaskStore, type Task } from "../lib/taskStore";
import DashboardDaily from "./DashboardDaily";
import DashboardHabits from "./DashboardHabits";
import DashboardRecent from "./DashboardRecent";
import DashboardToday from "./DashboardToday";
import { useHabitStore } from "./useHabitStore";

type Translator = (key: MessageKey, params?: TranslateParams) => string;

export type DashboardTab = "notes" | "tasks" | "calendar" | "settings" | "habits" | "boards" | "library";

interface FileEntry {
  name: string;
  path: string;
  relative: string;
  modified_ms: number | null;
}

interface BoardEntry {
  id: string;
  name: string;
  modifiedMs: number | null;
}

export interface DashboardViewProps {
  vaultPath: string;
  vaultName: string;
  /** Carpeta de las notas diarias (de los ajustes). */
  dailyNotesFolder: string;
  onNavigate: (tab: DashboardTab) => void;
  onNewTask: () => void;
  onOpenNote: (file: NoteFile) => void;
  onOpenDailyNote: () => void;
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

function folderOf(relative: string): string {
  const parts = relative.split("/");
  parts.pop();
  return parts.join("/");
}

/**
 * «Hoy»: lo que hay entre manos de un vistazo. Tareas de hoy y vencidas, hábitos
 * del día, la nota del día y lo último que se tocó para seguir donde se dejó.
 */
export default function DashboardView({
  vaultPath,
  vaultName,
  dailyNotesFolder,
  onNavigate,
  onNewTask,
  onOpenNote,
  onOpenDailyNote,
}: DashboardViewProps) {
  const t = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksStatus, setTasksStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [recentsStatus, setRecentsStatus] = useState<"loading" | "ready">("loading");
  /** `null` mientras se mira, `false` si hoy no hay nota. */
  const [daily, setDaily] = useState<string[] | false | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const habits = useHabitStore(vaultPath);

  const tasksRef = useRef<Task[]>([]);
  /** Cancela cargas obsoletas al cambiar de vault o recargar. */
  const requestRef = useRef(0);
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
    const token = ++requestRef.current;
    const fresh = () => token === requestRef.current;
    setRecentsStatus("loading");

    // Cada fuente falla por su cuenta: sin pizarras o sin PDF el resto se enseña igual.
    const ask = <T,>(command: string, args: Record<string, unknown>) =>
      invoke<T[]>(command, args).catch((): T[] => []);

    Promise.all([
      ask<FileEntry>("list_recent_notes", { path: vaultPath, limit: 8 }),
      ask<BoardEntry>("list_boards", { vaultPath }),
      ask<FileEntry>("list_vault_pdfs", { path: vaultPath }),
    ]).then(([notes, boards, pdfs]) => {
      if (!fresh()) return;
      setRecents(
        mergeRecents(
          [
            ...notes.map((note): RecentItem => ({ kind: "note", id: note.path, name: note.name.replace(/\.md$/i, ""), detail: folderOf(note.relative), modifiedMs: note.modified_ms })),
            ...boards.map((board): RecentItem => ({ kind: "board", id: board.id, name: board.name, detail: "", modifiedMs: board.modifiedMs })),
            ...pdfs.map((pdf): RecentItem => ({ kind: "pdf", id: pdf.path, name: pdf.name, detail: folderOf(pdf.relative), modifiedMs: pdf.modified_ms })),
          ],
          6,
        ),
      );
      setRecentsStatus("ready");
    });
  }, [vaultPath, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setDaily(null);
    const path = joinPath(vaultPath, dailyRelativePath(dailyNotesFolder, new Date()));

    invoke<string>("read_vault_file", { path })
      .then((text) => !cancelled && setDaily(notePreview(text)))
      .catch(() => !cancelled && setDaily(false));

    return () => {
      cancelled = true;
    };
  }, [vaultPath, dailyNotesFolder, reloadKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen(NEW_TASK_EVENT, () => setReloadKey((key) => key + 1))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function toggleTask(id: string) {
    const next = tasksRef.current.map((task) => (task.id === id ? { ...task, completes: !task.completes } : task));
    tasksRef.current = next;
    setTasks(next);
    setSyncError(null);

    writeQueueRef.current = writeQueueRef.current
      .then(() => invoke("save_tasks", { vaultPath, tasks: next }))
      .catch((error: unknown) => setSyncError(String(error)));
  }

  function openRecent(item: RecentItem) {
    if (item.kind === "board") onNavigate("boards");
    else onOpenNote({ id: item.id, name: item.kind === "note" ? `${item.name}.md` : item.name, kind: item.kind });
  }

  const today = todayIso();
  const now = new Date();
  const split = splitTodayTasks(tasks, today);
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  return (
    <section data-tour="dashboard" className="gus-scrollbar h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gus-text">{t(`dashboard.greeting.${greetingFor(now.getHours())}`)}</h2>
            <p className="text-body text-gus-muted first-letter:uppercase">
              {vaultName} · {dateLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            title={t("dashboard.reload")}
            aria-label={t("dashboard.reload")}
            className="gus-btn gus-btn-icon"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {(syncError || habits.error) && (
          <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-body text-rose-300">
            {syncError ?? habits.error}
          </p>
        )}

        <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
          <DashboardToday
            status={tasksStatus}
            error={tasksError}
            tasks={tasks}
            split={split}
            onToggle={toggleTask}
            onRetry={() => setReloadKey((key) => key + 1)}
            onOpenTasks={() => onNavigate("tasks")}
            onNewTask={onNewTask}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <DashboardHabits
              store={habits.store}
              status={habits.status}
              today={today}
              onToggle={(habitId) => habits.update(toggleDay(habits.store, habitId, today))}
              onOpenHabits={() => onNavigate("habits")}
            />
            <DashboardDaily note={daily} dateLabel={dateLabel} onOpen={onOpenDailyNote} />
          </div>
        </div>

        <DashboardRecent items={recents} status={recentsStatus} relativeTime={(ms) => relativeTime(ms, t)} onOpen={openRecent} />
      </div>
    </section>
  );
}
