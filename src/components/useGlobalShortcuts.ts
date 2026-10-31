import { useEffect, useEffectEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { globalShortcutFor } from "../lib/shortcuts";
import type { Language } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import type { TabId } from "./Sidebar";

export interface GlobalActions {
  changeSettings: (settings: AppSettings) => void;
  openNewTask: () => void;
  openDailyNote: () => void | Promise<void>;
  /** Abre la paleta en la sección de notas. */
  openPalette: () => void;
  togglePalette: () => void;
  togglePanel: () => void;
  selectTab: (tab: TabId) => void;
}

/**
 * Atajos globales de la ventana y menú nativo (macOS). `actions` se lee siempre
 * en su última versión sin volver a registrar los listeners en cada render.
 */
export function useGlobalShortcuts(
  settings: AppSettings,
  currentVault: string | null,
  language: Language,
  actions: GlobalActions,
) {
  const act = useEffectEvent(() => actions);

  /**
   * Atajos globales de la ventana. Los lee de los ajustes, así que cambiarlos
   * en Ajustes → Atajos los cambia aquí también. El editor tiene los suyos
   * (Ctrl+S, deshacer…), que se atienden antes porque viven en el textarea.
   */
  useEffect(() => {
    function handleGlobalKey(event: KeyboardEvent) {
      const id = globalShortcutFor(event, settings.shortcuts);
      if (!id) return;

      switch (id) {
        case "zoomIn":
        case "zoomOut":
        case "zoomReset": {
          // El «+» y el «−» del teclado numérico llegan como código, no como tecla.
          const factor = id === "zoomIn" ? 10 : id === "zoomOut" ? -10 : 0;
          const zoom =
            factor === 0
              ? 100
              : Math.min(200, Math.max(50, settings.uiZoom + factor));
          event.preventDefault();
          if (zoom !== settings.uiZoom) act().changeSettings({ ...settings, uiZoom: zoom });
          return;
        }
        case "newTask":
          if (!currentVault) return;
          event.preventDefault();
          act().openNewTask();
          return;
        case "openDailyNote":
          if (!currentVault) return;
          event.preventDefault();
          void act().openDailyNote();
          return;
        case "focusSearch":
          // «Buscar nota» de la pantalla de bienvenida, con atajo propio.
          event.preventDefault();
          act().openPalette();
          return;
        case "togglePanel":
          // Muestra u oculta el contenido de la derecha, como un visor de lado.
          event.preventDefault();
          act().togglePanel();
          return;
        case "commandPalette":
          if (!currentVault) return;
          event.preventDefault();
          act().togglePalette();
          return;
        default:
      }
    }

    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [settings, currentVault]);

  // Menú nativo (macOS): sus etiquetas siguen el idioma de la app y cada
  // entrada propia llega aquí como `menu-action`. Fuera de macOS no hace nada.
  useEffect(() => {
    invoke("set_app_menu", { lang: language }).catch(() => {});
  }, [language]);

  const onMenuAction = useEffectEvent((id: string) => {
    if (!currentVault) return;
    if (id === "new-task") act().openNewTask();
    else if (id === "search") act().openPalette();
    else if (id.startsWith("tab-")) act().selectTab(id.slice(4) as TabId);
  });

  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => onMenuAction(event.payload));
    return () => void unlisten.then((off) => off());
  }, []);
}
