/**
 * Tek ikon seti — 16/18 px, 1.6 çizgi kalınlığı (§4.5).
 * Sparkle, robot veya magic wand yoktur.
 */

export type IconName =
  | "overview"
  | "picking"
  | "exception"
  | "slotting"
  | "moves"
  | "history"
  | "time"
  | "sku"
  | "location"
  | "quality"
  | "integration"
  | "model"
  | "lock"
  | "unlock"
  | "ban"
  | "close"
  | "arrowRight"
  | "arrowDown"
  | "arrowUp"
  | "chevronRight"
  | "check"
  | "alert"
  | "info"
  | "search"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "external"
  | "upload"
  | "download"
  | "cube";

const PATHS: Record<IconName, string> = {
  overview: "M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  picking: "M4 7h16M4 12h10M4 17h13M18 12l3 3-3 3",
  exception: "M12 4l8 15H4zM12 10v4M12 17h.01",
  slotting: "M3 4h18v6H3zM3 14h8v6H3zM14 14h7v6h-7z",
  moves: "M4 7h10l-3-3M20 17H10l3 3M4 7l3 3M20 17l-3-3",
  history: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2",
  time: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3.5 2",
  sku: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  location: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11M12 8v4",
  quality: "M4 19V5M4 8h9M4 13h14M4 18h6",
  integration: "M7 4v6a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v4M7 4H4M7 4h3M17 20h3M17 20h-3",
  model: "M6 20V10M12 20V4M18 20v-7M3 20h18",
  lock: "M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4",
  unlock: "M6 11h12v9H6zM9 11V7a3 3 0 0 1 5.7-1.3",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M6 6l12 12",
  close: "M6 6l12 12M18 6L6 18",
  arrowRight: "M4 12h15M13 6l6 6-6 6",
  arrowDown: "M12 4v15M6 13l6 6 6-6",
  arrowUp: "M12 20V5M6 11l6-6 6 6",
  chevronRight: "M9 5l7 7-7 7",
  check: "M4 12.5l5 5L20 6",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v6M12 16.5h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7.5h.01",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l4 4",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l4 4M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l4 4M8 11h6",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  upload: "M12 15V3M8 7l4-4 4 4M4 15v5h16v-5",
  download: "M12 3v12M8 11l4 4 4-4M4 15v5h16v-5",
};

type Props = {
  name: IconName;
  size?: 14 | 16 | 18 | 20;
  className?: string;
  title?: string;
};

export function Icon({ name, size = 16, className, title }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
