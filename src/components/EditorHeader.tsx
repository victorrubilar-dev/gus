import type { RefObject } from "react";
import clsx from "clsx";
import { Ellipsis, Eye, FileDown, Pencil } from "lucide-react";
import { useT } from "../lib/i18n";
import NoteTagBar from "./NoteTagBar";

interface EditorHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  viewMode: "edit" | "preview";
  onToggleView: () => void;
  /** Menú «⋯» de la cabecera (exportar a PDF). */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  onExport: () => void;
  content: string;
  vaultPath?: string | null;
  onContentChange: (content: string) => void;
  saveState: "idle" | "dirty" | "saved" | "error";
  saveError: string | null;
  words: number;
  chars: number;
  saveCombo: string;
}

/** Cabecera del editor: título, vista previa, menú, etiquetas y estado de guardado. */
export default function EditorHeader({
  title,
  onTitleChange,
  viewMode,
  onToggleView,
  menuOpen,
  onMenuOpenChange,
  menuRef,
  onExport,
  content,
  vaultPath,
  onContentChange,
  saveState,
  saveError,
  words,
  chars,
  saveCombo,
}: EditorHeaderProps) {
  const t = useT();

  const statusLabel =
    saveState === "dirty"
      ? t("editor.saving")
      : saveState === "saved"
        ? t("editor.saved")
        : saveState === "error"
          ? t("editor.saveFailed")
          : t("editor.noChanges");

  const statusDot =
    saveState === "dirty"
      ? "bg-amber-400"
      : saveState === "saved"
        ? "bg-emerald-400"
        : saveState === "error"
          ? "bg-rose-400"
          : "bg-gus-muted";

  return (
  <header className="shrink-0 border-b border-gus-border gus-editor-pad py-4">
    <div className="flex items-start gap-3">
      <input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder={t("common.untitled")}
        aria-label={t("editor.title")}
        className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-gus-text outline-none placeholder:text-gus-muted"
      />

      <button
        type="button"
        onClick={onToggleView}
        aria-label={t(viewMode === "edit" ? "editor.previewAria" : "editor.editAria")}
        title={t(viewMode === "edit" ? "editor.preview" : "editor.edit")}
        className="gus-btn gus-btn-secondary shrink-0"
      >
        {viewMode === "edit" ? (
          <>
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t("editor.preview")}
          </>
        ) : (
          <>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("editor.edit")}
          </>
        )}
      </button>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => onMenuOpenChange(!menuOpen)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("editor.moreOptionsAria")}
          title={t("editor.moreOptions")}
          className="gus-btn gus-btn-icon"
        >
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              onClick={onExport}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("editor.exportPdf")}
            </button>
          </div>
        )}
      </div>
    </div>

    <NoteTagBar content={content} vaultPath={vaultPath} onChange={onContentChange} />

    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-gus-muted">
      <span className="flex items-center gap-1.5" role="status" aria-live="polite">
        <span className={clsx("h-1.5 w-1.5 rounded-full", statusDot)} aria-hidden="true" />
        {statusLabel}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {t("editor.words", { count: words })} · {t("editor.chars", { count: chars })}
      </span>
      <span aria-hidden="true">·</span>
      <span className="text-gus-muted/70">{t("editor.saveHint", { combo: saveCombo })}</span>
    </div>
    {saveError && (
      <p className="mt-2 break-words rounded-md border border-rose-400/30 bg-rose-400/5 px-2 py-1.5 text-meta text-rose-300">
        {saveError}
      </p>
    )}
  </header>
  );
}
