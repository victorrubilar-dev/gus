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
const PDF_DE_PRUEBA = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMjAgMTAwIFRkIChIb2xhIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA1IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgozMDgKJSVFT0YK";
const archivos = new Map<string, string>([
  ["/vault/bienvenida.md", "# Bienvenida\n"],
  ["/vault/manual.pdf", ""],
]);
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
  read_vault_pdf: () => PDF_DE_PRUEBA,
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
