import clsx from "clsx";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";

export interface NoteTab {
  path: string;
  title: string;
}

export interface NoteTabsProps {
  tabs: NoteTab[];
  /** Ruta de la nota abierta; `null` si lo que se ve es una imagen o un PDF. */
  activePath: string | null;
  onSelect: (tab: NoteTab) => void;
  onClose: (tab: NoteTab) => void;
}

export default function NoteTabs({ tabs, activePath, onSelect, onClose }: NoteTabsProps) {
  const t = useT();

  return (
    <div
      role="tablist"
      aria-label={t("tabs.label")}
      className="gus-scrollbar flex shrink-0 items-stretch overflow-x-auto border-b border-gus-border bg-gus-panel px-2"
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={clsx(
              "group relative flex shrink-0 items-center border-b-2 pr-1",
              active ? "border-gus-accent text-gus-text" : "border-transparent text-gus-muted",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={tab.title}
              onClick={() => onSelect(tab)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab);
              }}
              className={clsx("h-9 max-w-44 min-w-20 truncate rounded-md px-2 text-body outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60", active && "font-mono text-gus-text")}
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={t("tabs.close", { name: tab.title })}
              title={t("tabs.close", { name: tab.title })}
              onClick={() => onClose(tab)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
