import { useState, type ReactNode } from "react";
import { Header } from "@/components/Header";
import { Sidebar, MobileMenuButton } from "@/components/Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex items-stretch border-b border-border">
        <div className="flex h-14 items-center gap-2 px-4 md:hidden">
          <MobileMenuButton onClick={() => setSidebarOpen(true)} />
          <span className="font-semibold">PG Console</span>
        </div>
        <div className="flex-1">
          <Header />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="min-w-0 flex-1 overflow-hidden p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}