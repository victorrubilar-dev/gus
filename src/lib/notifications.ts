/**
 * Avisos del sistema (REQ-12): vencimientos de tareas y recordatorio de la
 * nota del día.
 *
 * La regla de negocio vive aquí, separada de Tauri, para poder probarla. El
 * envío propiamente dicho va en `sendSystemNotification`, que es la única
 * parte que toca el plugin y que falla en seco (sin SO, sin permiso, en
 * pruebas) sin romper nada.
 */

/** Milisegundos de un día de calendario (no se usa para sumar horas). */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Clave en `localStorage` de las tareas ya avisadas hoy. */
const NOTIFIED_KEY = "gus.notifications.notified";
/** Clave del último día en el que se avisó de la nota diaria. */
const DAILY_KEY = "gus.notifications.daily";

/** Mínimo que necesita una tarea para poder avisar de su vencimiento. */
export interface RemindableTask {
  id: string;
  title: string;
  due?: string;
  completes: boolean;
}

/** Fecha «AAAA-MM-DD» en la zona horaria local, a partir de milisegundos. */
export function isoDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parsea una fecha «AAAA-MM-DD», o `null` si no existe en el calendendario. */
function parseIsoDay(due: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_RE.exec(due);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // El constructor normaliza el desbordamiento: 2026-02-31 no existe.
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * Inicio del día de una fecha «AAAA-MM-DD», en la zona horaria local.
 * Devuelve `null` si la fecha no es válida.
 */
export function dueStartMs(due: string): number | null {
  const parsed = parseIsoDay(due);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime();
}

/**
 * Fin del día de una fecha «AAAA-MM-DD»: un vencimiento sin hora se cumple al
 * terminar su día, no a medianoche. Devuelve `null` si la fecha no es válida.
 */
export function dueEndMs(due: string): number | null {
  const parsed = parseIsoDay(due);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day, 23, 59, 59, 999).getTime();
}

/**
 * Instante en el que empieza a sonar el aviso de una tarea: el comienzo de su
 * día de vencimiento menos los días de antelación elegidos. Con 0 días suena
 * solo durante el propio día del vencimiento.
 */
export function reminderMomentMs(due: string, leadDays: number): number | null {
  const start = dueStartMs(due);
  if (start === null) return null;
  return start - leadDays * DAY_MS;
}

/** Clave con la que se recuerda que una tarea ya se avisó: caduca cada día. */
export function notifiedKey(taskId: string, due: string, nowMs: number): string {
  return `${taskId}@${due}@${isoDay(nowMs)}`;
}

/**
 * Tareas pendientes que merecen un aviso ahora mismo: están dentro de la
 * ventana de antelación, no han vencido aún y no se avisaron hoy.
 *
 * La ventana cierra al terminar el día del vencimiento: avisar de algo que ya
 * pasó es ruido, que para eso está la pestaña de tareas.
 */
export function tasksToNotify(
  tasks: readonly RemindableTask[],
  leadDays: number,
  nowMs: number,
  notified: ReadonlySet<string>,
): RemindableTask[] {
  const out: RemindableTask[] = [];

  for (const task of tasks) {
    if (task.completes || !task.due) continue;

    const moment = reminderMomentMs(task.due, leadDays);
    const end = dueEndMs(task.due);
    if (moment === null || end === null) continue;

    // Antes de la antelación no toca; después del día, ya es tarde.
    if (nowMs < moment || nowMs > end) continue;

    if (notified.has(notifiedKey(task.id, task.due, nowMs))) continue;
    out.push(task);
  }

  return out;
}

/**
 * ¿Toca avisar de la nota del día? Solo si está encendido, la nota todavía no
 * existe y no se avisó ya hoy.
 */
export function shouldNotifyDailyNote(
  enabled: boolean,
  noteExists: boolean,
  lastNotifiedDay: string | null,
  nowMs: number,
): boolean {
  return enabled && !noteExists && lastNotifiedDay !== isoDay(nowMs);
}

/* ------------------------------------------------------------------ */
/* Memoria entre sesiones                                              */
/* ------------------------------------------------------------------ */

/** Lee la memoria de avisos ya emitidos. Cualquier fallo se toma como vacío. */
export function readNotified(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Guarda las claves de los avisos emitidos, quitando las del día anterior.
 * Así la lista no crece sin límite y mañana vuelven a sonar.
 */
export function storeNotified(keys: readonly string[], nowMs: number): void {
  try {
    const today = isoDay(nowMs);
    const kept = [...readNotified()].filter((key) => key.endsWith(`@${today}`));
    window.localStorage.setItem(
      NOTIFIED_KEY,
      JSON.stringify([...kept, ...keys].slice(-200)),
    );
  } catch {
    // Sin memoria, los avisos se repetirán en cada arranque: solo ruido.
  }
}

/** Último día en el que se avisó de la nota diaria, o `null`. */
export function readNotifiedDay(): string | null {
  try {
    return window.localStorage.getItem(DAILY_KEY);
  } catch {
    return null;
  }
}

export function storeNotifiedDay(day: string): void {
  try {
    window.localStorage.setItem(DAILY_KEY, day);
  } catch {
    // Sin memoria el recordatorio diario se repetirá: molesta poco.
  }
}

/* ------------------------------------------------------------------ */
/* Envío                                                               */
/* ------------------------------------------------------------------ */

export interface NotificationPayload {
  title: string;
  body: string;
}

/**
 * Pide permiso al sistema si hace falta y envía el aviso. Devuelve `false` si
 * no se pudo (permiso denegado, plugin ausente, entorno sin Tauri): el
 * llamador no tiene por qué hacer nada con eso, pero así queda registrado.
 */
export async function sendSystemNotification(payload: NotificationPayload): Promise<boolean> {
  try {
    const plugin = await import("@tauri-apps/plugin-notification");
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      granted = (await plugin.requestPermission()) === "granted";
    }
    if (!granted) return false;

    plugin.sendNotification({ title: payload.title, body: payload.body });
    return true;
  } catch {
    // Sin plugin (pruebas, navegador, SO sin soporte) no se avisa y ya está.
    return false;
  }
}
