import { useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";
import { normalizeTags, parseTagInput } from "../lib/markdownTasks";
import type { Task } from "../lib/taskStore";

const TAG_COLORS = [
  "border-gus-accent/40 bg-gus-accent/15 text-gus-accent",
  "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  "border-sky-400/30 bg-sky-400/10 text-sky-300",
  "border-amber-400/30 bg-amber-400/10 text-amber-300",
  "border-rose-400/30 bg-rose-400/10 text-rose-300",
];

export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

export const TAG_CHIP_CLASS = "rounded-full border px-2 py-0.5 text-meta capitalize";

/** Chips con las etiquetas de todas las tareas y cuántas tiene cada una; pulsar una filtra. */
export function TagFilterBar({
  entries: tagEntries,
  activeFilter: tagFilter,
  onToggle,
  onClear,
}: {
  entries: { label: string; count: number }[];
  activeFilter: string | null;
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const t = useT();

  return (
    <>
  {tagEntries.length > 0 && (

    <div
      role="group"
      aria-label={t("tasks.filterTag")}
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="text-meta text-gus-muted">{t("tasks.tagsLabel")}</span>
      {tagEntries.map(({ label, count }) => {
        const active =
          !!tagFilter && tagFilter.toLowerCase() === label.toLowerCase();
        return (
          <button
            key={label.toLowerCase()}
            type="button"
            onClick={() => onToggle(label)}
            aria-pressed={active}
            title={`Filtrar por #${label} · ${count} ${
              count === 1 ? "tarea" : "tareas"
            }`}
            className={clsx(
              TAG_CHIP_CLASS,
              "inline-flex items-center gap-1 transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
              tagColor(label),
              active && "ring-2 ring-gus-accent/70",
            )}
          >
            {label}
            <span className="opacity-60">{count}</span>
          </button>
        );
      })}
      {tagFilter && (
        <button
          type="button"
          onClick={() => onClear()}
          title={t("tasks.removeFilter")}
          className="flex items-center gap-1 rounded-full border border-gus-border px-2 py-0.5 text-meta text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
        >
          {t("common.all")} <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )}
    </>
  );
}

/** Ventana para editar las etiquetas de una tarea: Intro añade, Esc cancela y al salir se guarda. */
export function TagEditor({
  task,
  onCommit,
  onClose,
}: {
  task: Task;
  /** Etiquetas nuevas, solo si cambiaron. */
  onCommit: (tags: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tags, setTags] = useState<string[]>(() => [...task.tags]);
  const [input, setInput] = useState("");
  const cancelledRef = useRef(false);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelledRef.current = true;
      onClose();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const parsed = parseTagInput(input);
      if (parsed.length > 0) {
        setTags((prev) => normalizeTags([...prev, ...parsed]));
        setInput("");
      } else {
        event.currentTarget.blur();
      }
      return;
    }

    if (event.key === "Backspace" && input === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function handleBlur() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    onClose();
    const next = normalizeTags([...tags, ...parseTagInput(input)]);
    if (next.join("\u0000") === normalizeTags(task.tags).join("\u0000")) return;
    onCommit(next);
  }

  return (
      <div className="absolute top-full right-11 z-30 mt-1 w-60 rounded-xl border border-gus-border bg-gus-card p-2 shadow-xl shadow-black/40">
        <p className="mb-1.5 text-meta tracking-wider text-gus-muted uppercase">
          {t("tasks.tagsOf", { title: task.title })}
        </p>
        <div
          className="flex flex-wrap gap-1.5"
          onMouseDown={(event) => event.preventDefault()}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className={clsx(
                "inline-flex items-center gap-1 capitalize",
                TAG_CHIP_CLASS,
                tagColor(tag),
              )}
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                aria-label={t("tasks.removeTag", { tag })}
                className="-mr-1 rounded-full px-1 opacity-60 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {tags.length === 0 && (
            <span className="text-meta text-gus-muted">{t("tasks.noTags")}</span>
          )}
        </div>
        <input
          autoFocus
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={t("tasks.addTagPlaceholder")}
          title={t("tasks.editHint")}
          aria-label={t("tasks.newTagFor", { title: task.title })}
          className="mt-2 w-full rounded-md border border-gus-border bg-gus-panel px-2 py-1 text-body text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60"
        />
      </div>
  );
}
