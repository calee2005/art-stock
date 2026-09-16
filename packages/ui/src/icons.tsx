import type { CSSProperties, ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function svg(props: IconProps, children: ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  );
}

export function WorkspaceIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 9v9" />
    </>,
  );
}

export function AssetsIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5.5-5.5L7 19" />
    </>,
  );
}

export function KanbanIcon(props: IconProps) {
  return svg(
    props,
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16M16 4v10" />
    </>,
  );
}

export function GearIcon(props: IconProps) {
  return svg(
    props,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 6.2l1.6 1.6M17.5 16.2l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.8l1.6-1.6M17.5 7.8l1.6-1.6" />
    </>,
  );
}

export function CloudIcon(props: IconProps & { color?: string }) {
  const { color, style, ...rest } = props;
  const merged: CSSProperties = { ...style, color: color ?? "currentColor" };
  return (
    <svg viewBox="0 0 48 36" aria-hidden="true" style={merged} {...rest}>
      <path
        d="M14 28h22a9 9 0 0 0 1.2-17.9A12 12 0 0 0 14.5 12 8.5 8.5 0 0 0 14 28z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M3 7h6l2 3h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>,
  );
}

export function FileIcon(props: IconProps) {
  return svg(
    props,
    <>
      <path d="M7 3h8l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M15 3v6h6" />
    </>,
  );
}

export const NAV_ICONS = {
  overview: OverviewIcon,
  library: WorkspaceIcon,
  assets: AssetsIcon,
  kanban: KanbanIcon,
} as const;
