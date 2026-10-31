## Gus v0.3.0 🚀

Gus crece: **biblioteca de PDF, hábitos y pizarras**, subtareas, tus checkboxes de notas convertidos en tareas… y a partir de esta versión **se actualiza solo**. Tus notas y tareas no cambian: es el mismo vault.

### ✨ Qué hay de nuevo

- 🔄 **Actualizaciones automáticas.** Gus avisa dentro de la app cuando hay una versión nueva, la descarga en segundo plano con una barra de progreso (verificando su firma) y, al terminar, un botón **Reiniciar y actualizar** la instala y vuelve a abrir la app. Nunca se instala nada sin que lo pidas.
- 📚 **Biblioteca de PDF.** Tus PDF como tarjetas con su portada, ordenados en **estanterías** que defines tú (Bibliografía, Clases, Programación…).
- 🔥 **Hábitos.** Define qué días haces cada hábito y sigue el día con **anillos de cierre diario** o con un **tracker** clásico, con rachas y porcentaje de cumplimiento.
- 🖍️ **Pizarras.** Lienzos libres con lápiz, **goma**, formas, flechas, texto, **post-it** e imágenes de tu vault; con deshacer/rehacer y zoom.
- ✅ **Tus checkboxes, como tareas.** La vista *Notas* de Tareas reúne los `- [ ]` de todas tus notas, agrupados por nota de origen y filtrables. Marcar uno reescribe su línea en la nota.
- 🌿 **Subtareas y dependencias.** Una tarea puede colgar de otra, con su progreso, y estar «bloqueada por» otras. Lo comprueba también el guardado: no admite ciclos.
- 👀 **Cambios externos.** Si editas una nota con otro programa, Gus la recarga sola; si tenías cambios sin guardar, te deja elegir entre recargar o conservar los tuyos.

### ⚠️ A tener en cuenta

- **Si vienes de la 0.2.0 o anterior, esta versión se instala a mano** (descargando el instalador): esas versiones aún no traen el actualizador. Desde esta en adelante, cada versión se instala sola en **AppImage, Windows y macOS**. Los paquetes **`.deb` y `.rpm`** no pueden reemplazarse a sí mismos: el aviso te ofrece descargar el instalador.
- En macOS, la actualización automática es solo para **Apple Silicon**.
- Es la primera versión con actualización automática y su instalación de extremo a extremo no se ha podido probar antes de publicar. Si algo falla, el aviso muestra el error y un botón para reintentar o ver los cambios.
- Aparecen archivos nuevos y ocultos en tu vault: `.gus-library.json` (estanterías), `.gus-habits.json` (hábitos) y la carpeta `.gus-boards/` (pizarras). Siguen siendo locales y no necesitas tocarlos.
- Las peticiones de red siguen siendo solo a GitHub y solo para actualizar; los detalles están en `PRIVACY.md`.
