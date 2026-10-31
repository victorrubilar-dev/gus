import { FileText, History, PenTool, Library } from "lucide-react";
import { useT } from "../lib/i18n";
import type { RecentItem, RecentKind } from "../lib/dashboard";
import DashboardCard from "./DashboardCard";

const ICON = { note: FileText, board: PenTool, pdf: Library } as const;
const KIND_KEY = { note: "dashboard.kind.note", board: "dashboard.kind.board", pdf: "dashboard.kind.pdf" } as const;

interface DashboardRecentProps {
  items: RecentItem[];
  status: "loading" | "ready";
  relativeTime: (ms: number | null) => string;
  onOpen: (item: RecentItem) => void;
}

/** Notas, pizarras y PDF tocados hace poco, para seguir donde se dejó. */
export default function DashboardRecent({ items, status, relativeTime, onOpen }: DashboardRecentProps) {
  const t = useT();

  return (
    <DashboardCard icon={History} title={t("dashboard.continueTitle")}>
      {status === "loading" && <p className="py-4 text-center text-body text-gus-muted">{t("dashboard.loadingNotes")}</p>}
      {status === "ready" && items.length === 0 && (
        <p className="rounded-lg border border-dashed border-gus-border py-6 text-center text-body text-gus-muted">{t("dashboard.recentEmpty")}</p>
      )}
      {items.length > 0 && (
        <ul className="grid gap-2 min-[700px]:grid-cols-2 min-[1000px]:grid-cols-3">
          {items.map((item) => {
            const Icon = ICON[item.kind as RecentKind];
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  title={item.detail || item.name}
                  className="flex w-full items-center gap-3 rounded-lg border border-gus-border bg-gus-panel px-3 py-2.5 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                >
                  <Icon className="h-4 w-4 shrink-0 text-gus-muted" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gus-text">{item.name}</span>
                    <span className="block truncate text-meta text-gus-muted">
                      {t(KIND_KEY[item.kind])} · {relativeTime(item.modifiedMs)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
