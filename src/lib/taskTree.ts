/**
 * Subtareas y dependencias (REQ-11). Puras: operan sobre la lista plana de
 * tareas y devuelven una nueva. El backend repite las mismas comprobaciones al
 * guardar (`validate_task_relations`), así que ambas reglas deben coincidir.
 */
import type { Task } from "./taskStore";

export interface TreeRow {
  task: Task;
  depth: number;
}

const byId = (tasks: readonly Task[]) => new Map(tasks.map((task) => [task.id, task]));

function childrenOf(tasks: readonly Task[], id: string): Task[] {
  return tasks.filter((task) => task.parentId === id);
}

/** Ids de todas las subtareas de `id`, a cualquier profundidad. */
export function descendantIds(tasks: readonly Task[], id: string): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of childrenOf(tasks, current)) {
      if (!found.has(child.id)) {
        found.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return found;
}

/**
 * Lista plana en orden de árbol: cada tarea seguida de sus subtareas. Las
 * raíces conservan el orden recibido; las subtareas, el de la lista.
 */
export function flattenTree(tasks: readonly Task[]): TreeRow[] {
  const known = byId(tasks);
  const rows: TreeRow[] = [];

  const visit = (task: Task, depth: number) => {
    rows.push({ task, depth });
    for (const child of childrenOf(tasks, task.id)) visit(child, depth + 1);
  };

  for (const task of tasks) {
    if (!task.parentId || !known.has(task.parentId)) visit(task, 0);
  }
  return rows;
}

/** Hechas y totales entre todas las subtareas de una tarea (`total` 0 = sin subtareas). */
export function subtaskProgress(tasks: readonly Task[], id: string): { done: number; total: number } {
  const ids = descendantIds(tasks, id);
  const subtasks = tasks.filter((task) => ids.has(task.id));
  return { done: subtasks.filter((task) => task.completes).length, total: subtasks.length };
}

/** Tareas que bloquean a `task` y siguen sin completarse. */
export function pendingBlockers(tasks: readonly Task[], task: Task): Task[] {
  const known = byId(tasks);
  return (task.blockedBy ?? [])
    .map((id) => known.get(id))
    .filter((blocker): blocker is Task => blocker !== undefined && !blocker.completes);
}

/** ¿`id` depende (directa o indirectamente) de `target`? */
function dependsOn(tasks: readonly Task[], id: string, target: string): boolean {
  const known = byId(tasks);
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(known.get(current)?.blockedBy ?? []));
  }
  return false;
}

/** Una tarea no puede colgar de sí misma ni de una de sus propias subtareas. */
export function canSetParent(tasks: readonly Task[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (parentId === id || !tasks.some((task) => task.id === parentId)) return false;
  return !descendantIds(tasks, id).has(parentId);
}

/** Una tarea no puede bloquearse a sí misma ni cerrar un ciclo de dependencias. */
export function canBlockBy(tasks: readonly Task[], id: string, blockerId: string): boolean {
  if (blockerId === id || !tasks.some((task) => task.id === blockerId)) return false;
  return !dependsOn(tasks, blockerId, id);
}

function patch(tasks: readonly Task[], id: string, change: (task: Task) => Task): Task[] {
  return tasks.map((task) => (task.id === id ? change(task) : task));
}

export function setParent(tasks: readonly Task[], id: string, parentId: string | null): Task[] {
  if (!canSetParent(tasks, id, parentId)) return [...tasks];
  return patch(tasks, id, ({ parentId: _old, ...rest }) => (parentId === null ? rest : { ...rest, parentId }));
}

/** Añade el bloqueo si no estaba y quita si ya estaba. Ignora los que crearían un ciclo. */
export function toggleBlocker(tasks: readonly Task[], id: string, blockerId: string): Task[] {
  const current = tasks.find((task) => task.id === id)?.blockedBy ?? [];
  const next = current.includes(blockerId)
    ? current.filter((other) => other !== blockerId)
    : canBlockBy(tasks, id, blockerId)
      ? [...current, blockerId]
      : current;

  return patch(tasks, id, ({ blockedBy: _old, ...rest }) => (next.length === 0 ? rest : { ...rest, blockedBy: next }));
}

/**
 * Quita una tarea sin dejar referencias colgando: sus subtareas suben un nivel
 * (no se borran con ella) y nadie sigue bloqueado por algo que ya no existe.
 */
export function removeWithRelations(tasks: readonly Task[], id: string): Task[] {
  const removed = tasks.find((task) => task.id === id);
  return tasks
    .filter((task) => task.id !== id)
    .map((task) => {
      let next = task;
      if (task.parentId === id) {
        const { parentId: _old, ...rest } = next;
        next = removed?.parentId ? { ...rest, parentId: removed.parentId } : rest;
      }
      if (next.blockedBy?.includes(id)) {
        const { blockedBy, ...rest } = next;
        const left = blockedBy.filter((other) => other !== id);
        next = left.length === 0 ? rest : { ...rest, blockedBy: left };
      }
      return next;
    });
}

/**
 * Deja la lista sin relaciones inválidas (ids que no existen, autorreferencias
 * y ciclos), por si el archivo se editó a mano. Lo válido se conserva.
 */
export function cleanRelations(tasks: readonly Task[]): Task[] {
  const known = new Set(tasks.map((task) => task.id));
  let result = tasks.map(({ parentId, blockedBy, ...rest }): Task => ({
    ...rest,
    ...(parentId && known.has(parentId) && parentId !== rest.id ? { parentId } : {}),
    ...(blockedBy ? { blockedBy: blockedBy.filter((id) => known.has(id) && id !== rest.id) } : {}),
  }));

  // Ciclos de jerarquía: se corta el enlace de quien la cierra.
  for (const task of result) {
    if (task.parentId && descendantIds(result, task.id).has(task.parentId)) {
      result = patch(result, task.id, ({ parentId: _old, ...rest }) => rest);
    }
  }

  // Dependencias: se aceptan una a una; `toggleBlocker` descarta la que cierra un ciclo.
  let rebuilt = result.map(({ blockedBy: _drop, ...rest }): Task => rest);
  for (const task of result) {
    for (const blocker of new Set(task.blockedBy)) rebuilt = toggleBlocker(rebuilt, task.id, blocker);
  }
  return rebuilt;
}
