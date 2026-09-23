/** Nombres y rutas de los archivos del vault (compartidos por editor y explorador). */

/** Último segmento de una ruta (nombre del archivo o carpeta). */
export function baseName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/** Nombre de archivo seguro a partir del título (sin cambiar de directorio). */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/\.md$/i, "")
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");

  return cleaned || "sin-titulo";
}

/** Ruta resultante de aplicarle `title` al archivo `path`. */
export function pathWithTitle(path: string, title: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const separator = lastSlash === -1 ? "" : path.slice(lastSlash, lastSlash + 1);

  return `${dir}${separator}${safeFileName(title)}.md`;
}

/** Une un directorio con un nombre respetando el separador del directorio. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

/** Directorio que contiene `path` ("" si la ruta no tiene separador). */
export function parentPath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

/** ¿Es un archivo que la app puede mostrar como imagen? */
export function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);
}

/** ¿Está `path` dentro de (o es) la carpeta `dir`? Compara por segmento completo. */
export function isInsidePath(path: string, dir: string): boolean {
  if (path === dir) return true;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return path.startsWith(dir.endsWith(separator) ? dir : `${dir}${separator}`);
}

/** Ruta final al renombrar `path` con el texto `rawValue`.
 *
 * - Notas: el título manda y se vuelve a añadir `.md`.
 * - Imágenes: se conserva la extensión original, aunque el usuario la vuelva
 *   a escribir (`foto.png` → `playa.png` sigue siendo `.png`, no `.md`).
 */
export function renameTarget(path: string, rawValue: string, kind: "note" | "image"): string {
  if (kind === "image") {
    const extension = path.match(/\.[^./\\]+$/)?.[0] ?? "";
    const stripped = isImageName(rawValue) ? rawValue.replace(/\.[^./\\]+$/, "") : rawValue;
    return joinPath(parentPath(path), `${safeFileName(stripped)}${extension}`);
  }
  return pathWithTitle(path, rawValue);
}
