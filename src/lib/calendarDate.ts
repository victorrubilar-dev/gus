/**
 * Utilidades de fecha compartidas por la pestaña Calendario y el mini
 * calendario del menú de tareas. Todo en hora local: los `AAAA-MM-DD` nunca
 * se generan ni se interpretan en UTC, para no desplazar el día.
 */

/** Rellena a la izquierda con ceros (`9` → `09`). */
export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Fecha local → `AAAA-MM-DD` (nunca usa UTC, para no desplazar el día). */
export function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `AAAA-MM-DD` → fecha local a medianoche. */
export function fromIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Fecha de hoy en `AAAA-MM-DD`. */
export function todayIso(): string {
  return toIso(new Date());
}

/** Fecha local sin hora (para navegar por meses sin arrastrar la hora). */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Título «octubre de 2026» en español. */
export function monthLabel(date: Date): string {
  const label = date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Título largo «martes, 15 de octubre de 2026». */
export function longDayLabel(iso: string): string {
  const date = fromIso(iso);
  if (!date) return iso;

  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Seis filas de fechas del mes (las casillas sobrantes quedan vacías). */
export function monthCells(visibleMonth: Date): (Date | null)[] {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? new Date(year, month, day) : null;
  });
}

/** Cabecera de semana «Lun»…«Dom» (lunes primero, como el Calendario). */
export const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
