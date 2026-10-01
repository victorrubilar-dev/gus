import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MarkdownEditor from "../src/components/MarkdownEditor";
import "../src/App.css";

/**
 * Banco de pruebas del editor de tablas, sin Tauri: el editor pinta la nota y
 * solo llama a `invoke` al guardar, así que aquí se puede probar la selección
 * de celdas y el menú contextual con el ratón de verdad.
 */
const TABLA = [
  "| Nombre | Apellido | Puntos |",
  "| --- | --- | --- |",
  "| Ana | Ruiz | 10 |",
  "| Luis | Paz | 20 |",
  "| Eva | Sol | 30 |",
  "",
  "Texto de después.",
].join("\n");

const root = document.getElementById("root") as HTMLElement;

createRoot(root).render(
  <StrictMode>
    <div className="h-screen w-screen">
      <MarkdownEditor path="/tmp/prueba.md" title="Prueba" content={TABLA} />
    </div>
  </StrictMode>,
);
