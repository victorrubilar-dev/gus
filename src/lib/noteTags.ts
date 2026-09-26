import { normalizeTags } from "./markdownTasks.ts";

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const PROPERTY_RE = /^[\p{L}\p{N}_-][\p{L}\p{N}_-]*:/mu;

const TAGS_KEY_RE = /^[ \t]*tags:(?=[ \t\[]|$)/;

export interface VaultTag {
  tag: string;
  count: number;
}

function frontmatterMatch(content: string): RegExpExecArray | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match || !PROPERTY_RE.test(match[1])) return null;
  return match;
}

export function parseNoteTags(content: string): string[] {
  const match = frontmatterMatch(content);
  return match ? parseTagsYaml(match[1]) : [];
}

export function stripFrontmatter(content: string): string {
  const match = frontmatterMatch(content);
  return match ? content.slice(match[0].length) : content;
}

export function frontmatterLineOffset(content: string): number {
  const match = frontmatterMatch(content);
  if (!match) return 0;
  return (match[0].match(/\n/g) ?? []).length;
}

export function replaceBody(content: string, body: string): string {
  const match = frontmatterMatch(content);
  return match ? match[0] + body : body;
}

export function tagOptions(vaultTags: VaultTag[], query: string, current: string[]): VaultTag[] {
  const have = new Set(current.map((tag) => tag.toLowerCase()));
  const needle = query.trim().toLowerCase();
  return vaultTags.filter(
    (entry) =>
      !have.has(entry.tag.toLowerCase()) &&
      (needle === "" || entry.tag.toLowerCase().includes(needle)),
  );
}

export function setNoteTags(content: string, tags: string[] | string): string {
  const clean = normalizeTags(tags);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const match = frontmatterMatch(content);

  if (!match) {
    if (clean.length === 0) return content;
    const block = `---${newline}tags: [${formatTags(clean)}]${newline}---${newline}`;
    return block + content;
  }

  const yaml = rewriteYaml(match[1], clean, newline);
  const rest = content.slice(match[0].length);
  if (yaml.trim() === "") return rest;

  return `---${newline}${yaml}${newline}---${newline}${rest}`;
}

function findTagsKey(lines: string[]): number {
  return lines.findIndex((line) => TAGS_KEY_RE.test(line));
}

function tagsKeySpan(lines: string[], keyIndex: number): number {
  let span = 1;
  while (keyIndex + span < lines.length && /^[ \t]*-[ \t]/.test(lines[keyIndex + span])) {
    span += 1;
  }
  return span;
}

function rewriteYaml(yaml: string, tags: string[], newline: string): string {
  const lines = yaml.split(/\r?\n/);
  const keyIndex = findTagsKey(lines);

  if (tags.length === 0) {
    if (keyIndex === -1) return yaml;
    lines.splice(keyIndex, tagsKeySpan(lines, keyIndex));
    return lines.join(newline);
  }

  const line = `tags: [${formatTags(tags)}]`;
  if (keyIndex === -1) {
    lines.unshift(line);
    return lines.join(newline);
  }

  const indent = /^[ \t]*/.exec(lines[keyIndex])?.[0] ?? "";
  lines.splice(keyIndex, tagsKeySpan(lines, keyIndex), `${indent}${line}`);
  return lines.join(newline);
}

function parseTagsYaml(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const keyIndex = findTagsKey(lines);
  if (keyIndex === -1) return [];

  const value = lines[keyIndex].replace(/^[ \t]*tags:[ \t]*/, "").trim();
  if (value !== "") {
    if (!value.startsWith("[")) return normalizeTags([unquote(value)]);
    const close = value.indexOf("]");
    const inner = value.slice(1, close === -1 ? value.length : close);
    return normalizeTags(splitFlowItems(inner).map(unquote));
  }

  const items: string[] = [];
  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const item = /^[ \t]*-[ \t]+(.*)$/.exec(lines[index]);
    if (!item) break;
    items.push(unquote(item[1].trim()));
  }
  return normalizeTags(items);
}

function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  items.push(current.trim());
  return items;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function formatTags(tags: string[]): string {
  return tags.map((tag) => {
    const needsQuote =
      /[:#{}[\],&*!|>'"%@`]/.test(tag) || /^[-?:]/.test(tag) || /^\s|\s$/.test(tag);
    return needsQuote ? JSON.stringify(tag) : tag;
  }).join(", ");
}
