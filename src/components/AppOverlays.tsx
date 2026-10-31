import clsx from "clsx";
import { Upload } from "lucide-react";
import { useT } from "../lib/i18n";
import { relativeFolderLabel, type ImportSummary } from "../lib/importFiles";

interface AppOverlaysProps {
  currentVault: string | null;
  /** Error al abrir un enlace [[wiki]]; se apaga solo. */
  linkError: string | null;
  /** Resultado de la última importación de archivos soltados. */
  importNotice: ImportSummary | null;
  droppingFiles: boolean;
  dropFolder: string | null;
  dropOnNote: boolean;
}

/** Avisos flotantes de la app: error de enlace, resultado de importar y capa de arrastre. */
export default function AppOverlays({
  currentVault,
  linkError,
  importNotice,
  droppingFiles,
  dropFolder,
  dropOnNote,
}: AppOverlaysProps) {
  const t = useT();

  return (
    <>
    {linkError && (
      <div
        role="status"
        aria-live="polite"
        className={clsx(
          "fixed right-4 z-50 max-w-sm rounded-xl border border-rose-400/40 bg-gus-panel px-4 py-3 text-body text-rose-300 shadow-2xl shadow-black/40",
          importNotice ? "bottom-20" : "bottom-4",
        )}
      >
        {linkError}
      </div>
    )}

    {importNotice && (
      <div
        role="status"
        aria-live="polite"
        className={clsx(
          "fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border bg-gus-panel px-4 py-3 text-body shadow-2xl shadow-black/40",
          importNotice.ok
            ? "border-gus-accent/40 text-gus-accent"
            : "border-amber-400/40 text-amber-300",
        )}
      >
        {importNotice.message}
      </div>
    )}

    {droppingFiles && (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-gus-accent bg-gus-bg/80 text-center shadow-2xl shadow-black/40"
      >
        <Upload className="h-10 w-10 text-gus-accent" strokeWidth={1.5} aria-hidden="true" />
        <p className="text-sm font-semibold text-gus-text">
          {!currentVault
            ? t("app.dropNoVault")
            : dropOnNote
              ? t("app.dropNote")
              : t("app.dropVault")}
        </p>
        {currentVault && !dropOnNote && (
          <p className="max-w-md break-words text-body text-gus-muted">
            {t("app.dropEnter", {
              folder: relativeFolderLabel(dropFolder ?? currentVault, currentVault),
            })}
          </p>
        )}
      </div>
    )}
    </>
  );
}
