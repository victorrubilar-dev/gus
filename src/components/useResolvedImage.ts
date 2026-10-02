import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { imageCandidates } from "../lib/imageLinks";

/**
 * Destinos ya resueltos a datos de imagen (`data:…`), para que abrir la vista
 * de lectura o volver a la edición no vuelva a leer el disco.
 */
const RESOLVED_IMAGES = new Map<string, string>();

export type ResolvedImageState =
  | { fase: "listo"; url: string }
  | { fase: "carga" }
  | { fase: "fallo" };

/**
 * Resuelve el `src` de una imagen de la nota a datos que el navegador entienda.
 *
 * Las rutas del vault no las entiende el webview (son relativas a la nota o a
 * la raíz), así que se prueban primero junto a la nota y después desde la raíz
 * con `read_vault_image`. Un `src` con esquema propio (`data:`, `https://`) se
 * pinta tal cual.
 *
 * Mientras carga y si no la encuentra se avisa en el sitio de dejar un hueco
 * roto.
 */
export function useResolvedImage(
  src: string | undefined,
  notePath: string,
  vaultPath: string | null,
): ResolvedImageState {
  const candidates = useMemo(
    () => (src ? imageCandidates(src, notePath, vaultPath) : []),
    [src, notePath, vaultPath],
  );
  const directo = src && /^(data:|https?:\/\/)/i.test(src) ? src : null;
  const key = directo ?? candidates.join("\n");

  const [estado, setEstado] = useState<ResolvedImageState>(() => {
    if (directo) return { fase: "listo", url: directo };
    const cacheado = key ? RESOLVED_IMAGES.get(key) : undefined;
    return cacheado ? { fase: "listo", url: cacheado } : { fase: "carga" };
  });

  useEffect(() => {
    if (directo) {
      setEstado((actual) =>
        actual.fase === "listo" && actual.url === directo ? actual : { fase: "listo", url: directo },
      );
      return;
    }
    if (candidates.length === 0) {
      setEstado({ fase: "fallo" });
      return;
    }

    const cacheado = RESOLVED_IMAGES.get(key);
    if (cacheado) {
      setEstado({ fase: "listo", url: cacheado });
      return;
    }

    let cancelado = false;
    setEstado({ fase: "carga" });

    void (async () => {
      for (const ruta of candidates) {
        try {
          const url = await invoke<string>("read_vault_image", { path: ruta });
          RESOLVED_IMAGES.set(key, url);
          if (!cancelado) setEstado({ fase: "listo", url });
          return;
        } catch {
          // Ni una ni otra: se prueba la siguiente candidata.
        }
      }
      if (!cancelado) setEstado({ fase: "fallo" });
    })();

    return () => {
      cancelado = true;
    };
  }, [key, directo, candidates]);

  return estado;
}
