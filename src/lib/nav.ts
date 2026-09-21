import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FolderTree,
  TerminalSquare,
  Boxes,
  Table2,
  Eye,
  Columns3,
  KeyRound,
  Link2,
  Hash,
  FunctionSquare,
  ListChecks,
  ArrowLeftRight,
  GitBranch,
  BookOpen,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/explorer", label: "Explorer", icon: FolderTree },
  { to: "/console", label: "SQL Console", icon: TerminalSquare },
  { to: "/schemas", label: "Schemas", icon: Boxes },
  { to: "/tables", label: "Tables", icon: Table2 },
  { to: "/views", label: "Views", icon: Eye },
  { to: "/columns", label: "Columns", icon: Columns3 },
  { to: "/indexes", label: "Indexes", icon: KeyRound },
  { to: "/constraints", label: "Constraints", icon: Link2 },
  { to: "/sequences", label: "Sequences", icon: Hash },
  { to: "/functions", label: "Functions", icon: FunctionSquare },
  { to: "/queries", label: "Queries", icon: ListChecks },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/explain", label: "Explain", icon: GitBranch },
  { to: "/examples", label: "Examples", icon: BookOpen },
];