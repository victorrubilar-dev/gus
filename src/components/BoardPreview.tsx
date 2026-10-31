import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PenTool } from "lucide-react";
import { useT } from "../lib/i18n";
import { parseBoard } from "../lib/board";
import { renderBoardSvg } from "../lib/boardSvg";
import { svgDataUrl, themePalette } from "../lib/boardExport";

interface BoardPreviewProps {
  vaultPath: string;
  id: string;
  /** Cambia cuando la pizarra se guarda: la miniatura se vuelve a pedir. */
  version: number | null;
}

/** Miniatura del contenido de una pizarra (sin imágenes: esas salen como huecos). */
export default function BoardPreview({ vaultPath, id, version }: BoardPreviewProps) {
  const t = useT();
  const [state, setState] = useState<{ src: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("load_board", { vaultPath, id })
      .then((json) => {
        if (cancelled) return;
        const board = parseBoard(json, id);
        const drawn = renderBoardSvg(board.elements, { palette: themePalette(), padding: 16 });
        setState({ src: drawn ? svgDataUrl(drawn.svg) : null });
      })
      .catch(() => !cancelled && setState({ src: null }));
    return () => {
      cancelled = true;
    };
  }, [vaultPath, id, version]);

  const empty = useMemo(() => state !== null && state.src === null, [state]);

  return (
    <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-t-xl border-b border-gus-border bg-gus-panel">
      {state?.src ? (
        <img src={state.src} alt="" draggable={false} className="h-full w-full object-contain p-2" />
      ) : (
        <span className="flex flex-col items-center gap-1 text-gus-muted">
          <PenTool className="h-6 w-6 opacity-50" strokeWidth={1.5} aria-hidden="true" />
          {empty && <span className="text-meta">{t("boards.emptyPreview")}</span>}
        </span>
      )}
    </span>
  );
}
