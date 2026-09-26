export interface TaskLine {
  line: number;
  title: string;
  tags: string[];
  completes: boolean;
  due?: string;
  description?: string;
}

const TASK_RE = /^(\s*)- \[([ xX])]\s*(.*)\r?$/;

const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)\s*$/u;

const DUE_RE = /\s+📅\s*(\d{4}-\d{2}-\d{2})\s*$/;

interface TaskBody {
  title: string;
  tags: string[];
  due: string | undefined;
}

function parseTaskBody(body: string): TaskBody {
  let text = body;
  let due: string | undefined;

  const dueMatch = DUE_RE.exec(text);
  if (dueMatch) {
    due = dueMatch[1];
    text = text.slice(0, dueMatch.index);
  }

  const tags: string[] = [];
  for (;;) {
    const match = TAG_RE.exec(text);
    if (!match) break;
    tags.unshift(match[1]);
    text = text.slice(0, match.index);
  }

  return { title: text.trim(), tags, due };
}

const CHECKBOX_LEN = "- [ ]".length;

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

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

function isDescriptionLine(line: string): boolean {
  if (TASK_RE.test(line)) return false;

  const body = line.replace(/\r$/, "");
  if (body === "") return false;
  if (/^\s+$/.test(body)) return true;
  return /^\s+\S/.test(body);
}

function blockEnd(lines: string[], line: number): number {
  let end = line;
  while (end + 1 < lines.length && isDescriptionLine(lines[end + 1])) end += 1;
  return end;
}

export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

export function scanTaskLines(markdown: string): TaskLine[] {
  const rawLines = markdown.split("\n");

  return taskLineIndexes(markdown).map(({ line, match }) => {
    const { title, tags, due } = parseTaskBody((match[3] ?? "").trim());

    const description: string[] = [];
    for (let index = line + 1; index < rawLines.length; index++) {
      const raw = rawLines[index];
      if (!isDescriptionLine(raw)) break;
      description.push(raw.replace(/\r$/, "").replace(/^\s+/, ""));
    }
    while (description.length > 0 && description[description.length - 1].trim() === "") {
      description.pop();
    }
    while (description.length > 0 && description[0].trim() === "") {
      description.shift();
    }

    return {
      line,
      title,
      tags,
      completes: match[2] !== " ",
      ...(due !== undefined ? { due } : {}),
      ...(description.length > 0 ? { description: description.join("\n") } : {}),
    };
  });
}

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

export function parseTagInput(text: string): string[] {
  return text.split(/[,，\s]+/).filter(Boolean);
}

export function formatTaskLine(
  title: string,
  tags: string[] | string = [],
  completes = false,
  due?: string | null,
): string {
  const body = [title.trim(), ...normalizeTags(tags).map((tag) => `#${tag}`)]
    .filter(Boolean)
    .join(" ");
  const plazo = due ? ` 📅 ${due}` : "";

  return `- [${completes ? "x" : " "}]${body ? ` ${body}` : ""}${plazo}`;
}

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

export interface NewTaskOptions {
  description?: string;
  due?: string;
}

export function addTaskLine(
  markdown: string,
  title: string,
  tags: string[] | string = [],
  completes = false,
  options: NewTaskOptions = {},
): string {
  const cr = markdown.includes("\r\n") ? "\r" : "";
  const lines = markdown.split("\n");

  const block = [`${formatTaskLine(title, tags, completes, options.due)}${cr}`];
  const description = (options.description ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text) => text.trimStart());
  while (description.length > 0 && description[0].trim() === "") description.shift();
  while (description.length > 0 && description[description.length - 1].trim() === "") {
    description.pop();
  }
  for (const text of description) {
    block.push(`  ${text}${cr}`);
  }

  const tasks = taskLineIndexes(lines.join("\n"));
  const last = tasks[tasks.length - 1];
  if (last) {
    lines.splice(blockEnd(lines, last.line) + 1, 0, ...block);
    return lines.join("\n");
  }

  const heading = lines.findIndex((line) => /^#{1,6}\s+.*tareas\s*$/i.test(line.trim()));
  if (heading !== -1) {
    lines.splice(heading + 1, 0, ...block);
    return lines.join("\n");
  }

  const nl = cr ? "\r\n" : "\n";
  if (markdown.trim() === "") {
    return `## Tareas${nl}${block.join(nl)}${nl}`;
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  lines.push("", "## Tareas", ...block, "");
  return lines.join("\n");
}

export function removeTaskLine(markdown: string, line: number): string {
  const lines = markdown.split("\n");
  if (line < 0 || line >= lines.length) return markdown;
  if (!isTaskLine(lines[line])) return markdown;

  lines.splice(line, blockEnd(lines, line) - line + 1);
  return lines.join("\n");
}

export function setTaskTags(markdown: string, line: number, tags: string[] | string): string {
  const lines = markdown.split("\n");
  if (line < 0 || line >= lines.length) return markdown;

  const match = TASK_RE.exec(lines[line]);
  if (!match) return markdown;

  const { title, due } = parseTaskBody((match[3] ?? "").trim());
  const indent = match[1];
  const carriageReturn = lines[line].endsWith("\r") ? "\r" : "";
  const rebuilt = formatTaskLine(title, tags, match[2] !== " ", due);

  lines[line] = `${indent}${rebuilt}${carriageReturn}`;
  return lines.join("\n");
}

export function countTasks(markdown: string): { total: number; done: number } {
  const lines = scanTaskLines(markdown);
  return { total: lines.length, done: lines.filter((task) => task.completes).length };
}
