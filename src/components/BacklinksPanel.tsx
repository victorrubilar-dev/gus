import { useEffect, useState } from "react";
import { ChevronDown, Link2, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useT } from "../lib/i18n";
import {
  backlinksTo,
  graphFolder,
  graphTitle,
  outgoingFrom,
  type LinkGraph,
} from "../lib/linkGraph";

/** Estado del panel en la sesión: abierto por defecto, como en un visor. */
const OPEN_KEY = "gus.backlinks-open";

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

function storeOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "open" : "closed");
  } catch {
    // Sin memoria entre sesiones el panel vuelve a abrirse por defecto.
  }
}

export interface BacklinksPanelProps {
  /** Grafo del vault ya cargado por la app (el mismo que usa el editor). */
  graph: LinkGraph | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string | null;
  /** Nota abierta: de ella se cuelgan sus entrantes y sus salientes. */
  notePath: string | null;
  onOpenNote: (note: { path: string; name: string }) => void;
  /**
   * Abre un enlace saliente por su destino `[[wiki]]`: los rotos se crean al
   * vuelo, igual que al pulsarlos dentro de la nota.
   */
  onOpenWikiTarget: (target: string) => void;
}

interface SectionItem {
  id: string;
  title: string;
  folder: string;
  count: number;
  broken?: boolean;
}

/**
 * Panel de referencias cruzadas bajo el editor: qué notas enlazan a la
 * abierta (backlinks) y a qué enlaza ella. Los datos vienen del grafo que
 * parsea el backend, así que el panel no vuelve a leer el vault.
 */
export default function BacklinksPanel({
  graph,
  status,
  error,
  notePath,
  onOpenNote,
  onOpenWikiTarget,
}: BacklinksPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(readStoredOpen);

  useEffect(() => {
    storeOpen(open);
  }, [open]);

  const backlinks = notePath ? backlinksTo(graph, notePath) : [];
  const outgoing = notePath ? outgoingFrom(graph, notePath) : [];

  return (
    <div className="flex shrink-0 flex-col border-t border-gus-border bg-gus-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left outline-none transition-colors hover:bg-gus-card focus-visible:bg-gus-card"
      >
        <Link2 className="h-3.5 w-3.5 shrink-0 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-xs font-semibold tracking-wide text-gus-text">
          {t("backlinks.title")}
        </span>

        {status === "loading" && graph === null && (
          <Loader2 className="h-3 w-3 animate-spin text-gus-muted" aria-hidden="true" />
        )}

        {backlinks.length > 0 && (
          <span className="rounded-full border border-gus-accent/40 bg-gus-accent/15 px-1.5 text-[10px] tabular-nums text-gus-accent">
            {backlinks.length}
          </span>
        )}

        <ChevronDown
          className={clsx(
            "ml-auto h-3.5 w-3.5 shrink-0 text-gus-muted transition-transform",
            !open && "-rotate-90",
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="gus-scrollbar max-h-56 min-h-0 overflow-y-auto px-4 pb-3">
          {status === "loading" && graph === null && (
            <p className="py-2 text-xs text-gus-muted">{t("backlinks.loading")}</p>
          )}

          {status === "error" && (
            <p role="alert" className="py-2 text-xs text-rose-300">
              {error ?? t("backlinks.error")}
            </p>
          )}

          {status !== "error" && (
            <>
              <Section
                title={t("backlinks.incoming")}
                empty={t("backlinks.emptyIncoming")}
                entries={backlinks.map((entry) => ({
                  id: entry.node.path,
                  title: graphTitle(entry.node),
                  folder: graphFolder(entry.node),
                  count: entry.count,
                }))}
                onSelect={(item) => onOpenNote({ path: item.id, name: item.title })}
              />

              <Section
                title={t("backlinks.outgoing")}
                empty={t("backlinks.emptyOutgoing")}
                entries={outgoing.map((entry) => ({
                  id: entry.target,
                  title: entry.resolved ? graphTitle(entry.resolved) : entry.target,
                  folder: entry.resolved ? graphFolder(entry.resolved) : "",
                  count: entry.count,
                  broken: entry.resolved === null,
                }))}
                onSelect={(item) => onOpenWikiTarget(item.id)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  entries,
  onSelect,
}: {
  title: string;
  empty: string;
  entries: SectionItem[];
  onSelect: (item: SectionItem) => void;
}) {
  const t = useT();

  return (
    <section className="mt-1 first:mt-0">
      <h4 className="pt-1.5 pb-1 text-[10px] font-medium tracking-wider text-gus-muted uppercase">
        {title}
        {entries.length > 0 && (
          <span className="ml-1.5 tabular-nums opacity-70">{entries.length}</span>
        )}
      </h4>

      {entries.length === 0 ? (
        <p className="pb-1 text-xs text-gus-muted/70">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-gus-card focus-visible:ring-2 focus-visible:ring-gus-accent/60"
              >
                <span
                  className={clsx(
                    "min-w-0 truncate text-xs",
                    item.broken ? "text-gus-muted italic" : "text-gus-text",
                  )}
                >
                  {item.title}
                </span>

                {item.folder && (
                  <span className="min-w-0 truncate text-[10px] text-gus-muted">{item.folder}</span>
                )}

                <span className="ml-auto shrink-0 rounded-full border border-gus-border px-1.5 text-[10px] tabular-nums text-gus-muted">
                  {t("backlinks.mentions", { count: item.count })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
