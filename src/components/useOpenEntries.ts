import { useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../lib/i18n";
import { baseName, isInsidePath } from "../lib/fileName";
import type { NoteFile } from "./FileExplorer";
import type { OpenImage } from "./ImagePane";
import type { EditorDraft, MarkdownEditorHandle } from "./MarkdownEditor";
import type { NoteTab } from "./NoteTabs";
import type { OpenPdf } from "./PdfPane";

export type NoteStatus = "idle" | "loading" | "ready" | "error";

export interface OpenNote {
  path: string;
  title: string;
  content: string;
}

function titleFromFileName(name: string): string {
  return name.replace(/\.md$/i, "");
}

interface OpenEntriesOptions {
  editorRef: RefObject<MarkdownEditorHandle | null>;
  /** Aparecen, cambian de nombre o desaparecen archivos: el explorador debe releer. */
  onFilesChanged: () => void;
  /** El editor acaba de guardar la nota (para mantener el índice de búsqueda). */
  onNoteSaved: (draft: EditorDraft) => void;
}

/**
 * Lo que hay abierto en el panel derecho: una nota (con sus pestañas), una imagen
 * o un PDF. Solo uno a la vez; las peticiones lentas se descartan si llegan tarde.
 */
export function useOpenEntries({ editorRef, onFilesChanged, onNoteSaved }: OpenEntriesOptions) {
  const t = useT();
  const [note, setNote] = useState<OpenNote | null>(null);
  /** Notas abiertas, en el orden en que se abrieron; la visible es `note`. */
  const [tabs, setTabs] = useState<NoteTab[]>([]);
  const [noteStatus, setNoteStatus] = useState<NoteStatus>("idle");
  const [noteError, setNoteError] = useState<string | null>(null);
  /** Nota que debe abrir el diálogo de exportación a PDF en cuanto cargue. */
  const [pendingExport, setPendingExport] = useState<string | null>(null);
  const [image, setImage] = useState<OpenImage | null>(null);
  const [imageStatus, setImageStatus] = useState<NoteStatus>("idle");
  const [pdf, setPdf] = useState<OpenPdf | null>(null);
  const [pdfStatus, setPdfStatus] = useState<NoteStatus>("idle");
  /** Solo la última petición de imagen puede escribir en el estado. */
  const imageRequestRef = useRef(0);
  /** Solo la última petición de PDF puede escribir en el estado. */
  const pdfRequestRef = useRef(0);
  const notePathRef = useRef<string | null>(null);

  function handleSelectNote(file: NoteFile) {
    if (file.kind === "image") {
      handleSelectImage(file);
      return;
    }
    if (file.kind === "pdf") {
      handleSelectPdf(file);
      return;
    }

    imageRequestRef.current += 1;
    setImage(null);
    setImageStatus("idle");
    pdfRequestRef.current += 1;
    setPdf(null);
    setPdfStatus("idle");

    setNoteStatus("loading");
    setNoteError(null);

    invoke<string>("read_vault_file", { path: file.id })
      .then((content) => {
        notePathRef.current = file.id;
        const title = titleFromFileName(file.name);
        setNote({ path: file.id, title, content });
        setTabs((open) => (open.some((tab) => tab.path === file.id) ? open : [...open, { path: file.id, title }]));
        setNoteStatus("ready");
      })
      .catch((error: unknown) => {
        setTabs((open) => open.filter((tab) => tab.path !== file.id));
        notePathRef.current = null;
        setNote(null);
        setNoteError(String(error));
        setNoteStatus("error");
        setPendingExport(null);
      });
  }

  /** Cambia de pestaña guardando antes lo que haya sin guardar en la nota actual. */
  async function handleSelectTab(tab: NoteTab) {
    if (tab.path === note?.path) return;
    try {
      if (notePathRef.current) await handleBeforeFileAction(notePathRef.current);
    } catch (error: unknown) {
      setNoteError(String(error));
      return;
    }
    handleSelectNote({ id: tab.path, name: baseName(tab.path), kind: "note" });
  }

  async function handleCloseTab(tab: NoteTab) {
    if (tab.path !== note?.path) {
      setTabs((open) => open.filter((other) => other.path !== tab.path));
      return;
    }
    try {
      await handleBeforeFileAction(tab.path);
    } catch (error: unknown) {
      setNoteError(String(error));
      return;
    }
    const index = tabs.findIndex((other) => other.path === tab.path);
    const next = tabs[index + 1] ?? tabs[index - 1];
    if (!next) {
      closeOpenNote();
      return;
    }
    setTabs((open) => open.filter((other) => other.path !== tab.path));
    handleSelectNote({ id: next.path, name: baseName(next.path), kind: "note" });
  }

  function handleSelectImage(file: NoteFile) {
    const token = ++imageRequestRef.current;
    pdfRequestRef.current += 1;
    setPdf(null);
    setPdfStatus("idle");
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);

    setImage({ path: file.id, title: file.name, src: null });
    setImageStatus("loading");

    invoke<string>("read_vault_image", { path: file.id })
      .then((src) => {
        if (token !== imageRequestRef.current) return;
        setImage({ path: file.id, title: file.name, src });
        setImageStatus("ready");
      })
      .catch((error: unknown) => {
        if (token !== imageRequestRef.current) return;
        setImage({ path: file.id, title: file.name, src: null, error: String(error) });
        setImageStatus("error");
      });
  }

  function handleSelectPdf(file: NoteFile) {
    const token = ++pdfRequestRef.current;
    imageRequestRef.current += 1;
    setImage(null);
    setImageStatus("idle");
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);

    setPdf({ path: file.id, title: file.name, src: null });
    setPdfStatus("loading");

    invoke<string>("read_vault_pdf", { path: file.id })
      .then((src) => {
        if (token !== pdfRequestRef.current) return;
        setPdf({ path: file.id, title: file.name, src });
        setPdfStatus("ready");
      })
      .catch((error: unknown) => {
        if (token !== pdfRequestRef.current) return;
        setPdf({ path: file.id, title: file.name, src: null, error: String(error) });
        setPdfStatus("error");
      });
  }

  function handleAutoSave(draft: EditorDraft) {
    if (notePathRef.current && notePathRef.current !== draft.path) {
      const previous = notePathRef.current;
      setTabs((open) => open.map((tab) => (tab.path === previous ? { path: draft.path, title: draft.title } : tab)));
      onFilesChanged();
    }
    notePathRef.current = draft.path;
    setNote((prev) => (prev ? { ...prev, ...draft } : prev));
    onNoteSaved(draft);
  }

  function handleFileDeleted(path: string) {
    setTabs((open) => open.filter((tab) => !isInsidePath(tab.path, path)));
    if (image?.path === path) {
      imageRequestRef.current += 1;
      setImage(null);
      setImageStatus("idle");
      return;
    }

    if (pdf?.path === path) {
      pdfRequestRef.current += 1;
      setPdf(null);
      setPdfStatus("idle");
      return;
    }

    if (notePathRef.current !== path) return;
    notePathRef.current = null;
    setNote(null);
    setNoteError(null);
    setNoteStatus("idle");
  }

  // Volcado previo: evita que el editor recriba el archivo en la ruta vieja al desmontarse.
  async function handleBeforeFileAction(path: string): Promise<void> {
    if (notePathRef.current !== path) return;

    const saved = await editorRef.current?.flush() ?? true;
    if (!saved) {
      throw new Error(t("app.saveBeforeAction"));
    }
  }

  function closeOpenNote() {
    setTabs([]);
    imageRequestRef.current += 1;
    pdfRequestRef.current += 1;
    notePathRef.current = null;
    setNote(null);
    setNoteStatus("idle");
    setNoteError(null);
    setImage(null);
    setImageStatus("idle");
    setPdf(null);
    setPdfStatus("idle");
  }

  /** El webview no pudo decodificar la imagen abierta. */
  function failImage(error: string) {
    if (!image) return;
    setImage({ ...image, error });
    setImageStatus("error");
  }

  return {
    note,
    tabs,
    noteStatus,
    noteError,
    pendingExport,
    setPendingExport,
    image,
    imageStatus,
    pdf,
    pdfStatus,
    notePathRef,
    handleSelectNote,
    handleSelectTab,
    handleCloseTab,
    handleAutoSave,
    handleFileDeleted,
    handleBeforeFileAction,
    closeOpenNote,
    failImage,
  };
}
