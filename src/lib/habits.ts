/**
 * Hábitos (REQ-04). Puras: toda la cuenta de rachas y porcentajes sale de la
 * definición del hábito y del registro de días hechos; no se guarda nada derivado.
 */
import { fromIso, toIso } from "./calendarDate";

export interface Habit {
  id: string;
  name: string;
  description?: string;
  /** Días en que toca, de 0 (lunes) a 6 (domingo). */
  days: number[];
  /** Día de alta: antes de él el hábito no cuenta como fallado. */
  created: string;
  /**
   * Meta semanal (1–7 veces por semana, de lunes a domingo): se puede hacer
   * cualquier día y lo que cuenta es llegar al total de la semana. En ese caso
   * `days` son los siete días.
   */
  weeklyGoal?: number;
}

export interface HabitStore {
  version?: number;
  habits: Habit[];
  /** Id del hábito → días `AAAA-MM-DD` en que se hizo. */
  log: Record<string, string[]>;
}

export const EMPTY_HABITS: HabitStore = { habits: [], log: {} };

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Lunes = 0 … domingo = 6, como `weekdayLabels`. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

/** ¿Es un hábito de meta semanal (cualquier día, tantas veces por semana)? */
export function isWeekly(habit: Habit): boolean {
  return habit.weeklyGoal !== undefined && habit.weeklyGoal > 0;
}

/** Los siete días (lunes primero) de la semana a la que pertenece `iso`. */
export function weekOf(iso: string): string[] {
  const date = fromIso(iso);
  if (!date) return [];
  const monday = addDays(date, -weekdayIndex(date));
  return Array.from({ length: 7 }, (_, index) => toIso(addDays(monday, index)));
}

/** Veces que se hizo el hábito en la semana de `iso`. */
export function weekDone(store: HabitStore, habitId: string, iso: string): number {
  return weekOf(iso).filter((day) => isDone(store, habitId, day)).length;
}

/**
 * ¿Se puede (y se espera) hacer el hábito ese día? Los de días fijos, solo en
 * sus días; los de meta semanal, cualquier día desde el alta. Antes del alta nunca.
 */
export function isScheduled(habit: Habit, iso: string): boolean {
  const date = fromIso(iso);
  if (date === null || iso < habit.created) return false;
  return isWeekly(habit) || habit.days.includes(weekdayIndex(date));
}

export function isDone(store: HabitStore, habitId: string, iso: string): boolean {
  return store.log[habitId]?.includes(iso) ?? false;
}

/** Marca o desmarca un día. El registro queda ordenado y sin repetidos. */
export function toggleDay(store: HabitStore, habitId: string, iso: string): HabitStore {
  const days = store.log[habitId] ?? [];
  const next = days.includes(iso) ? days.filter((day) => day !== iso) : [...days, iso].sort();
  const log = { ...store.log, [habitId]: next };
  if (next.length === 0) delete log[habitId];
  return { ...store, log };
}

/** ¿Cae el día en uno de los días de la semana del hábito, sin mirar el alta? */
export function onWeekday(habit: Habit, iso: string): boolean {
  const date = fromIso(iso);
  return date !== null && habit.days.includes(weekdayIndex(date));
}

/**
 * Como `toggleDay`, pero marcar un día anterior al alta adelanta el comienzo
 * del hábito a ese día: quien registra lo que ya llevaba hecho no se queda sin historial.
 */
export function markDay(store: HabitStore, habitId: string, iso: string): HabitStore {
  const next = toggleDay(store, habitId, iso);
  return {
    ...next,
    habits: next.habits.map((habit) => (habit.id === habitId && iso < habit.created ? { ...habit, created: iso } : habit)),
  };
}

export function addHabit(store: HabitStore, habit: Habit): HabitStore {
  return { ...store, habits: [...store.habits, habit] };
}

export function updateHabit(store: HabitStore, habit: Habit): HabitStore {
  return { ...store, habits: store.habits.map((other) => (other.id === habit.id ? habit : other)) };
}

/** Borra el hábito y su historial. */
export function removeHabit(store: HabitStore, habitId: string): HabitStore {
  const log = { ...store.log };
  delete log[habitId];
  return { ...store, habits: store.habits.filter((habit) => habit.id !== habitId), log };
}

/** Días de los últimos `count` (el último es `today`), del más antiguo al más reciente. */
export function lastDays(today: string, count: number): string[] {
  const end = fromIso(today) ?? new Date();
  return Array.from({ length: count }, (_, index) => toIso(addDays(end, index - count + 1)));
}

/**
 * Racha actual: días programados seguidos y hechos, contando hacia atrás desde
 * hoy. Hoy sin hacer todavía no corta la racha (aún hay tiempo); un día
 * programado anterior sin hacer sí.
 */
export function currentStreak(habit: Habit, store: HabitStore, today: string): number {
  if (isWeekly(habit)) return weeklyStreak(habit, store, today).current;
  let streak = 0;
  let day = fromIso(today);
  if (!day) return 0;

  // Más allá del alta no hay nada que contar; el tope evita bucles con datos raros.
  for (let guard = 0; guard < 3660; guard++) {
    const iso = toIso(day);
    if (iso < habit.created) break;
    if (isScheduled(habit, iso)) {
      if (isDone(store, habit.id, iso)) streak += 1;
      else if (iso !== today) break;
    }
    day = addDays(day, -1);
  }
  return streak;
}

/** Mejor racha de la historia del hábito. */
export function bestStreak(habit: Habit, store: HabitStore, today: string): number {
  if (isWeekly(habit)) return weeklyStreak(habit, store, today).best;
  const start = fromIso(habit.created);
  const end = fromIso(today);
  if (!start || !end) return 0;

  let best = 0;
  let run = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const iso = toIso(day);
    if (!isScheduled(habit, iso)) continue;
    run = isDone(store, habit.id, iso) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Rachas de un hábito de meta semanal, en semanas seguidas que llegaron a la
 * meta. La semana en curso suma si ya la cumplió y, si aún no, no corta nada
 * (todavía hay tiempo); una semana anterior sin cumplir sí corta.
 */
function weeklyStreak(habit: Habit, store: HabitStore, today: string): { current: number; best: number } {
  const goal = habit.weeklyGoal ?? 1;
  const first = weekOf(habit.created)[0];
  const thisWeek = weekOf(today)[0];
  if (!first || !thisWeek) return { current: 0, best: 0 };

  let best = 0;
  let run = 0;
  for (let monday = fromIso(first); monday !== null && toIso(monday) <= thisWeek; monday = addDays(monday, 7)) {
    const met = weekDone(store, habit.id, toIso(monday)) >= goal;
    if (met) run += 1;
    else if (toIso(monday) !== thisWeek) run = 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/**
 * Hechos y esperados de un día entre todos los hábitos (el anillo del día).
 * Los de meta semanal solo cuentan hoy —y mientras les falte para la meta o
 * ya estén hechos hoy—; en los días pasados no hay un «tocaba» que juzgar.
 */
export function dayProgress(store: HabitStore, iso: string, today?: string): { done: number; total: number } {
  const expected = store.habits.filter((habit) => {
    if (!isScheduled(habit, iso)) return false;
    if (!isWeekly(habit)) return true;
    return iso === today && (isDone(store, habit.id, iso) || weekDone(store, habit.id, iso) < (habit.weeklyGoal ?? 1));
  });
  return { done: expected.filter((habit) => isDone(store, habit.id, iso)).length, total: expected.length };
}

/** Porcentaje (0–100) de días programados cumplidos en los últimos `count` días. */
export function completionRate(habit: Habit, store: HabitStore, today: string, count: number): number | null {
  if (isWeekly(habit)) {
    // Veces hechas frente a las que pedía la meta en ese tiempo, sin pasarse del 100 %.
    const days = lastDays(today, count).filter((iso) => iso >= habit.created);
    const wanted = ((habit.weeklyGoal ?? 1) * days.length) / 7;
    if (wanted === 0) return null;
    const done = days.filter((iso) => isDone(store, habit.id, iso)).length;
    return Math.min(100, Math.round((done / wanted) * 100));
  }
  const scheduled = lastDays(today, count).filter((iso) => isScheduled(habit, iso));
  if (scheduled.length === 0) return null;
  const done = scheduled.filter((iso) => isDone(store, habit.id, iso)).length;
  return Math.round((done / scheduled.length) * 100);
}
