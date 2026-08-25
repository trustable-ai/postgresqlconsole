import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { SchemaProvider } from "@/lib/schema-context";
import Overview from "./pages/Overview";
import Explorer from "./pages/Explorer";
import Console from "./pages/Console";
import Databases from "./pages/Databases";
import Schemas from "./pages/Schemas";
import Tables from "./pages/Tables";
import Views from "./pages/Views";
import Columns from "./pages/Columns";
import Indexes from "./pages/Indexes";
import Constraints from "./pages/Constraints";
import Sequences from "./pages/Sequences";
import Functions from "./pages/Functions";
import Queries from "./pages/Queries";
import Parameterized from "./pages/Parameterized";
import Transactions from "./pages/Transactions";
import Explain from "./pages/Explain";
import Activity from "./pages/Activity";
import Examples from "./pages/Examples";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <SchemaProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/console" replace />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/explorer" element={<Explorer />} />
              <Route path="/console" element={<Console />} />
              <Route path="/databases" element={<Databases />} />
              <Route path="/schemas" element={<Schemas />} />
              <Route path="/tables" element={<Tables />} />
              <Route path="/views" element={<Views />} />
              <Route path="/columns" element={<Columns />} />
              <Route path="/indexes" element={<Indexes />} />
              <Route path="/constraints" element={<Constraints />} />
              <Route path="/sequences" element={<Sequences />} />
              <Route path="/functions" element={<Functions />} />
              <Route path="/queries" element={<Queries />} />
              <Route path="/params" element={<Parameterized />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/explain" element={<Explain />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/examples" element={<Examples />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </SchemaProvider>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;