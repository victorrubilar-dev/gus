## Gus v0.1.5 🚀

Actualización centrada en **la papelera de cada vault** y en una app más segura: la ventana solo carga lo que Gus necesita.

### ✨ Qué cambia

- 🗑️ **Papelera por vault**: lo que borras en un vault se guarda en la carpeta `.gus-trash` de ese mismo vault, así que viaja con él. Antes había una única papelera compartida por todos los vaults.
- 🔄 **Migración automática**: al abrir esta versión, lo que quedaba en la papelera antigua (`~/gus-vault/.gus-trash`) se pasa a la papelera del vault al que pertenecía. Lo que no es de ningún vault conocido se queda donde estaba, sin tocar.
- 🛡️ **Política de contenido activa**: la ventana solo puede cargar recursos de la propia app. No cambia nada de lo que ves, pero reduce el daño que podría causar un fallo al mostrar una nota.
- 🧹 **Papelera más fiable**: si no se puede guardar el registro de lo que has tirado, Gus lo dice en vez de fallar en silencio.

### ⚠️ A tener en cuenta

- Como la papelera y el índice de búsqueda viven dentro del vault, Nextcloud, Syncthing y similares los sincronizan también. Si no quieres eso, excluye `.gus-trash` y `.gus-index` en tu herramienta de sincronización.

### 🛠️ Cambios internos

- El backend y el editor están repartidos en módulos más pequeños. No cambia el comportamiento.
- Nuevas pruebas del teclado en tablas y de la app completa, además de las de siempre.
- La compilación de instaladores ejecuta antes los tests y no publica nada si fallan.

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
