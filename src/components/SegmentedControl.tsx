import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Selector de vistas alternativas (Tablero/Lista). */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex rounded-lg border border-gus-border bg-gus-card p-0.5"
    >
      {options.map(({ value: optionValue, label, title, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          role="tab"
          aria-selected={value === optionValue}
          onClick={() => onChange(optionValue)}
          title={title}
          className={clsx(
            "gus-btn w-auto px-2.5 text-meta",
            value === optionValue ? "bg-gus-panel text-gus-text" : "text-gus-muted hover:text-gus-text",
          )}
        >
          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  );
}
