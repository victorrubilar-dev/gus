import type { RefObject } from "react";
import clsx from "clsx";
import { Folder } from "lucide-react";
import { useT } from "../lib/i18n";
import { isImageName, isPdfName } from "../lib/fileName";
import type { FolderEntry } from "../lib/explorerTrail";
import type { NoteFile } from "./FileExplorer";

/** Menú del explorador: sobre una fila (`file`, `folder`) o sobre el hueco de la lista (`panel`). */
export interface MenuState {
  /** `""` cuando el menú es el de la lista (no apunta a ninguna entrada). */
  id: string;
  kind: "file" | "folder" | "panel";
  x: number;
  y: number;
}

export const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none";

const NORMAL_ITEM = "text-gus-muted hover:bg-gus-panel hover:text-gus-text";
const DANGER_ITEM = "border-t border-gus-border text-rose-300 hover:bg-rose-400/10";

function MenuItem({
  onClick,
  tone = NORMAL_ITEM,
  children,
}: {
  onClick: () => void;
  tone?: string;
  children: string;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={clsx(MENU_ITEM_CLASS, tone)}>
      {children}
    </button>
  );
}

interface ExplorerContextMenuProps {
  menu: MenuState;
  folder: FolderEntry | undefined;
  file: NoteFile | undefined;
  confirmId: string | null;
  movingId: string | null;
  /** Carpetas a las que se puede mover el elemento (`null` mientras carga). */
  destinations: FolderEntry[] | null;
  busy: boolean;
  confirmTrashRef: RefObject<HTMLButtonElement | null>;
  confirmCancelRef: RefObject<HTMLButtonElement | null>;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onStartRename: (id: string) => void;
  onStartMove: (path: string) => void;
  onMoveTo: (dest: FolderEntry) => void;
  onBackFromMove: () => void;
  onExport: (file: NoteFile) => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onImport: () => void;
  onRefresh: () => void;
}

/** Contenido del menú contextual del explorador: acciones, confirmación de papelera y selector de destino. */
export default function ExplorerContextMenu(props: ExplorerContextMenuProps) {
  const t = useT();
  const { menu, folder, file, confirmId, movingId, destinations, busy } = props;
  const target = folder ?? file;

  return (
    <div
      role="menu"
      aria-label={t(menu.kind === "panel" ? "explorer.panelOptions" : "explorer.itemOptions", {
        name: target?.name ?? "",
      })}
      className="fixed z-30 w-52 overflow-hidden rounded-lg border border-gus-border bg-gus-card shadow-xl shadow-black/40"
      style={{ left: menu.x, top: menu.y }}
    >
      {confirmId === menu.id && target ? (
        <div className="p-3 text-body">
          <p className="text-gus-text">
            {t(menu.kind === "folder" ? "explorer.trashFolderAsk" : "explorer.trashItemAsk", {
              name: "",
            })}
            <span className="font-mono break-all">{target.name}</span>
            {t("explorer.trashToBin")}
          </p>
          <p className="mt-1 text-meta text-gus-muted">
            {menu.kind === "folder" ? t("explorer.trashFolderBody") : t("explorer.trashItemBody")}
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              ref={props.confirmTrashRef}
              onClick={props.onConfirmDelete}
              disabled={busy}
              className="rounded-md border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-meta text-rose-300 transition-colors hover:bg-rose-400/20 focus-visible:ring-2 focus-visible:ring-rose-300/60 focus-visible:outline-none disabled:opacity-50"
            >
              {t("explorer.moveToTrash")}
            </button>
            <button
              type="button"
              ref={props.confirmCancelRef}
              onClick={props.onCancelDelete}
              className="rounded-md border border-gus-border px-2 py-1 text-meta text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : movingId === menu.id && target ? (
        <div>
          <p className="border-b border-gus-border px-3 py-2 text-meta tracking-wider text-gus-muted uppercase">
            {t(menu.kind === "folder" ? "explorer.moveFolderTo" : "explorer.moveFileTo")}
          </p>
          <ul className="gus-scrollbar max-h-44 overflow-y-auto py-1">
            {destinations === null && (
              <li className="px-3 py-2 text-meta text-gus-muted">{t("common.loading")}</li>
            )}
            {destinations?.length === 0 && (
              <li className="px-3 py-2 text-meta text-gus-muted">{t("explorer.noDestinations")}</li>
            )}
            {destinations?.map((dest) => (
              <li key={dest.path}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => props.onMoveTo(dest)}
                  disabled={busy}
                  title={dest.path}
                  className={clsx(MENU_ITEM_CLASS, NORMAL_ITEM, "disabled:opacity-50")}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{dest.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={props.onBackFromMove}
            className={clsx(
              MENU_ITEM_CLASS,
              "w-full border-t border-gus-border text-gus-muted hover:text-gus-text",
            )}
          >
            ← Volver
          </button>
        </div>
      ) : folder ? (
        <div className="py-1">
          <MenuItem onClick={() => props.onStartRename(menu.id)}>{t("common.rename")}</MenuItem>
          <MenuItem onClick={() => props.onStartMove(folder.path)}>{t("explorer.move")}</MenuItem>
          <MenuItem onClick={() => props.onAskDelete(menu.id)} tone={DANGER_ITEM}>
            {t("explorer.deleteEllipsis")}
          </MenuItem>
        </div>
      ) : file ? (
        <div className="py-1">
          {!isImageName(file.name) && !isPdfName(file.name) && (
            <MenuItem onClick={() => props.onExport(file)}>{t("explorer.export")}</MenuItem>
          )}
          <MenuItem onClick={() => props.onStartRename(menu.id)}>Renombrar</MenuItem>
          <MenuItem onClick={() => props.onStartMove(file.id)}>Mover a…</MenuItem>
          <MenuItem onClick={() => props.onAskDelete(menu.id)} tone={DANGER_ITEM}>
            Eliminar…
          </MenuItem>
        </div>
      ) : menu.kind === "panel" ? (
        <div className="py-1">
          <MenuItem onClick={props.onNewNote}>{t("explorer.newNote")}</MenuItem>
          <MenuItem onClick={props.onNewFolder}>{t("explorer.newFolder")}</MenuItem>
          <MenuItem onClick={props.onImport}>{t("explorer.addFromPc")}</MenuItem>
          <MenuItem onClick={props.onRefresh} tone={clsx("border-t border-gus-border", NORMAL_ITEM)}>
            {t("explorer.refresh")}
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}
