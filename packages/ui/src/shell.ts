export const TOUCH_MIN_PX = 44;

/** Web uses the tablet shell at this width and below. */
export const TABLET_SHELL_MAX_PX = 899;

export type NavId = "overview" | "library" | "assets" | "kanban";

export type SettingsSection = "basic" | "library" | "general";

export type TabletChrome = "sidebar" | "bottom";

export type AppShellKind = "desktop" | "tablet";

export const NAV_ITEMS: { id: NavId; label: string }[] = [
  { id: "overview", label: "总览" },
  { id: "library", label: "工作区" },
  { id: "assets", label: "素材库" },
  { id: "kanban", label: "看板" },
];

export const SETTINGS_NAV: { id: SettingsSection; label: string }[] = [
  { id: "basic", label: "基本" },
  { id: "library", label: "资料库" },
  { id: "general", label: "通用" },
];

/** Landscape → left sidebar; portrait → bottom bar. */
export function tabletChrome(width: number, height: number): TabletChrome {
  return width >= height ? "sidebar" : "bottom";
}

export function pickAppShell(width: number, forceTablet = false): AppShellKind {
  if (forceTablet) {
    return "tablet";
  }
  return width <= TABLET_SHELL_MAX_PX ? "tablet" : "desktop";
}

export function navButtonStyle(): {
  minWidth: number;
  minHeight: number;
  padding: string;
  fontSize: string;
} {
  return {
    minWidth: TOUCH_MIN_PX,
    minHeight: TOUCH_MIN_PX,
    padding: "8px 12px",
    fontSize: "16px",
  };
}
