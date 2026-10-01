export type WorkspaceIconId =
  | "calendar"
  | "lightbulb"
  | "notebook"
  | "flask";

export interface WorkspaceNavItem {
  href: "/" | "/inspirations" | "/jottings" | "/bench";
  label: string;
  icon: WorkspaceIconId;
}

export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/", label: "今日", icon: "calendar" },
  { href: "/inspirations", label: "灵感池", icon: "lightbulb" },
  { href: "/jottings", label: "杂记", icon: "notebook" },
  { href: "/bench", label: "验证台", icon: "flask" },
] as const;
