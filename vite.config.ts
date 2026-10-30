import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest vacía los .css; App.css se deja pasar para que un test lea los colores del esquema claro.
  test: { css: { include: [/App\.css/] } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});