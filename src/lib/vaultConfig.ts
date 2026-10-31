import { normalizeSettings, type AppSettings } from "./settings";
import type { VaultAppConfig, VaultInfo } from "../components/VaultPicker";

export const DEFAULT_BASE_DIR = "~/Documents/gus-vaults";

export interface VaultConfig {
  baseDir: string;
  vaults: VaultInfo[];
  lastVault: string | null;
  settings: AppSettings;
}

export function normalizeConfig(raw: VaultAppConfig | null | undefined): VaultConfig {
  return {
    baseDir: raw?.baseDir?.trim() || DEFAULT_BASE_DIR,
    vaults: raw?.vaults ?? [],
    lastVault: raw?.lastVault ?? null,
    settings: normalizeSettings(raw?.settings),
  };
}
