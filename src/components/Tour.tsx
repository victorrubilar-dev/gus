import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import clsx from "clsx";
import { useT } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n/core";
import { toLocalCoord } from "../lib/uiZoom";

/** Secciones que el tour puede abrir mientras avanza. */
export type TourTab = "home" | "notes" | "tasks" | "calendar";

interface TourStep {
  /** Pestaña que se abre al llegar al paso (el resaltado vive en esa vista). */
  tab: TourTab;
  /** Atributos `data-tour` del elemento a resaltar: se usa el primero que exista. */
  targets: string[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

const STEPS: TourStep[] = [
  {
    tab: "home",
    targets: ["dashboard"],
    titleKey: "tour.welcome.title",
    bodyKey: "tour.welcome.body",
  },
  {
    tab: "home",
    targets: ["sidebar"],
    titleKey: "tour.sidebar.title",
    bodyKey: "tour.sidebar.body",
  },
  {
    tab: "notes",
    targets: ["explorer"],
    titleKey: "tour.explorer.title",
    bodyKey: "tour.explorer.body",
  },
  {
    tab: "notes",
    // Si hay una nota abierta se resalta el editor; si no, la pantalla de bienvenida.
    targets: ["editor", "welcome"],
    titleKey: "tour.editor.title",
    bodyKey: "tour.editor.body",
  },
  {
    tab: "tasks",
    targets: ["tasks"],
    titleKey: "tour.tasks.title",
    bodyKey: "tour.tasks.body",
  },
  {
    tab: "calendar",
    targets: ["calendar"],
    titleKey: "tour.calendar.title",
    bodyKey: "tour.calendar.body",
  },
  {
    tab: "home",
    targets: ["sidebar-bottom"],
    titleKey: "tour.tools.title",
    bodyKey: "tour.tools.body",
  },
  { tab: "home", targets: [], titleKey: "tour.done.title", bodyKey: "tour.done.body" },
];

/** Ancho y alto con los que se calcula el hueco que necesita la burbuja. */
const BUBBLE_WIDTH = 360;
const BUBBLE_ESTIMATE = 230;
const EDGE_MARGIN = 16;
/** La interfaz puede estar animándose al cambiar de paso: se vuelve a medir. */
const MEASURE_INTERVAL_MS = 120;

function measureTargets(targets: string[]): DOMRect | null {
  for (const target of targets) {
    const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    // Un elemento plegado o recién montado no sirve para guiar nada.
    if (rect.width >= 8 && rect.height >= 8) return rect;
  }
  return null;
}

/** Hueco para la burbuja al lado del resaltado, sin salirse de la ventana. */
function bubblePosition(rect: DOMRect | null): CSSProperties {
  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: `min(${BUBBLE_WIDTH}px, calc(100vw - ${EDGE_MARGIN * 2}px))`,
    };
  }

  // Con zoom de interfaz activo, getBoundingClientRect devuelve coordenadas en
  // espacio de pantalla (afectadas por el zoom CSS), pero el tour posiciona sus
  // elementos con position: fixed dentro del documentElement que tiene zoom aplicado.
  // Es necesario convertir a espacio local para que el resaltado coincida con el elemento.
  const localRect = {
    left: toLocalCoord(rect.left),
    top: toLocalCoord(rect.top),
    right: toLocalCoord(rect.right),
    bottom: toLocalCoord(rect.bottom),
    width: toLocalCoord(rect.width),
    height: toLocalCoord(rect.height),
  };

  const viewportWidth = toLocalCoord(window.innerWidth);
  const viewportHeight = toLocalCoord(window.innerHeight);
  const maxWidth = Math.min(BUBBLE_WIDTH, viewportWidth - EDGE_MARGIN * 2);
  const centerX = Math.min(
    viewportWidth - maxWidth / 2 - EDGE_MARGIN,
    Math.max(maxWidth / 2 + EDGE_MARGIN, localRect.left + localRect.width / 2),
  );

  // Elemento estrecho y pegado a un lado: la burbuja va en el hueco contrario.
  if (localRect.width < viewportWidth * 0.5 && localRect.left + localRect.width < viewportWidth * 0.6) {
    const left = localRect.right + EDGE_MARGIN;
    if (left + maxWidth <= viewportWidth - EDGE_MARGIN) {
      const top = Math.min(
        viewportHeight - BUBBLE_ESTIMATE - EDGE_MARGIN,
        Math.max(EDGE_MARGIN, localRect.top + localRect.height / 2 - BUBBLE_ESTIMATE / 2),
      );
      return { left, top, width: `${maxWidth}px` };
    }
  }

  // Contenido ancho (o sin sitio a los lados): debajo y, si falta, encima.
  const fitsBelow = localRect.bottom + BUBBLE_ESTIMATE + EDGE_MARGIN * 2 < viewportHeight;
  const top = fitsBelow
    ? localRect.bottom + EDGE_MARGIN
    : Math.max(EDGE_MARGIN, localRect.top - BUBBLE_ESTIMATE - EDGE_MARGIN);

  return {
    top,
    left: centerX - maxWidth / 2,
    width: `${maxWidth}px`,
  };
}

export interface TourProps {
  open: boolean;
  /** Al terminar (o al saltar): el recorrido queda como visto. */
  onFinish: () => void;
  /** Abre la pestaña que toca en cada paso. */
  onStepChange: (tab: TourTab) => void;
}

/**
 * Recorrido guiado para quien usa Gus por primera vez: resalta una parte de la
 * interfaz, explica qué se hace allí y va abriendo la pestaña correspondiente.
 * El resaltado se mide en cada fotograma para seguir la interfaz si se mueve
 * (animaciones, redimensionado o cambio de escala).
 */
export default function Tour({ open, onFinish, onStepChange }: TourProps) {
  const t = useT();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // El padre puede recrear este callback en cada render: se usa una referencia
  // para que cambiar su identidad no reinicie el recorrido por accidente.
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const goTo = useCallback((index: number) => {
    const clamped = Math.min(STEPS.length - 1, Math.max(0, index));
    setStepIndex(clamped);
    onStepChangeRef.current(STEPS[clamped].tab);
  }, []);

  // Al abrir: primer paso y foco en «Siguiente» para poder avanzar con teclado.
  // Solo al abrir: un re-render del padre no debe volver a empezar el tour.
  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    onStepChangeRef.current(STEPS[0].tab);
    const timer = window.setTimeout(() => nextButtonRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Medida continua: la interfaz puede seguir animándose al cambiar de pestaña.
  useEffect(() => {
    if (!open) return;

    const update = () => setRect(measureTargets(STEPS[stepIndex].targets));
    update();
    const interval = window.setInterval(update, MEASURE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [open, stepIndex]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onFinish();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        if (event.key === "Enter" && document.activeElement?.tagName === "BUTTON") return;
        setStepIndex((current) => {
          const next = Math.min(STEPS.length - 1, current + 1);
          onStepChangeRef.current(STEPS[next].tab);
          return next;
        });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((current) => {
          const previous = Math.max(0, current - 1);
          onStepChangeRef.current(STEPS[previous].tab);
          return previous;
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onFinish]);

  if (!open) return null;

  const style = bubblePosition(rect);

  // Con zoom de interfaz, los rects vienen en px de pantalla pero el tour se
  // posiciona dentro del documentElement escalado: se pasan a espacio local.
  const local = rect
    ? {
        top: toLocalCoord(rect.top),
        bottom: toLocalCoord(rect.bottom),
        left: toLocalCoord(rect.left),
        right: toLocalCoord(rect.right),
        width: toLocalCoord(rect.width),
        height: toLocalCoord(rect.height),
      }
    : null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t("tour.title")}>
      {/* Cuatro paneles: la ventana queda oscurecida salvo el elemento guiado. */}
      {local ? (
        <>
          <div
            aria-hidden="true"
            className="fixed bg-black/65"
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, local.top) }}
          />
          <div
            aria-hidden="true"
            className="fixed bg-black/65"
            style={{
              top: local.bottom,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            aria-hidden="true"
            className="fixed bg-black/65"
            style={{ top: local.top, left: 0, width: Math.max(0, local.left), height: local.height }}
          />
          <div
            aria-hidden="true"
            className="fixed bg-black/65"
            style={{
              top: local.top,
              left: local.right,
              right: 0,
              height: local.height,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-xl ring-2 ring-gus-accent transition-all duration-200"
            style={{ top: local.top - 3, left: local.left - 3, width: local.width + 6, height: local.height + 6 }}
          />
        </>
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/65" />
      )}

      <motion.div
        key={stepIndex}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={style}
        className="fixed rounded-2xl border border-gus-border bg-gus-panel p-4 shadow-2xl shadow-black/50"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-gus-accent uppercase">
            {t("tour.title")}
          </span>
          <span className="text-[10px] text-gus-muted tabular-nums">
            {t("tour.progress", { current: stepIndex + 1, total: STEPS.length })}
          </span>
        </div>

        <h2 className="text-sm font-semibold text-gus-text">{t(step.titleKey)}</h2>
        <p className="mt-1.5 text-xs leading-5 text-gus-muted">{t(step.bodyKey)}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {STEPS.map((entry, index) => (
              <span
                key={entry.titleKey}
                className={clsx(
                  "h-1.5 rounded-full transition-all",
                  index === stepIndex ? "w-4 bg-gus-accent" : "w-1.5 bg-gus-muted/50",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onFinish}
              className="rounded-lg px-2 py-1.5 text-xs text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
            >
              {t("tour.skip")}
            </button>

            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              aria-label={t("tour.previous")}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gus-border text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              ref={nextButtonRef}
              type="button"
              onClick={() => (isLast ? onFinish() : goTo(stepIndex + 1))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gus-accent px-3.5 py-1.5 text-xs font-semibold text-gus-bg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gus-panel"
            >
              {isLast ? t("tour.finish") : t("tour.next")}
              {isLast ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
