## Gus v0.4.1 🎨

Una versión para **hacer Gus más tuyo**: emojis en tus notas, una galería con todas tus imágenes, leer y escribir a la vez y temas de color propios. Tus notas y tareas no cambian: es el mismo vault.

### ✨ Qué hay de nuevo

- 🎨 **Temas propios.** En Ajustes → Apariencia, «Nuevo tema» parte del que tienes puesto y te deja cambiar el fondo, los paneles, los bordes, los textos y el acento, claro u oscuro. **Toda la app se pinta con él mientras lo editas**, y te avisa si algún color queda con poco contraste para leer. Puedes guardar los que quieras, **exportarlos a un archivo JSON** y **importar** los de otra persona.
- 📖 **Leer y escribir a la vez.** La cabecera de cada nota tiene ahora **Editar · Dividido · Lectura**. En «Dividido» ves el texto y la nota ya formateada lado a lado, y el **scroll va sincronizado**. Hay también un botón de **pantalla completa** para leer sin distracciones (Esc para salir).
- 🖼️ **Galería de imágenes.** Una pestaña nueva con **todas las imágenes del vault** en una rejilla de miniaturas. Filtra por nombre, carpeta o fecha, ábrelas en un visor a pantalla completa (←/→ para pasar de una a otra) y **muévelas de carpeta o mándalas a la papelera** desde ahí.
- 😀 **Un emoji para cada nota.** Clic derecho en una nota → «Icono…». Se ve en el explorador, delante de los enlaces `[[así]]` y en la paleta de comandos, donde además puedes buscar por emoji. Se guarda en la propia nota (`icon:` al principio del archivo), así que te acompaña si la renombras o la mueves.

### 🛠️ Arreglos

- **El tema que elegías no se guardaba.** Al cerrar y volver a abrir Gus volvía siempre a «Gus oscuro» (y el acento «del tema» pasaba a terracota). Ahora el tema y su acento se recuerdan.

### ⚠️ A tener en cuenta

- El botón **«Vista previa»** del editor pasa a ser el selector de tres modos; **Ctrl+Mayús+V sigue alternando** entre editar y leer.
- «Restablecer» en Ajustes **no borra tus temas**: son tuyos, no un ajuste.
- Esta versión se instala **sola** desde la 0.3.0 en AppImage, Windows y macOS; con **`.deb` y `.rpm`** el aviso te ofrece descargar el instalador.
- Las peticiones de red siguen siendo solo a GitHub y solo para actualizar; los detalles están en `PRIVACY.md`.
