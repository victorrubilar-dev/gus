import { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  WEEKDAYS,
  fromIso,
  longDayLabel,
  monthCells,
  monthLabel,
  startOfMonth,
  toIso,
  todayIso,
} from "../lib/calendarDate";

export interface DatePickerProps {
  /** Fecha elegida en `AAAA-MM-DD` o `null` si no hay. */
  value: string | null;
  /** Se dispara al elegir (`AAAA-MM-DD`) o quitar (`null`) la fecha. */
  onChange: (value: string | null) => void;
}

/**
 * Mini-calendario integrado (lunes primero, mismo estilo que la pestaña
 * Calendario) para elegir la fecha de plazo de una tarea. Sustituye al
 * `<input type="date">`: el selector nativo se solapa con el menú
 * superpuesto en algunos webviews, en cambio este calendario vive dentro
 * del propio formulario y se navega con las flechas o el botón «Hoy».
 */
export default function DatePicker({ value, onChange }: DatePickerProps) {
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => fromIso(value ?? "") ?? startOfMonth(new Date()));

  /** Cambia de mes manteniendo la navegación anclada al día 1. */
  function shiftMonth(delta: number) {
    setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  /** «Hoy»: salta al mes actual y marca hoy como fecha elegida. */
  function selectToday() {
    const now = new Date();
    setVisibleMonth(startOfMonth(now));
    onChange(todayIso());
  }

  const today = todayIso();
  const cells = monthCells(visibleMonth);

  return (
    <div className="w-full max-w-80 overflow-hidden rounded-xl border border-gus-border bg-gus-card">
      {/* Cabecera: mes visible + navegación */}
      <div className="flex items-center justify-between gap-2 px-2 pt-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Mes anterior"
          title="Mes anterior"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <span aria-live="polite" className="text-xs font-semibold text-gus-text">
          {monthLabel(visibleMonth)}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={selectToday}
            className="rounded-lg border border-gus-border px-2 py-1 text-[11px] text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Mes siguiente"
            title="Mes siguiente"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Rejilla de días */}
      <div className="px-2 pt-2 pb-2">
        <div className="grid grid-cols-7" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-gus-muted"
            >
              {weekday}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((date, index) => {
            if (!date) {
              return <span key={`empty-${index}`} aria-hidden="true" className="h-8" />;
            }

            const iso = toIso(date);
            const isSelected = iso === value;
            const isToday = iso === today;

            return (
              <button
                key={iso}
                type="button"
                onClick={() => onChange(iso)}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={longDayLabel(iso)}
                className={clsx(
                  "flex h-8 items-center justify-center rounded-lg text-xs transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                  isSelected
                    ? "bg-gus-accent font-medium text-gus-bg"
                    : isToday
                      ? "border border-gus-accent/60 font-medium text-gus-text hover:bg-gus-panel"
                      : "text-gus-muted hover:bg-gus-panel hover:text-gus-text",
                )}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resumen de la fecha elegida (o aviso de que aún no hay) */}
      <div className="flex items-center justify-between gap-2 border-t border-gus-border px-3 py-2">
        <span
          className={clsx(
            "truncate text-[11px]",
            value ? "text-gus-text" : "text-gus-muted",
          )}
        >
          {value ? longDayLabel(value) : "Sin fecha elegida"}
        </span>

        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-[11px] text-gus-muted transition-colors hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}
