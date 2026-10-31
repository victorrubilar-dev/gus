/** Estado y aspecto del plazo de una tarea, compartido por la lista, el tablero y el resumen. */
import { toIso, todayIso } from "./calendarDate";

export type DueKind = "done" | "overdue" | "today" | "later";

/** Clases del chip de plazo según su estado. */
export const DUE_CLASS: Record<DueKind, string> = {
  done: "border-gus-border bg-gus-panel text-gus-muted",
  later: "border-gus-border bg-gus-panel text-gus-muted",
  overdue: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  today: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

/** Una tarea hecha nunca vence; si no, se compara el día con hoy (`today` en `AAAA-MM-DD`). */
export function dueKind(task: { completes: boolean }, due: string, today: string = todayIso()): DueKind {
  if (task.completes) return "done";
  if (due < today) return "overdue";
  return due === today ? "today" : "later";
}

/** «5 nov» y, si no es del año en curso, «5 nov 2027». Un texto que no es fecha se devuelve tal cual. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export { toIso, todayIso };
