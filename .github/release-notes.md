## Gus v0.1.4 🚀

Actualización centrada en **actualizar sin buscar**: el aviso de versión nueva ahora puede bajar el instalador de tu sistema y abrirlo por ti.

### ✨ Qué incluye

- ⬇️ **Descargar la actualización desde el aviso**: si hay una versión nueva, el botón «Descargar y abrir el instalador» baja el de tu sistema a tu carpeta de Descargas y lo abre. Nada se descarga si no lo pulsas, y solo desde la página de releases de este proyecto
- 🔗 Si la versión no trae instalador para tu sistema, el aviso sigue enlazando a la página de la release, como antes
- 🧹 **Papelera más fiable**: si no se puede guardar el registro de lo que has tirado, Gus lo dice en vez de fallar en silencio

### 🛠️ Cambios internos

- La compilación de instaladores ahora ejecuta antes los tests (TypeScript, Vitest y Rust), y no publica nada si fallan
- Comprobación automática de que la versión es la misma en todos los ficheros del proyecto
- Retirada la traza de depuración del editor y los recursos sin uso

### 📦 Instaladores

| Sistema | Archivos |
|---|---|
| Linux | `.deb` (Debian/Ubuntu), `.rpm` (Fedora), `.AppImage` |
| Windows | `.exe` / `.msi` |
| macOS | `.dmg` |

**Nota para Linux:** el botón de descarga baja el `.AppImage`, que funciona en cualquier distribución. Si prefieres el `.rpm` o el `.deb`, descárgalo desde la página de la release.

**Nota para Windows y macOS:** los instaladores no están firmados. Windows (SmartScreen) y macOS (Gatekeeper) pueden pedir confirmación antes de abrirlos.

**Nota sobre los avisos:** están **apagados por defecto** y se encienden en Ajustes → Tareas. Piden permiso al sistema; nada sale de tu equipo.

---

_Repositorio: https://github.com/victorrubilar-dev/gus · Licencia: GPL-3.0_
