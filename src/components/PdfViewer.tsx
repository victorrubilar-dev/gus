import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// pdf.js se carga solo al abrir el primer PDF (import diferido desde App).
GlobalWorkerOptions.workerSrc = workerSrc;

interface PageSize {
  w: number;
  h: number;
}

type ViewerStatus = "loading" | "ready" | "error";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const ZOOM_BUTTON =
  "h-6 w-6 rounded border border-gus-border bg-gus-card text-sm leading-none text-gus-text transition-colors hover:border-gus-accent/50 hover:text-gus-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gus-accent/60";

/**
 * Visor de PDF con pdf.js: decodifica el data URL, mide las páginas y las
 * pinta en canvas (una por fila, con scroll). El zoom vuelve a pintar con el
 * devicePixelRatio para que el texto quede nítido.
 */
export default function PdfViewer({ src, title }: { src: string; title: string }) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [pages, setPages] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  // En pdf.js v6 la limpieza correcta es destruir la tarea, no el documento.
  const taskRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderSeqRef = useRef(0);

  // Carga del documento y medición de páginas (una vez por src).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setStatus("loading");
    setPages([]);
    setError(null);
    canvasesRef.current = [];

    (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = new Uint8Array(await response.arrayBuffer());

        const task = getDocument({ data });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = doc;

        const sizes: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ w: viewport.width, h: viewport.height });
          if (cancelled) return;
        }

        if (cancelled) return;
        setPages(sizes);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      docRef.current = null;
      const task = taskRef.current;
      taskRef.current = null;
      void task?.destroy();
    };
  }, [src]);

  // Pintado progresivo de todas las páginas (se cancela al desmontar o al zoomar).
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || pages.length === 0) return;

    const seq = ++renderSeqRef.current;
    const dpr = window.devicePixelRatio || 1;
    let cancelled = false;

    void (async () => {
      for (let i = 0; i < pages.length; i += 1) {
        if (cancelled || seq !== renderSeqRef.current) return;
        const canvas = canvasesRef.current[i];
        if (!canvas) continue;

        try {
          const page = await doc.getPage(i + 1);
          const viewport = page.getViewport({ scale: zoom });
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          await page.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
        } catch (err) {
          if (cancelled || seq !== renderSeqRef.current) return;
          setError(String(err));
          setStatus("error");
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pages, zoom]);

  function changeZoom(delta: number) {
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + delta) * 100) / 100)),
    );
  }

  return (
    <div
      role="region"
      aria-label={`Documento ${title}`}
      className="flex h-full w-full min-h-0 flex-col"
    >
      <div className="flex items-center justify-center gap-2 border-b border-gus-border bg-gus-panel px-4 py-1.5 text-xs text-gus-muted">
        <button
          type="button"
          onClick={() => changeZoom(-ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Alejar"
          title="Alejar"
          className={ZOOM_BUTTON}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Restablecer al 100 %"
          className="min-w-12 px-1 font-mono tabular-nums transition-colors hover:text-gus-accent focus-visible:outline-2 focus-visible:outline-gus-accent/60"
        >
          {Math.round(zoom * 100)} %
        </button>
        <button
          type="button"
          onClick={() => changeZoom(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Acercar"
          title="Acercar"
          className={ZOOM_BUTTON}
        >
          +
        </button>

        {pages.length > 0 && (
          <span className="ml-2 border-l border-gus-border pl-3 font-mono tabular-nums">
            {pages.length} {pages.length === 1 ? "página" : "páginas"}
          </span>
        )}
      </div>

      <div className="gus-scrollbar min-h-0 flex-1 overflow-auto bg-black/20 p-4">
        {status === "error" && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="flex max-w-md flex-col gap-2">
              <p className="text-sm text-gus-muted">No se pudo renderizar el PDF</p>
              {error && <p className="break-words text-xs text-rose-300">{error}</p>}
            </div>
          </div>
        )}

        {status !== "error" && pages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gus-muted">Cargando documento…</p>
          </div>
        )}

        {pages.length > 0 && (
          <div className="flex flex-col items-center gap-4 pb-4">
            {pages.map((size, i) => (
              <canvas
                key={i}
                ref={(element) => {
                  canvasesRef.current[i] = element;
                }}
                aria-label={`Página ${i + 1}`}
                className="rounded-lg border border-white/10 bg-white shadow-2xl"
                style={{ width: size.w * zoom, height: size.h * zoom }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
