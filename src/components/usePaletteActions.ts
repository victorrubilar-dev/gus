import type { RefObject } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  Columns2,
  Eye,
  FilePlus,
  Palette,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react";
import { useT } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { AUTO_THEME, THEME_LIST } from "../lib/themes";
import { customThemeKey } from "../lib/customThemes";
import type { PaletteAction } from "./CommandPalette";
import type { FileExplorerHandle } from "./FileExplorer";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { SIDEBAR_TABS, type TabId } from "./Sidebar";

interface PaletteActionDeps {
  settings: AppSettings;
  changeSettings: (next: AppSettings) => void;
  selectTab: (tab: TabId) => void;
  explorerRef: RefObject<FileExplorerHandle | null>;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  /** Hay una nota abierta: se ofrecen los modos del editor. */
  noteOpen: boolean;
  openNewTask: () => void;
  openDailyNote: () => void;
}

/** Acciones de la paleta de comandos (3c): vistas, crear, tema y modo del editor. */
export function usePaletteActions({
  settings,
  changeSettings,
  selectTab,
  explorerRef,
  editorRef,
  noteOpen,
  openNewTask,
  openDailyNote,
}: PaletteActionDeps): PaletteAction[] {
  const t = useT();

  const views: PaletteAction[] = [
    ...SIDEBAR_TABS.map(({ id, labelKey, Icon }) => ({ id: `tab-${id}`, label: t(labelKey), Icon, tab: id })),
    { id: "tab-settings", label: t("settings.title"), Icon: Settings, tab: "settings" as const },
    { id: "tab-trash", label: t("app.trash"), Icon: Trash2, tab: "trash" as const },
  ].map(({ id, label, Icon, tab }) => ({
    id,
    label: t("palette.goTo", { name: label }),
    keywords: ["ir", "go", "vista", "view"],
    Icon,
    run: () => selectTab(tab),
  }));

  const themes: PaletteAction[] = [
    { key: AUTO_THEME, name: t("theme.auto") },
    ...THEME_LIST.map((theme) => ({ key: theme.key, name: t(theme.labelKey) })),
    ...settings.customThemes.map((theme) => ({ key: customThemeKey(theme), name: theme.name })),
  ]
    .filter(({ key }) => key !== settings.theme)
    .map(({ key, name }) => ({
      id: `theme-${key}`,
      label: t("palette.theme", { name }),
      keywords: ["tema", "theme", "color", "apariencia"],
      Icon: Palette,
      run: () => changeSettings({ ...settings, theme: key }),
    }));

  const modes: PaletteAction[] = noteOpen
    ? ([
        ["edit", t("editor.edit"), Pencil],
        ["split", t("editor.split"), Columns2],
        ["preview", t("editor.read"), Eye],
      ] as const).map(([mode, name, Icon]) => ({
        id: `mode-${mode}`,
        label: t("palette.viewMode", { name }),
        keywords: ["modo", "mode", "editor", "lectura", "dividido"],
        Icon,
        run: () => editorRef.current?.setViewMode(mode),
      }))
    : [];

  return [
    {
      id: "new-note",
      label: t("explorer.newNote"),
      keywords: ["crear", "new", "nota", "note"],
      Icon: FilePlus,
      run: () => {
        selectTab("notes");
        // El explorador solo existe en la vista de notas: se espera a que se monte.
        let tries = 0;
        const tick = () => {
          if (explorerRef.current) explorerRef.current.newNote();
          else if (tries++ < 40) window.setTimeout(tick, 50);
        };
        tick();
      },
    },
    {
      id: "new-task",
      label: t("palette.newTask"),
      keywords: ["crear", "new", "tarea", "task"],
      Icon: CalendarPlus,
      run: openNewTask,
    },
    {
      id: "daily-note",
      label: t("palette.dailyNote"),
      keywords: ["hoy", "today", "diario", "daily"],
      Icon: CalendarCheck,
      run: openDailyNote,
    },
    ...modes,
    ...views,
    ...themes,
  ];
}
