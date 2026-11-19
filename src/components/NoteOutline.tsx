import { useMemo, useState } from "react";
import clsx from "clsx";
import { ListTree } from "lucide-react";
import { useT } from "../lib/i18n";
import { noteOutline } from "../lib/noteOutline";

/**
 * Índice de la nota en la vista de lectura (y en la dividida): un botón fijo
 * arriba a la derecha que despliega los títulos. Pulsar uno lleva hasta él
 * dentro del mismo contenedor con scroll (los títulos llevan `data-line`).
 */
export default function NoteOutline({ body }: { body: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const headings = useMemo(() => noteOutline(body), [body]);
  if (headings.length < 2) return null;

  const minLevel = Math.min(...headings.map((heading) => heading.level));

  return (
    <div className="sticky top-0 z-10 flex h-0 justify-end">
      {open && <div className="fixed inset-0" aria-hidden="true" onMouseDown={() => setOpen(false)} />}
      <nav
        aria-label={t("editor.outline")}
        className="relative -mt-2 -mr-3"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          title={t("editor.outline")}
          onClick={() => setOpen((value) => !value)}
          className={clsx(
            "ml-auto flex items-center gap-1.5 rounded-lg border px-2 py-1 text-body shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
            open
              ? "border-gus-accent/50 bg-gus-card text-gus-accent"
              : "border-gus-border bg-gus-panel/90 text-gus-muted hover:text-gus-text",
          )}
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
          {t("editor.outline")}
        </button>
        {open && (
          <ol className="gus-scrollbar absolute right-0 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl shadow-black/30">
            {headings.map((heading) => (
              <li key={heading.line}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget
                      .closest("[data-preview-scroll]")
                      ?.querySelector(`[data-line="${heading.line}"]`)
                      ?.scrollIntoView({ block: "start", behavior: "smooth" });
                    setOpen(false);
                  }}
                  style={{ paddingLeft: `${0.75 + (heading.level - minLevel) * 0.75}rem` }}
                  className={clsx(
                    "block w-full truncate py-1 pr-3 text-left text-body outline-none transition-colors hover:bg-gus-panel focus-visible:bg-gus-panel",
                    heading.level === minLevel ? "font-medium text-gus-text" : "text-gus-muted hover:text-gus-text",
                  )}
                >
                  {heading.text}
                </button>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </div>
  );
}
