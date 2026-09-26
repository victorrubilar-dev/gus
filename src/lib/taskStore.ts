import { invoke } from "@tauri-apps/api/core";
import { scanTaskLines } from "./markdownTasks";
import { isTaskPriority, type TaskPriority } from "./taskPriority";

/**
 * Contrato del almacén privado de tareas (`.gus-tasks.json`).
 * El usuario no lo edita a mano: la app es la única fuente de escritura.
 */
export interface Task {
  id: string;
  title: string;
  /** Etiquetas de identificación libres: varias por tarea, en orden. */
  tags: string[];
  completes: boolean;
  /** Detalle opcional guardado junto a la tarea. */
  description?: string;
  /** Fecha de plazo `AAAA-MM-DD`, si tiene. */
  due?: string;
  /** Prioridad opcional (`baja`…`urgente`); ausente = sin prioridad. */
  priority?: TaskPriority;
  /** Columna «En progreso» del tablero Kanban. */
  doing?: boolean;
}

/** Id estable para una tarea recién creada o importada. */
export function createTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Importa una vez las tareas del antiguo `tareas.md` al nuevo almacén JSON. */
export function tasksFromLegacyMarkdown(markdown: string): Task[] {
  return scanTaskLines(markdown).map((task) => ({
    id: createTaskId(),
    title: task.title,
    tags: [...task.tags],
    completes: task.completes,
    ...(task.description ? { description: task.description } : {}),
    ...(task.due ? { due: task.due } : {}),
  }));
}

/** Normaliza una tarea leída del JSON: prioridad desconocida se ignora y
 * `doing` solo se conserva si es verdadero (los flags viajan «a hueso»). */
function normalizeStored({ priority, doing, ...rest }: Task): Task {
  return {
    ...rest,
    ...(isTaskPriority(priority) ? { priority } : {}),
    ...(doing ? { doing: true } : {}),
  };
}

/**
 * Carga las tareas del vault. Si el JSON todavía está vacío, migra el
 * `tareas.md` antiguo y lo archiva como `.gus-tasks.md.bak`.
 */
export async function loadTaskStore(vaultPath: string): Promise<Task[]> {
  const stored = await invoke<Task[]>("load_tasks", { vaultPath });
  if (stored.length > 0) return stored.map(normalizeStored);

  const legacyMarkdown = await invoke<string | null>("read_legacy_tasks", { vaultPath });
  if (!legacyMarkdown) return [];

  const migrated = tasksFromLegacyMarkdown(legacyMarkdown);
  if (migrated.length === 0) return [];

  await invoke("save_tasks", { vaultPath, tasks: migrated });
  try {
    await invoke("archive_legacy_tasks", { vaultPath });
  } catch {
    // El JSON ya es la fuente de verdad; el respaldo no estorba.
  }

  return migrated;
}
