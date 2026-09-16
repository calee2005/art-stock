import type { ReactNode } from "react";
import { NavRail } from "./DesktopShell.tsx";
import type { NavId, TabletChrome } from "./shell.ts";

export type TabletShellProps = {
  chrome: TabletChrome;
  active: NavId;
  onNavigate: (id: NavId) => void;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  children: ReactNode;
};

export function TabletShell({
  chrome,
  active,
  onNavigate,
  onOpenSettings,
  settingsOpen,
  children,
}: TabletShellProps) {
  const rail = (
    <NavRail
      chrome={chrome}
      active={active}
      onNavigate={onNavigate}
      onOpenSettings={onOpenSettings}
      settingsOpen={settingsOpen}
      testId="tablet-nav"
    />
  );

  if (chrome === "sidebar") {
    return (
      <div
        className="as-shell"
        data-testid="tablet-shell"
        data-chrome="sidebar"
      >
        <aside>{rail}</aside>
        <main className="as-main">{children}</main>
      </div>
    );
  }

  return (
    <div
      className="as-shell"
      data-testid="tablet-shell"
      data-chrome="bottom"
    >
      <main className="as-main">{children}</main>
      {rail}
    </div>
  );
}
