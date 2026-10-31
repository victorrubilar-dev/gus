import { useState } from "react";
import { m } from "framer-motion";
import clsx from "clsx";
import { ArrowLeft, FolderOpen, ShieldCheck } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import gusIcon from "../assets/gus-icon-512.png";
import { joinPath } from "../lib/fileName";
import { useT } from "../lib/i18n";

interface FirstVaultStepProps {
  /** Carpeta donde se crearán los vaults si no se elige otra. */
  baseDir: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, base: string) => Promise<boolean>;
  onAddExisting: (path: string) => Promise<boolean>;
  onSelectBaseDir: (dir: string) => void;
  onBack: () => void;
}

/**
 * Segundo paso de la primera vez: crear el primer vault con un nombre ya puesto,
 * o usar una carpeta que ya se tenga. Explica qué es un vault antes de pedir nada.
 */
export default function FirstVaultStep({ baseDir, busy, error, onCreate, onAddExisting, onSelectBaseDir, onBack }: FirstVaultStepProps) {
  const t = useT();
  const [name, setName] = useState(() => t("firstVault.defaultName"));
  const [base, setBase] = useState(baseDir);
  const [localError, setLocalError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const shownError = localError ?? error;
  const disabled = busy || picking;

  async function chooseFolder(): Promise<string | null> {
    setPicking(true);
    setLocalError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: t("vaults.baseFolder") });
      return typeof selected === "string" ? selected : null;
    } catch (reason: unknown) {
      setLocalError(String(reason));
      return null;
    } finally {
      setPicking(false);
    }
  }

  async function changeBase() {
    const selected = await chooseFolder();
    if (selected) {
      setBase(selected);
      onSelectBaseDir(selected);
    }
  }

  async function useExisting() {
    const selected = await chooseFolder();
    if (selected) await onAddExisting(selected);
  }

  function submit() {
    const clean = name.trim();
    if (!clean) {
      setLocalError(t("app.vaultNeedsName"));
      return;
    }
    setLocalError(null);
    void onCreate(clean, base);
  }

  return (
    <div className="gus-scrollbar flex h-full w-full items-center justify-center overflow-y-auto bg-gus-bg px-6 py-10">
      <m.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg"
        aria-labelledby="first-vault-title"
      >
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-body text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("firstVault.back")}
        </button>

        <div className="flex items-center gap-3">
          <img src={gusIcon} alt="" aria-hidden="true" draggable={false} className="h-12 w-12 shrink-0 select-none" />
          <h1 id="first-vault-title" className="text-2xl font-semibold tracking-tight">
            {t("firstVault.title")}
          </h1>
        </div>

        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-gus-muted">
          <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
          {t("firstVault.intro")}
        </p>

        {shownError && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-body text-rose-300">
            {shownError}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="mt-6 space-y-3 rounded-2xl border border-gus-border bg-gus-panel p-5"
        >
          <h2 className="text-sm font-semibold">{t("firstVault.newTitle")}</h2>
          <div>
            <label htmlFor="first-vault-name" className="mb-1 block text-body text-gus-muted">
              {t("vaults.vaultName")}
            </label>
            <input
              id="first-vault-name"
              autoFocus
              value={name}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60"
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-meta text-gus-muted">
              <span>{t("vaults.willCreateAt")}</span>
              <span className="min-w-0 break-all font-mono">{joinPath(base, name.trim() || "…")}</span>
              <button
                type="button"
                onClick={() => void changeBase()}
                disabled={disabled}
                className="rounded px-1 text-gus-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gus-accent/60 disabled:opacity-50"
              >
                {t("firstVault.changeFolder")}
              </button>
            </p>
          </div>
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gus-accent px-5 text-sm font-semibold text-gus-bg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gus-bg disabled:opacity-60"
          >
            {t("vaults.create")}
          </button>
        </form>

        <p className="my-4 flex items-center gap-3 text-meta uppercase tracking-wider text-gus-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-gus-border" />
          {t("firstVault.or")}
          <span className="h-px flex-1 bg-gus-border" />
        </p>

        <div className="space-y-2 rounded-2xl border border-gus-border bg-gus-panel p-5">
          <h2 className="text-sm font-semibold">{t("firstVault.existingTitle")}</h2>
          <p className="text-body leading-5 text-gus-muted">{t("firstVault.existingBody")}</p>
          <button
            type="button"
            onClick={() => void useExisting()}
            disabled={disabled}
            className={clsx(
              "inline-flex min-h-10 items-center gap-2 rounded-xl border border-gus-border bg-gus-card px-4 text-sm font-medium text-gus-text",
              "outline-none transition-colors hover:border-gus-accent/50 focus-visible:ring-2 focus-visible:ring-gus-accent/60 disabled:opacity-60",
            )}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            {t("firstVault.existingButton")}
          </button>
        </div>
      </m.section>
    </div>
  );
}
