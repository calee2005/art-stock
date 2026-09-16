import type { ReactNode } from "react";
import { NAV_ICONS, GearIcon } from "./icons.tsx";
import { NAV_ITEMS, navButtonStyle, type NavId, type TabletChrome } from "./shell.ts";

export type NavRailProps = {
  chrome: TabletChrome;
  active: NavId;
  onNavigate: (id: NavId) => void;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  testId?: string;
};

export function NavRail({
  chrome,
  active,
  onNavigate,
  onOpenSettings,
  settingsOpen,
  testId = "desktop-nav",
}: NavRailProps) {
  return (
    <nav
      className="as-rail"
      data-testid={testId}
      data-chrome={chrome}
      aria-label="主要导航"
    >
      <div className="as-rail-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = NAV_ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              className="as-nav-btn"
              data-nav={item.id}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
              style={navButtonStyle()}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      {onOpenSettings ? (
        <div className="as-rail-end">
          <button
            type="button"
            className="as-nav-btn"
            data-nav="settings"
            data-testid="open-settings"
            aria-pressed={settingsOpen}
            aria-label="配置"
            onClick={onOpenSettings}
            style={navButtonStyle()}
          >
            <GearIcon />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export type DesktopShellProps = {
  active: NavId;
  onNavigate: (id: NavId) => void;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  children: ReactNode;
};

export function DesktopShell({
  active,
  onNavigate,
  onOpenSettings,
  settingsOpen,
  children,
}: DesktopShellProps) {
  return (
    <div className="as-shell" data-testid="desktop-shell" data-chrome="sidebar">
      <NavRail
        chrome="sidebar"
        active={active}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
        settingsOpen={settingsOpen}
      />
      <main className="as-main">{children}</main>
    </div>
  );
}
