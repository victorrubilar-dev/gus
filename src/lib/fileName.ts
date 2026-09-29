export function baseName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

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

export function pathWithTitle(path: string, title: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const separator = lastSlash === -1 ? "" : path.slice(lastSlash, lastSlash + 1);

  return `${dir}${separator}${safeFileName(title)}.md`;
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

export function parentPath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

export function isImageName(name: string): boolean {
  return /\.(png|apng|jpe?g|jpe|jfif|gif|webp|svg|bmp|avif|ico|cur|tiff?|heic|heif|jxl|pnm|ppm|pgm|pbm|qoi|xbm)$/i.test(
    name,
  );
}

export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

export function isInsidePath(path: string, dir: string): boolean {
  if (path === dir) return true;
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return path.startsWith(dir.endsWith(separator) ? dir : `${dir}${separator}`);
}

export function renameTarget(path: string, rawValue: string, kind: "note" | "image" | "pdf"): string {
  if (kind !== "note") {
    const extension = path.match(/\.[^./\\]+$/)?.[0] ?? "";
    const typedHasExtension = kind === "pdf" ? isPdfName(rawValue) : isImageName(rawValue);
    const stripped = typedHasExtension ? rawValue.replace(/\.[^./\\]+$/, "") : rawValue;
    return joinPath(parentPath(path), `${safeFileName(stripped)}${extension}`);
  }
  return pathWithTitle(path, rawValue);
}
