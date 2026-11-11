import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ImageOff, Images, Trash2, X } from "lucide-react";
import EmptyState from "./EmptyState";
import ViewHeader from "./ViewHeader";
import { useT } from "../lib/i18n";
import { joinPath } from "../lib/fileName";
import type { VaultImage } from "../lib/imageLinks";
import {
  filterGallery,
  galleryFolders,
  imageFolder,
  stepIndex,
  type GalleryFilter,
  type GalleryPeriod,
} from "../lib/gallery";

export interface GalleryViewProps {
  vaultPath: string;
  refreshKey?: number;
  /** Se movió o se borró una imagen: el explorador tiene que releer. */
  onFilesChanged: () => void;
  /** La imagen ya no está donde estaba (cierra su visor si estaba abierta). */
  onFileGone: (path: string) => void;
}

const FIELD =
  "rounded-lg border border-gus-border bg-gus-panel px-2 py-1.5 text-body text-gus-text outline-none focus:border-gus-accent/60";

/** Miniatura de la rejilla: se pide al backend solo cuando entra en pantalla. */
function Thumb({ image }: { image: VaultImage }) {
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
      invoke<string>("read_vault_image_thumb", { path: image.path, maxPx: 320 })
        .then((thumb) => !cancelled && setSrc(thumb))
        .catch(() => !cancelled && setFailed(true));
    });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [image.path, image.modified_ms]);

  return (
    <div ref={ref} className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-gus-panel">
      {src ? (
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <ImageOff
          className={clsx("h-6 w-6 text-gus-muted", !failed && "animate-pulse")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

interface ViewerProps {
  image: VaultImage;
  position: string;
  folders: string[];
  busy: boolean;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
  onMove: (folder: string) => void;
  onTrash: () => void;
}

/** Visor a pantalla completa con anterior/siguiente, mover y papelera. */
function Viewer({ image, position, folders, busy, onStep, onClose, onMove, onTrash }: ViewerProps) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    setConfirmTrash(false);
    invoke<string>("read_vault_image", { path: image.path })
      .then((data) => !cancelled && setSrc(data))
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, [image.path]);

  useEffect(() => closeRef.current?.focus(), []);

  // En `window` y no en el diálogo: tras borrar, el botón con el foco desaparece y el foco cae al `body`.
  const keysRef = useRef({ onStep, onClose });
  keysRef.current = { onStep, onClose };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Las flechas no deben pasar de imagen mientras se elige carpeta en el desplegable.
      if (event.target instanceof HTMLSelectElement) return;
      if (event.key === "Escape") keysRef.current.onClose();
      else if (event.key === "ArrowLeft") keysRef.current.onStep(-1);
      else if (event.key === "ArrowRight") keysRef.current.onStep(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const current = imageFolder(image);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      className="fixed inset-0 z-40 flex flex-col bg-black/95"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-gus-panel px-4 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-body text-gus-text" title={image.relative}>
          {image.relative}
        </span>
        <span className="text-meta tabular-nums text-gus-muted">{position}</span>
        <select
          aria-label={t("gallery.moveTo")}
          value={current}
          disabled={busy}
          onChange={(event) => onMove(event.target.value)}
          className={FIELD}
        >
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder === "" ? t("gallery.root") : folder}
            </option>
          ))}
        </select>
        {confirmTrash ? (
          <>
            <button type="button" disabled={busy} onClick={onTrash} className="gus-btn border-rose-400/40 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20">
              {t("explorer.moveToTrash")}
            </button>
            <button type="button" onClick={() => setConfirmTrash(false)} className="gus-btn gus-btn-ghost">
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmTrash(true)}
            title={t("gallery.trash")}
            aria-label={t("gallery.trash")}
            className="gus-btn gus-btn-icon"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")} className="gus-btn gus-btn-icon">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-6">
        {error ? (
          <p className="max-w-md break-words text-center text-body text-rose-300">{error}</p>
        ) : src ? (
          <img src={src} alt={image.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : (
          <p className="text-sm text-white/60">{t("app.loadingImage")}</p>
        )}
        <button
          type="button"
          onClick={() => onStep(-1)}
          aria-label={t("gallery.previous")}
          className="absolute top-1/2 left-4 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
        >
          <ChevronLeft className="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onStep(1)}
          aria-label={t("gallery.next")}
          className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
        >
          <ChevronRight className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Galería de imágenes (interfaz REQ-02): todas las imágenes del vault en una rejilla. */
export default function GalleryView({ vaultPath, refreshKey = 0, onFilesChanged, onFileGone }: GalleryViewProps) {
  const t = useT();
  const [images, setImages] = useState<VaultImage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GalleryFilter>({ folder: null, period: "all", query: "" });
  /** Ruta de la imagen abierta en el visor. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  /** Todas las carpetas del vault (relativas), destinos de «Mover a». */
  const [dirs, setDirs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<VaultImage[]>("list_vault_images", { path: vaultPath }),
      invoke<{ relative: string }[]>("list_vault_dirs", { path: vaultPath }),
    ])
      .then(([list, vaultDirs]) => {
        if (cancelled) return;
        setImages(list);
        setDirs(["", ...vaultDirs.map((dir) => dir.relative)]);
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
  }, [vaultPath, refreshKey, reload]);

  const folders = useMemo(() => galleryFolders(images), [images]);
  const visible = useMemo(() => filterGallery(images, filter, Date.now()), [images, filter]);
  const openIndex = openPath === null ? -1 : visible.findIndex((image) => image.path === openPath);
  const open = openIndex === -1 ? null : visible[openIndex];

  const periods: { value: GalleryPeriod; label: string }[] = [
    { value: "all", label: t("gallery.periodAll") },
    { value: "week", label: t("gallery.periodWeek") },
    { value: "month", label: t("gallery.periodMonth") },
    { value: "year", label: t("gallery.periodYear") },
  ];

  /** Tras mover o borrar, el visor pasa a la siguiente imagen (o se cierra si no queda ninguna). */
  async function act(run: () => Promise<unknown>) {
    if (!open) return;
    const next = visible.length > 1 ? visible[stepIndex(openIndex, 1, visible.length)].path : null;
    setBusy(true);
    try {
      await run();
      onFileGone(open.path);
      onFilesChanged();
      setOpenPath(next);
      setReload((key) => key + 1);
    } catch (reason: unknown) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gus-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ViewHeader
        title={t("gallery.title")}
        description={status === "ready" ? t("gallery.count", { count: visible.length }) : t("gallery.desc")}
      />

      {status === "loading" && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {error && <p role="alert" className="break-words text-body text-rose-400">{error}</p>}

      {status === "ready" && images.length === 0 && <EmptyState icon={Images} title={t("gallery.empty")} />}

      {status === "ready" && images.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2" role="search">
            <input
              value={filter.query}
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
              placeholder={t("gallery.search")}
              aria-label={t("gallery.search")}
              className={clsx(FIELD, "min-w-0 flex-1 sm:max-w-xs")}
            />
            <select
              aria-label={t("gallery.folder")}
              value={filter.folder ?? "*"}
              onChange={(event) =>
                setFilter({ ...filter, folder: event.target.value === "*" ? null : event.target.value })
              }
              className={FIELD}
            >
              <option value="*">{t("gallery.allFolders")}</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder === "" ? t("gallery.root") : folder}
                </option>
              ))}
            </select>
            <select
              aria-label={t("gallery.period")}
              value={filter.period}
              onChange={(event) => setFilter({ ...filter, period: event.target.value as GalleryPeriod })}
              className={FIELD}
            >
              {periods.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </select>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Images} title={t("gallery.noMatch")} />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {visible.map((image) => (
                <li key={image.path}>
                  <button
                    type="button"
                    onClick={() => setOpenPath(image.path)}
                    title={image.relative}
                    className="flex w-full flex-col gap-1.5 rounded-xl border border-gus-border bg-gus-card p-2 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/60"
                  >
                    <Thumb image={image} />
                    <span className="truncate text-meta text-gus-muted">{image.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && (
        <Viewer
          image={open}
          position={`${openIndex + 1} / ${visible.length}`}
          folders={dirs}
          busy={busy}
          onStep={(step) => setOpenPath(visible[stepIndex(openIndex, step, visible.length)].path)}
          onClose={() => setOpenPath(null)}
          onMove={(folder) =>
            void act(() =>
              invoke("move_vault_file", { from: open.path, toDir: folder === "" ? vaultPath : joinPath(vaultPath, folder) }),
            )
          }
          onTrash={() => void act(() => invoke("move_to_trash", { path: open.path, vault: vaultPath }))}
        />
      )}
    </section>
  );
}
