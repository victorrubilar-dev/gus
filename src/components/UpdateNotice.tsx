import { useState } from "react";
import { m } from "framer-motion";
import { ArrowUpCircle, X } from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../lib/i18n";
import { openExternal } from "../lib/externalLink";
import { percentDone, type SelfUpdateState } from "../lib/selfUpdate";
import type { UpdateInfo } from "../lib/updateCheck";

export interface UpdateNoticeProps {
  info: UpdateInfo;
  /** Versión instalada, para que el aviso la muestre junto a la nueva. */
  current: string;
  /** Distancia desde la izquierda: el aviso no debe tapar el menú lateral. */
  offsetLeft: number;
  /** Se llama al cerrar el aviso: esa versión no se vuelve a anunciar. */
  onDismiss: () => void;
  /** Si hay actualización automática en marcha: su estado sustituye a los botones de descarga manual. */
  self?: SelfUpdateState | null;
  onRestart?: () => void;
  onRetry?: () => void;
}

/** Barra de progreso de la descarga; indeterminada si el servidor no dijo el tamaño. */
function DownloadBar({ progress }: { progress: Extract<SelfUpdateState, { phase: "downloading" }>["progress"] }) {
  const percent = percentDone(progress);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="mt-2 flex items-center gap-2"
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gus-border">
        <span
          className={clsx("block h-full rounded-full bg-gus-accent", percent === null && "w-1/3 animate-pulse")}
          style={percent === null ? undefined : { width: `${percent}%`, transition: "width 0.15s ease-out" }}
        />
      </span>
      {percent !== null && <span className="w-9 text-right text-meta text-gus-muted tabular-nums">{percent}%</span>}
    </div>
  );
}

/**
 * Aviso discreto de que hay una versión más nueva en el repositorio. Si la
 * release trae instalador para este equipo, lo baja a Descargas y lo abre a
 * petición de quien use Gus; si no, abre la página de la release.
 */
export default function UpdateNotice({ info, current, offsetLeft, onDismiss, self, onRestart, onRetry }: UpdateNoticeProps) {
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
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={{
        left: offsetLeft,
        width: `min(20rem, calc(100vw - ${offsetLeft + 16}px))`,
      }}
      className="fixed bottom-4 z-50 rounded-xl border border-gus-accent/40 bg-gus-panel p-3.5 shadow-2xl shadow-black/40"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gus-border bg-gus-card text-gus-muted">
          <ArrowUpCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-body leading-5 text-gus-text">
            {self
              ? t(
                  self.phase === "ready"
                    ? "update.selfReady"
                    : self.phase === "installing"
                      ? "update.installing"
                      : self.phase === "error"
                        ? "update.selfFailed"
                        : "update.selfDownloading",
                  { version: info.version },
                )
              : t("update.available", { version: info.version, current })}
          </p>

          {self?.phase === "downloading" && <DownloadBar progress={self.progress} />}
          {self?.phase === "error" && (
            <p role="alert" className="mt-1.5 text-body leading-5 break-words text-rose-300">
              {self.message}
            </p>
          )}

          {self ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {self.phase === "ready" && (
                <button type="button" onClick={onRestart} className="gus-btn gus-btn-primary">
                  {t("update.restart")}
                </button>
              )}
              {self.phase === "error" && (
                <button type="button" onClick={onRetry} className="gus-btn gus-btn-primary">
                  {t("update.retry")}
                </button>
              )}
              <button
                type="button"
                onClick={() => void openExternal(info.url)}
                className="gus-btn gus-btn-ghost w-auto px-2.5"
              >
                {t("update.openRelease")}
              </button>
              {(self.phase === "ready" || self.phase === "error") && (
                <button type="button" onClick={onDismiss} className="gus-btn gus-btn-ghost w-auto px-2.5">
                  {t("update.later")}
                </button>
              )}
            </div>
          ) : (
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

          )}

          {error && (
            <p role="alert" className="mt-2 text-body leading-5 text-rose-300">
              {error}
            </p>
          )}
        </div>

        {(!self || self.phase === "ready" || self.phase === "error") && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("update.close")}
          title={t("update.close")}
          className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        )}
      </div>
    </m.div>
  );
}
