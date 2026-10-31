import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Copy, Download, FolderOpen, ImageDown, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import BoardPreview from "./BoardPreview";
import { useT } from "../lib/i18n";
import type { ExportFormat } from "../lib/boardActions";
import { BOARD_LABEL_COLORS } from "../lib/board";
import type { MessageKey } from "../lib/i18n/core";

export interface BoardEntry {
  id: string;
  name: string;
  modifiedMs: number | null;
  pinned?: boolean;
  /** Color de etiqueta (`#rrggbb`). */
  color?: string | null;
}

interface BoardCardProps {
  vaultPath: string;
  board: BoardEntry;
  /** En modo selección un clic marca la tarjeta en vez de abrirla. */
  selecting: boolean;
  selected: boolean;
  menuOpen: boolean;
  renaming: boolean;
  confirmingTrash: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyImage: () => void;
  onTogglePin: () => void;
  onSetColor: (color: string | null) => void;
  onAskTrash: () => void;
  onConfirmTrash: () => void;
  onCancelTrash: () => void;
}

const ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none";

/** Tarjeta de una pizarra: miniatura, nombre, selección y menú de acciones. */
export default function BoardCard(props: BoardCardProps) {
  const { board, selecting, selected, menuOpen, renaming, confirmingTrash } = props;
  const t = useT();
  const [draft, setDraft] = useState(board.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (renaming) {
      cancelledRef.current = false;
      setDraft(board.name);
    }
  }, [renaming, board.name]);

  // El menú se cierra al pulsar fuera de él o con Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      props.onMenuOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onMenuOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
    // `props.onMenuOpenChange` cambia en cada render y no debe re-registrar los escuchadores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  const run = (action: () => void) => () => {
    props.onMenuOpenChange(false);
    action();
  };

  return (
    <li
      onContextMenu={(event) => {
        if (selecting) return;
        event.preventDefault();
        props.onMenuOpenChange(true);
      }}
      className={clsx(
        "group relative rounded-xl border bg-gus-card transition-colors",
        selected ? "border-gus-accent ring-2 ring-gus-accent/40" : "border-gus-border hover:border-gus-accent/50",
      )}
    >
      {board.color && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 rounded-t-xl" style={{ background: board.color }} />
      )}
      <button
        type="button"
        onClick={selecting ? props.onToggleSelect : props.onOpen}
        aria-pressed={selecting ? selected : undefined}
        className="flex w-full flex-col rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-gus-accent/60"
      >
        <BoardPreview vaultPath={props.vaultPath} id={board.id} version={board.modifiedMs} />
        <span className="flex flex-col gap-0.5 p-3">
          {renaming ? (
            <span className="h-5" aria-hidden="true" />
          ) : (
            <span className="flex items-center gap-1.5">
              {board.pinned && <Pin className="h-3 w-3 shrink-0 text-gus-accent" strokeWidth={2} aria-label={t("boards.pinned")} />}
              <span className="truncate text-sm font-medium text-gus-text">{board.name}</span>
            </span>
          )}
          {board.modifiedMs !== null && (
            <span className="text-meta text-gus-muted">
              {new Date(board.modifiedMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </span>
      </button>

      {renaming && (
        <input
          autoFocus
          value={draft}
          maxLength={80}
          aria-label={t("boards.renameField", { name: board.name })}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (cancelledRef.current) return;
            props.onCommitRename(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelledRef.current = true;
              props.onCancelRename();
            }
          }}
          className="absolute right-2.5 bottom-9 left-2.5 rounded-md border border-gus-accent/60 bg-gus-panel px-2 py-1 text-sm font-medium text-gus-text outline-none"
        />
      )}

      {selecting && (
        <span
          aria-hidden="true"
          className={clsx(
            "pointer-events-none absolute top-2 left-2 grid h-5 w-5 place-items-center rounded border",
            selected ? "border-gus-accent bg-gus-accent text-gus-bg" : "border-gus-muted/60 bg-gus-card/80",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      )}

      {!selecting && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            onClick={() => props.onMenuOpenChange(!menuOpen)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("boards.cardMenu", { name: board.name })}
            title={t("boards.cardMenu", { name: board.name })}
            className={clsx(
              "rounded-md bg-gus-card/80 p-1.5 text-gus-muted transition hover:bg-gus-panel hover:text-gus-text focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div role="menu" aria-label={t("boards.cardMenu", { name: board.name })} className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl">
              <button type="button" role="menuitem" onClick={run(props.onOpen)} className={ITEM}>
                <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.open")}
              </button>
              <button type="button" role="menuitem" onClick={run(props.onStartRename)} className={ITEM}>
                <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.rename")}
              </button>
              <button type="button" role="menuitem" onClick={run(props.onDuplicate)} className={ITEM}>
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.duplicate")}
              </button>
              <button type="button" role="menuitem" onClick={run(props.onTogglePin)} className={ITEM}>
                {board.pinned ? <PinOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                {t(board.pinned ? "boards.unpin" : "boards.pin")}
              </button>
              <div role="group" aria-label={t("boards.colorLabel")} className="flex items-center gap-1.5 px-3 py-1.5">
                <span className="mr-1 text-meta text-gus-muted">{t("boards.colorLabel")}</span>
                {BOARD_LABEL_COLORS.map((color, index) => (
                  <button
                    key={color}
                    type="button"
                    role="menuitemradio"
                    aria-checked={board.color === color}
                    aria-label={t(`boards.color.${index}` as MessageKey)}
                    title={t(`boards.color.${index}` as MessageKey)}
                    onClick={run(() => props.onSetColor(board.color === color ? null : color))}
                    className={clsx("h-4 w-4 rounded-full border border-gus-border outline-none focus-visible:ring-2 focus-visible:ring-gus-accent", board.color === color && "ring-2 ring-gus-accent")}
                    style={{ background: color }}
                  />
                ))}
                {board.color && (
                  <button type="button" onClick={run(() => props.onSetColor(null))} className="ml-1 text-meta text-gus-muted underline-offset-2 hover:text-gus-text hover:underline">
                    {t("boards.colorNone")}
                  </button>
                )}
              </div>
              <div role="separator" className="my-1 h-px bg-gus-border" />
              <button type="button" role="menuitem" onClick={run(() => props.onExport("svg"))} className={ITEM}>
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.exportSvg")}
              </button>
              <button type="button" role="menuitem" onClick={run(() => props.onExport("png"))} className={ITEM}>
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.exportPng")}
              </button>
              <button type="button" role="menuitem" onClick={run(props.onCopyImage)} className={ITEM}>
                <ImageDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.copyImage")}
              </button>
              <div role="separator" className="my-1 h-px bg-gus-border" />
              <button type="button" role="menuitem" onClick={run(props.onAskTrash)} className={clsx(ITEM, "text-rose-300 hover:bg-rose-400/10 hover:text-rose-300")}>
                <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t("boards.toTrash")}
              </button>
            </div>
          )}
        </div>
      )}

      {confirmingTrash && (
        <div role="alertdialog" aria-label={t("boards.confirmTrash")} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-gus-bg/90 p-3 text-center backdrop-blur-sm">
          <p className="text-body text-gus-text">{t("boards.confirmTrash")}</p>
          <div className="flex gap-2">
            <button type="button" autoFocus onClick={props.onConfirmTrash} className="gus-btn gus-btn-secondary text-rose-300">
              {t("boards.confirmYes")}
            </button>
            <button type="button" onClick={props.onCancelTrash} className="gus-btn gus-btn-secondary">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
