import clsx from "clsx";
import { Flame } from "lucide-react";
import { useT } from "../lib/i18n";
import { dayProgress, expectedHabits, isDone, isWeekly, weekDone, type HabitStore } from "../lib/habits";
import CheckboxVisual from "./CheckboxVisual";
import DashboardCard, { CardLink } from "./DashboardCard";
import HabitRing from "./HabitRing";

interface DashboardHabitsProps {
  store: HabitStore;
  status: "loading" | "ready" | "error";
  today: string;
  onToggle: (habitId: string) => void;
  onOpenHabits: () => void;
}

/** Los hábitos de hoy: el anillo del día y cada uno con su casilla. */
export default function DashboardHabits({ store, status, today, onToggle, onOpenHabits }: DashboardHabitsProps) {
  const t = useT();
  const expected = expectedHabits(store, today, today);
  const progress = dayProgress(store, today, today);

  return (
    <DashboardCard
      icon={Flame}
      title={t("dashboard.habitsTitle")}
      action={<CardLink onClick={onOpenHabits}>{t("dashboard.openHabits")}</CardLink>}
    >
      {status === "loading" && <p className="py-4 text-center text-body text-gus-muted">{t("common.loading")}</p>}
      {status === "error" && <p className="py-4 text-center text-body text-gus-muted">{t("dashboard.loadError")}</p>}

      {status === "ready" && store.habits.length === 0 && (
        <p className="py-2 text-body text-gus-muted">{t("dashboard.habitsNone")}</p>
      )}

      {status === "ready" && store.habits.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <HabitRing done={progress.done} total={progress.total} size={64} stroke={7} label={progress.total === 0 ? "—" : `${progress.done}/${progress.total}`} />
            <p className="text-body text-gus-text">
              {progress.total === 0
                ? t("habits.nothingToday")
                : progress.done === progress.total
                  ? t("habits.allDone")
                  : t("habits.todayLeft", { count: progress.total - progress.done })}
            </p>
          </div>

          {expected.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {expected.map((habit) => {
                const done = isDone(store, habit.id, today);
                return (
                  <li key={habit.id} className="rounded-lg border border-gus-border bg-gus-panel px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={done} onChange={() => onToggle(habit.id)} className="peer sr-only" />
                      <CheckboxVisual checked={done} />
                      <span className={clsx("min-w-0 flex-1 truncate text-sm", done ? "text-gus-muted line-through" : "text-gus-text")}>{habit.name}</span>
                      {isWeekly(habit) && (
                        <span className="shrink-0 text-meta text-gus-muted">
                          {weekDone(store, habit.id, today)}/{habit.weeklyGoal ?? 1}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </DashboardCard>
  );
}
