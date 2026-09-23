/**
 * Utilidades para escanear y modificar líneas de tareas en archivos `.md`
 * con el formato de task list de Markdown: `- [ ]` (pendiente) / `- [x]` (hecha).
 *
 * Las funciones de escritura devuelven SIEMPRE el contenido completo resultante
 * (inmutables): quien decide persistirlo es el consumidor.
 */

export interface TaskLine {
  /** Índice de línea (base 0) dentro del contenido. */
  line: number;
  /** Texto de la tarea sin el checkbox y sin las etiquetas. */
  title: string;
  /** Etiquetas `#tag` finales de la línea, en orden (vacío si no tiene). */
  tags: string[];
  completes: boolean;
}

/** `- [ ] texto` o `- [x] texto` (también `[X]`), con sangría opcional y `\r` tolerado. */
const TASK_RE = /^(\s*)- \[([ xX])]\s*(.*)\r?$/;

/**
 * Una etiqueta final precedida de espacio o de inicio de línea: ` ... #dev #ui`.
 * Exigir el espacio antes del `#` evita comerse títulos como "Aprender C#net".
 */
const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)\s*$/u;

/**
 * Separa el cuerpo de una tarea en título y etiquetas libres (varias por línea),
 * quitando las que están al final: `Comprar pan #casa #urgente`.
 */
function parseTaskBody(body: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  let text = body;

  for (;;) {
    const match = TAG_RE.exec(text);
    if (!match) break;
    tags.unshift(match[1]);
    text = text.slice(0, match.index);
  }

  return { title: text.trim(), tags };
}

const CHECKBOX_LEN = "- [ ]".length; // "- [x]" mide lo mismo

/** Apertura/cierre de bloque de código con ``` o ~~~ (0-3 espacios de sangría). */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Índices de las líneas que son tareas FUERA de bloques de código,
 * junto con sus coincidencias (mismo numerado que `markdown.split("\n")`).
 */
function taskLineIndexes(markdown: string): { line: number; match: RegExpExecArray }[] {
  const found: { line: number; match: RegExpExecArray }[] = [];
  let openFence: string | null = null;

  markdown.split("\n").forEach((raw, line) => {
    const fence = FENCE_RE.exec(raw);
    if (fence) {
      const char = fence[1][0];
      openFence = openFence === null ? char : openFence === char ? null : openFence;
      return;
    }
    if (openFence !== null) return;

    const match = TASK_RE.exec(raw);
    if (match) found.push({ line, match });
  });

  return found;
}

/** ¿Esta línea es una tarea con formato `- [ ]` / `- [x]`? */
export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

/** Escanea todo el contenido y devuelve las líneas de tarea con su posición. */
export function scanTaskLines(markdown: string): TaskLine[] {
  return taskLineIndexes(markdown).map(({ line, match }) => {
    const { title, tags } = parseTaskBody((match[3] ?? "").trim());

    return { line, title, tags, completes: match[2] !== " " };
  });
}

/**
 * Normaliza una lista de etiquetas: quita `#` iniciales y espacios, descarta
 * vacíos y duplicados (comparando sin distinguir mayúsculas) y conserva el orden.
 * Acepta también una única cadena, por compatibilidad con el modelo `tag` simple.
 */
export function normalizeTags(tags: string[] | string = []): string[] {
  const list = typeof tags === "string" ? [tags] : tags;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of list) {
    const clean = raw.trim().replace(/^#+/, "");
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(clean);
  }

  return result;
}

/** Formatea una línea de tarea: `- [ ] Comprar pan #casa #urgente`. */
export function formatTaskLine(
  title: string,
  tags: string[] | string = [],
  completes = false,
): string {
  const body = [title.trim(), ...normalizeTags(tags).map((tag) => `#${tag}`)]
    .filter(Boolean)
    .join(" ");

  return `- [${completes ? "x" : " "}]${body ? ` ${body}` : ""}`;
}

/**
 * Marca/desmarca la checkbox de `line` tocando SOLO el `[ ]`/`[x]`;
 * el resto de la línea (texto y `#tag`s) queda intacto.
 * Si la línea no existe o no es una tarea, devuelve el contenido sin cambios.
 */
export function setTaskChecked(markdown: string, line: number, completes: boolean): string {
  const lines = markdown.split("\n");
  if (line < 0 || line >= lines.length) return markdown;

  const match = TASK_RE.exec(lines[line]);
  if (!match) return markdown;

  const indent = match[1];
  const rest = lines[line].slice(indent.length + CHECKBOX_LEN);
  lines[line] = `${indent}- [${completes ? "x" : " "}]${rest}`;

  return lines.join("\n");
}

/** Inserta una tarea nueva (sin persistir) y devuelve el contenido resultante. */
export function addTaskLine(
  markdown: string,
  title: string,
  tags: string[] | string = [],
  completes = false,
): string {
  const newLine = formatTaskLine(title, tags, completes);
  const cr = markdown.includes("\r\n") ? "\r" : "";
  const lines = markdown.split("\n");

  // 1) después de la última tarea existente (fuera de bloques de código)
  const tasks = taskLineIndexes(lines.join("\n"));
  const last = tasks[tasks.length - 1];
  if (last) {
    lines.splice(last.line + 1, 0, `${newLine}${cr}`);
    return lines.join("\n");
  }

  // 2) debajo de un encabezado de tareas si existe (## Tareas, # Tareas, ...)
  const heading = lines.findIndex((line) => /^#{1,6}\s+\S.*tareas\s*$/i.test(line.trim()));
  if (heading !== -1) {
    lines.splice(heading + 1, 0, `${newLine}${cr}`);
    return lines.join("\n");
  }

  // 3) si no hay tareas ni sección, se crea al final
  const nl = cr ? "\r\n" : "\n";
  if (markdown.trim() === "") {
    return `## Tareas${nl}${newLine}${nl}`;
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("", "## Tareas", `${newLine}${cr}`, "");
  return lines.join("\n");
}

/**
 * Elimina la línea de tarea `line` y devuelve el contenido resultante.
 * Si la línea no existe o no es una tarea, devuelve el contenido sin cambios.
 */
export function removeTaskLine(markdown: string, line: number): string {
  const lines = markdown.split("\n");
  if (line < 0 || line >= lines.length) return markdown;
  if (!isTaskLine(lines[line])) return markdown;

  lines.splice(line, 1);
  return lines.join("\n");
}

/**
 * Sustituye las etiquetas de la línea `line` conservando su texto, su checkbox
 * y su sangría (también el `\r` de los archivos CRLF).
 * Si la línea no existe o no es una tarea, devuelve el contenido sin cambios.
 */
export function setTaskTags(markdown: string, line: number, tags: string[] | string): string {
  const lines = markdown.split("\n");
  if (line < 0 || line >= lines.length) return markdown;

  const match = TASK_RE.exec(lines[line]);
  if (!match) return markdown;

  const { title } = parseTaskBody((match[3] ?? "").trim());
  const indent = match[1];
  const carriageReturn = lines[line].endsWith("\r") ? "\r" : "";
  const rebuilt = formatTaskLine(title, tags, match[2] !== " ");

  lines[line] = `${indent}${rebuilt}${carriageReturn}`;
  return lines.join("\n");
}

/** Contador simple de tareas (hechas / total). */
export function countTasks(markdown: string): { total: number; done: number } {
  const lines = scanTaskLines(markdown);
  return { total: lines.length, done: lines.filter((task) => task.completes).length };
}
