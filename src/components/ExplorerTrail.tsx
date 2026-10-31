import { Fragment, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, CalendarClock, Folder, Search } from "lucide-react";
import { useT } from "../lib/i18n";
import { splitTrail, type FolderEntry } from "../lib/explorerTrail";
import { MENU_ITEM_CLASS } from "./ExplorerContextMenu";

const TRAIL_BUTTON_CLASS =
  "gus-btn gus-btn-ghost shrink-0 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

/** `shrink-0` es clave: si algo no cabe, la barra prefiere ocultar tramos antes que encogerlos. */
const TRAIL_SEGMENT_CLASS =
  "gus-btn gus-btn-ghost w-auto min-w-0 max-w-full shrink-0 justify-start truncate px-1.5 text-left focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none";

function TrailSeparator() {
  return (
    <span aria-hidden="true" className="shrink-0 text-gus-muted/60">
      ›
    </span>
  );
}

interface ExplorerTrailProps {
  trail: FolderEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  backCombo: string;
  forwardCombo: string;
  onBack: () => void;
  onForward: () => void;
  /** Cambia a la ruta indicada (un prefijo de la actual). */
  onNavigate: (next: FolderEntry[]) => void;
  /** Desplegable «…» con los tramos que no caben. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  dragOverPath: string | null;
  onDragOverFolder: (event: DragEvent<HTMLElement>, folder: FolderEntry) => void;
  onDragLeaveFolder: (folder: FolderEntry) => void;
  onDropOnFolder: (event: DragEvent<HTMLElement>, folder: FolderEntry) => void;
  onOpenSearch?: () => void;
  onOpenDailyNote?: () => void;
}

/** Barra de ruta del explorador: historial, tramos que se pliegan según el ancho y atajos. */
export default function ExplorerTrail({
  trail,
  canGoBack,
  canGoForward,
  backCombo,
  forwardCombo,
  onBack,
  onForward,
  onNavigate,
  menuOpen,
  onMenuOpenChange,
  dragOverPath,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onOpenSearch,
  onOpenDailyNote,
}: ExplorerTrailProps) {
  const t = useT();
  /** Clave de la ruta: al cambiarla la barra vuelve a intentar mostrarla entera. */
  const trailKey = trail.map((step) => step.path).join("\n");
  /** Nivel de colapso de la ruta, dictado por la medición del ancho (ver efecto). */
  const [collapse, setCollapse] = useState({ key: "", level: 0 });
  /** Ancho medido de la barra: cambia al redimensionar el explorador. */
  const [boxWidth, setBoxWidth] = useState(0);
  /** Barra de ruta: mide su ancho para decidir cuántos tramos mostrar. */
  const trailRef = useRef<HTMLDivElement | null>(null);

  const collapseLevel = collapse.key === trailKey ? collapse.level : 0;
  const { visible: trailParts, hidden: hiddenParts, maxLevel } = splitTrail(trail, collapseLevel);

  /** Si la raíz quedó fuera, el «…» abre la fila («… › carpeta actual»); si no, va tras la raíz. */
  const abreConEllipsis = hiddenParts.length > 0 && !trailParts.some((part) => part.index === 0);

  const ellipsisButton = (
    <button
      type="button"
      onClick={() => onMenuOpenChange(!menuOpen)}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={t("explorer.hiddenFolders", { count: hiddenParts.length })}
      title={t("explorer.trailEarlier")}
      className={clsx(
        "shrink-0 rounded px-0.5 py-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
        menuOpen ? "text-gus-accent" : "text-gus-muted hover:text-gus-text",
      )}
    >
      …
    </button>
  );

  /**
   * La barra mide su ancho real: si los tramos visibles no caben, se oculta alguno
   * —nunca se encogen todos juntos, que era lo que se veía tosco—. Al cambiar de
   * carpeta o de ancho de explorador se vuelve a intentar con la ruta entera.
   */
  useLayoutEffect(() => {
    const box = trailRef.current;
    if (!box) return;

    // Solo falta sitio: se oculta un tramo más (nunca se encogen todos juntos).
    // El nuevo nivel se calcula desde `prev` y no desde `collapseLevel`: el
    // valor derivado en render no debe copiarse al estado (costaría un render
    // extra y la regla no-derived-state-effect lo marca).
    if (box.scrollWidth > box.clientWidth + 1 && collapseLevel < maxLevel) {
      setCollapse((prev) => ({
        key: trailKey,
        level: (prev.key === trailKey ? prev.level : 0) + 1,
      }));
    }

    let ancho = box.clientWidth;
    const observer = new ResizeObserver(() => {
      // El primer disparo no es un cambio real; después, con otro ancho se
      // vuelve a intentar con la ruta entera y la medición de arriba repliega.
      if (box.clientWidth === ancho) return;
      ancho = box.clientWidth;
      setBoxWidth(box.clientWidth);
      setCollapse({ key: trailKey, level: 0 });
    });
    observer.observe(box);

    return () => observer.disconnect();
  }, [trailKey, collapseLevel, maxLevel, boxWidth]);

  return (
    <nav
      aria-label={t("explorer.currentFolder")}
      data-trail-menu="true"
      className="relative -mt-1 flex items-center gap-1 text-meta"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          title={t("explorer.backHint", { combo: backCombo })}
          aria-label={t("explorer.back")}
          className={TRAIL_BUTTON_CLASS}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          title={t("explorer.forwardHint", { combo: forwardCombo })}
          aria-label={t("explorer.forward")}
          className={TRAIL_BUTTON_CLASS}
        >
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={trailRef}
        className="flex min-w-0 flex-1 items-center gap-x-0.5 overflow-hidden"
      >
        {abreConEllipsis && ellipsisButton}
        {trailParts.map((part, position) => (
          <Fragment key={part.folder.path}>
            {(position > 0 || abreConEllipsis) && <TrailSeparator />}
            <button
              type="button"
              data-drop-folder={part.folder.path}
              onClick={() => onNavigate(trail.slice(0, part.index + 1))}
              onDragOver={(event) => onDragOverFolder(event, part.folder)}
              onDragLeave={() => {
                onDragLeaveFolder(part.folder);
              }}
              onDrop={(event) => onDropOnFolder(event, part.folder)}
              title={t("explorer.trailDropHint", { path: part.folder.path })}
              aria-current={part.index === trail.length - 1 ? "true" : undefined}
              className={clsx(
                TRAIL_SEGMENT_CLASS,
                dragOverPath === part.folder.path &&
                  "bg-gus-accent/20 text-gus-accent ring-1 ring-gus-accent/50",
                part.index === trail.length - 1
                  ? "font-medium text-gus-text"
                  : "text-gus-muted hover:text-gus-text",
              )}
            >
              {part.folder.name}
            </button>

            {position === 0 && hiddenParts.length > 0 && !abreConEllipsis && (
              <>
                <TrailSeparator />
                {ellipsisButton}
              </>
            )}
          </Fragment>
        ))}
      </div>

      {menuOpen && hiddenParts.length > 0 && (
        <div
          role="menu"
          aria-label={t("explorer.trailEarlier")}
          className="absolute top-full right-0 left-11 z-30 mt-1 overflow-hidden rounded-lg border border-gus-border bg-gus-card shadow-xl shadow-black/40"
        >
          <ul className="gus-scrollbar max-h-52 overflow-y-auto py-1">
            {hiddenParts.map((part) => (
              <li key={part.folder.path}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onNavigate(trail.slice(0, part.index + 1))}
                  onDragOver={(event) => onDragOverFolder(event, part.folder)}
                  onDragLeave={() => {
                    onDragLeaveFolder(part.folder);
                  }}
                  onDrop={(event) => onDropOnFolder(event, part.folder)}
                  title={t("explorer.trailDropHint", { path: part.folder.path })}
                  className={clsx(
                    MENU_ITEM_CLASS,
                    "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                  )}
                >
                  <Folder
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{part.folder.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            title={t("app.tab.search")}
            aria-label={t("app.tab.search")}
            className={TRAIL_BUTTON_CLASS}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {onOpenDailyNote && (
          <button
            type="button"
            onClick={onOpenDailyNote}
            title={t("daily.openToday")}
            aria-label={t("daily.openToday")}
            className={TRAIL_BUTTON_CLASS}
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
    </nav>
  );
}
