import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../lib/i18n";
import { dailyRelativePath } from "../lib/dailyNotes";
import { joinPath } from "../lib/fileName";
import {
  isoDay,
  notifiedKey,
  readNotified,
  readNotifiedDay,
  shouldNotifyDailyNote,
  sendSystemNotification,
  storeNotified,
  storeNotifiedDay,
  tasksToNotify,
} from "../lib/notifications";
import type { AppSettings } from "../lib/settings";
import { loadTaskStore } from "../lib/taskStore";

/** Avisos del sistema al abrir un vault (ver `lib/notifications`). */
export function useStartupNotifications(ready: boolean, currentVault: string | null, settings: AppSettings) {
  const t = useT();

  /**
   * Avisos del sistema al arrancar (REQ-12): tareas por vencer según la
   * antelación elegida y la nota del día que todavía no se ha escrito. Van
   * una sola vez por vault y por día; quien los apague en Ajustes no vuelve a
   * ver ninguno.
   */
  useEffect(() => {
    if (!ready || currentVault === null) return;
    if (!settings.notificationsEnabled) return;

    let cancelled = false;
    const vault = currentVault;
    const leadDays = settings.notificationLeadDays;
    const dailyFolder = settings.dailyNotesFolder;
    const nowMs = Date.now();

    async function announce(): Promise<void> {
      // 1. Tareas: las que entran en la ventana y no se avisaron hoy.
      try {
        if (cancelled) return;
        const tasks = await loadTaskStore(vault);
        if (cancelled) return;
        const pending = tasksToNotify(tasks, leadDays, nowMs, readNotified());
        if (pending.length > 0) {
          const first = pending[0];
          const body =
            pending.length === 1
              ? t("notify.tasksBody__one", { count: 1, title: first.title })
              : t("notify.tasksBody", { count: pending.length });
          await sendSystemNotification({ title: t("notify.tasksTitle"), body });
          storeNotified(
            pending.map((task) => notifiedKey(task.id, task.due ?? "", nowMs)),
            nowMs,
          );
        }
      } catch {
        // Sin tareas legibles no se avisa de nada: esto nunca rompe el arranque.
      }

      // 2. Nota del día: solo si todavía no existe.
      try {
        if (cancelled) return;
        const path = joinPath(vault, dailyRelativePath(dailyFolder, new Date(nowMs)));
        let exists = true;
        try {
          await invoke<string>("read_vault_file", { path });
        } catch {
          exists = false;
        }
        if (cancelled) return;

        if (shouldNotifyDailyNote(true, exists, readNotifiedDay(), nowMs)) {
          await sendSystemNotification({
            title: t("notify.dailyTitle"),
            body: t("notify.dailyBody"),
          });
          storeNotifiedDay(isoDay(nowMs));
        }
      } catch {
        // Igual que arriba: el recordatorio es un extra, no una obligación.
      }
    }

    void announce();

    return () => {
      cancelled = true;
    };
  }, [ready, currentVault, settings.notificationsEnabled]);
}
