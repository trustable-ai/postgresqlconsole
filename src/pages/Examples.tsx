import { useNavigate } from "react-router-dom";
import { BookOpen, ArrowRight } from "lucide-react";
import { EXAMPLES } from "@/lib/pgQueries";

export default function Examples() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Examples</h1>
        <p className="text-sm text-muted-foreground">
          Curated SQL snippets to explore PostgreSQL. Copy any of them into the SQL Console.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {EXAMPLES.map((ex, i) => (
          <div key={i} className="flex flex-col rounded-lg border border-border bg-card">
            <div className="flex items-start gap-2 border-b border-border p-3">
              <BookOpen className="mt-0.5 size-4 text-primary" />
              <div className="min-w-0">
                <p className="font-medium">{ex.title}</p>
                <p className="text-xs text-muted-foreground">{ex.description}</p>
              </div>
            </div>
            <pre className="flex-1 overflow-x-auto bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
{ex.sql}
            </pre>
            <div className="flex justify-end border-t border-border p-2">
              <button
                type="button"
                onClick={() => navigate("/console")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-primary hover:bg-accent"
              >
                Open console <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}