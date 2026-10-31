/** Cambios sobre la lista de tareas como funciones puras: reciben la lista y devuelven otra. */
import { normalizeTags } from "./markdownTasks";
import type { NewTask } from "./newTask";
import { isTaskPriority, nextPriority } from "./taskPriority";
import { createTaskId, type Task } from "./taskStore";
import { removeWithRelations } from "./taskTree";

export type TaskColumn = "todo" | "doing" | "done";

function update(tasks: Task[], id: string, change: (task: Task) => Task): Task[] {
  return tasks.map((task) => (task.id === id ? change(task) : task));
}

/** Marca o desmarca una tarea; una tarea hecha deja de estar «en progreso». */
export function toggleDone(tasks: Task[], id: string): Task[] {
  return update(tasks, id, (task) => {
    const next = { ...task, completes: !task.completes };
    if (next.completes) delete next.doing;
    return next;
  });
}

/** Sube la prioridad un escalón (y tras la última, la quita). */
export function cyclePriority(tasks: Task[], id: string): Task[] {
  return update(tasks, id, (task) => {
    const { priority: _old, ...rest } = task;
    const priority = nextPriority(task.priority);
    return priority ? { ...rest, priority } : rest;
  });
}

/** Lleva una tarea a una columna del tablero. */
export function moveToColumn(tasks: Task[], id: string, column: TaskColumn): Task[] {
  return update(tasks, id, (task) => {
    const next: Task = { ...task, completes: column === "done", doing: column === "doing" };
    if (!next.doing) delete next.doing; // «en progreso» solo si lo está
    return next;
  });
}

/** Sustituye las etiquetas de una tarea (ya normalizadas). */
export function setTags(tasks: Task[], id: string, tags: string[]): Task[] {
  return update(tasks, id, (task) => ({ ...task, tags }));
}

/** Añade una subtarea al final: conservan el orden en que se crean bajo su padre. */
export function addSubtask(tasks: Task[], parentId: string, title: string): Task[] {
  return [...tasks, { id: createTaskId(), title, tags: [], completes: false, parentId }];
}

/** Quita la tarea y deja consistentes las relaciones de las demás (subtareas, bloqueos). */
export function removeTask(tasks: Task[], id: string): Task[] {
  return removeWithRelations(tasks, id);
}

/** Tarea nueva a partir de lo que trae el diálogo; `null` si no tiene título. */
export function taskFromNew(input: NewTask): Task | null {
  const title = input.title.trim();
  if (!title) return null;

  const description = input.description?.trim() || undefined;
  const due = input.due ?? undefined;
  const priority = isTaskPriority(input.priority) ? input.priority : undefined;

  return {
    id: createTaskId(),
    title,
    tags: normalizeTags(input.tags),
    completes: false,
    ...(description ? { description } : {}),
    ...(due ? { due } : {}),
    ...(priority ? { priority } : {}),
  };
}

/** ¿Pasa el filtro de etiqueta? Sin filtro pasan todas; las mayúsculas no cuentan. */
export function matchesTag(tags: string[], filter: string | null): boolean {
  if (!filter) return true;
  const wanted = filter.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === wanted);
}

/** Etiquetas con cuántas tareas las llevan, por orden alfabético; se muestra la primera grafía vista. */
export function tagCounts(tasks: Task[]): { label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      const key = tag.toLowerCase();
      const slot = counts.get(key);
      if (slot) slot.count += 1;
      else counts.set(key, { label: tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
}
