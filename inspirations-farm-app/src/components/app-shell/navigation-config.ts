export type WorkspaceIconId =
  | "calendar"
  | "lightbulb"
  | "notebook"
  | "flask"
  | "message";

export interface WorkspaceNavItem {
  href: "/" | "/inspirations" | "/jottings" | "/bench" | "/chat";
  label: string;
  icon: WorkspaceIconId;
}

export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/", label: "今日", icon: "calendar" },
  { href: "/inspirations", label: "灵感池", icon: "lightbulb" },
  { href: "/jottings", label: "杂记", icon: "notebook" },
  { href: "/bench", label: "验证台", icon: "flask" },
  { href: "/chat", label: "参谋", icon: "message" },
] as const;
