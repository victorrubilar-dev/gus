export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Fecha local → `AAAA-MM-DD` (nunca usa UTC, para no desplazar el día). */
export function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayIso(): string {
  return toIso(new Date());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Las fechas se formatean en el idioma de la aplicación. */
export function monthLabel(date: Date): string {
  const label = date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function longDayLabel(iso: string): string {
  const date = fromIso(iso);
  if (!date) return iso;

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function monthCells(visibleMonth: Date): (Date | null)[] {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? new Date(year, month, day) : null;
  });
}

/** Iniciales de los días de la semana, en el idioma de la aplicación. */
export function weekdayLabels(): string[] {
  // Se toma un lunes de 2024 (que empieza en día 1) para tener los siete días
  // en orden, sin depender del mes que se esté viendo.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, 1 + index);
    return date
      .toLocaleDateString(undefined, { weekday: "short" })
      .replace(".", "")
      .slice(0, 3);
  });
}
