import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import clsx from "clsx";
import { useT } from "../lib/i18n";
import { dailyTitle, isSameDay, shiftDay } from "../lib/dailyNotes";

/**
 * Barra que acompaña a una nota diaria: dice qué día se está viendo y
 * permite saltar al día anterior y al siguiente sin salir del editor.
 * Si el día no es el de hoy aparece un botón para volver a él.
 */
export interface DailyNoteBarProps {
  /** El día de la nota abierta. */
  date: Date;
  /** Mientras la nota se carga o se crea, los saltos esperan a que entre. */
  busy?: boolean;
  /** Abre la nota de otro día (la crea con la plantilla si no existe). */
  onNavigate: (date: Date) => void;
}

export default function DailyNoteBar({ date, busy = false, onNavigate }: DailyNoteBarProps) {
  const t = useT();
  const now = new Date();
  const isToday = isSameDay(date, now);

  const step = (delta: number) => onNavigate(shiftDay(date, delta));

  const arrowClass =
    "flex h-8 w-8 items-center justify-center rounded-lg text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 disabled:cursor-wait disabled:opacity-50";

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-gus-border bg-gus-panel px-4 py-2"
      data-tour="daily-note-bar"
    >
      <button
        type="button"
        title={t("daily.previousDay")}
        aria-label={t("daily.previousDay")}
        disabled={busy}
        onClick={() => step(-1)}
        className={arrowClass}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>

      <p className="min-w-0 truncate text-sm font-medium text-gus-text" aria-live="polite">
        {dailyTitle(date)}
      </p>

      <span className="rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gus-accent">
        {t("daily.badge")}
      </span>

      {!isToday && (
        <button
          type="button"
          title={t("daily.backToToday")}
          aria-label={t("daily.backToToday")}
          disabled={busy}
          onClick={() => onNavigate(now)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gus-border px-2.5 py-1 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 disabled:cursor-wait disabled:opacity-50"
        >
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          {t("daily.today")}
        </button>
      )}

      <button
        type="button"
        title={t("daily.nextDay")}
        aria-label={t("daily.nextDay")}
        disabled={busy}
        onClick={() => step(1)}
        className={clsx(arrowClass, "ml-auto")}
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
