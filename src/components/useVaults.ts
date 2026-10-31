import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../lib/i18n";
import { baseName, safeFileName } from "../lib/fileName";
import { DEFAULT_BASE_DIR, normalizeConfig, type VaultConfig } from "../lib/vaultConfig";
import type { VaultAppConfig } from "./VaultPicker";

/**
 * Vaults y configuración de la app: carga al arrancar, vault abierto, y crear,
 * añadir, renombrar, ponerle portada y quitar vaults. `onVaultSwitch` avisa de
 * que se abrió o se dejó un vault, para que quien llama cierre lo que tenía abierto.
 */
export function useVaults({ onVaultSwitch }: { onVaultSwitch: () => void }) {
  const t = useT();
  const [bootStatus, setBootStatus] = useState<"loading" | "ready">("loading");
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [currentVault, setCurrentVault] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await invoke<VaultAppConfig>("load_app_config");
        if (cancelled) return;
        const next = normalizeConfig(raw);

        let openPath: string | null = null;
        if (next.lastVault && next.settings.openLastVault) {
          const exists = await invoke<boolean>("vault_dir_exists", { path: next.lastVault });
          if (cancelled) return;
          openPath = exists ? next.lastVault : null;
        }

        if (cancelled) return;
        setVaultConfig(next);
        setCurrentVault(openPath);
        // Sin esperar: si falla, la papelera global sigue en disco y no se pierde nada.
        void invoke("migrate_legacy_trash", {
          vaults: next.vaults.map((vault) => vault.path),
        }).catch(() => {});
        setBootStatus("ready");
      } catch (error: unknown) {
        if (cancelled) return;
        setVaultConfig(normalizeConfig(null));
        setVaultError(String(error));
        setBootStatus("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function saveVaultConfig(next: VaultConfig) {
    setVaultConfig(next);
    invoke("save_app_config", { config: next }).catch((error: unknown) => {
      setVaultError(String(error));
    });
  }

  function openVault(path: string) {
    setCurrentVault(path);
    onVaultSwitch();
    setVaultError(null);
    if (vaultConfig) saveVaultConfig({ ...vaultConfig, lastVault: path });
  }

  function leaveVault() {
    setCurrentVault(null);
    onVaultSwitch();
  }

  async function handleCreateVault(name: string, base: string): Promise<boolean> {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const finalBase = base.trim() || DEFAULT_BASE_DIR;
      const safeName = safeFileName(name);
      const path = await invoke<string>("create_vault", { base: finalBase, name: safeName });

      const source = vaultConfig ?? normalizeConfig(null);
      setCurrentVault(path);
      onVaultSwitch();
      saveVaultConfig({
        ...source,
        baseDir: finalBase,
        vaults: [...source.vaults, { name: safeName, path }],
        lastVault: path,
      });
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleAddExistingVault(rawPath: string): Promise<boolean> {
    setVaultBusy(true);
    setVaultError(null);
    try {
      const path = rawPath.trim();
      const exists = await invoke<boolean>("vault_dir_exists", { path });
      if (!exists) {
        setVaultError(t("app.vaultNotFound", { path }));
        return false;
      }

      const source = vaultConfig ?? normalizeConfig(null);
      setCurrentVault(path);
      onVaultSwitch();

      if (source.vaults.some((vault) => vault.path === path)) {
        saveVaultConfig({ ...source, lastVault: path });
        return true;
      }

      const cleanPath = path.replace(/[\\/]+$/, "");
      saveVaultConfig({
        ...source,
        vaults: [...source.vaults, { name: baseName(cleanPath) || path, path }],
        lastVault: path,
      });
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleRenameVault(path: string, name: string): Promise<boolean> {
    if (!vaultConfig) return false;

    const cleanName = name.trim();
    if (!cleanName) {
      setVaultError(t("app.vaultNeedsName"));
      return false;
    }

    setVaultBusy(true);
    setVaultError(null);

    const next: VaultConfig = {
      ...vaultConfig,
      vaults: vaultConfig.vaults.map((vault) =>
        vault.path === path ? { ...vault, name: cleanName } : vault,
      ),
    };

    try {
      await invoke("save_app_config", { config: next });
      setVaultConfig(next);
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleSetVaultCover(path: string, cover: string | null): Promise<boolean> {
    if (!vaultConfig) return false;

    setVaultBusy(true);
    setVaultError(null);

    const next: VaultConfig = {
      ...vaultConfig,
      vaults: vaultConfig.vaults.map((vault) =>
        vault.path === path ? { ...vault, cover: cover ?? undefined } : vault,
      ),
    };

    try {
      await invoke("save_app_config", { config: next });
      setVaultConfig(next);
      return true;
    } catch (error: unknown) {
      setVaultError(String(error));
      return false;
    } finally {
      setVaultBusy(false);
    }
  }

  function handleRemoveVaults(paths: string[]) {
    if (!vaultConfig || paths.length === 0) return;

    const removed = new Set(paths);
    const vaults = vaultConfig.vaults.filter((vault) => !removed.has(vault.path));
    const lastVault =
      vaultConfig.lastVault && removed.has(vaultConfig.lastVault)
        ? null
        : vaultConfig.lastVault;
    saveVaultConfig({ ...vaultConfig, vaults, lastVault });

    if (currentVault && removed.has(currentVault)) leaveVault();
  }

  function handleSelectBaseDir(dir: string) {
    const clean = dir.trim();
    if (!vaultConfig || !clean || clean === vaultConfig.baseDir) return;
    saveVaultConfig({ ...vaultConfig, baseDir: clean });
  }

  return {
    bootStatus,
    vaultConfig,
    currentVault,
    vaultBusy,
    vaultError,
    saveVaultConfig,
    openVault,
    leaveVault,
    handleCreateVault,
    handleAddExistingVault,
    handleRenameVault,
    handleSetVaultCover,
    handleRemoveVaults,
    handleSelectBaseDir,
  };
}
