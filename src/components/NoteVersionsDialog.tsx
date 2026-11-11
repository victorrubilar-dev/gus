import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { m } from "framer-motion";
import { History, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage, useT } from "../lib/i18n";

interface NoteVersion {
  savedMs: number;
  size: number;
}

export interface NoteVersionsDialogProps {
  vaultPath: string;
  path: string;
  title: string;
  /** Mete el texto de la versión en el editor (como una edición normal). */
  onRestore: (content: string) => Promise<void>;
  onClose: () => void;
}

/** Versiones anteriores de la nota (`.gus-history/`): lista, vista previa y «Restaurar». */
export default function NoteVersionsDialog({ vaultPath, path, title, onRestore, onClose }: NoteVersionsDialogProps) {
  const t = useT();
  const language = useLanguage();
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    invoke<NoteVersion[]>("list_note_versions", { vault: vaultPath, path })
      .then((list) => {
        setVersions(list);
        setSelected(list[0]?.savedMs ?? null);
      })
      .catch((reason: unknown) => {
        setVersions([]);
        setError(String(reason));
      });
  }, [vaultPath, path]);

  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    setPreview(null);
    invoke<string>("read_note_version", { vault: vaultPath, path, savedMs: selected })
      .then((text) => !cancelled && setPreview(text))
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, [vaultPath, path, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function restore() {
    if (preview === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRestore(preview);
      onClose();
    } catch (reason: unknown) {
      setError(String(reason));
      setBusy(false);
    }
  }

  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div role="dialog" aria-modal="true" aria-label={t("versions.title")} className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <m.button
        type="button"
        aria-label={t("common.close")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/65"
      />

      <m.div
        ref={panelRef}
        tabIndex={-1}
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gus-border bg-gus-panel shadow-2xl focus:outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-gus-border px-4 py-3">
          <History className="h-4 w-4 shrink-0 text-gus-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gus-text">{t("versions.title")}</h2>
            <p className="truncate text-body text-gus-muted">{title || t("common.untitled")}</p>
          </div>
          <button
            type="button"
            onClick={() => void restore()}
            disabled={preview === null || busy}
            className="gus-btn shrink-0 disabled:opacity-50"
          >
            {t("versions.restore")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="shrink-0 rounded-lg p-1.5 text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {error && <p className="shrink-0 border-b border-gus-border px-4 py-2 text-body text-rose-400/80">{error}</p>}

        {versions !== null && versions.length === 0 ? (
          <p className="m-auto max-w-sm px-6 text-center text-body text-gus-muted">{t("versions.empty")}</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul aria-label={t("versions.list")} className="gus-scrollbar w-56 shrink-0 overflow-y-auto border-r border-gus-border py-1">
              {versions?.map((version) => (
                <li key={version.savedMs}>
                  <button
                    type="button"
                    aria-current={selected === version.savedMs}
                    onClick={() => setSelected(version.savedMs)}
                    className={clsx(
                      "flex w-full flex-col px-3 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                      selected === version.savedMs ? "bg-gus-accent/15 text-gus-accent" : "text-gus-text hover:bg-gus-card",
                    )}
                  >
                    <span className="text-body">{dateFormat.format(version.savedMs)}</span>
                    <span className="text-meta text-gus-muted">{t("versions.bytes", { count: version.size })}</span>
                  </button>
                </li>
              ))}
            </ul>
            <pre className="gus-scrollbar min-w-0 flex-1 overflow-auto px-5 py-4 font-mono text-body break-words whitespace-pre-wrap text-gus-text">
              {preview ?? ""}
            </pre>
          </div>
        )}
      </m.div>
    </div>
  );
}
