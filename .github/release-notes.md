## Gus v0.4.0 🚀

Una versión para **empezar el día en Gus**: un resumen nuevo, hábitos con meta semanal y unas pizarras mucho más completas. Tus notas y tareas no cambian: es el mismo vault.

### ✨ Qué hay de nuevo

- 🌅 **Un Resumen nuevo, «Hoy».** Es lo primero que ves al abrir la app: tus **tareas de hoy y las vencidas** (con casilla para marcarlas), los **hábitos del día**, la **nota del día** y lo último que tocaste (notas, pizarras y PDF) para seguir donde lo dejaste.
- 🔥 **Hábitos con meta semanal.** Además de los días fijos, un hábito puede ser «3 veces por semana, el día que quieras»: lo que cuenta es llegar al total de la semana. La racha pasa a contarse en semanas.
- 🖍️ **Pizarras, mucho más completas.**
  - **Miniatura** de cada pizarra en la lista.
  - **Exportar** la pizarra entera a **SVG** (vectorial, nítido con zoom) o **PNG**, o **copiarla como imagen** al portapapeles.
  - **Menú «⋯»** en cada una: abrir, renombrar, duplicar, fijar arriba, color de etiqueta, exportar y papelera.
  - **Selección múltiple** para duplicar, exportar o borrar varias a la vez.
  - **Buscar** por nombre y **ordenar** (recientes, antiguas, A–Z, Z–A).
- 👋 **Primera vez más clara.** La bienvenida explica qué es Gus, un paso nuevo te deja crear tu **primer vault** con el nombre ya puesto (o usar una carpeta que ya tengas, como una de Obsidian) y el **recorrido guiado** está al día: ahora pasa por Hábitos y por Grafo, Biblioteca y Pizarras.
- ⚙️ **Configuración reorganizada.** Seis categorías (General, Apariencia, Notas, Tareas y avisos, Atajos y Acerca de) con cada ajuste en su sitio, y una sección **Acerca de** con la versión, la privacidad y los enlaces.

### 🛠️ Arreglos

- **El explorador y el grafo dejan de moverse solos.** Leer o listar el vault contaba como un «cambio externo» y la app se recargaba en bucle: el explorador parpadeaba con «Leyendo vault…» y el grafo se recolocaba sin parar.
- **Guardado más seguro.** Notas, tareas, hábitos, pizarras y biblioteca se escriben de forma atómica: un corte a mitad de guardado ya no puede dejar un archivo vacío o a medias.
- **Grafo y backlinks completos** en vaults de más de 1.000 notas (antes quedaban fuera las últimas).
- **Atajos del explorador:** Alt+←, Alt+→ y Alt+↑ (atrás, adelante y carpeta superior) no respondían nunca; ahora sí.
- El botón **«Siguiente»** del recorrido ya no sobresale del cartel, y la carpeta vacía del explorador ya no escribe «Nueva carpetao».

### ⚠️ A tener en cuenta

- **La app ahora abre siempre en el Resumen**, no en Notas. Por eso se quita el ajuste «Empezar en Notas al cambiar de vault»: ya no tenía sentido.
- Las pizarras guardan dos campos opcionales nuevos (fijada y color). Las que ya tienes siguen funcionando sin tocar nada.
- Por dentro, el código se ha reorganizado a fondo (la pantalla principal, el explorador y el editor están partidos en piezas más pequeñas) sin cambiar su comportamiento. Si notas algo raro en el editor o en las tablas, avísame.
- Esta versión se instala **sola** desde la 0.3.0 en AppImage, Windows y macOS; con **`.deb` y `.rpm`** el aviso te ofrece descargar el instalador.
- Las peticiones de red siguen siendo solo a GitHub y solo para actualizar; los detalles están en `PRIVACY.md`.
