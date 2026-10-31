import { useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkSelfUpdate, reduceDownload, START_PROGRESS, type SelfUpdateState } from "../lib/selfUpdate";
import {
  checkForUpdate,
  dismissUpdate,
  dismissedVersion,
  type UpdateCheckResult,
  type UpdateInfo,
  type UpdateUiState,
} from "../lib/updateCheck";
import { RELEASES_URL } from "../lib/version";

/**
 * Comprobación y descarga de versiones nuevas. Comprueba una vez cuando la app
 * está lista (`ready`); nunca frena ni rompe el arranque.
 */
export function useAppUpdates(ready: boolean) {
  const [updateState, setUpdateState] = useState<UpdateUiState>({ status: "idle" });
  const [updateNotice, setUpdateNotice] = useState<UpdateInfo | null>(null);
  /** Actualización automática en curso (descarga, lista o instalando); `null` si el flujo es el manual. */
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateState | null>(null);
  const selfUpdateRef = useRef<{ update: Update; info: UpdateInfo } | null>(null);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    setUpdateState({ status: "checking" });
    void checkAndPrepare().then((result) => {
      if (cancelled) return;
      applyResult(result);
    });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  /**
   * Comprueba si hay versión nueva. Donde la app puede actualizarse sola (ver
   * `can_self_update`) la descarga de inmediato; en el resto devuelve el aviso
   * de siempre, con descarga manual.
   */
  async function checkAndPrepare(): Promise<UpdateCheckResult> {
    // Ya hay una descarga en marcha o terminada: no se repite.
    if (selfUpdateRef.current && selfUpdate?.phase !== "error") {
      return { status: "available", info: selfUpdateRef.current.info };
    }

    const self = await checkSelfUpdate();
    if (!self.capable) return checkForUpdate();
    if (self.failed) return { status: "unavailable" };
    if (!self.update) return { status: "uptodate" };

    const info: UpdateInfo = {
      version: self.update.version,
      url: `${RELEASES_URL}/tag/v${self.update.version}`,
      publishedAt: self.update.date ?? null,
      installer: null,
    };
    selfUpdateRef.current = { update: self.update, info };
    void retryDownload();
    return { status: "available", info };
  }

  async function retryDownload() {
    const pending = selfUpdateRef.current;
    if (!pending) return;
    const version = pending.info.version;

    setSelfUpdate({ phase: "downloading", version, progress: START_PROGRESS });
    try {
      await pending.update.download((event) =>
        setSelfUpdate((current) =>
          current?.phase === "downloading"
            ? { ...current, progress: reduceDownload(current.progress, event) }
            : current,
        ),
      );
      setSelfUpdate({ phase: "ready", version });
    } catch (error) {
      setSelfUpdate({ phase: "error", version, message: String(error) });
    }
  }

  /** Instala lo ya descargado y vuelve a abrir la app. */
  async function restartAndInstall() {
    const pending = selfUpdateRef.current;
    if (!pending) return;
    const version = pending.info.version;

    setSelfUpdate({ phase: "installing", version });
    try {
      await pending.update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      setSelfUpdate({ phase: "error", version, message: String(error) });
    }
  }

  /** Traduce el resultado de la comprobación al estado que pinta la interfaz. */
  function applyResult(result: UpdateCheckResult) {
    setUpdateState(result);
    // De la versión que ya se decidió ignorar no se vuelve a avisar, salvo que
    // se esté actualizando sola: ese aviso trae el botón de reiniciar.
    if (
      result.status === "available" &&
      (selfUpdateRef.current !== null || dismissedVersion() !== result.info.version)
    ) {
      setUpdateNotice(result.info);
    }
  }

  /** Comprobación manual, desde Ajustes → Acerca de. */
  async function checkNow() {
    setUpdateState({ status: "checking" });
    applyResult(await checkAndPrepare());
  }

  /** «Más tarde» en automático solo oculta el aviso: no se da por ignorada la versión. */
  function dismissNotice() {
    if (updateNotice && !selfUpdate) dismissUpdate(updateNotice.version);
    setUpdateNotice(null);
  }

  return { updateState, updateNotice, selfUpdate, checkNow, retryDownload, restartAndInstall, dismissNotice };
}
