import clsx from "clsx";
import { Check } from "lucide-react";
import { themeDefinition, themePreviewStyle, type ThemeKey } from "../lib/themes";

export interface ThemeCardProps {
  theme: ThemeKey;
  selected: boolean;
  onSelect: () => void;
  /** Muestra el detalle corto del tema debajo del nombre. */
  withHint?: boolean;
}

/**
 * Tarjeta con vista previa de un tema. Las variables del tema se aplican solo
 * a la miniatura: así pinta esa paleta y el nombre de la tarjeta sigue usando
 * el color del tema activo (se lee igual en un tema claro u oscuro).
 */
export default function ThemeCard({ theme, selected, onSelect, withHint }: ThemeCardProps) {
  const definition = themeDefinition(theme);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={definition.label}
      className={clsx(
        "flex flex-col gap-1.5 rounded-xl border p-2.5 text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-gus-accent/70",
        selected
          ? "border-gus-accent ring-1 ring-gus-accent/70"
          : "border-gus-border hover:border-gus-muted",
      )}
    >
      <span
        aria-hidden="true"
        style={themePreviewStyle(theme)}
        className="flex h-14 shrink-0 flex-col gap-1 rounded-lg border border-gus-border/70 bg-gus-bg p-1.5"
      >
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-gus-accent" />
          <span className="h-1.5 flex-1 rounded-full bg-gus-muted/70" />
        </span>
        <span className="flex min-h-0 flex-1 gap-1">
          <span className="w-1/4 rounded-sm bg-gus-panel" />
          <span className="flex-1 rounded-sm bg-gus-card" />
        </span>
      </span>

      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium text-gus-text">{definition.label}</span>
        {selected && (
          <Check
            className="h-3.5 w-3.5 shrink-0 text-gus-accent"
            strokeWidth={3}
            aria-hidden="true"
          />
        )}
      </span>

      {withHint && (
        <span className="text-[10px] leading-tight text-gus-muted">{definition.hint}</span>
      )}
    </button>
  );
}
