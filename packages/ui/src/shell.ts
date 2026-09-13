export const TOUCH_MIN_PX = 44;

/** Web uses the tablet shell at this width and below. */
export const TABLET_SHELL_MAX_PX = 899;

export type NavId = "library" | "assets" | "kanban" | "remote";

export type TabletChrome = "sidebar" | "bottom";

export type AppShellKind = "desktop" | "tablet";

export const NAV_ITEMS: { id: NavId; label: string }[] = [
  { id: "library", label: "资料库" },
  { id: "assets", label: "素材" },
  { id: "kanban", label: "看板" },
  { id: "remote", label: "远端" },
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
