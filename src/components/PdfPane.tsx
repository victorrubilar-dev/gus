import { lazy, Suspense } from "react";
import { useT } from "../lib/i18n";

// Visor de PDF: carga pdf.js solo cuando se abre el primer documento.
const PdfViewer = lazy(() => import("./PdfViewer"));

export interface OpenPdf {
  path: string;
  title: string;
  src: string | null;
  error?: string;
}

interface PdfPaneProps {
  pdf: OpenPdf;
  status: "idle" | "loading" | "ready" | "error";
}

/** Visor de un PDF del vault, con su cabecera y los estados de carga y error. */
export default function PdfPane({ pdf, status }: PdfPaneProps) {
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gus-border bg-gus-panel px-4 py-2">
        <span className="truncate font-mono text-body text-gus-muted">{pdf.title}</span>
        <span className="shrink-0 gus-chip uppercase tracking-wide">
          PDF
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-black/20">
        {status === "loading" && (
          <p className="text-sm text-white/60">{t("app.loadingPdf")}</p>
        )}

        {status === "error" && (
          <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
            <p className="text-sm text-gus-muted">{t("app.pdfError")}</p>
            {pdf.error && (
              <p className="break-words text-body text-rose-300">{pdf.error}</p>
            )}
          </div>
        )}

        {status === "ready" && pdf.src && (
          <Suspense fallback={<p className="text-sm text-white/60">{t("app.loadingViewer")}</p>}>
            <PdfViewer src={pdf.src} title={pdf.title} path={pdf.path} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
