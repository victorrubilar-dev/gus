import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import "../src/App.css";

/**
 * Banco de la app completa, sin Tauri: `__TAURI_INTERNALS__` finge el backend
 * con un vault en memoria. Lo que se escribe o se crea queda en `window.__smoke`
 * para que el smoke test (`bench/prueba-app.mjs`) compruebe que llegó al «disco».
 */
interface Entrada {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms: number | null;
}

const ahora = 1_700_000_000_000;
const archivos = new Map<string, string>([["/vault/bienvenida.md", "# Bienvenida\n"]]);
const llamadas: { cmd: string; args: Record<string, unknown> }[] = [];
const tareas: unknown[] = [];

/** Entradas directas de `dir`, como las da `list_vault_entries`. */
function entradasDe(dir: string): Entrada[] {
  const prefijo = `${dir.replace(/\/$/, "")}/`;
  const vistas = new Map<string, Entrada>();
  for (const ruta of archivos.keys()) {
    if (!ruta.startsWith(prefijo)) continue;
    const [primero, ...resto] = ruta.slice(prefijo.length).split("/");
    const path = prefijo + primero;
    if (!vistas.has(path)) {
      vistas.set(path, { name: primero, path, is_dir: resto.length > 0, modified_ms: ahora });
    }
  }
  return [...vistas.values()];
}

const respuestas: Record<string, (args: Record<string, unknown>) => unknown> = {
  load_app_config: () => ({
    baseDir: "/vaults",
    vaults: [{ name: "Demo", path: "/vault" }],
    lastVault: "/vault",
    settings: { openLastVault: true },
  }),
  vault_dir_exists: () => true,
  list_vault_entries: (args) => entradasDe(String(args.path)),
  read_vault_file: (args) => archivos.get(String(args.path)) ?? "",
  write_vault_file: (args) => {
    archivos.set(String(args.path), String(args.content));
    return null;
  },
  create_vault_file: (args) => {
    archivos.set(String(args.path), String(args.content));
    return args.path;
  },
  load_tasks: () => tareas,
  save_tasks: (args) => {
    tareas.splice(0, tareas.length, ...(args.tasks as unknown[]));
    return null;
  },
  build_link_graph: () => ({ nodes: [], generatedMs: ahora }),
  read_legacy_tasks: () => "",
  save_app_config: () => null,
};

(window as unknown as { __smoke: unknown }).__smoke = { archivos, llamadas, tareas };
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    llamadas.push({ cmd, args: args ?? {} });
    const respuesta = respuestas[cmd];
    if (respuesta) return respuesta(args ?? {});
    if (cmd.startsWith("list_") || cmd.startsWith("build_") || cmd.startsWith("read_legacy")) {
      return [];
    }
    return null;
  },
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
