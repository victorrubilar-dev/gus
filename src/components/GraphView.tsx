import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderTree,
  Loader2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Tag,
} from "lucide-react";
import { useT } from "../lib/i18n";
import type { LinkGraph } from "../lib/linkGraph";
import {
  DEFAULT_SIMULATION,
  MAX_GRAPH_NODES,
  buildGraphModel,
  edgeKey,
  filterGraph,
  fitView,
  graphFolders,
  graphTags,
  mulberry32,
  neighborhood,
  seedPositions,
  simulationStep,
  toGraphPoint,
  zeroVelocities,
  zoomAt,
  type GraphModelNode,
  type Point,
} from "../lib/graphLayout";

type LoadState = "loading" | "ready" | "error";

export interface GraphViewProps {
  vaultPath: string;
  /** Cambios en el vault (archivos nuevos, papelera): recalcula el grafo. */
  refreshKey?: number;
  /** Abre la nota de un nodo con clic. */
  onOpenNote: (note: { path: string; name: string }) => void;
}

const NODE_MIN_RADIUS = 3.5;
const NODE_MAX_RADIUS = 12;

/** Pasos de simulación por fotograma: más de uno asienta el mapa antes. */
const STEPS_PER_FRAME = 2;

/** Desplazamiento por debajo del cual el mapa se da por quieto. */
const SETTLED = 0.08;

/** Etiquetas siempre visibles con este grado o a partir de esta escala. */
const LABEL_DEGREE = 2;
const LABEL_SCALE = 0.8;

/** Radio de un nodo: crece con el número de conexiones, con techo. */
function nodeRadius(degree: number): number {
  return NODE_MIN_RADIUS + Math.min(NODE_MAX_RADIUS - NODE_MIN_RADIUS, degree);
}

const SELECT_CLASS =
  "rounded-lg border border-gus-border bg-gus-panel px-2 py-1 text-xs text-gus-text outline-none transition-colors focus:border-gus-accent/60";

const ZOOM_BUTTON_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-md text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70";

/**
 * Grafo interactivo de las notas del vault: nodos arrastrables, zoom y pan,
 * clic para abrir. Los enlaces vienen del grafo que parsea el backend, así
 * que aquí solo toca colocarlos y moverlos.
 */
export default function GraphView({ vaultPath, refreshKey = 0, onOpenNote }: GraphViewProps) {
  const t = useT();
  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  /** Cambia con cada «recolocar», para que la espiral arranque en otra fase. */
  const [seed, setSeed] = useState(1);
  /** Número de render: la simulación vive en refs y empuja repintados. */
  const [, setVersion] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    invoke<LinkGraph>("build_link_graph", { path: vaultPath })
      .then((result) => {
        if (cancelled) return;
        setGraph(result);
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

  const filtered = useMemo(() => filterGraph(graph, folder, tag), [graph, folder, tag]);
  const model = useMemo(() => buildGraphModel(filtered), [filtered]);
  const folders = useMemo(() => graphFolders(graph), [graph]);
  const tags = useMemo(() => graphTags(graph), [graph]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((current) => {
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        return current.width === width && current.height === height ? current : { width, height };
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const positionsRef = useRef<Map<string, Point>>(new Map());
  const velocitiesRef = useRef<Map<string, Point>>(new Map());
  /** Nodos arrastrados: se quedan donde se les dejó hasta «recolocar». */
  const pinnedPositionsRef = useRef<Map<string, Point>>(new Map());

  // Colocación inicial (y encuadre) cada vez que cambia el modelo o el tamaño.
  useEffect(() => {
    positionsRef.current = seedPositions(model.nodes, size.width, size.height, mulberry32(seed));
    velocitiesRef.current = zeroVelocities(positionsRef.current);
    pinnedPositionsRef.current.clear();
    setView(fitView(positionsRef.current, size.width, size.height));
    setVersion((version) => version + 1);
  }, [model, size.width, size.height, seed]);

  // Bucle de fuerzas: corre hasta que el mapa se queda quieto.
  useEffect(() => {
    if (model.nodes.length === 0) return;

    let alive = true;
    let frame = 0;

    const tick = () => {
      if (!alive) return;

      const center = { x: size.width / 2, y: size.height / 2 };
      let movement = 0;
      for (let step = 0; step < STEPS_PER_FRAME; step += 1) {
        movement = Math.max(
          movement,
          simulationStep(
            positionsRef.current,
            velocitiesRef.current,
            model.edges,
            center,
            DEFAULT_SIMULATION,
          ),
        );
      }

      // Lo arrastrado se queda donde está: no lo arrastra la simulación.
      for (const [id, position] of pinnedPositionsRef.current) {
        const current = positionsRef.current.get(id);
        if (current) {
          current.x = position.x;
          current.y = position.y;
        }
        const velocity = velocitiesRef.current.get(id);
        if (velocity) {
          velocity.x = 0;
          velocity.y = 0;
        }
      }

      setVersion((version) => version + 1);
      if (movement > SETTLED) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [model, size.width, size.height, seed]);

  /* ------------------------- interacción ------------------------- */

  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(
    null,
  );
  /** Distingue un clic de un arrastre: al soltar tras mover no se abre nada. */
  const movedRef = useRef(false);

  const graphPointFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return toGraphPoint(view, event.clientX - rect.left, event.clientY - rect.top);
    },
    [view],
  );

  function handleBackgroundDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    movedRef.current = false;
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleNodeDown(event: React.PointerEvent<SVGGElement>, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();

    const position = positionsRef.current.get(id);
    if (!position) return;

    const point = graphPointFromEvent(event);
    movedRef.current = false;
    dragRef.current = { id, dx: position.x - point.x, dy: position.y - point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag) {
      const position = positionsRef.current.get(drag.id);
      if (position) {
        const point = graphPointFromEvent(event);
        position.x = point.x + drag.dx;
        position.y = point.y + drag.dy;

        const velocity = velocitiesRef.current.get(drag.id);
        if (velocity) {
          velocity.x = 0;
          velocity.y = 0;
        }

        pinnedPositionsRef.current.set(drag.id, { x: position.x, y: position.y });
        movedRef.current = true;
        setVersion((version) => version + 1);
      }
      return;
    }

    const pan = panRef.current;
    if (!pan) return;

    movedRef.current = true;
    setView((current) => ({
      ...current,
      x: pan.viewX + (event.clientX - pan.startX),
      y: pan.viewY + (event.clientY - pan.startY),
    }));
  }

  function handlePointerUp() {
    dragRef.current = null;
    panRef.current = null;
  }

  function openNode(id: string) {
    if (movedRef.current) return;
    const node = model.nodes.find((entry) => entry.id === id);
    if (!node) return;
    onOpenNote({ path: id, name: node.label.split("/").pop() ?? node.label });
  }

  // Zoom con la rueda: sin preventDefault el webview se desplazaría él.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const container = element;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((current) =>
        zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top),
      );
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  function zoomBy(factor: number) {
    setView((current) => zoomAt(current, factor, size.width / 2, size.height / 2));
  }

  const positions = positionsRef.current;
  const highlight = useMemo(() => neighborhood(model, hover), [model, hover]);

  return (
    <div
      ref={containerRef}
      data-tour="graph"
      className="relative h-full w-full overflow-hidden bg-gus-bg"
    >
      <svg
        ref={svgRef}
        role="application"
        aria-label={t("graph.title")}
        className="h-full w-full touch-none select-none"
        onPointerDown={handleBackgroundDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {model.edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;

            const lit = highlight.edges.has(edgeKey(edge));
            return (
              <line
                key={edgeKey(edge)}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={lit ? "var(--color-gus-accent)" : "var(--color-gus-border)"}
                strokeWidth={lit ? 1.6 : 1}
                strokeOpacity={lit ? 0.9 : 0.65}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {model.nodes.map((node: GraphModelNode) => {
            const position = positions.get(node.id);
            if (!position) return null;

            const lit = highlight.nodes.has(node.id);
            return (
              <g
                key={node.id}
                onPointerDown={(event) => handleNodeDown(event, node.id)}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover((current) => (current === node.id ? null : current))}
                onClick={() => openNode(node.id)}
                className="cursor-pointer"
              >
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={nodeRadius(node.degree)}
                  fill={lit ? "var(--color-gus-accent)" : "var(--color-gus-muted)"}
                  stroke="var(--color-gus-bg)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <title>{node.label}</title>
              </g>
            );
          })}
        </g>

        {/* Las etiquetas no escalan: se pintan ya en coordenadas de pantalla. */}
        <g>
          {model.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;

            const lit = highlight.nodes.has(node.id);
            const showLabel = lit || node.degree >= LABEL_DEGREE || view.scale >= LABEL_SCALE;
            if (!showLabel) return null;

            return (
              <text
                key={node.id}
                x={position.x * view.scale + view.x}
                y={position.y * view.scale + view.y - nodeRadius(node.degree) * view.scale - 5}
                textAnchor="middle"
                className="pointer-events-none select-none"
                style={{
                  fontSize: 11,
                  fill: lit ? "var(--color-gus-accent)" : "var(--color-gus-text)",
                  opacity: lit ? 1 : 0.75,
                }}
              >
                {node.label}
              </text>
            );
          })}
        </g>
      </svg>

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-gus-muted">
          <Loader2 className="h-4 w-4 animate-spin text-gus-accent" aria-hidden="true" />
          {t("graph.loading")}
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-rose-300">
          <p role="alert">{error ?? t("graph.error")}</p>
        </div>
      )}

      {status === "ready" && model.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gus-muted">
          {graph && graph.nodes.length > 0 ? t("graph.emptyFiltered") : t("graph.empty")}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-gus-border bg-gus-panel/95 px-3 py-1.5 shadow-lg shadow-black/20">
          <Network className="h-3.5 w-3.5 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs font-semibold text-gus-text">{t("graph.title")}</span>
          <span className="text-[11px] text-gus-muted">
            {t("graph.nodes", { count: model.nodes.length })}
            {" · "}
            {t("graph.edges", { count: model.edges.length })}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <FolderTree className="h-3.5 w-3.5 text-gus-muted" aria-hidden="true" />
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              aria-label={t("graph.filterFolder")}
              className={SELECT_CLASS}
            >
              <option value="">{t("graph.allFolders")}</option>
              {folders.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-gus-muted" aria-hidden="true" />
            <select
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              aria-label={t("graph.filterTag")}
              className={SELECT_CLASS}
            >
              <option value="">{t("graph.allTags")}</option>
              {tags.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="pointer-events-auto ml-auto flex items-center gap-1 rounded-xl border border-gus-border bg-gus-panel/95 px-1.5 py-1 shadow-lg shadow-black/20">
          <button
            type="button"
            title={t("graph.zoomOut")}
            aria-label={t("graph.zoomOut")}
            onClick={() => zoomBy(0.8)}
            className={ZOOM_BUTTON_CLASS}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            title={t("graph.zoomReset")}
            aria-label={t("graph.zoomReset")}
            onClick={() => setView(fitView(positions, size.width, size.height))}
            className="rounded-md px-1.5 text-[11px] tabular-nums text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            title={t("graph.zoomIn")}
            aria-label={t("graph.zoomIn")}
            onClick={() => zoomBy(1.25)}
            className={ZOOM_BUTTON_CLASS}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-gus-border" />
          <button
            type="button"
            title={t("graph.relayout")}
            aria-label={t("graph.relayout")}
            onClick={() => setSeed((current) => current + 1)}
            className={ZOOM_BUTTON_CLASS}
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 p-3 text-center">
        {graph && graph.nodes.length > MAX_GRAPH_NODES && (
          <p className="rounded-full border border-gus-border bg-gus-panel/90 px-3 py-1 text-[11px] text-gus-muted">
            {t("graph.truncated", { count: MAX_GRAPH_NODES })}
          </p>
        )}
        <p className="rounded-full border border-gus-border bg-gus-panel/90 px-3 py-1 text-[11px] text-gus-muted">
          {t("graph.hint")}
        </p>
      </div>
    </div>
  );
}
