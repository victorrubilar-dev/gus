export type TaskPriority = "urgente" | "alta" | "media" | "baja";

export interface ParsedMarkdownTask {
  line: number;
  raw: string;
  title: string;
  completed: boolean;
  priority: TaskPriority | null;
  tags: string[];
  due?: string;
}

const TASK_RE = /^(\s*)- \[([ xX])]\s*(.*?)\r?$/;

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

const DUE_RE = /\s+📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/g;

const PRIORITY_RE = /(?:^|[\s(])!(urgente|alta|media|baja)\b/giu;

const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_-]+)/gu;

function tokenStart(match: RegExpExecArray): number {
  return match.index + match[0].length - match[1].length - 1;
}

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

    DUE_RE.lastIndex = 0; // regex global: se reinicia antes de cada uso
    const due = DUE_RE.exec(body);
    const dueDate = due?.[1];
    if (due) body = body.slice(0, due.index) + body.slice(due.index + due[0].length);

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
