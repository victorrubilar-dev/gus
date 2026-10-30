## Gus v0.2.0 🎨

Un **re-diseño completo**: nueva paleta, navegación más clara y un editor con pestañas. Tus notas y tareas no cambian: es el mismo vault, con otra cara.

### ✨ Qué cambia

- 🎨 **Paleta nueva**, sacada del logo: negros y blancos cálidos con el bermellón como acento. El acento queda para acciones, selección y foco; etiquetas e insignias pasan a neutro.
- 📝 **Pestañas de notas abiertas**: cada nota queda en su pestaña, con cierre propio (también con clic central). Al cambiar de pestaña se guarda lo pendiente.
- 📖 **Editor con medida de lectura** de 680 px centrada, y cabecera con el nombre, el estado de guardado y un menú ⋯.
- 🧭 **Barra lateral con nombres** (Resumen, Notas, Tareas, Calendario, Grafo), de ancho ajustable y con un botón para contraerla a solo iconos.
- 🏠 **Notas es la pantalla de inicio.** La búsqueda y la nota de hoy pasan a la fila del recorrido de Notas, y `Ctrl K` ofrece buscar en el vault.
- 🔤 **Texto más legible**: tres tamaños en toda la app, contraste AA en los siete temas, y el texto sigue el tamaño de fuente del sistema.
- ♿ **Accesibilidad de escritorio**: foco visible en todos los controles, y respeto a «reducir movimiento» y «reducir transparencia» del sistema.
- 🧩 **Tareas, Calendario y Grafo** comparten cabecera, selector de vistas y estados vacíos.
- 🍎 **Menú nativo en macOS** (Gus, Archivo, Edición, Ver), en español o inglés según el idioma de la app.

### ⚠️ A tener en cuenta

- Quien ya tenía la barra lateral estrecha la sigue viendo en modo iconos; puedes ensancharla arrastrando su borde o con el botón de la parte de abajo.
- El menú nativo de macOS no se ha podido probar en un Mac antes de publicar.

### 🛠️ Cambios internos

- El editor está repartido en módulos más pequeños (vista previa, etiquetas, imágenes, corrector y portapapeles). No cambia el comportamiento.
- Nuevas pruebas: regresión visual en los temas oscuro y claro, foco con teclado, corrector, portapapeles y pestañas.

### 📦 Instaladores

| Sistema | Archivos |
|---|---|
| Linux | `.deb` (Debian/Ubuntu), `.rpm` (Fedora), `.AppImage` |
| Windows | `.exe` / `.msi` |
| macOS | `.dmg` |

**Nota para Linux:** el botón de descarga del aviso de versión baja el `.AppImage`, que funciona en cualquier distribución. Si prefieres el `.rpm` o el `.deb`, descárgalo desde la página de la release.

**Nota para Windows y macOS:** los instaladores no están firmados. Windows (SmartScreen) y macOS (Gatekeeper) pueden pedir confirmación antes de abrirlos.

**Nota sobre los avisos:** están **apagados por defecto** y se encienden en Ajustes → Tareas. Piden permiso al sistema; nada sale de tu equipo.

---

_Repositorio: https://github.com/victorrubilar-dev/gus · Licencia: GPL-3.0_
