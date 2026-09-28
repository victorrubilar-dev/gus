import { invoke } from "@tauri-apps/api/core";
import { scanTaskLines } from "./markdownTasks";
import { isTaskPriority, type TaskPriority } from "./taskPriority";

export interface Task {
  id: string;
  title: string;
  tags: string[];
  completes: boolean;
  description?: string;
  due?: string;
  priority?: TaskPriority;
  doing?: boolean;
}

export function createTaskId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

function normalizeStored({ priority, doing, ...rest }: Task): Task {
  return {
    ...rest,
    ...(isTaskPriority(priority) ? { priority } : {}),
    ...(doing ? { doing: true } : {}),
  };
}

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
    // Respaldo best-effort: el JSON ya es la fuente de verdad.
  }

  return migrated;
}
