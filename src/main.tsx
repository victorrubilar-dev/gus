import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, storedTheme } from "./lib/themes";

// Pinta el tema de la sesión anterior antes del primer render para evitar
// un parpadeo del tema por defecto mientras se leen los ajustes.
applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
