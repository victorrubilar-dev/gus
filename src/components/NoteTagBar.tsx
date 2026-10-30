import { useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";
import { parseNoteTagInput, parseNoteTags, setNoteTags, tagOptions, type VaultTag } from "../lib/noteTags";

interface NoteTagBarProps {
  content: string;
  vaultPath?: string | null;
  onChange: (content: string) => void;
}

/** Etiquetas de la nota (frontmatter): chips, entrada y menú con las etiquetas del vault. */
export default function NoteTagBar({ content, vaultPath, onChange }: NoteTagBarProps) {
  const t = useT();
  const [tagInput, setTagInput] = useState("");
  const [vaultTags, setVaultTags] = useState<VaultTag[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagIndex, setTagIndex] = useState(0);
  const tagRequestRef = useRef(0);
  const noteTags = parseNoteTags(content);
  const tagOptionList = tagOptions(vaultTags, tagInput, noteTags);

  function applyNoteTags(next: string[]) {
    const updated = setNoteTags(content, next);
    if (updated === content) return;
    onChange(updated);
  }

  function loadVaultTags() {
    if (!vaultPath) return;

    const request = ++tagRequestRef.current;
    invoke<VaultTag[]>("list_vault_tags", { path: vaultPath })
      .then((tags) => {
        if (request === tagRequestRef.current) setVaultTags(tags);
      })
      .catch(() => {
      });
  }

  function pickTag(tag: string) {
    applyNoteTags([...parseNoteTags(content), tag]);
    setTagInput("");
    setTagIndex(0);
  }

  function commitTagInput() {
    const parsed = parseNoteTagInput(tagInput);
    if (parsed.length === 0) return;

    applyNoteTags([...parseNoteTags(content), ...parsed]);
    setTagInput("");
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const options = tagOptions(vaultTags, tagInput, parseNoteTags(content));

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!tagMenuOpen || options.length === 0) return;
      event.preventDefault();

      const current = Math.min(tagIndex, options.length - 1);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : current <= 0
            ? options.length - 1
            : current - 1;
      setTagIndex(next);
      return;
    }

    if (event.key === "Escape") {
      if (!tagMenuOpen) return;
      event.preventDefault();
      setTagMenuOpen(false);
      return;
    }

    if (event.key === "Enter") {
      if (tagMenuOpen && options.length > 0) {
        pickTag(options[Math.min(tagIndex, options.length - 1)].tag);
        return;
      }
      const parsed = parseNoteTagInput(tagInput);
      if (parsed.length > 0) {
        event.preventDefault();
        applyNoteTags([...parseNoteTags(content), ...parsed]);
        setTagInput("");
      }
      return;
    }

    if (event.key === "Backspace" && tagInput === "") {
      const tags = parseNoteTags(content);
      if (tags.length > 0) applyNoteTags(tags.slice(0, -1));
    }
  }

  function handleTagInputChange(value: string) {
    if (/[,，]/.test(value)) {
      applyNoteTags([...parseNoteTags(content), ...parseNoteTagInput(value)]);
      setTagInput("");
      return;
    }
    setTagInput(value);
    setTagIndex(0);
  }

  return (
  <div className="mt-2 flex flex-wrap items-center gap-1.5">
    {noteTags.map((tag) => (
      <span
        key={tag}
        className="gus-chip gap-1"
      >
        {tag}
        <button
          type="button"
          onClick={() => applyNoteTags(noteTags.filter((item) => item !== tag))}
          aria-label={t("tasks.removeTag", { tag })}
          className="-mr-1 rounded-full opacity-70 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </span>
    ))}

    <div className="relative min-w-40 max-w-64 flex-1">
      <input
        value={tagInput}
        onChange={(event) => handleTagInputChange(event.target.value)}
        onKeyDown={handleTagInputKeyDown}
        onFocus={() => {
          if (!vaultPath) return;
          loadVaultTags();
          setTagMenuOpen(true);
        }}
        onBlur={() => {
          commitTagInput();
          setTagMenuOpen(false);
        }}
        placeholder={t(noteTags.length > 0 ? "editor.tagPlaceholder" : "editor.tagPlaceholderLong")}
        aria-label={t("editor.tags")}
        role="combobox"
        aria-expanded={tagMenuOpen}
        aria-controls="gus-tag-menu"
        className="w-full rounded-full border border-transparent bg-gus-card/60 px-2.5 py-0.5 text-meta text-gus-text outline-none transition-colors placeholder:text-gus-muted/70 focus:border-gus-accent/50"
      />

      {tagMenuOpen && (
        <div
          id="gus-tag-menu"
          role="listbox"
          aria-label={t("editor.vaultTags")}
          className="absolute left-0 top-full z-30 mt-1 max-h-56 w-64 min-w-full overflow-y-auto rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
        >
          {tagOptionList.length === 0 ? (
            <p className="px-3 py-1.5 text-meta text-gus-muted">
              {t(tagInput ? "editor.tagCreateHint" : "editor.noVaultTags", {
                tag: tagInput,
              })}
            </p>
          ) : (
            tagOptionList.map((entry, index) => (
              <button
                key={entry.tag}
                type="button"
                role="option"
                aria-selected={index === Math.min(tagIndex, tagOptionList.length - 1)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickTag(entry.tag)}
                onMouseEnter={() => setTagIndex(index)}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-meta outline-none",
                  index === Math.min(tagIndex, tagOptionList.length - 1)
                    ? "bg-gus-accent/15 text-gus-accent"
                    : "text-gus-text hover:bg-gus-card",
                )}
              >
                <span className="truncate">{entry.tag}</span>
                <span className="ml-auto shrink-0 text-meta text-gus-muted">
                  {t("editor.tagUseCount", { count: entry.count })}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  </div>
  );
}
