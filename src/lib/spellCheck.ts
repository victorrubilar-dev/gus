import type { Hunspell } from "hunspell-wasm";

export type SpellLang = "off" | "es" | "en-US" | "en-GB" | "fr" | "de" | "pt-BR" | "it";

export const SPELL_LANGUAGES: readonly { value: SpellLang; label: string }[] = [
  { value: "off", label: "Desactivado" },
  { value: "es", label: "Español" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "it", label: "Italiano" },
];

export type SpellChecker = (word: string) => boolean;

export interface SpellSegment {
  text: string;
  bad: boolean;
}

export type SpellFn = (text: string) => SpellSegment[];

interface LoadedEngine {
  hunspell: Hunspell;
  engine: SpellEngine;
}

export interface SpellEngine {
  correct: SpellChecker;
  suggest: (word: string, limit?: number) => string[];
}

const instances = new Map<SpellLang, LoadedEngine>();

const pending = new Map<SpellLang, Promise<SpellEngine | null>>();

const personalWords = new Set<string>();

const ignoredWords = new Set<string>();

export function setPersonalWords(words: readonly string[]): void {
  personalWords.clear();
  for (const word of words) personalWords.add(word);
}

export function getPersonalWords(): string[] {
  return [...personalWords];
}

export function isPersonalWord(word: string): boolean {
  return personalWords.has(word);
}

export function addPersonalWord(word: string): boolean {
  if (!word || personalWords.has(word)) return false;
  personalWords.add(word);
  return true;
}

export function removePersonalWord(word: string): void {
  personalWords.delete(word);
}

export function ignoreWord(word: string): void {
  ignoredWords.add(word);
}

export function loadSpellEngine(lang: SpellLang): Promise<SpellEngine | null> {
  if (lang === "off") return Promise.resolve(null);

  const ready = instances.get(lang);
  if (ready) return Promise.resolve(ready.engine);

  const running = pending.get(lang);
  if (running) return running;

  const task = buildEngine(lang)
    .then((loaded) => {
      if (loaded) {
        // Un solo diccionario en memoria: cambiar de idioma libera el anterior.
        for (const previous of instances.values()) previous.hunspell.dispose();
        instances.clear();
        instances.set(lang, loaded);
      }
      return loaded ? loaded.engine : null;
    })
    .catch(() => null)
    .finally(() => pending.delete(lang));

  pending.set(lang, task);
  return task;
}

async function buildEngine(lang: SpellLang): Promise<LoadedEngine | null> {
  try {
    const base = `${import.meta.env.BASE_URL}dict/${lang}`;
    const [affRes, dicRes] = await Promise.all([fetch(`${base}.aff`), fetch(`${base}.dic`)]);
    if (!affRes.ok || !dicRes.ok) return null;

    const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
    const { createHunspellFromStrings } = await import("hunspell-wasm");
    const hunspell = await createHunspellFromStrings(aff, dic);

    const engine: SpellEngine = {
      // El diccionario personal se consulta antes que el wasm: «quitar» surte efecto sin recargar.
      correct: (word) =>
        personalWords.has(word) || ignoredWords.has(word) || safeTest(hunspell, word),
      suggest: (word, limit = 6) => {
        let found: string[] = [];
        try {
          found = hunspell.getSpellingSuggestions(word) ?? [];
        } catch {
          found = [];
        }
        return found
          .filter((item) => item !== word && !personalWords.has(item) && !ignoredWords.has(item))
          .slice(0, limit);
      },
    };

    return { hunspell, engine };
  } catch {
    return null;
  }
}

function safeTest(hunspell: Hunspell, word: string): boolean {
  try {
    return hunspell.testSpelling(word);
  } catch {
    return false;
  }
}

const PROTECTED_RE =
  /`[^`\n]*`|\[\[[^\[\]\n]*\]\]|\]\([^)\n]*\)|https?:\/\/[^\s)\]]+|www\.[^\s)\]]+|[\p{L}][\p{L}-]*(?:\.[\p{L}][\p{L}-]*)+/gu;

const WORD_RE = /[\p{L}][\p{L}'’]*/gu;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

export function spellSegments(text: string, correct: SpellChecker): SpellSegment[] {
  const out: SpellSegment[] = [];
  if (!text) return out;

  PROTECTED_RE.lastIndex = 0; // regex global compartido: siempre a cero
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = PROTECTED_RE.exec(text)) !== null) {
    addWords(out, text, cursor, match.index, correct);
    push(out, match[0], false);
    cursor = match.index + match[0].length;
  }
  addWords(out, text, cursor, text.length, correct);
  return out;
}

function push(out: SpellSegment[], text: string, bad: boolean): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.bad === bad) last.text += text;
  else out.push({ text, bad });
}

function addWords(
  out: SpellSegment[],
  full: string,
  from: number,
  to: number,
  correct: SpellChecker,
): void {
  const chunk = full.slice(from, to);
  WORD_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = WORD_RE.exec(chunk)) !== null) {
    const word = match[0];
    const at = from + match.index;
    push(out, chunk.slice(cursor, match.index), false);

    const bad = !skipWord(full, at, word.length) && !isCorrect(word, correct);
    push(out, word, bad);
    cursor = match.index + word.length;
  }
  push(out, chunk.slice(cursor), false);
}

function skipWord(full: string, at: number, length: number): boolean {
  if (length < 2) return true;

  const word = full.slice(at, at + length);
  if (word === word.toLocaleUpperCase()) return true;

  const before = at > 0 ? full[at - 1] : "";
  if (before === "#" || before === "@" || before === "/" || before === ".") return true;
  if (before === "_" && isWordChar(full[at - 2])) return true;
  if (/\p{N}/u.test(before)) return true;

  const after = full[at + length];
  if (after === undefined) return false;
  if (after === "_" && isWordChar(full[at + length + 1])) return true;
  return /\p{N}/u.test(after);
}

function isCorrect(word: string, correct: SpellChecker): boolean {
  const normalized = word.replace(/’/g, "'");
  if (correct(normalized)) return true;

  const tail = normalized.slice(normalized.lastIndexOf("'") + 1);
  return tail !== normalized && tail.length >= 2 && correct(tail);
}

export interface SpellWord {
  start: number;
  end: number;
  word: string;
  bad: boolean;
}

export function spellWordAt(
  text: string,
  offset: number,
  correct: SpellChecker,
): SpellWord | null {
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WORD_RE.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset < start || offset > end) continue;

    const bad =
      !isProtectedAt(text, start) && !skipWord(text, start, end - start) && !isCorrect(match[0], correct);
    return { start, end, word: match[0], bad };
  }
  return null;
}

function isProtectedAt(text: string, at: number): boolean {
  PROTECTED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PROTECTED_RE.exec(text)) !== null) {
    if (at >= match.index && at < match.index + match[0].length) return true;
  }
  return false;
}
