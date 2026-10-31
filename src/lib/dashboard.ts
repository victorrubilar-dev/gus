/** Lógica pura del resumen («Hoy»): qué enseñar y en qué orden. */
import { priorityRank } from "./taskPriority";
import type { Task } from "./taskStore";
import { stripFrontmatter } from "./noteTags";

export type Greeting = "morning" | "afternoon" | "evening";

/** Saludo según la hora local: de 5 a 11 mañana, hasta las 19 tarde y el resto noche. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 20) return "afternoon";
  return "evening";
}

export interface TodayTasks {
  /** Pendientes con plazo anterior a hoy, la más antigua primero. */
  overdue: Task[];
  /** Pendientes que vencen hoy, las más importantes primero. */
  today: Task[];
  /** Lo que viene después (sin plazo o más adelante), por importancia y plazo. */
  upcoming: Task[];
}

/** Reparte las tareas pendientes entre vencidas, de hoy y lo siguiente (`today` en `AAAA-MM-DD`). */
export function splitTodayTasks(tasks: Task[], today: string, upcomingLimit = 3): TodayTasks {
  const pending = tasks.filter((task) => !task.completes);
  const byPriority = (a: Task, b: Task) => priorityRank(b.priority) - priorityRank(a.priority);

  const overdue = pending
    .filter((task) => task.due && task.due < today)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || byPriority(a, b));
  const dueToday = pending.filter((task) => task.due === today).sort(byPriority);
  const upcoming = pending
    .filter((task) => !task.due || task.due > today)
    .sort((a, b) => byPriority(a, b) || (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99"))
    .slice(0, upcomingLimit);

  return { overdue, today: dueToday, upcoming };
}

export type RecentKind = "note" | "board" | "pdf";

export interface RecentItem {
  kind: RecentKind;
  /** Ruta (notas y PDF) o id (pizarra): con lo que se abre. */
  id: string;
  name: string;
  /** Carpeta de la nota o del PDF; vacío para las pizarras. */
  detail: string;
  /** Última modificación en milisegundos, si se conoce. */
  modifiedMs: number | null;
}

/** Notas, pizarras y PDF juntos, lo más reciente primero; lo que no tiene fecha va al final. */
export function mergeRecents(items: RecentItem[], limit: number): RecentItem[] {
  return [...items]
    .sort((a, b) => (b.modifiedMs ?? -1) - (a.modifiedMs ?? -1))
    .slice(0, limit);
}

/**
 * Las primeras líneas con contenido de una nota, sin frontmatter ni marcas de
 * título o lista, para enseñar de qué va sin abrirla.
 */
export function notePreview(content: string, maxLines = 2): string[] {
  return stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+[.)]\s+)/, "").trim())
    .filter((line) => line !== "")
    .slice(0, maxLines);
}
