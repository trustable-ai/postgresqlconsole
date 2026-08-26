import { cn } from "@/lib/utils";
import type { OperationClass } from "@/lib/safety";

const STYLES: Record<OperationClass, string> = {
  READ: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  WRITE: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  DDL: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  DESTRUCTIVE: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  CONTROL: "bg-muted text-muted-foreground",
  FORBIDDEN: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

const ICONS: Record<OperationClass, string> = {
  READ: "🔍",
  WRITE: "✏️",
  DDL: "🛠️",
  DESTRUCTIVE: "⚠️",
  CONTROL: "⚙️",
  FORBIDDEN: "🚫",
};

export function SafetyBadge({ op, label }: { op: OperationClass; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STYLES[op],
      )}
      title={label ?? op}
    >
      <span aria-hidden="true">{ICONS[op]}</span>
      {label ?? op}
    </span>
  );
}