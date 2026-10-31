import { FolderPlus, Import as ImportIcon, Plus } from "lucide-react";
import clsx from "clsx";
import { useT } from "../lib/i18n";

interface ExplorerHeaderProps {
  status: "loading" | "ready" | "error";
  staticMode: boolean;
  busy: boolean;
  onImport: () => void;
  onNewFolder: () => void;
  onNewNote: () => void;
}

/** Cabecera del explorador: título y botones de añadir archivos, nueva carpeta y nueva nota. */
export default function ExplorerHeader({
  status,
  staticMode,
  busy,
  onImport,
  onNewFolder,
  onNewNote,
}: ExplorerHeaderProps) {
  const t = useT();

  return (
  <header className="flex items-start justify-between gap-2 pl-1">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
        Notas
      </h2>
      {status === "error" && (
        <p className="text-meta leading-snug text-gus-muted">{t("explorer.readError")}</p>
      )}
    </div>
    <div className="flex shrink-0 gap-1.5">
      {!staticMode && (
        <button
          type="button"
          onClick={() => void onImport()}
          disabled={busy}
          title={t("explorer.addFilesHint")}
          aria-label={t("explorer.addFiles")}
          className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
        >
          <ImportIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {!staticMode && (
        <button
          type="button"
          onClick={() => void onNewFolder()}
          disabled={busy}
          title={t("explorer.newFolder")}
          aria-label={t("explorer.newFolder")}
          className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
        >
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={() => void onNewNote()}
        disabled={busy}
        title={t("explorer.newNote")}
        aria-label={t("explorer.newNote")}
        className="shrink-0 rounded-lg border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:border-gus-accent/50 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </header>
  );
}

/** Avisos bajo la cabecera: resultado de importar y error de la última acción. */
export function ExplorerNotices({
  notice,
  noticeOk,
  actionError,
  onCloseNotice,
  onCloseError,
}: {
  notice: string | null;
  noticeOk: boolean;
  actionError: string | null;
  onCloseNotice: () => void;
  onCloseError: () => void;
}) {
  const t = useT();

  return (
    <>
  {notice && (
    <p
      role="status"
      aria-live="polite"
      className={clsx(
        "flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-meta",
        noticeOk
          ? "border-gus-accent/40 bg-gus-accent/10 text-gus-accent"
          : "border-amber-400/30 bg-amber-400/10 text-amber-300",
      )}
    >
      <span className="min-w-0 break-words">{notice}</span>
      <button
        type="button"
        onClick={() => onCloseNotice()}
        aria-label={t("common.close")}
        className={clsx(
          "shrink-0 rounded px-1 transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:outline-none",
          noticeOk
            ? "text-gus-accent/70 focus-visible:ring-gus-accent/60"
            : "text-amber-300/70 focus-visible:ring-amber-300/60",
        )}
      >
        ×
      </button>
    </p>
  )}

  {actionError && (
    <p
      role="alert"
      className="flex items-start justify-between gap-2 rounded-md border border-rose-400/30 bg-rose-400/5 px-2 py-1.5 text-meta text-rose-300"
    >
      <span className="min-w-0 break-words">{actionError}</span>
      <button
        type="button"
        onClick={() => onCloseError()}
        aria-label={t("common.close")}
        className="shrink-0 rounded px-1 text-rose-300/70 transition-colors hover:text-rose-200 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none"
      >
        ×
      </button>
    </p>
  )}
    </>
  );
}
