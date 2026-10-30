import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { FileText, Library, Pencil, Plus, Trash2 } from "lucide-react";
import EmptyState from "./EmptyState";
import ViewHeader from "./ViewHeader";
import { useT } from "../lib/i18n";
import {
  addShelf,
  assignShelf,
  EMPTY_LIBRARY,
  filterPdfs,
  removeShelf,
  renameShelf,
  shelfOf,
  type LibraryStore,
  type ShelfFilter,
  type VaultPdf,
} from "../lib/library";
import { pdfCover } from "../lib/pdfCover";

export interface LibraryViewProps {
  vaultPath: string;
  refreshKey?: number;
  onOpenPdf: (pdf: VaultPdf) => void;
}

const CHIP = "rounded-full border px-3 py-1 text-body transition-colors";

/** Portada de un PDF: se genera solo cuando la tarjeta entra en pantalla. */
function Cover({ pdf }: { pdf: VaultPdf }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void pdfCover(pdf.path, pdf.modified_ms).then((cover) => {
        if (cancelled) return;
        if (cover) setSrc(cover);
        else setFailed(true);
      });
    });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pdf.path, pdf.modified_ms]);

  return (
    <div
      ref={ref}
      className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg bg-gus-panel"
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover object-top" />
      ) : (
        <FileText
          className={clsx("h-8 w-8 text-gus-muted", !failed && "animate-pulse")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * Biblioteca de PDF en estanterías (REQ-02): una tarjeta con portada por PDF
 * del vault y estanterías que define el usuario (Bibliografía, Clases…).
 */
export default function LibraryView({ vaultPath, refreshKey = 0, onOpenPdf }: LibraryViewProps) {
  const t = useT();
  const [pdfs, setPdfs] = useState<VaultPdf[]>([]);
  const [store, setStore] = useState<LibraryStore>(EMPTY_LIBRARY);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShelfFilter>({ kind: "all" });
  /** Nombre en edición: una estantería nueva (`from` null) o el renombrado de una. */
  const [editing, setEditing] = useState<{ from: string | null; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<VaultPdf[]>("list_vault_pdfs", { path: vaultPath }),
      invoke<LibraryStore>("load_library", { vaultPath }),
    ])
      .then(([list, loaded]) => {
        if (cancelled) return;
        setPdfs(list);
        setStore(loaded);
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
  }, [vaultPath, refreshKey]);

  function update(next: LibraryStore) {
    setStore(next);
    invoke("save_library", { vaultPath, store: next }).catch((reason: unknown) =>
      setError(String(reason)),
    );
  }

  function commitEditing() {
    if (!editing) return;
    const name = editing.value.trim();
    if (name) {
      if (editing.from === null) {
        update(addShelf(store, name));
        setFilter({ kind: "shelf", name });
      } else {
        update(renameShelf(store, editing.from, name));
        setFilter({ kind: "shelf", name });
      }
    }
    setEditing(null);
  }

  const visible = useMemo(() => filterPdfs(pdfs, store, filter), [pdfs, store, filter]);
  const countIn = (f: ShelfFilter) => filterPdfs(pdfs, store, f).length;
  const isActive = (f: ShelfFilter) =>
    f.kind === filter.kind && (f.kind !== "shelf" || (filter.kind === "shelf" && f.name === filter.name));

  const chips: { key: string; label: string; filter: ShelfFilter }[] = [
    { key: "all", label: t("library.all"), filter: { kind: "all" } },
    ...store.shelves.map((name) => ({ key: `s:${name}`, label: name, filter: { kind: "shelf", name } as ShelfFilter })),
    { key: "none", label: t("library.unshelved"), filter: { kind: "none" } },
  ];

  return (
    <section data-tour="library" className="gus-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ViewHeader title={t("library.title")} description={t("library.desc")} />

      {status === "loading" && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {error && <p className="break-words text-body text-rose-400">{error}</p>}

      {status === "ready" && pdfs.length === 0 && (
        <EmptyState icon={Library} title={t("library.empty")} />
      )}

      {status === "ready" && pdfs.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("library.shelves")}>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-pressed={isActive(chip.filter)}
                onClick={() => setFilter(chip.filter)}
                className={clsx(
                  CHIP,
                  isActive(chip.filter)
                    ? "border-gus-accent/50 bg-gus-accent/15 text-gus-accent"
                    : "border-gus-border text-gus-muted hover:text-gus-text",
                )}
              >
                {chip.label} <span className="opacity-70">{countIn(chip.filter)}</span>
              </button>
            ))}

            {editing ? (
              <input
                autoFocus
                value={editing.value}
                maxLength={40}
                placeholder={t("library.shelfName")}
                aria-label={t("library.shelfName")}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onBlur={commitEditing}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitEditing();
                  if (event.key === "Escape") setEditing(null);
                }}
                className="rounded-full border border-gus-accent/50 bg-gus-panel px-3 py-1 text-body text-gus-text outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing({ from: null, value: "" })}
                className={clsx(CHIP, "flex items-center gap-1 border-dashed border-gus-border text-gus-muted hover:text-gus-text")}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("library.newShelf")}
              </button>
            )}

            {filter.kind === "shelf" && !editing && (
              <>
                <button
                  type="button"
                  title={t("library.renameShelf")}
                  aria-label={t("library.renameShelf")}
                  className="gus-btn gus-btn-icon"
                  onClick={() => setEditing({ from: filter.name, value: filter.name })}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title={t("library.deleteShelf")}
                  aria-label={t("library.deleteShelf")}
                  className="gus-btn gus-btn-icon"
                  onClick={() => {
                    update(removeShelf(store, filter.name));
                    setFilter({ kind: "all" });
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Library} title={t("library.emptyShelf")} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {visible.map((pdf) => (
                <li key={pdf.relative} className="flex flex-col gap-2 rounded-xl border border-gus-border bg-gus-card p-3">
                  <button
                    type="button"
                    onClick={() => onOpenPdf(pdf)}
                    title={pdf.relative}
                    className="flex flex-col gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-gus-accent/60"
                  >
                    <Cover pdf={pdf} />
                    <span className="line-clamp-2 text-body font-medium text-gus-text">
                      {pdf.name.replace(/\.pdf$/i, "")}
                    </span>
                  </button>
                  <select
                    aria-label={t("library.shelfOf", { name: pdf.name })}
                    value={shelfOf(store, pdf.relative) ?? ""}
                    onChange={(event) => update(assignShelf(store, pdf.relative, event.target.value || null))}
                    className="rounded-lg border border-gus-border bg-gus-panel px-2 py-1 text-body text-gus-muted outline-none focus:border-gus-accent/60"
                  >
                    <option value="">{t("library.unshelved")}</option>
                    {store.shelves.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
