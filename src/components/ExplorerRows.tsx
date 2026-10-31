import { useRef, useState, type DragEvent, type MouseEvent } from "react";
import { m } from "framer-motion";
import clsx from "clsx";
import { FileText, File as FileIcon, Folder, Image as ImageIcon } from "lucide-react";
import { useT } from "../lib/i18n";
import { safeFileName } from "../lib/fileName";
import type { FolderEntry } from "../lib/explorerTrail";
import type { NoteFile } from "./FileExplorer";

const RENAME_INPUT_CLASS =
  "min-w-0 flex-1 rounded-lg border border-gus-accent/50 bg-gus-card px-2 py-1.5 font-mono text-body text-gus-text outline-none focus:ring-2 focus:ring-gus-accent/60";

function RenameField({
  initialValue,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const cancelledRef = useRef(false);

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      aria-label={ariaLabel}
      className={RENAME_INPUT_CLASS}
    />
  );
}

interface RowHandlers {
  staticMode: boolean;
  isRenaming: boolean;
  /** La fila se está arrastrando. */
  isDragged: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
}

interface FolderRowProps extends RowHandlers {
  folder: FolderEntry;
  /** Hay un arrastre encima de la fila y puede soltarse aquí. */
  isDragOver: boolean;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onEnter: () => void;
}

/** Fila de una carpeta: se abre con un clic, se arrastra y acepta soltar sobre ella. */
export function FolderRow({
  folder,
  staticMode,
  isRenaming,
  isDragged,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
  onEnter,
  onCommitRename,
  onCancelRename,
}: FolderRowProps) {
  const t = useT();

  return (
    <li
      data-entry-id={folder.path}
      data-entry-kind="folder"
      data-drop-folder={folder.path}
      draggable={!staticMode && !isRenaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={clsx(
        "group relative rounded-lg transition-opacity",
        isDragged && "opacity-50",
        isDragOver && "bg-gus-accent/15 ring-1 ring-gus-accent/50",
      )}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center">
        {isRenaming ? (
          <RenameField
            initialValue={safeFileName(folder.name)}
            ariaLabel={t("explorer.renameField", { name: folder.name })}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <button
            type="button"
            onClick={onEnter}
            title={t("explorer.folderHint", { path: folder.path })}
            className="flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-gus-muted transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none active:cursor-grabbing"
          >
            <Folder
              className="h-4 w-4 shrink-0 text-gus-muted group-hover:text-gus-accent"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-body">
              {folder.name}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-meta opacity-0 transition-opacity group-hover:opacity-100"
            >
              ›
            </span>
          </button>
        )}
      </div>
    </li>
  );
}

interface FileRowProps extends RowHandlers {
  file: NoteFile;
  isCurrent: boolean;
  onSelect: () => void;
}

/** Fila de una nota, imagen o PDF. */
export function FileRow({
  file,
  isCurrent,
  staticMode,
  isRenaming,
  isDragged,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onSelect,
  onCommitRename,
  onCancelRename,
}: FileRowProps) {
  const t = useT();
  const isActive = isCurrent;

  return (
    <m.li
      data-entry-id={file.id}
      data-entry-kind="file"
      layout
      initial={false}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      transition={{
        duration: 0.15,
        ease: "easeOut",
        layout: { type: "spring", stiffness: 500, damping: 45 },
      }}
      className={clsx(
        "group relative rounded-lg transition-opacity",
        isDragged && "opacity-50",
      )}
      onContextMenu={onContextMenu}
    >
      <div
        className="overflow-hidden"
        draggable={!staticMode && !isRenaming}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <m.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex items-center"
        >
          {isRenaming ? (
            <RenameField
              initialValue={safeFileName(file.name)}
              ariaLabel={t("explorer.renameField", { name: file.name })}
              onCommit={onCommitRename}
              onCancel={onCancelRename}
            />
          ) : (
            <button
              type="button"
              onClick={onSelect}
              title={t("explorer.folderHint", { path: file.name })}
              aria-current={isCurrent ? "true" : undefined}
              className={clsx(
                "relative flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 text-left outline-none transition-colors active:cursor-grabbing",
                "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
                isActive
                  ? "border-transparent text-gus-text"
                  : "border-transparent text-gus-muted hover:bg-gus-card hover:text-gus-text",
              )}
            >
              {isActive && (
                <m.span
                  layoutId="file-active"
                  className="absolute inset-0 rounded-lg border-l-2 border-gus-accent bg-gus-card"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {file.kind === "image" ? (
                <ImageIcon
                  className={clsx(
                    "relative h-4 w-4 shrink-0",
                    isActive ? "text-gus-text" : "text-gus-muted",
                  )}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : file.kind === "pdf" ? (
                <FileIcon
                  className={clsx(
                    "relative h-4 w-4 shrink-0",
                    isActive ? "text-gus-text" : "text-gus-muted",
                  )}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : (
                <FileText
                  className={clsx(
                    "relative h-4 w-4 shrink-0",
                    isActive ? "text-gus-text" : "text-gus-muted",
                  )}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              )}
              <span className="relative min-w-0 flex-1">
                <span className="block truncate font-mono text-body">{file.name}</span>
                <span className="block truncate text-meta text-gus-muted">
                  {file.kind === "image"
                    ? "imagen"
                    : file.kind === "pdf"
                      ? "pdf"
                      : (file.updatedAt ?? "")}
                </span>
              </span>
            </button>
          )}
        </m.div>
      </div>
    </m.li>
  );
}
