/**
 * Checkboxes de las notas como tareas (REQ-09). La nota es la única fuente de
 * verdad: aquí solo se leen y se marcan, nunca se copian a `.gus-tasks.json`.
 */
import { scanTaskLines, setTaskChecked, type TaskLine } from "./markdownTasks";

/** Lo que devuelve `list_notes_with_checkboxes`. */
export interface NoteWithText {
  name: string;
  path: string;
  relative: string;
  text: string;
}

export interface NoteTask extends TaskLine {
  notePath: string;
  noteName: string;
  /** Ruta relativa de la nota en el vault: sirve de clave de origen. */
  relative: string;
}

export function noteTasksFrom(notes: readonly NoteWithText[]): NoteTask[] {
  return notes.flatMap((note) =>
    scanTaskLines(note.text).map((task) => ({
      ...task,
      notePath: note.path,
      noteName: note.name.replace(/\.md$/i, ""),
      relative: note.relative,
    })),
  );
}

/**
 * Marca o desmarca la tarea en el texto actual de su nota. Devuelve `null` si
 * la línea ya no es la que se vio (la nota cambió entre tanto): mejor no tocar
 * nada que marcar la línea equivocada.
 */
export function toggleNoteTaskText(markdown: string, task: NoteTask): string | null {
  const current = scanTaskLines(markdown).find((candidate) => candidate.line === task.line);
  if (!current || current.title !== task.title || current.completes !== task.completes) return null;
  return setTaskChecked(markdown, task.line, !task.completes);
}

/** Tareas de una nota (`null` = todas), o ninguna si el origen ya no existe. */
export function filterByOrigin(tasks: readonly NoteTask[], relative: string | null): NoteTask[] {
  return relative === null ? [...tasks] : tasks.filter((task) => task.relative === relative);
}

/** Agrupa por nota conservando el orden en que aparecen. */
export function groupByNote(tasks: readonly NoteTask[]): { relative: string; noteName: string; notePath: string; tasks: NoteTask[] }[] {
  const groups = new Map<string, { relative: string; noteName: string; notePath: string; tasks: NoteTask[] }>();
  for (const task of tasks) {
    const group = groups.get(task.relative);
    if (group) group.tasks.push(task);
    else groups.set(task.relative, { relative: task.relative, noteName: task.noteName, notePath: task.notePath, tasks: [task] });
  }
  return [...groups.values()];
}
