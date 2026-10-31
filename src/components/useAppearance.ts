import { useEffect } from "react";
import { setPersonalWords } from "../lib/spellCheck";
import type { AppSettings } from "../lib/settings";
import { applyTheme } from "../lib/themes";

/** Efectos globales de los ajustes: diccionario personal, zoom de la interfaz y tema. */
export function useAppearance(settings: AppSettings, hasConfig: boolean) {
  useEffect(() => {
    setPersonalWords(settings.spellWords);
  }, [settings.spellWords]);

  /** Escala global de la interfaz (Ajustes o atajos Ctrl + «+»/«−»/0). */
  useEffect(() => {
    const factor = settings.uiZoom / 100;
    document.documentElement.style.setProperty("zoom", String(factor));
    // Los vw/vh no se reescalan con el zoom raíz: la caja raíz los divide
    // por este factor para seguir llenando la ventana a cualquier escala.
    document.documentElement.style.setProperty("--gus-zoom", String(factor));
    window.dispatchEvent(new Event("gus:zoom"));
  }, [settings.uiZoom]);

  /** Paleta activa: variables de color, esquema y acento de todo el documento. */
  useEffect(() => {
    // Sin configuración leída aún se respeta el tema de main.tsx (sesión anterior).
    if (!hasConfig) return;
    applyTheme(settings.theme);
  }, [settings.theme, hasConfig]);
}
