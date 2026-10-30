import { useState } from "react";
import { m } from "framer-motion";
import { ArrowUpCircle, X } from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../lib/i18n";
import { openExternal } from "../lib/externalLink";
import type { UpdateInfo } from "../lib/updateCheck";

export interface UpdateNoticeProps {
  info: UpdateInfo;
  /** Versión instalada, para que el aviso la muestre junto a la nueva. */
  current: string;
  /** Distancia desde la izquierda: el aviso no debe tapar el menú lateral. */
  offsetLeft: number;
  /** Se llama al cerrar el aviso: esa versión no se vuelve a anunciar. */
  onDismiss: () => void;
}

/**
 * Aviso discreto de que hay una versión más nueva en el repositorio. Si la
 * release trae instalador para este equipo, lo baja a Descargas y lo abre a
 * petición de quien use Gus; si no, abre la página de la release.
 */
export default function UpdateNotice({ info, current, offsetLeft, onDismiss }: UpdateNoticeProps) {
  const t = useT();
  const [opening, setOpening] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openRelease() {
    if (opening) return;
    setOpening(true);
    try {
      await openExternal(info.url);
    } finally {
      setOpening(false);
      onDismiss();
    }
  }

  async function downloadInstaller() {
    if (!info.installer || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      await invoke<string>("download_update", { url: info.installer.url });
      onDismiss();
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <m.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        left: offsetLeft,
        width: `min(20rem, calc(100vw - ${offsetLeft + 16}px))`,
      }}
      className="fixed bottom-4 z-50 rounded-xl border border-gus-accent/40 bg-gus-panel p-3.5 shadow-2xl shadow-black/40"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gus-accent/40 bg-gus-accent/15 text-gus-accent">
          <ArrowUpCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-body leading-5 text-gus-text">
            {t("update.available", { version: info.version, current })}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {info.installer ? (
              <button
                type="button"
                onClick={() => void downloadInstaller()}
                disabled={downloading}
                className="gus-btn gus-btn-primary"
              >
                {downloading ? t("update.downloading") : t("update.download")}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void openRelease()}
              disabled={opening}
              className={clsx(
                "gus-btn w-auto px-2.5",
                info.installer ? "gus-btn-ghost" : "gus-btn-primary",
              )}
            >
              {t("update.openRelease")}
            </button>

            <button
              type="button"
              onClick={onDismiss}
              className="gus-btn gus-btn-ghost w-auto px-2.5"
            >
              {t("update.later")}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-body leading-5 text-rose-300">
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("update.close")}
          title={t("update.close")}
          className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </m.div>
  );
}
