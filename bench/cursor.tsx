import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MarkdownEditor from "../src/components/MarkdownEditor";
import "../src/App.css";

/**
 * Banco del cursor: una nota vacía, sin tablas, para probar imágenes de bloque
 * seguidas de saltos de línea (`bench/prueba-cursor.mjs`). Sin Tauri, como el
 * banco del editor.
 */
const root = document.getElementById("root") as HTMLElement;

createRoot(root).render(
  <StrictMode>
    <div className="h-screen w-screen">
      <MarkdownEditor path="/tmp/prueba.md" vaultPath="/tmp/vault" title="Prueba" content="" />
    </div>
  </StrictMode>,
);
