import type { TaskPriority } from "../utils/taskParser";

export type { TaskPriority };

export const TASK_PRIORITIES: TaskPriority[] = ["urgente", "alta", "media", "baja"];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export const PRIORITY_CLASS: Record<TaskPriority, string> = {
  urgente: "border-rose-400/50 bg-rose-400/15 text-rose-300",
  alta: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  media: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  baja: "border-gus-border bg-gus-panel text-gus-muted",
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgente: 4,
  alta: 3,
  media: 2,
  baja: 1,
};

export function priorityRank(priority?: TaskPriority | null): number {
  return priority ? PRIORITY_RANK[priority] : 0;
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as string[]).includes(value);
}

export function nextPriority(current?: TaskPriority | null): TaskPriority | null {
  if (!current) return "baja";
  if (current === "baja") return "media";
  if (current === "media") return "alta";
  if (current === "alta") return "urgente";
  return null;
}

export const PRIORITY_OPTIONS: (TaskPriority | null)[] = [
  null,
  "baja",
  "media",
  "alta",
  "urgente",
];
