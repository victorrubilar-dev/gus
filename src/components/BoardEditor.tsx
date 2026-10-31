import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowUpRight,
  Circle,
  Diamond,
  Download,
  Eraser,
  Hand,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Paintbrush,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import BoardImagePicker from "./BoardImagePicker";
import { useT } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n/core";
import {
  bounds,
  boxFrom,
  EMPTY_HISTORY,
  eraseAt,
  handlePoint,
  INK_COLORS,
  NOTE_COLORS,
  parseBoard,
  recordChange,
  redo,
  resizeTo,
  serializeBoard,
  topmostAt,
  toWorld,
  translate,
  undo,
  zoomAt,
  type BoardElement,
  type History,
  type Point,
  type View,
} from "../lib/board";
import { renderBoardSvg } from "../lib/boardSvg";
import { bytesToBase64, EXPORT_BACKGROUND, EXPORT_PALETTE, svgToPng, utf8ToBase64 } from "../lib/boardExport";
import { joinPath, safeFileName } from "../lib/fileName";
import type { VaultImage } from "../lib/imageLinks";
import { createTaskId } from "../lib/taskStore";

type Tool = "select" | "hand" | "pen" | "eraser" | "rect" | "ellipse" | "diamond" | "line" | "arrow" | "text" | "note" | "image";

const TOOLS: { id: Tool; Icon: LucideIcon; labelKey: MessageKey; key: string }[] = [
  { id: "select", Icon: MousePointer2, labelKey: "boards.tool.select", key: "v" },
  { id: "hand", Icon: Hand, labelKey: "boards.tool.hand", key: "h" },
  { id: "pen", Icon: Pencil, labelKey: "boards.tool.pen", key: "p" },
  { id: "eraser", Icon: Eraser, labelKey: "boards.tool.eraser", key: "e" },
  { id: "rect", Icon: Square, labelKey: "boards.tool.rect", key: "r" },
  { id: "ellipse", Icon: Circle, labelKey: "boards.tool.ellipse", key: "o" },
  { id: "diamond", Icon: Diamond, labelKey: "boards.tool.diamond", key: "d" },
  { id: "line", Icon: Minus, labelKey: "boards.tool.line", key: "l" },
  { id: "arrow", Icon: ArrowUpRight, labelKey: "boards.tool.arrow", key: "a" },
  { id: "text", Icon: Type, labelKey: "boards.tool.text", key: "t" },
  { id: "note", Icon: StickyNote, labelKey: "boards.tool.note", key: "n" },
  { id: "image", Icon: ImageIcon, labelKey: "boards.tool.image", key: "i" },
];

const SHAPE_TOOLS = new Set<Tool>(["rect", "ellipse", "diamond", "line", "arrow"]);
const SAVE_DELAY_MS = 800;
const HANDLE = 10;
const HIT_TOLERANCE = 6;
const PEN_WIDTH = 3;
/** Alcance de la goma en píxeles de pantalla; en el lienzo se divide por el zoom. */
const ERASER_RADIUS = 10;
const NOTE_SIZE = { w: 180, h: 140 };
const NOTE_TEXT = "#1f2937";
const MAX_IMAGE_SIDE = 400;

type Gesture =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "move"; start: Point; orig: BoardElement; before: BoardElement[] }
  | { kind: "resize"; orig: BoardElement; before: BoardElement[] }
  | { kind: "draw"; start: Point }
  /** Pasada de goma: `erased` pasa a true si quitó algo, y entonces se anota un solo paso de deshacer. */
  | { kind: "erase"; before: BoardElement[]; last: Point; erased: boolean }
  /** Texto o post-it: el editor se abre al soltar, porque al pulsar el navegador aún está moviendo el foco. */
  | { kind: "place"; el: Extract<BoardElement, { type: "text" | "note" }> };

/**
 * Punto del lienzo, en píxeles locales del SVG, bajo un evento. La interfaz se
 * escala con `zoom` en `<html>`: eventos y rects llegan en px de pantalla y el
 * SVG vive en px locales. La razón se mide (rect / ancho de layout) en vez de
 * suponerla, así vale en cualquier motor.
 */
function localPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const rect = svg.getBoundingClientRect();
  const layoutWidth = svg.parentElement?.offsetWidth ?? 0;
  const ratio = layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
  return [(clientX - rect.left) / ratio, (clientY - rect.top) / ratio];
}

function arrowHead(el: { x1: number; y1: number; x2: number; y2: number }): string {
  const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
  const size = 14;
  const wing = (delta: number) =>
    `${el.x2 - size * Math.cos(angle + delta)},${el.y2 - size * Math.sin(angle + delta)}`;
  return `${el.x2},${el.y2} ${wing(0.45)} ${wing(-0.45)}`;
}

function ElementShape({ el, images }: { el: BoardElement; images: Record<string, string> }) {
  const stroke = el.type === "image" ? undefined : el.color;
  const line = { style: { stroke }, strokeWidth: 2, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

  switch (el.type) {
    case "pen":
      return (
        <path
          d={`M ${el.points.map(([x, y]) => `${x} ${y}`).join(" L ")}${el.points.length === 1 ? " l 0.01 0" : ""}`}
          {...line}
          strokeWidth={el.width}
        />
      );
    case "rect":
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={6} {...line} style={{ stroke, fill: el.fill ? el.color : "none", fillOpacity: 0.18 }} />;
    case "ellipse":
      return <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2} {...line} style={{ stroke, fill: el.fill ? el.color : "none", fillOpacity: 0.18 }} />;
    case "diamond":
      return (
        <polygon
          points={`${el.x + el.w / 2},${el.y} ${el.x + el.w},${el.y + el.h / 2} ${el.x + el.w / 2},${el.y + el.h} ${el.x},${el.y + el.h / 2}`}
          {...line}
          style={{ stroke, fill: el.fill ? el.color : "none", fillOpacity: 0.18 }}
        />
      );
    case "line":
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...line} />;
    case "arrow":
      return (
        <g>
          <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...line} />
          <polygon points={arrowHead(el)} style={{ fill: el.color, stroke: el.color }} strokeWidth={1} strokeLinejoin="round" />
        </g>
      );
    case "text":
      return (
        <text x={el.x} y={el.y} fontSize={el.size} style={{ fill: el.color }} className="select-none">
          {el.text.split("\n").map((row, i) => (
            <tspan key={i} x={el.x} y={el.y + el.size * (0.95 + i * 1.3)}>
              {row || " "}
            </tspan>
          ))}
        </text>
      );
    case "note":
      return (
        <g>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4} style={{ fill: el.color, filter: "drop-shadow(0 3px 5px rgba(0,0,0,.3))" }} />
          <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
            <div className="h-full w-full overflow-hidden p-2.5 text-sm break-words whitespace-pre-wrap" style={{ color: NOTE_TEXT }}>
              {el.text}
            </div>
          </foreignObject>
        </g>
      );
    case "image": {
      const href = images[el.src];
      return href ? (
        <image href={href} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="none" />
      ) : (
        <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="none" strokeDasharray="6 4" style={{ stroke: "var(--color-gus-muted)" }} />
      );
    }
  }
}

export interface BoardEditorProps {
  vaultPath: string;
  boardId: string;
  onBack: () => void;
}

/** Lienzo de una pizarra (REQ-03): dibujo a mano, formas, flechas, texto, post-it e imágenes del vault. */
export default function BoardEditor({ vaultPath, boardId, onBack }: BoardEditorProps) {
  const t = useT();
  const fallbackName = t("boards.untitled");
  const [name, setName] = useState(fallbackName);
  const [elements, setElements] = useState<BoardElement[]>([]);
  const [loaded, setLoaded] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [paper, setPaper] = useState(NOTE_COLORS[0]);
  const [fill, setFill] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BoardElement | null>(null);
  /** Texto o post-it en edición; `isNew` aún no está en `elements`. */
  const [editing, setEditing] = useState<{ el: Extract<BoardElement, { type: "text" | "note" }>; isNew: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const draftRef = useRef<BoardElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Copia de trabajo durante la pasada de goma: varios eventos pueden llegar antes de repintar. */
  const elementsRef = useRef(elements);
  useEffect(() => {
    elementsRef.current = elements;
  });
  const [eraserAt, setEraserAt] = useState<Point | null>(null);

  /* ------------------------- carga y guardado ------------------------- */

  useEffect(() => {
    let cancelled = false;
    invoke<string>("load_board", { vaultPath, id: boardId })
      .then((json) => {
        if (cancelled) return;
        const board = parseBoard(json, fallbackName);
        setName(board.name);
        setElements(board.elements);
        setLoaded("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(String(reason));
        setLoaded("error");
      });
    return () => {
      cancelled = true;
    };
    // `fallbackName` cambia con el idioma, no debe recargar la pizarra abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, boardId]);

  useEffect(() => {
    if (!dirty || loaded !== "ready") return;
    const timer = window.setTimeout(() => {
      invoke("save_board", { vaultPath, id: boardId, json: serializeBoard({ name, elements }) })
        .then(() => setDirty(false))
        .catch((reason: unknown) => setError(String(reason)));
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, loaded, name, elements, vaultPath, boardId]);

  // Imágenes: se piden al vault las que la pizarra usa y aún no están en memoria.
  useEffect(() => {
    for (const el of elements) {
      if (el.type !== "image" || el.src in images) continue;
      setImages((current) => ({ ...current, [el.src]: "" })); // marca «pidiendo»
      invoke<string>("read_vault_image", { path: joinPath(vaultPath, el.src) })
        .then((href) => setImages((current) => ({ ...current, [el.src]: href })))
        .catch(() => {
          // Imagen movida o borrada: el hueco punteado la sustituye.
        });
    }
  }, [elements, images, vaultPath]);

  /* ---------------------------- cambios ---------------------------- */

  /** Aplica un cambio completo (no un arrastre en curso) y lo anota para deshacer. */
  function commit(next: BoardElement[]) {
    setHistory((current) => recordChange(current, elements));
    setElements(next);
    setDirty(true);
  }

  function replace(id: string, change: (el: BoardElement) => BoardElement) {
    commit(elements.map((el) => (el.id === id ? change(el) : el)));
  }

  function removeSelected() {
    if (!selectedId) return;
    commit(elements.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }

  function handleUndo() {
    const result = undo(history, elements);
    if (!result) return;
    setHistory(result.history);
    setElements(result.elements);
    setSelectedId(null);
    setDirty(true);
  }

  function handleRedo() {
    const result = redo(history, elements);
    if (!result) return;
    setHistory(result.history);
    setElements(result.elements);
    setSelectedId(null);
    setDirty(true);
  }

  function finishEditing() {
    if (!editing) return;
    const text = textareaRef.current?.value ?? editing.el.text;
    const { el, isNew } = editing;
    setEditing(null);

    if (isNew) {
      if (text.trim()) {
        commit([...elements, { ...el, text } as BoardElement]);
        setSelectedId(el.id);
      }
    } else if (!text.trim()) {
      commit(elements.filter((other) => other.id !== el.id));
      setSelectedId(null);
    } else if (text !== el.text) {
      replace(el.id, (current) => ({ ...current, text }) as BoardElement);
    }
  }

  async function placeImage(image: VaultImage) {
    setPicking(false);
    try {
      const href = await invoke<string>("read_vault_image", { path: image.path });
      const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const probe = new Image();
        probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
        probe.onerror = () => reject(new Error("imagen no legible"));
        probe.src = href;
      });
      const fit = Math.min(1, MAX_IMAGE_SIDE / Math.max(size.w, size.h));
      const svg = svgRef.current;
      const [cx, cy] = svg
        ? toWorld(view, svg.parentElement!.offsetWidth / 2, svg.parentElement!.offsetHeight / 2)
        : [0, 0];
      const el: BoardElement = {
        type: "image",
        id: createTaskId(),
        src: image.relative,
        w: Math.round(size.w * fit),
        h: Math.round(size.h * fit),
        x: Math.round(cx - (size.w * fit) / 2),
        y: Math.round(cy - (size.h * fit) / 2),
      };
      setImages((current) => ({ ...current, [image.relative]: href }));
      commit([...elements, el]);
      setSelectedId(el.id);
    } catch (reason) {
      setError(String(reason));
    }
    setTool("select");
  }

  /* ----------------------------- gestos ----------------------------- */

  function pointOf(event: { clientX: number; clientY: number }): { screen: Point; world: Point } {
    const svg = svgRef.current;
    const screen: Point = svg ? localPoint(svg, event.clientX, event.clientY) : [0, 0];
    return { screen, world: toWorld(view, screen[0], screen[1]) };
  }

  function setDraftBoth(next: BoardElement | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (editing) return; // el blur del textarea ya cierra la edición
    const { screen, world } = pointOf(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "hand" || spaceHeld || event.button === 1) {
      gestureRef.current = { kind: "pan", sx: screen[0], sy: screen[1], view };
      return;
    }

    const tolerance = HIT_TOLERANCE / view.scale;

    if (tool === "select") {
      const selected = elements.find((el) => el.id === selectedId);
      const handle = selected && handlePoint(selected);
      if (selected && handle && Math.hypot(world[0] - handle[0], world[1] - handle[1]) <= HANDLE / view.scale) {
        gestureRef.current = { kind: "resize", orig: selected, before: elements };
        return;
      }
      const hit = topmostAt(elements, world, tolerance);
      setSelectedId(hit?.id ?? null);
      gestureRef.current = hit
        ? { kind: "move", start: world, orig: hit, before: elements }
        : { kind: "pan", sx: screen[0], sy: screen[1], view };
      return;
    }

    setSelectedId(null);
    const id = createTaskId();

    if (tool === "eraser") {
      gestureRef.current = { kind: "erase", before: elements, last: world, erased: false };
      eraseStep(gestureRef.current, world);
      return;
    }

    if (tool === "text") {
      gestureRef.current = { kind: "place", el: { type: "text", id, color: ink, x: world[0], y: world[1], text: "", size: 20 } };
      return;
    }
    if (tool === "note") {
      gestureRef.current = {
        kind: "place",
        el: { type: "note", id, color: paper, x: world[0] - NOTE_SIZE.w / 2, y: world[1] - NOTE_SIZE.h / 2, ...NOTE_SIZE, text: "" },
      };
      return;
    }
    if (tool === "image") return;

    gestureRef.current = { kind: "draw", start: world };
    if (tool === "pen") {
      setDraftBoth({ type: "pen", id, color: ink, width: PEN_WIDTH, points: [world] });
    } else if (tool === "line" || tool === "arrow") {
      setDraftBoth({ type: tool, id, color: ink, x1: world[0], y1: world[1], x2: world[0], y2: world[1] });
    } else if (SHAPE_TOOLS.has(tool)) {
      setDraftBoth({ type: tool as "rect", id, color: ink, x: world[0], y: world[1], w: 0, h: 0, fill });
    }
  }

  /** Quita lo que la goma toca en `p`, sobre la copia de trabajo, y repinta si cambió algo. */
  function eraseStep(gesture: Extract<Gesture, { kind: "erase" }>, p: Point) {
    const next = eraseAt(elementsRef.current, p, ERASER_RADIUS / view.scale);
    if (next === elementsRef.current) return;
    elementsRef.current = next;
    gesture.erased = true;
    setElements(next);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === "eraser") setEraserAt(pointOf(event).world);
    const gesture = gestureRef.current;
    if (!gesture) return;
    const { screen, world } = pointOf(event);

    switch (gesture.kind) {
      case "pan":
        setView({ ...gesture.view, x: gesture.view.x + screen[0] - gesture.sx, y: gesture.view.y + screen[1] - gesture.sy });
        break;
      case "move": {
        const moved = translate(gesture.orig, world[0] - gesture.start[0], world[1] - gesture.start[1]);
        setElements(gesture.before.map((el) => (el.id === moved.id ? moved : el)));
        break;
      }
      case "resize": {
        const resized = resizeTo(gesture.orig, world);
        setElements(gesture.before.map((el) => (el.id === resized.id ? resized : el)));
        break;
      }
      case "erase": {
        // Un movimiento rápido salta de un punto a otro: se recorre el tramo para no dejar trazos finos sin borrar.
        const spacing = ERASER_RADIUS / view.scale / 2;
        const distance = Math.hypot(world[0] - gesture.last[0], world[1] - gesture.last[1]);
        const steps = Math.max(1, Math.ceil(distance / spacing));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          eraseStep(gesture, [gesture.last[0] + (world[0] - gesture.last[0]) * t, gesture.last[1] + (world[1] - gesture.last[1]) * t]);
        }
        gesture.last = world;
        break;
      }
      case "draw": {
        const current = draftRef.current;
        if (!current) break;
        if (current.type === "pen") {
          const last = current.points[current.points.length - 1];
          if (Math.hypot(world[0] - last[0], world[1] - last[1]) * view.scale < 2) break;
          setDraftBoth({ ...current, points: [...current.points, world] });
        } else if (current.type === "line" || current.type === "arrow") {
          setDraftBoth({ ...current, x2: world[0], y2: world[1] });
        } else if (current.type === "rect" || current.type === "ellipse" || current.type === "diamond") {
          setDraftBoth({ ...current, ...boxFrom(gesture.start, world) });
        }
        break;
      }
    }
  }

  function onPointerUp() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;

    if (gesture.kind === "move" || gesture.kind === "resize") {
      // El arrastre ya movió `elements`; aquí solo se anota para deshacer.
      if (elements !== gesture.before && elements.some((el, i) => el !== gesture.before[i])) {
        setHistory((current) => recordChange(current, gesture.before));
        setDirty(true);
      }
      return;
    }

    if (gesture.kind === "erase") {
      if (gesture.erased) {
        setHistory((current) => recordChange(current, gesture.before));
        setDirty(true);
      }
      return;
    }

    if (gesture.kind === "place") {
      setEditing({ el: gesture.el, isNew: true });
      return;
    }

    if (gesture.kind !== "draw") return;
    const finished = draftRef.current;
    setDraftBoth(null);
    if (!finished) return;

    const box = bounds(finished);
    const tooSmall = finished.type !== "pen" && box.w < 4 && box.h < 4;
    if (tooSmall) return;

    commit([...elements, finished]);
    if (finished.type !== "pen") {
      setSelectedId(finished.id);
      setTool("select");
    }
  }

  function startEditing(event: ReactPointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    if (tool !== "select") return;
    const { world } = pointOf(event);
    const hit = topmostAt(elements, world, HIT_TOLERANCE / view.scale);
    if (hit && (hit.type === "text" || hit.type === "note")) setEditing({ el: hit, isNew: false });
  }

  // La rueda hace zoom hacia el cursor. Se registra a mano: React la trata como
  // pasiva y no dejaría evitar que se desplace la página.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const [sx, sy] = localPoint(svg, event.clientX, event.clientY);
      setView((current) => zoomAt(current, event.deltaY < 0 ? 1.1 : 1 / 1.1, sx, sy));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [loaded]);

  // Atajos: no se activan mientras se escribe en un campo.
  const onKeyEvent = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === " ") {
      event.preventDefault();
      setSpaceHeld(event.type === "keydown");
      return;
    }
    if (event.type !== "keydown") return;

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      handleRedo();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      removeSelected();
    } else if (event.key === "Escape") {
      setSelectedId(null);
      setTool("select");
    } else if (!mod && !event.altKey) {
      const match = TOOLS.find((candidate) => candidate.key === event.key.toLowerCase());
      if (match) pickTool(match.id);
    }
  };
  const keyHandlerRef = useRef(onKeyEvent);
  useEffect(() => {
    keyHandlerRef.current = onKeyEvent;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", handler);
    };
  }, []);

  // El menú de exportar se cierra al pulsar fuera de él.
  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && exportRef.current?.contains(event.target)) return;
      setExportOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [exportOpen]);

  /* ---------------------------- exportar ---------------------------- */

  /** Guarda toda la pizarra (no solo lo que se ve) como imagen: SVG vectorial o PNG. */
  async function exportBoard(format: "svg" | "png") {
    setExportOpen(false);
    setError(null);
    setNotice(null);

    const drawn = renderBoardSvg(elements, { palette: EXPORT_PALETTE, images, background: EXPORT_BACKGROUND });
    if (!drawn) {
      setError(t("boards.exportEmpty"));
      return;
    }

    try {
      const target = await save({
        title: t("boards.exportTitle"),
        defaultPath: `${safeFileName(name)}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!target) return;

      const data = format === "svg" ? utf8ToBase64(drawn.svg) : bytesToBase64(await svgToPng(drawn));
      await invoke("write_image_file", { path: target, data, format });
      setNotice(t("boards.exported"));
    } catch (reason) {
      setError(t("boards.exportError", { error: String(reason) }));
    }
  }

  function pickTool(next: Tool) {
    setTool(next);
    if (next === "image") setPicking(true);
    if (next !== "select") setSelectedId(null);
  }

  /* ----------------------------- dibujo ----------------------------- */

  const selected = elements.find((el) => el.id === selectedId) ?? null;
  const swatches = tool === "note" || selected?.type === "note" ? NOTE_COLORS : INK_COLORS;
  const activeColor = tool === "note" || selected?.type === "note" ? (selected?.type === "note" ? selected.color : paper) : selected && selected.type !== "image" ? selected.color : ink;
  const showFill = SHAPE_TOOLS.has(tool) && tool !== "line" && tool !== "arrow";
  const selectedBox = selected ? bounds(selected) : null;
  const selectedHandle = selected ? handlePoint(selected) : null;

  function pickColor(color: string) {
    if (tool === "note" || selected?.type === "note") {
      setPaper(color);
      if (selected?.type === "note") replace(selected.id, (el) => ({ ...el, color }) as BoardElement);
    } else {
      setInk(color);
      if (selected && selected.type !== "image") replace(selected.id, (el) => ({ ...el, color }) as BoardElement);
    }
  }

  const toolbarButton = "gus-btn gus-btn-icon";

  return (
    <section data-tour="boards" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-gus-border bg-gus-panel px-3 py-2">
        <button type="button" onClick={onBack} className="gus-btn gus-btn-secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("boards.back")}
        </button>
        <input
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
            setDirty(true);
          }}
          aria-label={t("boards.name")}
          className="min-w-0 max-w-64 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-gus-text outline-none hover:border-gus-border focus:border-gus-accent/60"
        />

        <div role="toolbar" aria-label={t("boards.tools")} className="flex flex-wrap items-center gap-1">
          {TOOLS.map(({ id, Icon, labelKey, key }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={`${t(labelKey)} (${key.toUpperCase()})`}
              aria-label={t(labelKey)}
              onClick={() => pickTool(id)}
              className={clsx(toolbarButton, tool === id && "border-gus-accent/50 bg-gus-accent/15 text-gus-accent")}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
        </div>

        <div role="group" aria-label={t("boards.colors")} className="flex items-center gap-1">
          {swatches.map((color) => (
            <button
              key={color}
              type="button"
              aria-pressed={activeColor === color}
              aria-label={color}
              onClick={() => pickColor(color)}
              className={clsx("h-5 w-5 rounded-full border border-gus-border", activeColor === color && "ring-2 ring-gus-accent")}
              style={{ background: color }}
            />
          ))}
          {showFill && (
            <button
              type="button"
              aria-pressed={fill}
              title={t("boards.fill")}
              aria-label={t("boards.fill")}
              onClick={() => setFill(!fill)}
              className={clsx(toolbarButton, fill && "border-gus-accent/50 bg-gus-accent/15 text-gus-accent")}
            >
              <Paintbrush className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div ref={exportRef} className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              title={t("boards.export")}
              aria-label={t("boards.export")}
              className={toolbarButton}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
            {exportOpen && (
              <div role="menu" aria-label={t("boards.export")} className="absolute right-0 z-30 mt-1.5 w-60 overflow-hidden rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl">
                {(["svg", "png"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => void exportBoard(format)}
                    className="flex w-full items-center px-3 py-1.5 text-left text-body text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {t(format === "svg" ? "boards.exportSvg" : "boards.exportPng")}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={handleUndo} disabled={history.past.length === 0} title={t("boards.undo")} aria-label={t("boards.undo")} className={toolbarButton}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={handleRedo} disabled={history.future.length === 0} title={t("boards.redo")} aria-label={t("boards.redo")} className={toolbarButton}>
            <Redo2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={removeSelected} disabled={!selected} title={t("boards.deleteSelected")} aria-label={t("boards.deleteSelected")} className={toolbarButton}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setView({ x: 0, y: 0, scale: 1 })} title={t("boards.resetView")} className="gus-btn gus-btn-secondary tabular-nums">
            {Math.round(view.scale * 100)}%
          </button>
        </div>
      </header>

      {error && <p className="break-words border-b border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">{error}</p>}
      {notice && (
        <p role="status" className="border-b border-gus-accent/30 bg-gus-accent/10 px-3 py-2 text-body text-gus-accent">
          {notice}
        </p>
      )}

      <div
        className="gus-board relative min-h-0 flex-1 overflow-hidden bg-gus-bg select-none"
        onDragStart={(event) => event.preventDefault()}
        style={{
          backgroundImage: "radial-gradient(var(--color-gus-border) 1px, transparent 1px)",
          backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        {loaded === "loading" && <p className="p-4 text-body text-gus-muted">{t("common.loading")}</p>}

        {loaded === "ready" && (
          <svg
            ref={svgRef}
            role="img"
            aria-label={name}
            className={clsx(
              "h-full w-full touch-none outline-none",
              tool === "hand" || spaceHeld ? "cursor-grab" : tool === "select" ? "cursor-default" : "cursor-crosshair",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setEraserAt(null)}
            onDoubleClick={startEditing}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              {elements.map((el) =>
                editing && !editing.isNew && editing.el.id === el.id ? null : (
                  <ElementShape key={el.id} el={el} images={images} />
                ),
              )}
              {draft && <ElementShape el={draft} images={images} />}
              {tool === "eraser" && eraserAt && (
                <circle
                  cx={eraserAt[0]}
                  cy={eraserAt[1]}
                  r={ERASER_RADIUS / view.scale}
                  fill="none"
                  strokeWidth={1.5 / view.scale}
                  pointerEvents="none"
                  style={{ stroke: "var(--color-gus-muted)" }}
                />
              )}
              {selectedBox && !editing && (
                <g pointerEvents="none">
                  <rect
                    x={selectedBox.x - 4}
                    y={selectedBox.y - 4}
                    width={selectedBox.w + 8}
                    height={selectedBox.h + 8}
                    fill="none"
                    strokeDasharray="5 4"
                    strokeWidth={1.5 / view.scale}
                    style={{ stroke: "var(--color-gus-accent)" }}
                  />
                  {selectedHandle && (
                    <rect
                      x={selectedHandle[0] - HANDLE / 2 / view.scale}
                      y={selectedHandle[1] - HANDLE / 2 / view.scale}
                      width={HANDLE / view.scale}
                      height={HANDLE / view.scale}
                      rx={2 / view.scale}
                      style={{ fill: "var(--color-gus-accent)" }}
                    />
                  )}
                </g>
              )}
            </g>
          </svg>
        )}

        {editing && (
          <textarea
            ref={textareaRef}
            autoFocus
            defaultValue={editing.el.text}
            aria-label={t("boards.editText")}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === "Escape") event.currentTarget.blur();
            }}
            className="absolute resize-none overflow-hidden rounded-md border border-gus-accent/60 bg-gus-panel/90 p-1 leading-[1.3] outline-none"
            style={(() => {
              const box = bounds(editing.el);
              const isNote = editing.el.type === "note";
              return {
                left: view.x + box.x * view.scale,
                top: view.y + box.y * view.scale,
                width: Math.max(isNote ? box.w * view.scale : 160, 60),
                height: Math.max(isNote ? box.h * view.scale : box.h * view.scale + 8, 28),
                fontSize: (isNote ? 14 : editing.el.type === "text" ? editing.el.size : 14) * view.scale,
                color: isNote ? NOTE_TEXT : editing.el.color,
                background: isNote ? editing.el.color : undefined,
              };
            })()}
          />
        )}

        {picking && (
          <BoardImagePicker
            vaultPath={vaultPath}
            onPick={(image) => void placeImage(image)}
            onClose={() => {
              setPicking(false);
              setTool("select");
            }}
          />
        )}
      </div>
    </section>
  );
}
