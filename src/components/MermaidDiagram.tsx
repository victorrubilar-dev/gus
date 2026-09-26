/** Diagrama Mermaid dentro de la vista previa (```mermaid).
 *
 * La librería pesada se descarga solo cuando hay un diagrama que dibujar: el
 * primer render trae el módulo y los estilos del tema oscuro de Gus van por el
 * propio SVG.
 */

import { useEffect, useRef, useState } from "react";

/** Tipo del módulo por defecto de `mermaid` (sin importarlo al arrancar). */
type MermaidApi = (typeof import("mermaid"))["default"];

/** Carga diferida: una sola promesa para todo el proceso. */
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    const promise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      return mermaid;
    });

    mermaidPromise = promise;
    // Si la descarga falla, el siguiente intento vuelve a pedirla.
    promise.catch(() => {
      if (mermaidPromise === promise) mermaidPromise = null;
    });
  }

  return mermaidPromise;
}

/** Contador para que cada render use un id distinto (evita colisiones). */
let renderCounter = 0;

export interface MermaidDiagramProps {
  /** Código fuente del diagrama (el interior del bloque `mermaid`). */
  code: string;
}

export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"drawing" | "ready" | "error">("drawing");
  const [error, setError] = useState<string | null>(null);

  /**
   * Código con calma: la vista en vivo re-renderiza con cada tecleo, así que
   * el diagrama solo se vuelve a dibujar cuando la escritura se detiene.
   * (En el primer render `renderCode` ya es el código: no se espera nada.)
   */
  const [renderCode, setRenderCode] = useState(code);

  useEffect(() => {
    const timer = setTimeout(() => setRenderCode(code), 250);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const renderId = `gus-mermaid-${++renderCounter}`;
    setStatus("drawing");
    setError(null);

    loadMermaid()
      .then(async (mermaid) => {
        const { svg } = await mermaid.render(renderId, renderCode);
        if (cancelled) return;
        host.innerHTML = svg;
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        // Mermaid puede dejar un contenedor temporal detrás del error.
        document.getElementById(renderId)?.remove();
        document.getElementById(`d${renderId}`)?.remove();
        if (cancelled) return;
        setError(String(reason));
        setStatus("error");
      });

    return () => {
      cancelled = true;
      host.innerHTML = "";
    };
  }, [renderCode]);

  return (
    <div className="gus-mermaid">
      {status === "drawing" && (
        <p className="text-xs text-gus-muted">Dibujando el diagrama…</p>
      )}

      {status === "error" && (
        <div className="flex flex-col gap-1 rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-[11px] text-rose-300">
          <span>No se pudo dibujar el diagrama.</span>
          {error && <span className="font-mono break-all">{error}</span>}
        </div>
      )}

      {/* El SVG se inyecta aquí (React no le pone hijos, no hay conflicto). */}
      <div ref={hostRef} />
    </div>
  );
}
