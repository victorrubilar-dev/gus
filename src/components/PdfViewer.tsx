import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Bookmark,
  Coffee,
  Eraser,
  Hand,
  Highlighter,
  Maximize2,
  Minimize2,
  Moon,
  Pencil,
  StickyNote,
  Sun,
  X,
} from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import PdfNotesPanel from "./PdfNotesPanel";
import {
  loadPdfDoc,
  loadPdfProgress,
  makeId,
  savePdfDoc,
  savePdfProgress,
  type PdfDocData,
  type PdfProgress,
  type PdfReadFilter,
  type PdfStroke,
} from "../lib/pdfAnnotations";

// pdf.js se carga solo al abrir el primer PDF (import diferido desde App).
GlobalWorkerOptions.workerSrc = workerSrc;

interface PageSize {
  w: number;
  h: number;
}

type ViewerStatus = "loading" | "ready" | "error";

type Tool = "mano" | "marcador" | "lapiz" | "borrador";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

// Radio del borrador y grosores de trazo (en píxeles al 100 %).
const ERASE_RADIUS_PX = 12;
const MARKER_PX = 16;
const PEN_PX = 3;

const PALETTE = ["#ffd23f", "#f0655a", "#5aa9e6", "#63c174", "#b48ead"];

const ICON_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded border border-gus-border bg-gus-card transition-colors hover:border-gus-accent/50 hover:text-gus-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gus-accent/60";

const ICON_BUTTON_ACTIVE =
  "flex h-6 w-6 items-center justify-center rounded border border-gus-accent/60 bg-gus-accent/20 text-gus-accent transition-colors focus-visible:outline-2 focus-visible:outline-gus-accent/60";

const CHIP_BUTTON =
  "flex items-center gap-1 rounded border border-gus-accent/40 bg-gus-accent/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gus-accent transition-colors hover:bg-gus-accent/25 focus-visible:outline-2 focus-visible:outline-gus-accent/60";

const TOOLS: { id: Tool; label: string; Icon: typeof Hand }[] = [
  { id: "mano", label: "Mano", Icon: Hand },
  { id: "marcador", label: "Marcador", Icon: Highlighter },
  { id: "lapiz", label: "Lápiz", Icon: Pencil },
  { id: "borrador", label: "Borrador", Icon: Eraser },
];

// Filtros del modo lectura: solo afectan a lo que se ve en el visor.
const FILTER_ORDER: PdfReadFilter[] = ["normal", "sepia", "noche"];
const FILTER_INFO: Record<PdfReadFilter, { Icon: typeof Sun; label: string }> = {
  normal: { Icon: Sun, label: "Normal" },
  sepia: { Icon: Coffee, label: "Sepia" },
  noche: { Icon: Moon, label: "Noche" },
};
const FILTER_CSS: Record<PdfReadFilter, string | undefined> = {
  normal: undefined,
  sepia: "sepia(0.45) contrast(0.97) brightness(0.96)",
  noche: "invert(1) hue-rotate(180deg) contrast(0.92) brightness(0.95)",
};

const EMPTY_STROKES: PdfStroke[] = [];

function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  stroke: PdfStroke,
  width: number,
): void {
  ctx.globalAlpha = stroke.alpha;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width * width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Pinta un trazo completo (coords. normalizadas → px de pantalla). */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: PdfStroke,
  width: number,
  height: number,
): void {
  const points = stroke.points;
  if (points.length === 0) return;
  applyStrokeStyle(ctx, stroke, width);
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  if (points.length === 1) {
    ctx.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
  } else {
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x * width, points[i].y * height);
    }
  }
  ctx.stroke();
}

/** Distancia en px desde el punto hasta el segmento (para el borrador). */
function segmentDistance2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  let t = 0;
  if (length2 > 0) {
    t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2));
  }
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function strokeTouches(
  stroke: PdfStroke,
  x: number,
  y: number,
  radiusPx: number,
  width: number,
  height: number,
): boolean {
  const tx = x * width;
  const ty = y * height;
  const radius2 = radiusPx * radiusPx;
  const points = stroke.points;
  if (points.length === 0) return false;
  const first = points[0];
  const fx = first.x * width;
  const fy = first.y * height;
  if ((fx - tx) ** 2 + (fy - ty) ** 2 <= radius2) return true;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const d2 = segmentDistance2(
      prev.x * width,
      prev.y * height,
      curr.x * width,
      curr.y * height,
      tx,
      ty,
    );
    if (d2 <= radius2) return true;
  }
  return false;
}

/**
 * Visor de PDF con pdf.js: decodifica el data URL, mide las páginas y las
 * pinta en canvas (una por fila, con scroll). El zoom vuelve a pintar con el
 * devicePixelRatio para que el texto quede nítido.
 *
 * Sobre el documento se apoyan las herramientas del lector: notas al margen,
 * lápiz/marcador/borrador (guardados solo en la app, jamás en el PDF),
 * marcapáginas con progreso automático, modo lectura con filtro, pantalla
 * completa y zoom con Ctrl + rueda.
 */
export default function PdfViewer({
  src,
  title,
  path,
}: {
  src: string;
  title: string;
  path: string;
}) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [pages, setPages] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [doc, setDoc] = useState<PdfDocData>(() => loadPdfDoc(path));
  const [tool, setTool] = useState<Tool>("mano");
  const [penColor, setPenColor] = useState(PALETTE[0]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteFocusId, setNoteFocusId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [fallbackFs, setFallbackFs] = useState(false);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  // En pdf.js v6 la limpieza correcta es destruir la tarea, no el documento.
  const taskRef = useRef<ReturnType<typeof getDocument> | null>(null);
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderSeqRef = useRef(0);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pathRef = useRef(path);
  const zoomRef = useRef(zoom);
  const prevZoomRef = useRef(1);
  const zoomAnchorRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const progressRef = useRef<{ path: string; progress: PdfProgress } | null>(null);
  const restoreDoneRef = useRef(false);

  pathRef.current = path;
  zoomRef.current = zoom;

  // Cambio de documento: se recargan sus anotaciones y su progreso.
  useEffect(() => {
    setDoc(loadPdfDoc(path));
    restoreDoneRef.current = false;
    progressRef.current = null;
    setCurrentPage(1);
  }, [path]);

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
          // Si el zoom cambia mientras se pinta, la tarea anterior se cancela
          // en la limpieza: sin esto, dos renders pisan el mismo lienzo y lo
          // dejan corrupto (y pdf.js lanza la excepción que ve el usuario).
          const renderTask = page.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          renderTaskRef.current = renderTask;
          await renderTask.promise;
          if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
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
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pages, zoom]);

  // Las anotaciones (notas, trazos, marcapáginas y filtro) viven en
  // localStorage por archivo: el PDF en disco no se toca nunca.
  useEffect(() => {
    savePdfDoc(path, doc);
  }, [doc, path]);

  // Restauración del progreso de lectura la primera vez que hay páginas.
  useEffect(() => {
    if (status !== "ready" || pages.length === 0 || restoreDoneRef.current) return;
    restoreDoneRef.current = true;
    const progress = loadPdfProgress(path);
    if (!progress) return;

    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const canvas = canvasesRef.current[progress.page - 1];
      if (!scroller || !canvas) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const canvasRect = canvas.getBoundingClientRect();
      const pageTop = canvasRect.top - scrollerTop + scroller.scrollTop;
      scroller.scrollTop = Math.max(0, pageTop + progress.frac * canvasRect.height);
    });
    return () => cancelAnimationFrame(frame);
  }, [status, pages, path]);

  // Zoom con Ctrl + rueda (listener nativo: el de React es pasivo y no deja
  // cancelar el scroll). El punto bajo el cursor se queda quieto.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const next = Math.round(zoomRef.current * Math.exp(-event.deltaY * 0.0018) * 20) / 20;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (clamped === zoomRef.current) return;
      zoomAnchorRef.current = event.clientY;
      setZoom(clamped);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Tras cada cambio de zoom se reajusta el scroll para respetar el anclaje.
  useEffect(() => {
    const anchor = zoomAnchorRef.current;
    const prev = prevZoomRef.current;
    prevZoomRef.current = zoom;
    zoomAnchorRef.current = null;
    if (anchor === null || prev === zoom) return;
    const el = scrollerRef.current;
    if (!el) return;
    // Con el contenido aún vacío (PDF sin medir) escalar el scroll solo
    // produce una posición basura: no se ancla nada.
    if (el.scrollHeight <= el.clientHeight + 1) return;
    const relY = anchor - el.getBoundingClientRect().top;
    el.scrollTop = ((el.scrollTop + relY) * zoom) / prev - relY;
  }, [zoom]);

  // Seguimiento de la página visible + guardado (diferido) del progreso.
  function syncScrollState(): void {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const center = scrollerRect.top + scrollerRect.height / 2;
    let page = 1;
    let frac = 0;
    for (let i = 0; i < canvasesRef.current.length; i += 1) {
      const canvas = canvasesRef.current[i];
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      // La página «actual» es la que ocupa el centro del visor: al final del
      // documento la última página nunca llega al tope y, por el borde superior,
      // acabaría señalando la anterior.
      if (rect.bottom >= center) {
        page = i + 1;
        frac = Math.min(1, Math.max(-1, (scrollerRect.top - rect.top) / rect.height));
        break;
      }
    }
    setCurrentPage((current) => (current === page ? current : page));
    progressRef.current = { path: pathRef.current, progress: { page, frac } };
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null;
      const entry = progressRef.current;
      if (entry) savePdfProgress(entry.path, entry.progress);
    }, 900);
  }

  function handleScroll(): void {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      syncScrollState();
    });
  }

  // Al desmontar se suelta el progreso pendiente en disco.
  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      const entry = progressRef.current;
      if (entry) savePdfProgress(entry.path, entry.progress);
    },
    [],
  );

  // Pantalla completa: se usa la Fullscreen API sobre el propio visor (se
  // oculta toda la interfaz de la app); si el entorno la rechaza, se recurre
  // a un panel fijo a pantalla completa dentro de la app.
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  async function toggleFullscreen(): Promise<void> {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      setFallbackFs((current) => !current);
    }
  }

  // Esc: sale de pantalla completa y devuelve la mano (herramienta de lectura).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setFallbackFs((current) => (current ? false : current));
      setTool((current) => (current === "mano" ? current : "mano"));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function changeZoom(delta: number) {
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + delta) * 100) / 100)),
    );
  }

  const strokesByPage = useMemo(() => {
    const map = new Map<number, PdfStroke[]>();
    for (const stroke of doc.strokes) {
      const list = map.get(stroke.page);
      if (list) list.push(stroke);
      else map.set(stroke.page, [stroke]);
    }
    return map;
  }, [doc.strokes]);

  function commitStroke(stroke: PdfStroke): void {
    setDoc((current) => ({ ...current, strokes: [...current.strokes, stroke] }));
  }

  function eraseAt(page: number, x: number, y: number, radiusNorm: number): void {
    setDoc((current) => {
      const kept = current.strokes.filter((stroke) => {
        if (stroke.page !== page) return true;
        const size = pages[page - 1];
        if (!size) return true;
        const width = size.w * zoom;
        const height = size.h * zoom;
        return !strokeTouches(stroke, x, y, radiusNorm * width, width, height);
      });
      if (kept.length === current.strokes.length) return current;
      return { ...current, strokes: kept };
    });
  }

  function jumpToPage(page: number): void {
    const scroller = scrollerRef.current;
    const canvas = canvasesRef.current[page - 1];
    if (!scroller || !canvas) return;
    const delta = canvas.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta - 12;
  }

  function addNote(): void {
    const id = makeId();
    setDoc((current) => ({
      ...current,
      notes: [
        ...current.notes,
        { id, page: currentPage, text: "", created: Date.now() },
      ],
    }));
    setNoteFocusId(id);
  }

  function updateNote(id: string, text: string): void {
    setDoc((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === id ? { ...note, text } : note)),
    }));
  }

  function deleteNote(id: string): void {
    setDoc((current) => ({ ...current, notes: current.notes.filter((n) => n.id !== id) }));
  }

  function cycleFilter(): void {
    const index = FILTER_ORDER.indexOf(doc.filter);
    const next = FILTER_ORDER[(index + 1) % FILTER_ORDER.length];
    setDoc((current) => ({ ...current, filter: next }));
  }

  const dpr = window.devicePixelRatio || 1;
  const filterInfo = FILTER_INFO[doc.filter];
  const fsActive = fullscreen || fallbackFs;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={`Documento ${title}`}
      className={clsx(
        "gus-pdf-root flex h-full w-full min-h-0 flex-col",
        fallbackFs && "fixed inset-0 z-50 bg-gus-bg",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gus-border bg-gus-panel px-3 py-1.5 text-xs text-gus-muted">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeZoom(-ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Alejar"
            title="Alejar"
            className={ICON_BUTTON}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Restablecer al 100 % · Ctrl + rueda para el zoom"
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
            className={ICON_BUTTON}
          >
            +
          </button>
        </div>

        {pages.length > 0 && (
          <span className="border-l border-gus-border pl-2 font-mono tabular-nums">
            {currentPage}/{pages.length}
            <span className="ml-1.5 text-gus-muted">
              {pages.length} {pages.length === 1 ? "página" : "páginas"}
            </span>
          </span>
        )}

        <div className="flex items-center gap-1 border-l border-gus-border pl-2">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              aria-label={label}
              aria-pressed={tool === id}
              title={id === "mano" ? "Mano (leer y desplazar)" : `${label} — Esc vuelve a la mano`}
              className={tool === id ? ICON_BUTTON_ACTIVE : ICON_BUTTON}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>

        {(tool === "marcador" || tool === "lapiz") && (
          <div className="flex items-center gap-1.5 px-1">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setPenColor(color)}
                aria-label={`Color ${color}`}
                title="Color del trazo"
                style={{ backgroundColor: color }}
                className={clsx(
                  "h-3.5 w-3.5 rounded-full border transition-transform",
                  penColor === color
                    ? "scale-110 border-gus-text"
                    : "border-white/25 hover:scale-110",
                )}
              />
            ))}
          </div>
        )}

        {tool !== "mano" && (
          <span className="text-gus-accent/80">Dibujando · Esc vuelve a la mano</span>
        )}

        <button
          type="button"
          onClick={cycleFilter}
          aria-label={`Modo lectura: ${filterInfo.label}`}
          title={`Modo lectura: ${filterInfo.label} (clic para cambiar de filtro)`}
          className={clsx(
            "flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-gus-accent/60",
            doc.filter === "normal"
              ? "border-gus-border bg-gus-card hover:border-gus-accent/50 hover:text-gus-accent"
              : "border-gus-accent/60 bg-gus-accent/20 text-gus-accent",
          )}
        >
          <filterInfo.Icon size={13} />
          {filterInfo.label}
        </button>

        {doc.bookmark ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => jumpToPage(doc.bookmark!.page)}
              title={`Ir a la página marcada (${doc.bookmark.page})`}
              className={CHIP_BUTTON}
            >
              <Bookmark size={11} fill="currentColor" />
              pág. {doc.bookmark.page}
            </button>
            <button
              type="button"
              onClick={() => setDoc((current) => ({ ...current, bookmark: null }))}
              aria-label="Quitar marcapáginas"
              title="Quitar marcapáginas"
              className={clsx(ICON_BUTTON, "h-5 w-5")}
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDoc((current) => ({ ...current, bookmark: { page: currentPage } }))}
            aria-label={`Marcar la página ${currentPage}`}
            title={`Marcar la página ${currentPage} para no perder el progreso`}
            className={ICON_BUTTON}
          >
            <Bookmark size={13} />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNotesOpen((current) => !current)}
            aria-label={notesOpen ? "Ocultar notas del PDF" : "Mostrar notas del PDF"}
            aria-pressed={notesOpen}
            title="Notas al margen del PDF"
            className={notesOpen ? ICON_BUTTON_ACTIVE : ICON_BUTTON}
          >
            <StickyNote size={13} />
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={fsActive ? "Salir de pantalla completa" : "Pantalla completa"}
            title={fsActive ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
            className={fsActive ? ICON_BUTTON_ACTIVE : ICON_BUTTON}
          >
            {fsActive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={scrollerRef} onScroll={handleScroll} className="gus-scrollbar min-h-0 flex-1 overflow-auto bg-black/20 p-4">
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
            <div
              className="flex flex-col items-center gap-4 pb-4"
              style={{ filter: FILTER_CSS[doc.filter] }}
            >
              {pages.map((size, i) => (
                <div
                  key={i}
                  className="relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl"
                  style={{ width: size.w * zoom, height: size.h * zoom }}
                >
                  <canvas
                    ref={(element) => {
                      canvasesRef.current[i] = element;
                    }}
                    aria-label={`Página ${i + 1}`}
                    className="block h-full w-full"
                  />
                  <PageOverlay
                    page={i + 1}
                    width={size.w * zoom}
                    height={size.h * zoom}
                    dpr={dpr}
                    strokes={strokesByPage.get(i + 1) ?? EMPTY_STROKES}
                    tool={tool}
                    color={penColor}
                    onCommit={commitStroke}
                    onErase={(x, y, radiusNorm) => eraseAt(i + 1, x, y, radiusNorm)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {notesOpen && (
          <PdfNotesPanel
            notes={doc.notes}
            currentPage={currentPage}
            autoFocusId={noteFocusId}
            onAdd={addNote}
            onChange={updateNote}
            onDelete={deleteNote}
            onJump={jumpToPage}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Capa transparente sobre una página para dibujar (marcador/lápiz) y borrar.
 * Sus coordenadas se guardan normalizadas (0..1), así que el zoom solo
 * obliga a redibujar: los trazos no se mueven ni se deforman.
 */
function PageOverlay({
  page,
  width,
  height,
  dpr,
  strokes,
  tool,
  color,
  onCommit,
  onErase,
}: {
  page: number;
  width: number;
  height: number;
  dpr: number;
  strokes: PdfStroke[];
  tool: Tool;
  color: string;
  onCommit: (stroke: PdfStroke) => void;
  onErase: (x: number, y: number, radiusNorm: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<PdfStroke | null>(null);

  // Redibujado completo cuando cambian los trazos o el tamaño (zoom).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    const sized = canvas.width === w && canvas.height === h;
    // Sin trazos y sin pintar: no merece la pena reservar memoria.
    if (strokes.length === 0 && !sized) return;
    if (!sized) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const stroke of strokes) drawStroke(ctx, stroke, width, height);
  }, [strokes, width, height, dpr]);

  function pointAt(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      rectWidth: rect.width,
    };
  }

  function ensureSized(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (tool === "mano") return;
    const canvas = event.currentTarget;
    const { x, y, rectWidth } = pointAt(canvas, event);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Puntero sintético (pruebas): la captura es opcional.
    }

    if (tool === "borrador") {
      onErase(x, y, ERASE_RADIUS_PX / rectWidth);
      return;
    }

    const ctx = ensureSized(canvas);
    if (!ctx) return;
    const stroke: PdfStroke = {
      id: makeId(),
      page,
      color,
      alpha: tool === "marcador" ? 0.4 : 1,
      width: (tool === "marcador" ? MARKER_PX : PEN_PX) / rectWidth,
      points: [{ x, y }],
    };
    drawingRef.current = stroke;
    drawStroke(ctx, stroke, width, height);
    event.preventDefault();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (tool === "mano") return;
    const canvas = event.currentTarget;
    const { x, y, rectWidth } = pointAt(canvas, event);

    if (tool === "borrador") {
      if (event.buttons & 1) onErase(x, y, ERASE_RADIUS_PX / rectWidth);
      return;
    }

    const stroke = drawingRef.current;
    if (!stroke) return;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.abs(last.x - x) < 1e-5 && Math.abs(last.y - y) < 1e-5) return;
    stroke.points.push({ x, y });

    // En vivo solo se pinta el último tramo; al soltar se redibuja entero.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyStrokeStyle(ctx, stroke, width);
    ctx.beginPath();
    ctx.moveTo(last.x * width, last.y * height);
    ctx.lineTo(x * width, y * height);
    ctx.stroke();
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    const stroke = drawingRef.current;
    if (!stroke) return;
    drawingRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ver handlePointerDown.
    }
    onCommit(stroke);
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={clsx(
        "absolute inset-0 h-full w-full touch-none select-none",
        tool === "mano" && "pointer-events-none",
        (tool === "marcador" || tool === "lapiz") && "cursor-crosshair",
        tool === "borrador" && "cursor-cell",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    />
  );
}
