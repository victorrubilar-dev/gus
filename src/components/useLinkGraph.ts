import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { incomingCountMap, type LinkGraph } from "../lib/linkGraph";

type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * Grafo de enlaces del vault y el contador de enlaces entrantes por nota.
 * `refreshKey` crece cuando aparecen o desaparecen archivos; `notePath` es la
 * nota abierta.
 */
export function useLinkGraph(currentVault: string | null, refreshKey: number, notePath: string | undefined) {
  /**
   * Grafo de enlaces del vault (parseado en Rust): alimenta el panel de
   * backlinks y el contador de cada enlace [[wiki]] de la vista previa.
   */
  const [linkGraph, setLinkGraph] = useState<LinkGraph | null>(null);
  const [linkGraphStatus, setLinkGraphStatus] = useState<LoadStatus>("idle");
  const [linkGraphError, setLinkGraphError] = useState<string | null>(null);


  /**
   * Grafo de enlaces del vault: se recalcula al cambiar de vault, al abrir
   * otra nota y al crecer el contador de refresco (archivos nuevos o en la
   * papelera). El retardo evita repetir el barrido mientras se guardan varios
   * cambios seguidos.
   */
  useEffect(() => {
    if (!currentVault) {
      setLinkGraph(null);
      setLinkGraphStatus("idle");
      setLinkGraphError(null);
      return;
    }

    let cancelled = false;
    setLinkGraphStatus("loading");

    const timer = window.setTimeout(() => {
      invoke<LinkGraph>("build_link_graph", { path: currentVault })
        .then((graph) => {
          if (cancelled) return;
          setLinkGraph(graph);
          setLinkGraphStatus("ready");
          setLinkGraphError(null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // El grafo anterior se conserva: el panel sigue siendo útil aunque
          // falle la última lectura.
          setLinkGraphStatus("error");
          setLinkGraphError(String(error));
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentVault, refreshKey, notePath]);

  /** Contador por nota para cada enlace [[wiki]] de la vista previa. */
  const linkRefs = useMemo(() => incomingCountMap(linkGraph), [linkGraph]);

  return { linkGraph, linkGraphStatus, linkGraphError, linkRefs };
}
