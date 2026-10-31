import { useT } from "../lib/i18n";

interface ExternalNoticeBarProps {
  notice: { path: string; kind: "reloaded" | "conflict" };
  title: string;
  /** Descarta lo escrito en la app y recarga la nota desde el disco. */
  onReload: () => void;
  /** Conserva lo escrito en la app y deja de avisar. */
  onKeep: () => void;
}

/** Aviso de que la nota abierta cambió fuera de la app (REQ-13). */
export default function ExternalNoticeBar({ notice, title, onReload, onKeep }: ExternalNoticeBarProps) {
  const t = useT();

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-400/40 bg-gus-panel px-4 py-2 text-body text-amber-300"
    >
      <span className="min-w-0 flex-1">
        {t(
          notice.kind === "conflict"
            ? "app.externalConflict"
            : "app.externalReloaded",
          { title },
        )}
      </span>
      {notice.kind === "conflict" && (
        <>
          <button
            type="button"
            className="rounded-md border border-amber-400/40 px-2 py-1 hover:bg-white/5"
            onClick={onReload}
          >
            {t("app.externalReload")}
          </button>
          <button
            type="button"
            className="rounded-md border border-amber-400/40 px-2 py-1 hover:bg-white/5"
            onClick={onKeep}
          >
            {t("app.externalKeep")}
          </button>
        </>
      )}
    </div>
  );
}
