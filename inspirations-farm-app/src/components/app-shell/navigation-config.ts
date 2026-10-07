export type WorkspaceIconId = "calendar" | "lightbulb" | "notebook";

export interface WorkspaceNavItem {
  href: "/" | "/inspirations" | "/jottings";
  label: string;
  icon: WorkspaceIconId;
}

export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/", label: "今日", icon: "calendar" },
  { href: "/inspirations", label: "灵感池", icon: "lightbulb" },
  { href: "/jottings", label: "杂记", icon: "notebook" },
] as const;
