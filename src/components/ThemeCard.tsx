import clsx from "clsx";
import { Check } from "lucide-react";
import { IS_MOBILE } from "../lib/platform";
import { AUTO_THEME, customPalette, resolveTheme, themeDefinition, themePreviewStyle, type ThemeKey } from "../lib/themes";
import type { CustomTheme } from "../lib/customThemes";
import { useT } from "../lib/i18n";

export interface ThemeCardProps {
  /** Un tema de serie, uno personalizado o el automático (según el sistema). */
  theme: ThemeKey | CustomTheme | typeof AUTO_THEME;
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
  const t = useT();
  const auto = theme === AUTO_THEME;
  const builtin = typeof theme === "string" && !auto ? themeDefinition(theme as ThemeKey) : null;
  const palette = auto ? resolveTheme(AUTO_THEME, []) : (builtin ?? customPalette(theme as CustomTheme));
  const label = auto ? t("theme.auto") : builtin ? t(builtin.labelKey) : (theme as CustomTheme).name;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={label}
      className={clsx(
        "flex flex-col gap-1.5 rounded-xl border p-2.5 text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-gus-accent/70",
        selected
          ? "border-gus-accent ring-1 ring-gus-accent/70"
          : "border-gus-border hover:border-gus-muted",
      )}
    >
      {IS_MOBILE ? (
        // Móvil: la miniatura es un teléfono (título, tarjeta y barra inferior).
        <span
          aria-hidden="true"
          style={themePreviewStyle(palette)}
          className="flex h-28 w-full shrink-0 flex-col gap-1.5 rounded-lg border border-gus-border/70 bg-gus-bg p-2"
        >
          <span className="h-2 w-1/2 rounded-full bg-gus-text/80" />
          <span className="flex flex-1 flex-col gap-1 rounded-md bg-gus-card p-1.5">
            <span className="h-1.5 w-1/3 rounded-full bg-gus-accent" />
            <span className="h-1.5 w-5/6 rounded-full bg-gus-muted/50" />
            <span className="h-1.5 w-2/3 rounded-full bg-gus-muted/50" />
          </span>
          <span className="flex justify-around rounded-md bg-gus-panel py-1.5">
            {[0, 1, 2, 3].map((dot) => (
              <span key={dot} className={clsx("h-1.5 w-1.5 rounded-full", dot === 0 ? "bg-gus-accent" : "bg-gus-muted/60")} />
            ))}
          </span>
        </span>
      ) : (
      <span
        aria-hidden="true"
        style={themePreviewStyle(palette)}
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
      )}

      {/* w-full: el WebView de Android no estira los hijos de un <button> flex. */}
      <span className="flex w-full items-center justify-between gap-1">
        <span className="truncate text-body font-medium text-gus-text">{label}</span>
        {selected && (
          <Check
            className="h-3.5 w-3.5 shrink-0 text-gus-accent"
            strokeWidth={3}
            aria-hidden="true"
          />
        )}
      </span>

      {withHint && auto && <span className="text-meta leading-tight text-gus-muted">{t("theme.autoHint")}</span>}
      {withHint && builtin && (
        <span className="text-meta leading-tight text-gus-muted">{t(builtin.hintKey)}</span>
      )}
    </button>
  );
}
