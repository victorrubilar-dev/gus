import { useEffect, useRef, useState } from "react";

type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    const promise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      return mermaid;
    });

    mermaidPromise = promise;
    promise.catch(() => {
      if (mermaidPromise === promise) mermaidPromise = null;
    });
  }

  return mermaidPromise;
}

let renderCounter = 0;

export interface MermaidDiagramProps {
  code: string;
}

export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"drawing" | "ready" | "error">("drawing");
  const [error, setError] = useState<string | null>(null);

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

      <div ref={hostRef} />
    </div>
  );
}
