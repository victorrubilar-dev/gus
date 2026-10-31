import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EMPTY_HABITS, type HabitStore } from "../lib/habits";

/** Los hábitos del vault: carga y guardado (`update` aplica el cambio al momento y lo escribe). */
export function useHabitStore(vaultPath: string) {
  const [store, setStore] = useState<HabitStore>(EMPTY_HABITS);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<HabitStore>("load_habits", { vaultPath })
      .then((loaded) => {
        if (cancelled) return;
        setStore(loaded);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(String(reason));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  function update(next: HabitStore) {
    setStore(next);
    setError(null);
    invoke("save_habits", { vaultPath, store: next }).catch((reason: unknown) => setError(String(reason)));
  }

  return { store, status, error, update };
}
