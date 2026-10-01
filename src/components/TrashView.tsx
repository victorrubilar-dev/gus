import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import {
  FileText,
  Folder,
  Image as ImageIcon,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { isImageName } from "../lib/fileName";
import { useT } from "../lib/i18n";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";

type Translator = (key: MessageKey, params?: TranslateParams) => string;

export interface TrashItem {
  name: string;
  path: string;
  origin: string | null;
  size: number;
  modifiedMs: number | null;
  trashedAtMs: number | null;
  isDir: boolean;
}

export interface TrashViewProps {
  onRestore?: () => void;
}

type LoadState = "loading" | "ready" | "error";

function formatoFecha(ms: number | null): string {
  if (ms == null) return "";
  const fecha = new Date(ms);
  if (Number.isNaN(fecha.getTime())) return "";

  return fecha.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatoTamano(bytes: number, isDir: boolean, t: Translator): string {
  if (isDir) return t("trash.folder");
  if (bytes < 1024) return `${bytes} B`;

  const unidades = ["KB", "MB", "GB"];
  let valor = bytes / 1024;
  let unidad = 0;
  while (valor >= 1024 && unidad < unidades.length - 1) {
    valor /= 1024;
    unidad += 1;
  }
  return `${valor.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unidades[unidad]}`;
}

function carpetaOrigen(item: TrashItem, t: Translator): string {
  if (!item.origin) return t("trash.unknownOrigin");

  const slash = Math.max(item.origin.lastIndexOf("/"), item.origin.lastIndexOf("\\"));
  const carpeta = slash === -1 ? "" : item.origin.slice(0, slash);
  return carpeta || t("trash.fromVault");
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días que la papelera conserva cada elemento (mismo plazo que en Rust). */
const CADUCA_DIAS = 30;

function diasRestantes(trashedAtMs: number | null): number | null {
  if (trashedAtMs == null) return null;
  const restante = trashedAtMs + CADUCA_DIAS * DIA_MS - Date.now();
  return Math.max(0, Math.floor(restante / DIA_MS));
}

export default function TrashView({ onRestore }: TrashViewProps) {
  const t = useT();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    invoke<TrashItem[]>("list_trash")
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(String(reason));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const busy = busyId !== null;

  async function restore(item: TrashItem) {
    setSyncError(null);
    setBusyId(item.path);

    try {
      const destino = await invoke<string>("restore_from_trash", { path: item.path });
      setConfirmId(null);
      showNotice(`Restaurado en ${destino}`);
      onRestore?.();
      reload();
    } catch (reason: unknown) {
      setSyncError(String(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function removeForever(item: TrashItem) {
    setSyncError(null);
    setBusyId(item.path);

    try {
      await invoke("delete_from_trash", { path: item.path });
      setConfirmId(null);
      showNotice(`«${item.name}» se ha eliminado definitivamente`);
      reload();
    } catch (reason: unknown) {
      setSyncError(String(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function emptyAll() {
    setSyncError(null);
    setBusyId("__all__");

    try {
      await invoke("empty_trash");
      setConfirmEmpty(false);
      showNotice(t("trash.emptied"));
      reload();
    } catch (reason: unknown) {
      setSyncError(String(reason));
    } finally {
      setBusyId(null);
    }
  }

  const chip =
    "rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none";

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
          {t("trash.title")}
          <span className="ml-2 font-normal normal-case">
            {status === "loading" ? t("common.loading") : t("trash.count", { count: items.length })}
          </span>
        </h2>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            disabled={busy}
            title={t("trash.reload")}
            aria-label={t("trash.reload")}
            className="rounded-md border border-gus-border bg-gus-card p-1.5 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {confirmEmpty ? (
            <span className="flex items-center gap-1.5 text-[11px] text-rose-300">
              {t("trash.emptyAsk")}
              <button
                type="button"
                onClick={() => void emptyAll()}
                disabled={busy}
                className={`${chip} border-rose-400/40 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20`}
              >
                {t("trash.emptyYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmEmpty(false)}
                className={`${chip} border-gus-border text-gus-muted hover:text-gus-text`}
              >
                {t("common.cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEmpty(true)}
              disabled={busy || status !== "ready" || items.length === 0}
              className={`${chip} border-gus-border text-gus-muted hover:border-rose-400/40 hover:text-rose-300`}
            >
              {t("trash.emptyTrash")}
            </button>
          )}
        </div>
      </header>

      {status === "ready" && items.length > 0 && (
        <p className="text-[11px] text-gus-muted">
          {t("trash.retentionNote", { days: CADUCA_DIAS })}
        </p>
      )}

      {syncError && (
        <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
          La papelera ha devuelto un error: {syncError}
        </p>
      )}

      {notice && (
        <p className="rounded-lg border border-gus-accent/40 bg-gus-accent/10 px-3 py-2 text-xs text-gus-accent">
          {notice}
        </p>
      )}

      <ul className="flex-1 space-y-2 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const confirming = confirmId === item.path;
            const isBusy = busyId === item.path;
            const restan = diasRestantes(item.trashedAtMs);

            return (
              <m.li
                key={item.path}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{
                  duration: 0.2,
                  ease: "easeOut",
                  layout: { type: "spring", stiffness: 500, damping: 45 },
                }}
                className="group overflow-hidden rounded-xl border border-gus-border bg-gus-card px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gus-border bg-gus-panel text-gus-muted">
                    {item.isDir ? (
                      <Folder className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    ) : isImageName(item.name) ? (
                      <ImageIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    )}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-gus-text" title={item.path}>
                      {item.name}
                    </span>
                    <span
                      className="truncate text-[11px] text-gus-muted"
                      title={item.origin ?? t("trash.unknownOrigin")}
                    >
                      {carpetaOrigen(item, t)}
                    </span>
                  </span>

                  <span className="hidden shrink-0 flex-col items-end text-[11px] text-gus-muted sm:flex">
                    <span>{formatoTamano(item.size, item.isDir, t)}</span>
                    <span>{formatoFecha(item.trashedAtMs ?? item.modifiedMs)}</span>
                    {restan !== null && (
                      <span
                        className={restan <= 3 ? "text-amber-300" : "text-gus-accent"}
                        title={t("trash.retentionNote", { days: CADUCA_DIAS })}
                      >
                        {restan === 0
                          ? t("trash.expiresToday")
                          : t("trash.expiresIn", { count: restan })}
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void restore(item)}
                      disabled={busy}
                      title={t("trash.restore")}
                      aria-label={t("trash.restoreNamed", { name: item.name })}
                      className="rounded-md p-1.5 text-gus-muted transition hover:bg-gus-accent/15 hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmId(confirming ? null : item.path)}
                      disabled={busy}
                      title={t("trash.deleteForever")}
                      aria-label={t("trash.deleteNamed", { name: item.name })}
                      aria-pressed={confirming}
                      className="rounded-md p-1.5 text-gus-muted transition hover:bg-rose-400/10 hover:text-rose-400 focus-visible:ring-2 focus-visible:ring-rose-400/60 focus-visible:outline-none disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </span>
                </div>

                {confirming && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
                    <span className="min-w-0 break-all">
                      {t("trash.deleteConfirm", { name: item.name })}
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void removeForever(item)}
                        disabled={isBusy}
                        className="rounded-md border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-300 transition-colors hover:bg-rose-400/20 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none disabled:opacity-50"
                      >
                        {isBusy ? t("trash.deleting") : t("trash.deleteYes")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        disabled={isBusy}
                        className="rounded-md border border-gus-border px-2 py-1 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
                      >
                        {t("common.cancel")}
                      </button>
                    </span>
                  </div>
                )}
              </m.li>
            );
          })}
        </AnimatePresence>

        {status === "loading" && (
          <li className="rounded-xl border border-dashed border-gus-border px-4 py-10 text-center text-sm text-gus-muted">
            {t("trash.loading")}
          </li>
        )}

        {status === "error" && (
          <li className="flex flex-col items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-xs text-rose-300">
            <span className="break-words">
              {t("trash.loadError")}
              <span className="block font-mono text-rose-400/80">
                ~/gus-vault/.gus-trash
              </span>
              {error && <span className="block text-rose-400/80">{error}</span>}
            </span>
            <button
              type="button"
              onClick={reload}
              className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {t("editor.retry")}
            </button>
          </li>
        )}

        {status === "ready" && items.length === 0 && (
          <li className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gus-border px-4 py-10 text-center">
            <Trash2 className="h-6 w-6 text-gus-muted" strokeWidth={1.5} aria-hidden="true" />
            <p className="text-sm text-gus-muted">{t("trash.empty")}</p>
            <p className="text-[11px] text-gus-muted/80">{t("trash.emptyHint")}</p>
          </li>
        )}
      </ul>
    </section>
  );
}
