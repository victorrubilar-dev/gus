import { useState } from "react";
import clsx from "clsx";
import { Check, Circle, Flame, Pencil, Plus, Target, Trash2 } from "lucide-react";
import CheckboxVisual from "./CheckboxVisual";
import EmptyState from "./EmptyState";
import HabitRing from "./HabitRing";
import SegmentedControl from "./SegmentedControl";
import ViewHeader from "./ViewHeader";
import { useT } from "../lib/i18n";
import { fromIso, todayIso, weekdayLabels } from "../lib/calendarDate";
import { addHabit, ALL_DAYS, bestStreak, completionRate, currentStreak, dayProgress, isDone, isScheduled, isWeekly, lastDays, markDay, onWeekday, removeHabit, toggleDay, updateHabit, weekDone, weekdayIndex, type Habit } from "../lib/habits";
import { createTaskId } from "../lib/taskStore";
import { useHabitStore } from "./useHabitStore";

export interface HabitsViewProps {
  vaultPath: string;
}

/** Días que enseña el tracker: dos semanas caben sin scroll en una ventana normal. */
const TRACKER_DAYS = 14;

interface HabitFormProps {
  initial: Habit | null;
  onSave: (habit: Habit) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

function HabitForm({ initial, onSave, onDelete, onCancel }: HabitFormProps) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [days, setDays] = useState<number[]>(initial?.days ?? ALL_DAYS);
  /** «Días fijos»: solo toca en los días elegidos. «Meta semanal»: cualquier día, tantas veces por semana. */
  const [weekly, setWeekly] = useState(initial ? isWeekly(initial) : false);
  const [goal, setGoal] = useState(initial?.weeklyGoal ?? 3);
  const labels = weekdayLabels();
  const field = "rounded-lg border border-gus-border bg-gus-panel px-2 py-1.5 text-body text-gus-text outline-none focus:border-gus-accent/60";
  const valid = name.trim() !== "" && (weekly || days.length > 0);

  function submit() {
    if (!valid) return;
    onSave({
      id: initial?.id ?? createTaskId(),
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      days: weekly ? ALL_DAYS : [...days].sort(),
      created: initial?.created ?? todayIso(),
      ...(weekly ? { weeklyGoal: goal } : {}),
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="space-y-3 rounded-xl border border-gus-border bg-gus-card p-4"
    >
      <input
        autoFocus
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder={t("habits.namePlaceholder")}
        aria-label={t("habits.name")}
        className={`${field} w-full`}
      />
      <input
        value={description}
        maxLength={200}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t("habits.descriptionPlaceholder")}
        aria-label={t("habits.description")}
        className={`${field} w-full`}
      />
      <div className="w-fit">
        <SegmentedControl
          ariaLabel={t("habits.days")}
          value={weekly ? "weekly" : "days"}
          onChange={(value) => setWeekly(value === "weekly")}
          options={[
            { value: "days", label: t("habits.mode.days") },
            { value: "weekly", label: t("habits.mode.weekly") },
          ]}
        />
      </div>
      {weekly ? (
        <div className="space-y-1.5">
          <div role="group" aria-label={t("habits.weeklyGoal")} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-body text-gus-muted">{t("habits.weeklyGoal")}</span>
            {[1, 2, 3, 4, 5, 6, 7].map((times) => (
              <button
                key={times}
                type="button"
                aria-pressed={goal === times}
                onClick={() => setGoal(times)}
                className={clsx(
                  "h-7 w-7 rounded-full border text-meta transition-colors",
                  goal === times ? "border-gus-accent/50 bg-gus-accent/15 text-gus-accent" : "border-gus-border text-gus-muted hover:text-gus-text",
                )}
              >
                {times}
              </button>
            ))}
          </div>
          <p className="text-meta text-gus-muted">{t("habits.weeklyHint")}</p>
        </div>
      ) : (
      <div role="group" aria-label={t("habits.days")} className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-body text-gus-muted">{t("habits.days")}</span>
        {ALL_DAYS.map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => setDays(on ? days.filter((other) => other !== day) : [...days, day])}
              className={clsx(
                "rounded-full border px-2.5 py-1 text-meta capitalize transition-colors",
                on ? "border-gus-accent/50 bg-gus-accent/15 text-gus-accent" : "border-gus-border text-gus-muted hover:text-gus-text",
              )}
            >
              {labels[day]}
            </button>
          );
        })}
      </div>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={!valid} className="gus-btn gus-btn-primary">
          {t("common.save")}
        </button>
        <button type="button" onClick={onCancel} className="gus-btn gus-btn-secondary">
          {t("common.cancel")}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="gus-btn gus-btn-secondary ml-auto text-rose-300">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("habits.delete")}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Hábitos (REQ-04): un anillo de cierre del día y una cuadrícula clásica de
 * seguimiento. Los datos viven en `.gus-habits.json`; rachas y porcentajes se
 * calculan al vuelo desde el registro.
 */
export default function HabitsView({ vaultPath }: HabitsViewProps) {
  const t = useT();
  const { store, status, error, update } = useHabitStore(vaultPath);
  const [mode, setMode] = useState<"rings" | "tracker">("rings");
  /** `"new"` abre el formulario vacío; un hábito, su edición. */
  const [editing, setEditing] = useState<Habit | "new" | null>(null);

  const today = todayIso();
  const labels = weekdayLabels();
  const todayProgress = dayProgress(store, today, today);
  const week = lastDays(today, 7);

  const form = editing !== null && (
    <HabitForm
      initial={editing === "new" ? null : editing}
      onCancel={() => setEditing(null)}
      onSave={(habit) => {
        update(editing === "new" ? addHabit(store, habit) : updateHabit(store, habit));
        setEditing(null);
      }}
      onDelete={editing === "new" ? undefined : () => {
        update(removeHabit(store, editing.id));
        setEditing(null);
      }}
    />
  );

  return (
    <section data-tour="habits" className="gus-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ViewHeader
        title={t("habits.title")}
        description={t("habits.desc")}
        actions={
          <>
            <SegmentedControl
              ariaLabel={t("habits.title")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "rings", label: t("habits.modeRings"), icon: Target },
                { value: "tracker", label: t("habits.modeTracker"), icon: Check },
              ]}
            />
            <button type="button" onClick={() => setEditing("new")} className="gus-btn gus-btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("habits.new")}
            </button>
          </>
        }
      />

      {status === "loading" && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {error && <p className="break-words rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">{error}</p>}

      {editing === "new" && form}

      {status === "ready" && store.habits.length === 0 && editing !== "new" && (
        <EmptyState icon={Flame} title={t("habits.empty")} />
      )}

      {status === "ready" && store.habits.length > 0 && mode === "rings" && (
        <>
          <div className="flex flex-wrap items-center gap-8 rounded-xl border border-gus-border bg-gus-card p-5">
            <HabitRing
              done={todayProgress.done}
              total={todayProgress.total}
              size={132}
              stroke={12}
              label={todayProgress.total === 0 ? "—" : `${todayProgress.done}/${todayProgress.total}`}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-display text-gus-text">
                {todayProgress.total === 0
                  ? t("habits.nothingToday")
                  : todayProgress.done === todayProgress.total
                    ? t("habits.allDone")
                    : t("habits.todayLeft", { count: todayProgress.total - todayProgress.done })}
              </p>
              <ul className="flex gap-3" aria-label={t("habits.lastWeek")}>
                {week.map((iso) => {
                  const progress = dayProgress(store, iso, today);
                  const date = fromIso(iso);
                  return (
                    <li key={iso} className="flex flex-col items-center gap-1 text-meta text-gus-muted" title={`${iso}: ${progress.done}/${progress.total}`}>
                      <HabitRing done={progress.done} total={progress.total} size={30} stroke={4} />
                      <span className={clsx("capitalize", iso === today && "text-gus-accent")}>{date ? labels[weekdayIndex(date)] : ""}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <ul className="space-y-2">
            {store.habits.map((habit) => {
              const scheduled = isScheduled(habit, today);
              const done = isDone(store, habit.id, today);
              const streak = currentStreak(habit, store, today);
              return (
                <li key={habit.id} className="space-y-2">
                  <div className={clsx("flex items-center gap-3 rounded-xl border border-gus-border bg-gus-card px-3 py-2.5", !scheduled && "opacity-60")}>
                    <label className={clsx("flex min-w-0 flex-1 items-center gap-3", scheduled && "cursor-pointer")}>
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={!scheduled}
                        onChange={() => update(toggleDay(store, habit.id, today))}
                        className="peer sr-only"
                      />
                      <CheckboxVisual checked={done} />
                      <span className="flex min-w-0 flex-col">
                        <span className={clsx("truncate text-sm", done ? "text-gus-muted line-through" : "text-gus-text")}>{habit.name}</span>
                        {habit.description && <span className="truncate text-meta text-gus-muted">{habit.description}</span>}
                      </span>
                    </label>
                    {!scheduled && <span className="shrink-0 text-meta text-gus-muted">{t("habits.notToday")}</span>}
                    {isWeekly(habit) && (
                      <span className="shrink-0 rounded-full border border-gus-border bg-gus-panel px-2 py-0.5 text-meta text-gus-muted">
                        {t("habits.weekProgress", { done: weekDone(store, habit.id, today), goal: habit.weeklyGoal ?? 1 })}
                      </span>
                    )}
                    {streak > 0 && (
                      <span title={t(isWeekly(habit) ? "habits.streakWeeks" : "habits.streakTitle", { best: bestStreak(habit, store, today) })} className="flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-meta text-amber-300">
                        <Flame className="h-3 w-3" aria-hidden="true" />
                        {streak}
                      </span>
                    )}
                    <button type="button" onClick={() => setEditing(habit)} aria-label={t("habits.edit", { name: habit.name })} title={t("habits.edit", { name: habit.name })} className="gus-btn gus-btn-icon">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {editing !== "new" && editing?.id === habit.id && form}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {status === "ready" && store.habits.length > 0 && mode === "tracker" && (
        <div className="gus-scrollbar overflow-x-auto rounded-xl border border-gus-border bg-gus-card">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="text-meta text-gus-muted">
                <th className="px-3 py-2 text-left font-normal">{t("habits.name")}</th>
                {lastDays(today, TRACKER_DAYS).map((iso) => {
                  const date = fromIso(iso);
                  return (
                    <th key={iso} className={clsx("px-1 py-2 text-center font-normal", iso === today && "text-gus-accent")} title={iso}>
                      <span className="block capitalize">{date ? labels[weekdayIndex(date)] : ""}</span>
                      <span className="block">{date?.getDate()}</span>
                    </th>
                  );
                })}
                <th className="px-2 py-2 text-center font-normal">{t("habits.streak")}</th>
                <th className="px-2 py-2 text-center font-normal">30d</th>
              </tr>
            </thead>
            <tbody>
              {store.habits.map((habit) => {
                const rate = completionRate(habit, store, today, 30);
                return (
                  <tr key={habit.id} className="border-t border-gus-border">
                    <th scope="row" className="max-w-48 px-3 py-2 text-left font-normal">
                      <button type="button" onClick={() => { setMode("rings"); setEditing(habit); }} className="truncate text-gus-text hover:text-gus-accent" title={habit.description ?? habit.name}>
                        {habit.name}
                      </button>
                      {isWeekly(habit) && (
                        <span className="ml-1.5 text-meta text-gus-muted">{weekDone(store, habit.id, today)}/{habit.weeklyGoal ?? 1}</span>
                      )}
                    </th>
                    {lastDays(today, TRACKER_DAYS).map((iso) => {
                      const done = isDone(store, habit.id, iso);
                      return (
                        <td key={iso} className="px-1 py-1 text-center">
                          {onWeekday(habit, iso) || done ? (
                            <button
                              type="button"
                              aria-pressed={done}
                              aria-label={`${habit.name} ${iso}`}
                              onClick={() => update(markDay(store, habit.id, iso))}
                              className={clsx(
                                "grid h-6 w-6 place-items-center rounded-md border transition-colors",
                                done ? "border-gus-accent bg-gus-accent text-gus-bg" : "border-gus-border hover:border-gus-accent/60",
                              )}
                            >
                              {done && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                            </button>
                          ) : (
                            <Circle className="mx-auto h-1.5 w-1.5 text-gus-border" aria-hidden="true" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center text-gus-text">{currentStreak(habit, store, today)}</td>
                    <td className="px-2 py-1 text-center text-gus-muted">{rate === null ? "—" : `${rate}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
