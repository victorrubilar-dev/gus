import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isInsidePath, parentPath } from "../lib/fileName";
import { imageFilters, importFilesIntoVault, summarizeImageInsert, type ImageInsertResult, type ImportSummary } from "../lib/importFiles";
import { filterVaultImages, imageAlt, imageDest, imageMarkdown, type VaultImage } from "../lib/imageLinks";
import { stripFrontmatter } from "../lib/noteTags";
import { DRAG_ENTRY_MIME, type DragEntry } from "./FileExplorer";
import type { EditorMenu } from "./markdownEditorTypes";

const EMPTY_IMAGES: VaultImage[] = [];

/** Lo que las imágenes necesitan del editor: la nota, el campo de texto y cómo escribir en él. */
export interface EditorImagesDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  content: string;
  path: string;
  vaultPath?: string | null;
  menu: EditorMenu | null;
  replaceRange: (start: number, text: string, caretOffset: number) => void;
  caretAtPoint: (clientX: number, clientY: number) => number | null;
}

export function readExplorerEntry(dataTransfer: DataTransfer): DragEntry | null {
  try {
    const raw = dataTransfer.getData(DRAG_ENTRY_MIME);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "kind" in parsed &&
      "path" in parsed &&
      (parsed.kind === "file" || parsed.kind === "folder") &&
      typeof parsed.path === "string"
    ) {
      return { kind: parsed.kind, path: parsed.path };
    }
  } catch {
    // Ni JSON del explorador ni nada que interpretar.
  }
  return null;
}

/**
 * Imágenes de la nota: lista del vault para el selector «Imagen del vault»,
 * insertar archivos (soltados, del equipo o del vault) y el aviso del resultado.
 */
export function useEditorImages(deps: EditorImagesDeps) {
  const { textareaRef, content, path, vaultPath, menu, replaceRange, caretAtPoint } = deps;

  /** Imágenes del vault para el selector que abre «Imagen del vault». */
  const [vaultImages, setVaultImages] = useState<VaultImage[]>([]);
  const [vaultImagesLoading, setVaultImagesLoading] = useState(false);
  // Aviso de las imágenes recién insertadas desde el menú «/» o soltadas
  // sobre la nota: el de un arrastre del sistema lo enseña App, que es quien
  // lo recibe, para que no salgan dos a la vez.
  const [imageNotice, setImageNotice] = useState<ImportSummary | null>(null);
  const imageNoticeTimerRef = useRef<number | null>(null);
  const imagesRequestRef = useRef(0);

  function showImageNotice(result: ImageInsertResult) {
    // Cancelar el diálogo no es un error: no se avisa de nada.
    if (result.inserted === 0 && result.failed === 0) return;
    setImageNotice(summarizeImageInsert(result));
    if (imageNoticeTimerRef.current !== null) window.clearTimeout(imageNoticeTimerRef.current);
    imageNoticeTimerRef.current = window.setTimeout(() => setImageNotice(null), 8000);
  }

  /**
   * Imágenes que enseña el selector: dependen de su consulta y de la lista del
   * vault, no del índice recorrido, para que el array no cambie al pulsar ↑↓
   * (si no, el efecto de las miniaturas se volvería a disparar en cada tecla).
   */
  const imagesQuery = menu?.kind === "images" ? menu.query : null;
  const imageMatches = useMemo(
    () => (imagesQuery === null ? EMPTY_IMAGES : filterVaultImages(vaultImages, imagesQuery)),
    [imagesQuery, vaultImages],
  );

  // Al desmontar no queda suelto el temporizador del aviso.
  useEffect(() => {
    return () => {
      if (imageNoticeTimerRef.current !== null) window.clearTimeout(imageNoticeTimerRef.current);
    };
  }, []);

  /**
   * Imágenes de todo el vault para el selector que abre «Imagen del vault»: se
   * piden al abrirlo, que recorrer el vault entero no es algo que hacer en
   * cada render.
   */
  function loadVaultImages() {
    if (!vaultPath) {
      setVaultImages([]);
      setVaultImagesLoading(false);
      return;
    }

    const request = ++imagesRequestRef.current;
    setVaultImagesLoading(true);

    invoke<VaultImage[]>("list_vault_images", { path: vaultPath })
      .then((images) => {
        if (request !== imagesRequestRef.current) return;
        setVaultImages(images);
        setVaultImagesLoading(false);
      })
      .catch(() => {
        if (request !== imagesRequestRef.current) return;
        setVaultImagesLoading(false);
      });
  }

  /**
   * Enlaza imágenes en la nota: las que ya están en el vault se referen tal
   * cual y las del equipo se copian antes junto a la nota (si no, el enlace
   * apuntaría a una ruta que vive fuera del vault y se rompería al moverlo).
   *
   * La selección debe haberse colapsado ya en `from` cuando lo que se trae es
   * un arrastre; con el menú «/» abierto, en cambio, `from` es la barra y el
   * cursor sigue al final de la consulta, que es el texto que hay que sustituir.
   */
  async function insertImageFiles(
    sources: string[],
    from: number,
  ): Promise<ImageInsertResult> {
    if (sources.length === 0) return { inserted: 0, failed: 0 };

    const dentro: string[] = [];
    const fuera: string[] = [];
    for (const source of sources) {
      (vaultPath && isInsidePath(source, vaultPath) ? dentro : fuera).push(source);
    }

    const destinos = [...dentro];

    if (fuera.length > 0) {
      const carpeta = parentPath(path);
      if (carpeta) {
        try {
          const items = await importFilesIntoVault(fuera, carpeta);
          for (const item of items) if (item.path) destinos.push(item.path);
        } catch {
          // Sin vault o sin permisos: no se enlaza nada de lo que venía de fuera.
        }
      }
    }

    if (destinos.length === 0) return { inserted: 0, failed: sources.length };

    const enlaces = destinos.map((destino) =>
      imageMarkdown(imageAlt(destino), imageDest(path, destino)),
    );
    // Cada imagen en su línea: sueltas tres y las tres quedan repartidas.
    const texto = enlaces.join("\n");
    replaceRange(from, texto, texto.length);

    return { inserted: destinos.length, failed: sources.length - destinos.length };
  }

  /**
   * Inserta imágenes en el punto `at` (ya en px de documento) o, sin punto, en
   * el cursor. La selección se colapsa antes: si no, lo que se suelta encima
   * de un texto marcado se comería ese texto.
   */
  async function insertImagesDropped(
    sources: string[],
    at: number | null,
  ): Promise<ImageInsertResult> {
    const area = textareaRef.current;
    if (!area) {
      // Vista previa: no hay campo de texto, así que la imagen entra al final.
      return insertImageFiles(sources, stripFrontmatter(content).length);
    }

    const from = at ?? area.selectionStart;
    area.setSelectionRange(from, from);
    return insertImageFiles(sources, from);
  }

  /**
   * Lo que llama App cuando sueltas archivos encima del editor: `point` llega
   * en píxeles físicos, como los da Tauri.
   */
  async function insertImagesAt(
    sources: string[],
    point?: { x: number; y: number },
  ): Promise<ImageInsertResult> {
    const dpr = window.devicePixelRatio || 1;
    const at = point ? caretAtPoint(point.x / dpr, point.y / dpr) : null;
    return insertImagesDropped(sources, at);
  }

  /**
   * Imagen del equipo: se elige en el diálogo del sistema, se copia junto a la
   * nota y se enlaza empezando en `from` (la barra del «/» o el cursor).
   */
  async function insertImagesFromComputer(from: number): Promise<ImageInsertResult> {
    if (!vaultPath) return { inserted: 0, failed: 0 };

    let picked: string | string[] | null = null;
    try {
      picked = await open({ multiple: true, filters: imageFilters() });
    } catch {
      return { inserted: 0, failed: 0 };
    }
    // Cancelar el diálogo no es un error: simplemente no se inserta nada.
    if (!picked) return { inserted: 0, failed: 0 };

    const sources = Array.isArray(picked) ? picked : [picked];
    const result = await insertImageFiles(sources, from);
    showImageNotice(result);
    return result;
  }

  function insertVaultImage(image: VaultImage) {
    const area = textareaRef.current;
    const start =
      menu?.kind === "images" ? menu.start : (area?.selectionStart ?? stripFrontmatter(content).length);
    const texto = imageMarkdown(imageAlt(image.name), imageDest(path, image.path));
    replaceRange(start, texto, texto.length);
    showImageNotice({ inserted: 1, failed: 0 });
  }

  return {
    imageMatches,
    vaultImagesLoading,
    imageNotice,
    showImageNotice,
    loadVaultImages,
    insertImagesDropped,
    insertImagesAt,
    insertImagesFromComputer,
    insertVaultImage,
  };
}
