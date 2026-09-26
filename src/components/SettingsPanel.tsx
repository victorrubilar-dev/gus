import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ListTodo,
  Palette,
  RotateCcw,
  Search,
  SlidersHorizontal,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  SETTINGS_CATEGORIES,
  SETTINGS_DEFINITIONS,
  type AccentKey,
  type AppSettings,
  type SettingDefinition,
  type SettingsCategoryId,
} from "../lib/settings";
import type { SpellLang } from "../lib/spellCheck";

const CATEGORY_ICONS: Record<SettingsCategoryId, LucideIcon> = {
  general: SlidersHorizontal,
  appearance: Palette,
  notes: StickyNote,
  tasks: ListTodo,
  calendar: CalendarDays,
};

const INPUT_CLASS =
  "rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60 placeholder:text-gus-muted";

export interface SettingsPanelProps {
  /** Ajustes actuales (persistidos en el `config.json`). */
  settings: AppSettings;
  /** Se dispara con los ajustes completos tras cada cambio (se guardan ya). */
  onChange: (next: AppSettings) => void;
}

/** Interruptor accesible para los ajustes booleanos. */
function Toggle({
  on,
  onPressed,
  label,
}: {
  on: boolean;
  onPressed: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onPressed(!on)}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
        on ? "border-gus-accent bg-gus-accent" : "border-gus-border bg-gus-panel",
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all",
          on ? "left-[calc(100%-1.375rem)]" : "left-0.5 bg-gus-muted",
        )}
      />
    </button>
  );
}

/**
 * Panel de configuración de la aplicación: categorías a la izquierda, ajustes
 * a la derecha y un buscador que filtra en todas las categorías.
 */
export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  /** Índice de texto de cada definición (etiqueta + descripción + categoría). */
  const searchable = useMemo(
    () =>
      SETTINGS_DEFINITIONS.map((definition) => {
        const category = SETTINGS_CATEGORIES.find((entry) => entry.id === definition.category);
        const haystack = [
          definition.label,
          definition.description,
          definition.keywords,
          category?.label ?? "",
          category?.keywords ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return { definition, haystack };
      }),
    [],
  );

  /** Grupos a mostrar: resultados de búsqueda o la categoría activa. */
  const groups = useMemo(() => {
    const matches = searchable.filter(({ haystack }) =>
      haystack.includes(normalizedQuery),
    );

    const wanted = searching
      ? SETTINGS_CATEGORIES.map((category) => category.id)
      : [activeCategory];

    return wanted
      .map((categoryId) => ({
        category: SETTINGS_CATEGORIES.find((entry) => entry.id === categoryId)!,
        items: matches
          .map(({ definition }) => definition)
          .filter((definition) => definition.category === categoryId),
      }))
      .filter((group) => group.items.length > 0);
  }, [searchable, normalizedQuery, searching, activeCategory]);

  function update<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    onChange({ ...settings, [key]: value });
  }

  function renderControl(definition: SettingDefinition) {
    if (definition.kind === "toggle") {
      const on = settings[definition.key];
      return (
        <Toggle
          on={on}
          onPressed={(next) => update(definition.key, next)}
          label={definition.label}
        />
      );
    }

    if (definition.kind === "choice") {
      const current = settings[definition.key];
      return (
        <div className="flex items-center gap-1 rounded-lg border border-gus-border bg-gus-panel p-1">
          {definition.options.map((size) => {
            const isActive = current === size;
            return (
              <button
                key={size}
                type="button"
                aria-pressed={isActive}
                onClick={() => update(definition.key, size)}
                style={{ fontSize: `${Math.max(12, size - 2)}px` }}
                className={clsx(
                  "rounded-md px-2.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                  isActive
                    ? "bg-gus-accent text-gus-bg"
                    : "text-gus-muted hover:text-gus-text",
                )}
              >
                {size}px
              </button>
            );
          })}
        </div>
      );
    }

    if (definition.kind === "select") {
      const current = settings[definition.key];
      return (
        <select
          value={current}
          onChange={(event) => update(definition.key, event.target.value as SpellLang)}
          aria-label={definition.label}
          className={clsx(INPUT_CLASS, "min-w-[11rem] cursor-pointer")}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value} className="bg-gus-card text-gus-text">
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    const selected = settings[definition.key];
    return (
      <div className="flex items-center gap-2">
        {(Object.keys(ACCENTS) as AccentKey[]).map((key) => {
          const accent = ACCENTS[key];
          const isSelected = selected === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              aria-label={`Color ${accent.label}`}
              title={accent.label}
              onClick={() => update(definition.key, key)}
              style={{ backgroundColor: accent.hex }}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                isSelected
                  ? "ring-2 ring-gus-accent ring-offset-2 ring-offset-gus-card"
                  : "ring-1 ring-white/25 hover:ring-white/60",
              )}
            >
              {isSelected && (
                <Check
                  className="h-4 w-4 text-gus-bg"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gus-border px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gus-muted">
            Configuración
          </h2>
          <p className="text-xs text-gus-muted">
            Los cambios se guardan automáticamente
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-gus-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar configuración…"
              aria-label="Buscar configuración"
              className={clsx(INPUT_CLASS, "w-60 py-2 pr-8 pl-9")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            title="Restaurar todos los ajustes por defecto"
            className={clsx(
              INPUT_CLASS,
              "inline-flex items-center gap-1.5 text-xs text-gus-muted hover:text-gus-text",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restablecer
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Categorías */}
        <nav
          aria-label="Categorías de configuración"
          className="gus-scrollbar flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-gus-border p-3"
        >
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category.id];
            const isActive = !searching && activeCategory === category.id;
            const count = SETTINGS_DEFINITIONS.filter(
              (definition) => definition.category === category.id,
            ).length;

            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setActiveCategory(category.id);
                  setQuery("");
                }}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                  isActive
                    ? "bg-gus-accent/15 text-gus-accent"
                    : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{category.label}</span>
                <span className="ml-auto text-[10px] text-gus-muted">{count}</span>
              </button>
            );
          })}
        </nav>

        {/* Ajustes */}
        <div className="gus-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {searching && (
            <p className="mb-4 text-xs text-gus-muted" role="status">
              {groups.reduce((total, group) => total + group.items.length, 0)} resultado
              {groups.reduce((total, group) => total + group.items.length, 0) === 1
                ? ""
                : "s"}{" "}
              para «{query.trim()}»
            </p>
          )}

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gus-border py-14 text-center">
              <Search className="h-5 w-5 text-gus-muted" aria-hidden="true" />
              <p className="text-sm text-gus-muted">
                Ninguna configuración coincide con «{query.trim()}»
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className={clsx(INPUT_CLASS, "text-xs text-gus-muted hover:text-gus-text")}
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : (
            groups.map((group) => {
              const Icon = CATEGORY_ICONS[group.category.id];
              return (
                <div key={group.category.id} className="mb-6 last:mb-0">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon
                      className="h-4 w-4 text-gus-accent"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gus-muted">
                      {group.category.label}
                    </h3>
                    <span
                      aria-hidden="true"
                      className="h-px flex-1 bg-gus-border"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    {group.items.map((definition) => (
                      <div
                        key={definition.key}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gus-border bg-gus-card px-4 py-3.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gus-text">
                            {definition.label}
                          </p>
                          <p className="mt-0.5 text-xs text-gus-muted">
                            {definition.description}
                          </p>
                        </div>

                        <div className="shrink-0">{renderControl(definition)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
