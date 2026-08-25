import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, Database as DbIcon } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed z-40 inset-y-0 left-0 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <DbIcon className="size-5 text-primary" />
          <span className="font-semibold">PG Console</span>
          <button
            type="button"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent md:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setPressed(true);
        onClick();
      }}
      className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-foreground hover:bg-accent md:hidden"
      aria-label="Open navigation"
    >
      <Menu className="size-5" />
      <span className="sr-only" data-pressed={pressed} />
    </button>
  );
}