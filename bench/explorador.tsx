import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FileExplorer from "../src/components/FileExplorer";
import "../src/App.css";

/**
 * Banco del explorador, sin Tauri: se finge `__TAURI_INTERNALS__` para que el
 * listado salga de un vault de mentira y «mover a la papelera» se apunte en
 * memoria. Así se puede probar con teclado de verdad el confirm de Supr, que
 * es lo que solo se comprueba pulsando flechas e Intro sobre el diálogo.
 */
interface Entrada {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms: number | null;
}

const ahora = 1_700_000_000_000;
const entradas: Entrada[] = [
  { name: "Notas", path: "/vault/Notas", is_dir: true, modified_ms: ahora },
  { name: "ana.md", path: "/vault/ana.md", is_dir: false, modified_ms: ahora },
  { name: "luis.md", path: "/vault/luis.md", is_dir: false, modified_ms: ahora },
];

/** Camino de cada nota que este banco ha «movido a la papelera». */
const borrados: string[] = [];

interface Internals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

(window as unknown as { __borrados: string[] }).__borrados = borrados;
(window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "list_vault_entries") return entradas;
    if (cmd === "move_to_trash") {
      const path = String(args?.path ?? "");
      borrados.push(path);
      const at = entradas.findIndex((entry) => entry.path === path);
      if (at >= 0) entradas.splice(at, 1);
      return null;
    }
    throw new Error(`comando sin fingir: ${cmd}`);
  },
};

const root = document.getElementById("root") as HTMLElement;

createRoot(root).render(
  <StrictMode>
    <div className="h-screen w-screen">
      <FileExplorer vaultPath="/vault" />
    </div>
  </StrictMode>,
);
