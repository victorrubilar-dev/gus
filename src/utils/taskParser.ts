/**
 * Parser de tareas incrustadas en Markdown: recibe el texto de un archivo
 * `.md` del vault y devuelve **todas** las líneas con formato de task list
 * (`- [ ]` pendiente / `- [x]` hecha) que están fuera de bloques de código,
 * con la prioridad que declare la propia línea y sus etiquetas.
 *
 * Formato reconocido (todo después del checkbox es libre):
 *
 * ```md
 * - [ ] Enviar el informe !alta #trabajo 📅 2026-10-15
 * - [x] Comprar pan #casa
 * ```
 *
 * - **Prioridad**: `!urgente`, `!alta`, `!media` o `!baja` (sin distinguir
 *   mayúsculas).
 * - **Etiquetas**: `#trabajo`, `#casa_2`… el `#` debe ir tras un espacio, el
 *   inicio de línea o un paréntesis (así «Aprender C#net» no crea una etiqueta).
 * - **Plazo**: `📅 AAAA-MM-DD`.
 *
 * El parser solo **lee**: para escribir cambios en la nota se usa
 * `setTaskChecked` de `src/lib/markdownTasks.ts` sobre el índice de línea.
 */

/** Prioridades que entiende la app (`!urgente`, `!alta`, `!media`, `!baja`). */
export type TaskPriority = "urgente" | "alta" | "media" | "baja";

/** Una línea de tarea extraída de un Markdown. */
export interface ParsedMarkdownTask {
  /** Índice de línea (base 0) dentro del texto recibido. */
  line: number;
  /** Línea original tal cual aparece en el archivo (sirve para localizarla). */
  raw: string;
  /** Texto sin checkbox, sin etiquetas, sin prioridad y sin plazo. */
  title: string;
  /** La checkbox está marcada: `- [x]` (o `[X]`). */
  completed: boolean;
  /** Prioridad detectada en la línea, o `null` si no lleva. */
  priority: TaskPriority | null;
  /** Etiquetas `#tag` (sin el `#`), en orden de aparición y sin repetir. */
  tags: string[];
  /** Plazo `AAAA-MM-DD` del `📅`, si lo tiene. */
  due?: string;
}

/** `- [ ] texto` / `- [x] texto` (también `[X]`), con sangría y `\r` tolerados. */
const TASK_RE = /^(\s*)- \[([ xX])]\s*(.*?)\r?$/;

/** Apertura/cierre de bloque de código con ``` o ~~~ (0-3 espacios de sangría). */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Plazo `📅 2026-10-15` en cualquier punto de la línea. */
const DUE_RE = /\s+📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/g;

/** Prioridad `!urgente` / `!alta` / `!media` / `!baja` tras espacio, inicio o paréntesis. */
const PRIORITY_RE = /(?:^|[\s(])!(urgente|alta|media|baja)\b/giu;

/** Etiqueta `#tag` tras espacio, inicio o paréntesis (no «C#net»). */
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_-]+)/gu;

/** Índice donde empieza el token capturado (`!` o `#`) dentro de `match[0]`. */
function tokenStart(match: RegExpExecArray): number {
  // match[0] = separador + "!"|"#" + grupo; el token mide grupo.length + 1.
  return match.index + match[0].length - match[1].length - 1;
}

/**
 * Quita de `text` los tramos que casa `re` (de derecha a izquierda para no
 * descuadrar los índices) y devuelve lo capturado, en orden.
 */
function extractMatches(text: string, re: RegExp): { text: string; found: string[] } {
  const found: string[] = [];
  const ranges: [number, number][] = [];

  re.lastIndex = 0;
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    const start = tokenStart(match);
    found.push(match[1]);
    ranges.push([start, match.index + match[0].length]);
  }

  let result = text;
  for (let index = ranges.length - 1; index >= 0; index--) {
    const [start, end] = ranges[index];
    result = result.slice(0, start) + result.slice(end);
  }

  return { text: result, found };
}

/**
 * Extrae todas las tareas `- [ ]` / `- [x]` de un texto Markdown.
 *
 * Ignora las que están dentro de bloques de código (una demo en un tutorial
 * no es una tarea) y devuelve los resultados en orden de aparición.
 */
export function parseMarkdownTasks(markdown: string): ParsedMarkdownTask[] {
  const tasks: ParsedMarkdownTask[] = [];
  const lines = markdown.split("\n");
  let openFence: string | null = null;

  lines.forEach((raw, line) => {
    const fence = FENCE_RE.exec(raw);
    if (fence) {
      const char = fence[1][0];
      openFence = openFence === null ? char : openFence === char ? null : openFence;
      return;
    }
    if (openFence !== null) return;

    const task = TASK_RE.exec(raw);
    if (!task) return;

    let body = task[3] ?? "";

    // 1) plazo (siempre lo primero: suele ir al final).
    DUE_RE.lastIndex = 0; // regex global: reutilizable entre líneas
    const due = DUE_RE.exec(body);
    const dueDate = due?.[1];
    if (due) body = body.slice(0, due.index) + body.slice(due.index + due[0].length);

    // 2) prioridad y etiquetas, que pueden estar en cualquier punto.
    const priorities = extractMatches(body, PRIORITY_RE);
    body = priorities.text;
    const tagged = extractMatches(body, TAG_RE);
    body = tagged.text;

    const tags: string[] = [];
    for (const tag of tagged.found) {
      if (!tags.some((known) => known.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }

    tasks.push({
      line,
      raw,
      title: body.replace(/\s+/g, " ").trim(),
      completed: task[2] !== " ",
      priority: (priorities.found[0]?.toLowerCase() as TaskPriority | undefined) ?? null,
      tags,
      ...(dueDate ? { due: dueDate } : {}),
    });
  });

  return tasks;
}
