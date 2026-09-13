import type { ReactNode } from "react";
import {
  NAV_ITEMS,
  navButtonStyle,
  type NavId,
  type TabletChrome,
} from "./shell.ts";

export type TabletShellProps = {
  chrome: TabletChrome;
  active: NavId;
  onNavigate: (id: NavId) => void;
  children: ReactNode;
};

export function TabletShell({
  chrome,
  active,
  onNavigate,
  children,
}: TabletShellProps) {
  const nav = (
    <nav
      data-testid="tablet-nav"
      data-chrome={chrome}
      aria-label="主要导航"
      style={{
        display: "flex",
        flexDirection: chrome === "sidebar" ? "column" : "row",
        justifyContent: chrome === "bottom" ? "space-around" : "flex-start",
        gap: 4,
        padding: 8,
        background: "#111827",
        color: "#f9fafb",
        minWidth: chrome === "sidebar" ? 88 : undefined,
        width: chrome === "bottom" ? "100%" : undefined,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          data-nav={item.id}
          aria-current={active === item.id ? "page" : undefined}
          onClick={() => onNavigate(item.id)}
          style={{
            ...navButtonStyle(),
            background: active === item.id ? "#4f46e5" : "transparent",
            color: "#f9fafb",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );

  if (chrome === "sidebar") {
    return (
      <div
        data-testid="tablet-shell"
        data-chrome="sidebar"
        style={{ display: "flex", minHeight: "100vh" }}
      >
        <aside>{nav}</aside>
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    );
  }

  return (
    <div
      data-testid="tablet-shell"
      data-chrome="bottom"
      style={{ minHeight: "100vh", paddingBottom: 64 }}
    >
      <main>{children}</main>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20 }}>
        {nav}
      </div>
    </div>
  );
}
