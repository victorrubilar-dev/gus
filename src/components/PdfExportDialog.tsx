import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, FileDown, Moon, Sun, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { safeFileName } from "../lib/fileName";
import {
  buildPdf,
  capturePdfPage,
  layoutStrip,
  PDF_PAGE_HEIGHT_PX,
  PDF_PAGE_WIDTH_PX,
  settlePage,
  showStripPage,
  toBase64,
  type PdfPageImage,
} from "../lib/pdfExport";

type PdfTheme = "light" | "dark";

export interface PdfExportDialogProps {
  /** Título de la nota, para nombrar el PDF de destino. */
  title: string;
  /** Nota ya renderizada: se exporta exactamente lo que se muestra. */
  children: ReactNode;
  onClose: () => void;
}

const THEME_OPTIONS: { id: PdfTheme; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Oscuro", Icon: Moon },
];

const PAGE_BACKGROUND: Record<PdfTheme, string> = {
  light: "#ffffff",
  dark: "#0d0e11",
};

/** Hueco alrededor de la hoja para encajarla en el área disponible. */
const FIT_PADDING = 56;

export default function PdfExportDialog({ title, children, onClose }: PdfExportDialogProps) {
  const [theme, setTheme] = useState<PdfTheme>("light");
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [scale, setScale] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  /** Página visible, para repaginar sin perder el sitio. */
  const pageRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Ajusta la hoja al espacio disponible sin perder resolución interna. */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const fit = () => {
      const width = stage.clientWidth - FIT_PADDING;
      const height = stage.clientHeight - FIT_PADDING;
      if (width <= 0 || height <= 0) return;
      setScale(
        Math.max(0.1, Math.min(width / PDF_PAGE_WIDTH_PX, height / PDF_PAGE_HEIGHT_PX, 1)),
      );
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /** Pagina el strip cada vez que el contenido o el tema cambian. */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    let cancelled = false;
    let timer = 0;

    const relayout = () => {
      // Durante la exportación el strip no se reordena: se está capturando.
      if (cancelled || busyRef.current) return;
      const current = stripRef.current;
      if (!current) return;
      const total = layoutStrip(current);
      const next = Math.min(pageRef.current, Math.max(0, total - 1));
      pageRef.current = next;
      setPageCount(total);
      setPage(next);
      showStripPage(current, next);
    };

    relayout();
    void settlePage(strip).then(relayout);

    // Los diagramas y las fórmulas aparecen después de montar: se vuelve a
    // paginar cuando cambie el contenido.
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(relayout, 150);
    });
    observer.observe(strip, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [theme]);

  /** Muestra la página pedida (por botones o durante la exportación). */
  useEffect(() => {
    pageRef.current = page;
    if (stripRef.current) showStripPage(stripRef.current, page);
  }, [page]);

  /** Esc y clic fuera cierran el diálogo, salvo mientras se exporta. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /** El foco pasa a la hoja: mientras el diálogo esté abierto no se escribe en la nota. */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function requestClose() {
    if (busyRef.current) return;
    onClose();
  }

  async function handleExport() {
    if (busyRef.current) return;
    setError(null);

    let target: string | null = null;
    try {
      target = await save({
        title: "Exportar a PDF",
        defaultPath: `${safeFileName(title)}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
    } catch (reason: unknown) {
      setError(
        `No se pudo abrir el cuadro de guardado: ${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
      return;
    }
    if (!target) return;

    const strip = stripRef.current;
    const pageWindow = windowRef.current;
    if (!strip || !pageWindow) {
      setError("No se pudo preparar la página.");
      return;
    }

    busyRef.current = true;
    setBusy(true);

    try {
      setStatus("Preparando la página…");
      await settlePage(pageWindow);

      const pages: PdfPageImage[] = [];
      for (let index = 0; index < pageCount; index += 1) {
        setStatus(`Capturando página ${index + 1} de ${pageCount}…`);
        showStripPage(strip, index);
        setPage(index);
        // Dos frames para que el navegador repinte antes de capturar.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        pages.push(await capturePdfPage(pageWindow, PAGE_BACKGROUND[theme]));
      }

      setStatus("Montando el PDF…");
      const pdf = buildPdf(pages, title || "Nota");

      setStatus("Guardando…");
      await invoke("write_pdf_file", { path: target, data: toBase64(pdf) });

      setStatus("¡Listo!");
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Exportar a PDF"
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <motion.button
        type="button"
        aria-label="Cerrar el diálogo"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={requestClose}
        className="absolute inset-0 cursor-default bg-black/65"
      />

      <motion.div
        ref={panelRef}
        tabIndex={-1}
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gus-border bg-gus-panel shadow-2xl focus:outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-gus-border px-4 py-3">
          <FileDown className="h-4 w-4 shrink-0 text-gus-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gus-text">Exportar a PDF</h2>
            <p className="truncate text-xs text-gus-muted">{title || "Sin título"}</p>
          </div>

          <div
            role="group"
            aria-label="Tono de la página"
            className="flex shrink-0 rounded-lg border border-gus-border bg-gus-card p-0.5"
          >
            {THEME_OPTIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={theme === id}
                disabled={busy}
                onClick={() => setTheme(id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50",
                  theme === id
                    ? "bg-gus-accent/15 font-medium text-gus-accent"
                    : "text-gus-muted hover:text-gus-text",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Cerrar"
            disabled={busy}
            className="shrink-0 rounded-lg p-1.5 text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div
          ref={stageRef}
          className="gus-scrollbar relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gus-bg"
        >
          <div
            className="relative"
            style={{
              width: PDF_PAGE_WIDTH_PX * scale,
              height: PDF_PAGE_HEIGHT_PX * scale,
            }}
          >
            <div
              className="absolute top-0 left-0 overflow-hidden rounded-sm shadow-[0_18px_45px_rgba(0,0,0,0.5)] ring-1 ring-black/20"
              style={{
                width: PDF_PAGE_WIDTH_PX,
                height: PDF_PAGE_HEIGHT_PX,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <div ref={windowRef} className="gus-pdf-window" data-theme={theme}>
                <div className="gus-pdf-page">
                  <div ref={stripRef} className="gus-pdf-strip">
                    <Suspense
                      fallback={
                        <p className="text-sm text-gus-muted">Cargando vista previa…</p>
                      }
                    >
                      {children}
                    </Suspense>
                    <div data-pdf-end style={{ height: 0 }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-gus-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {error ? (
              <p role="alert" className="truncate text-xs text-rose-300">
                {error}
              </p>
            ) : status ? (
              <p className="truncate text-xs text-gus-muted">{status}</p>
            ) : (
              <p className="truncate text-xs text-gus-muted">
                Vista previa fiel: lo que ves es lo que se exporta.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-gus-border bg-gus-card px-1 py-1">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={busy || page === 0}
              aria-label="Página anterior"
              className="rounded-md p-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-16 text-center text-xs text-gus-muted tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={busy || page >= pageCount - 1}
              aria-label="Página siguiente"
              className="rounded-md p-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="shrink-0 rounded-lg border border-gus-border bg-gus-card px-3 py-1.5 text-xs text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gus-accent px-3 py-1.5 text-xs font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-60"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? "Exportando…" : "Exportar a PDF"}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
