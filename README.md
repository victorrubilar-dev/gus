<div align="center">
  <img src="src/assets/gus-icon-512.png" alt="Logo de Gus" width="256" style="border-radius: 8px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
  <h1>Gus</h1>
</div>




Una aplicación de escritorio **100 % local** para tomar notas y gestionar tareas. Las notas viven en archivos `.md` de una carpeta tuya; las tareas, en un almacén JSON oculto por vault. Sin nube, sin cuentas.

**Tecnología:** Tauri v2 (backend en Rust + el WebView del sistema). Ligera y rápida.

---

## Características principales

- **Notas Markdown** — explorador de carpetas (crear, renombrar, mover y borrar); editor con renderizado en línea; tablas estilo Obsidian con filas/columnas flexibles, arrastrar para redimensionar y menú de acciones; listas numeradas con renumeración automática; deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z); mover líneas (Alt+↑ / Alt+↓); **autoguardado** con debounce de 500 ms (se puede desactivar en Ajustes → Notas, que entonces usa Ctrl+S).

- **Etiquetas** — chips en la cabecera del editor; viven en el frontmatter `tags: [a, b]` y se autocompletan con las usadas en el vault.

- **Menú `/`** — inserta títulos, listas, tareas, citas, tablas, código, imágenes y más. Dentro de una tabla ofrece acciones de agregar/eliminar filas y columnas, marcar tareas, ordenar, alinear y copiar celdas. Fuera de tabla, convierte texto seleccionado en tabla (separa por tabuladores, comas o `|`).

- **Corrector ortográfico** — subrayado ondulado con uno o varios diccionarios (7 idiomas); las palabras están subrayadas al pasar el cursor. Sugerencias en un cuadro al pasar el cursor: **Alt+Intro** aplica, **↑/↓** recorre, **1-9** aplica, **Esc** descarta.

- **Menú derecho** — siempre visible: cortar/copiar/pegar/pegar sin formato/seleccionar todo, y submenús para insertar bloques (código, tablas, fórmulas, diagramas), texto y formato. Si el clic está sobre una tabla, muestra sus acciones.

- **Fórmulas y diagramas** — `$…$` / `$$…$$` con KaTeX y bloques ` ```mermaid ` con Mermaid (carga diferida).

- **Visor de imágenes** — png, jpg, gif, webp, svg y más en el panel derecho. Tres vías de inserción: arrastrar sobre el texto, `/` → *Imagen del vault* (selector con miniaturas y buscador) o `/` → *Imagen del equipo* (diálogo del sistema). Lo del vault se enlaza sin copiar; lo de fuera se copia junto a la nota en ruta relativa.

- **Visor de PDF** — pdf.js con zoom y paginación integrado.

- **Autoguardado** — debounce 500 ms; se desactiva en Ajustes → Notas.

---

## Descarga

Disponible en las [ releases ](https://github.com/korossuh/gus/releases) de GitHub. La primera vez que se ejecuta, Tauri solicita permisos de acceso a la carpeta de notas.

---

## Desarrollo

```bash
npx tsc --noEmit          # TypeScript check
npx vitest run            # tests (114 passed)
npx vite build            # build
npx -y react-doctor@latest --json  # reporte de calidad (react-doctor)
```