import { useRef, type ReactNode } from "react";
import { m } from "framer-motion";
import clsx from "clsx";
import {
  CalendarDays,
  Flame,
  LayoutDashboard,
  Library,
  ListTodo,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Settings as SettingsIcon,
  StickyNote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import gusIcon from "../assets/gus-icon-512.png";
import { useT, type MessageKey } from "../lib/i18n";
import { usePanelWidth } from "./usePanelWidth";

export type TabId =
  | "home"
  | "notes"
  | "tasks"
  | "calendar"
  | "graph"
  | "library"
  | "habits"
  | "boards"
  | "search"
  | "settings"
  | "trash";

const TABS: { id: TabId; labelKey: MessageKey; Icon: LucideIcon }[] = [
  { id: "home", labelKey: "app.tab.home", Icon: LayoutDashboard },
  { id: "notes", labelKey: "app.tab.notes", Icon: StickyNote },
  { id: "tasks", labelKey: "app.tab.tasks", Icon: ListTodo },
  { id: "calendar", labelKey: "app.tab.calendar", Icon: CalendarDays },
  { id: "graph", labelKey: "app.tab.graph", Icon: Network },
  { id: "library", labelKey: "app.tab.library", Icon: Library },
  { id: "habits", labelKey: "app.tab.habits", Icon: Flame },
  { id: "boards", labelKey: "app.tab.boards", Icon: PenTool },
];

const SIDEBAR_MIN_WIDTH = 64;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 200;
/** Desde este ancho la barra muestra el nombre de cada sección junto al icono. */
const SIDEBAR_LABEL_MIN = 160;
const SIDEBAR_WIDTH_KEY = "gus.sidebar-width";

function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/** Ancho de la barra lateral y su botón de contraer a solo iconos / expandir. */
export function useSidebarWidth() {
  const panel = usePanelWidth({
    storageKey: SIDEBAR_WIDTH_KEY,
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    fallback: SIDEBAR_DEFAULT_WIDTH,
    clamp: clampSidebarWidth,
  });
  const labeled = panel.width >= SIDEBAR_LABEL_MIN;
  const lastLabeledWidth = useRef(SIDEBAR_DEFAULT_WIDTH);

  /** Contrae a solo iconos y, al expandir, vuelve al ancho que tenía con etiquetas. */
  function toggle() {
    if (labeled) {
      lastLabeledWidth.current = panel.widthRef.current;
      panel.change(SIDEBAR_MIN_WIDTH);
    } else {
      panel.change(lastLabeledWidth.current);
    }
  }

  return { ...panel, labeled, toggle };
}

export type SidebarState = ReturnType<typeof useSidebarWidth>;

interface SidebarProps {
  sidebar: SidebarState;
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  onLeaveVault: () => void;
}

interface SidebarButtonProps {
  label: string;
  labeled: boolean;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** Botón de sección: el fondo del activo se desliza entre botones con `layoutId`. */
function SectionButton({ label, labeled, active, onClick, children }: SidebarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "relative flex items-center rounded-xl outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
        labeled ? "h-10 w-full gap-3 px-3" : "h-11 w-11 justify-center",
        active ? "text-gus-accent" : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
      )}
    >
      {active && (
        <m.span
          layoutId="sidebar-active-tab"
          className="absolute inset-0 rounded-xl border border-gus-accent/40 bg-gus-accent/15"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      {children}
      {labeled && <span className="relative truncate text-sm">{label}</span>}
    </button>
  );
}

export default function Sidebar({ sidebar, activeTab, onSelectTab, onLeaveVault }: SidebarProps) {
  const t = useT();
  const { labeled } = sidebar;
  const plainButton = clsx(
    "flex items-center rounded-xl text-gus-muted outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-gus-accent/60",
    labeled ? "h-10 w-full gap-3 px-3" : "h-11 w-11 justify-center",
  );

  return (
    <aside
      data-tour="sidebar"
      style={{ width: sidebar.width }}
      className="relative flex h-full shrink-0 flex-col items-center gap-2 border-r border-gus-border bg-gus-panel px-2 py-4"
    >
      <img src={gusIcon} alt="Gus" title="Gus" draggable={false} className="h-9 w-9 select-none" />

      <div aria-hidden="true" className="my-1 h-px w-8 bg-gus-border" />

      {TABS.map(({ id, labelKey, Icon }) => (
        <SectionButton
          key={id}
          label={t(labelKey)}
          labeled={labeled}
          active={activeTab === id}
          onClick={() => onSelectTab(id)}
        >
          <Icon className="relative h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        </SectionButton>
      ))}

      <div data-tour="sidebar-bottom" className="mt-auto flex w-full flex-col items-center gap-2">
        <div aria-hidden="true" className="h-px w-8 bg-gus-border" />

        <div className="flex w-full flex-col items-center gap-2">
          <button
            type="button"
            title={t("app.leaveVault")}
            aria-label={t("app.leaveVault")}
            onClick={onLeaveVault}
            className={clsx(plainButton, "hover:bg-rose-400/10 hover:text-rose-300")}
          >
            <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            {labeled && <span className="truncate text-sm">{t("app.leaveVault")}</span>}
          </button>

          <SectionButton
            label={t("app.trash")}
            labeled={labeled}
            active={activeTab === "trash"}
            onClick={() => onSelectTab("trash")}
          >
            <Trash2 className="relative h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </SectionButton>

          <SectionButton
            label={t("app.settings")}
            labeled={labeled}
            active={activeTab === "settings"}
            onClick={() => onSelectTab("settings")}
          >
            <SettingsIcon className="relative h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </SectionButton>

          <button
            type="button"
            title={t(labeled ? "app.collapseSidebar" : "app.expandSidebar")}
            aria-label={t(labeled ? "app.collapseSidebar" : "app.expandSidebar")}
            onClick={sidebar.toggle}
            className={clsx(plainButton, "hover:bg-gus-card hover:text-gus-text")}
          >
            {labeled ? (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
            )}
            {labeled && <span className="truncate text-sm">{t("app.collapseSidebar")}</span>}
          </button>
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("app.resizeSidebar")}
        aria-valuenow={sidebar.width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        tabIndex={0}
        title={t("app.resizeHint")}
        onPointerDown={sidebar.onResizeStart}
        onDoubleClick={() => sidebar.change(SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={sidebar.onResizeKeyDown}
        className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none rounded-r-sm transition-colors hover:bg-gus-accent/40 focus-visible:bg-gus-accent/60 focus-visible:outline-none"
      />
    </aside>
  );
}
