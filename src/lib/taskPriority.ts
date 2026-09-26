import type { TaskPriority } from "../utils/taskParser";

export type { TaskPriority };

/**
 * Prioridades de las tareas, de mayor a menor urgencia, con sus etiquetas,
 * colores y utilidades de ordenación. Las cuatro banderas se usan tanto en
 * el almacén JSON como en las tareas escritas en notas (`!urgente`…).
 */

/** Niveles de prioridad ordenados de mayor a menor urgencia. */
export const TASK_PRIORITIES: TaskPriority[] = ["urgente", "alta", "media", "baja"];

/** Nombre visible de cada nivel. */
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

/** Color del chip/bandera de cada nivel (de más a menos urgente). */
export const PRIORITY_CLASS: Record<TaskPriority, string> = {
  urgente: "border-rose-400/50 bg-rose-400/15 text-rose-300",
  alta: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  media: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  baja: "border-gus-border bg-gus-panel text-gus-muted",
};

/** Peso de cada nivel para ordenar (mayor = atender antes). */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgente: 4,
  alta: 3,
  media: 2,
  baja: 1,
};

/** Peso para ordenar: sin prioridad = 0 (va al final de su grupo). */
export function priorityRank(priority?: TaskPriority | null): number {
  return priority ? PRIORITY_RANK[priority] : 0;
}

/** ¿Es un nivel conocido? (tolera datos sueltos que vengan del almacén). */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as string[]).includes(value);
}

/**
 * Siguiente nivel al clicar la bandera de una fila:
 * sin prioridad → baja → media → alta → urgente → sin prioridad.
 */
export function nextPriority(current?: TaskPriority | null): TaskPriority | null {
  if (!current) return "baja";
  if (current === "baja") return "media";
  if (current === "media") return "alta";
  if (current === "alta") return "urgente";
  return null;
}

/** Opciones del formulario de creación, de menor a mayor urgencia. */
export const PRIORITY_OPTIONS: (TaskPriority | null)[] = [
  null,
  "baja",
  "media",
  "alta",
  "urgente",
];
