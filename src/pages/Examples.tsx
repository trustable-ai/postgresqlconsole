import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Play, Loader2, ArrowRight, Database } from "lucide-react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { EXAMPLES, type Example } from "@/lib/pgQueries";
import { ResultTable } from "@/components/ResultTable";
import { ErrorPanel } from "@/components/useQuery";
import { SafetyBadge } from "@/components/SafetyBadge";
import { DestructiveConfirm } from "@/components/DestructiveConfirm";
import { classifyStatement, type Classification } from "@/lib/safety";
import { useServerInfo } from "@/hooks/useServerInfo";

interface RunState {
  data: QueryData | null;
  error: ApiError | null;
  running: boolean;
}

export default function Examples() {
  const navigate = useNavigate();
  const info = useServerInfo();
  const [states, setStates] = useState<Record<number, RunState>>({});
  const [pending, setPending] = useState<{ index: number; cls: Classification; sql: string } | null>(null);

  const run = (ex: Example, index: number, confirm = false) => {
    const cls = classifyStatement(ex.sql);
    if (cls.op === "DESTRUCTIVE" && !confirm) {
      setPending({ index, cls, sql: ex.sql });
      return;
    }
    setStates((s) => ({ ...s, [index]: { data: null, error: null, running: true } }));
    runQuery({ sql: ex.sql, confirmDestructive: confirm })
      .then((res) => {
        setStates((s) => ({
          ...s,
          [index]: res.ok
            ? { data: res.data, error: null, running: false }
            : { data: null, error: res.error, running: false },
        }));
      });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Examples</h1>
        <p className="text-sm text-muted-foreground">
          Educational PostgreSQL examples. Each runs through the same psycopg/OpenServerless backend as the main console
          (table: <code className="font-mono">pg_console_demo</code>). No results are simulated in React.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {EXAMPLES.map((ex, i) => {
          const cls = classifyStatement(ex.sql);
          const st = states[i];
          return (
            <div key={i} className="flex flex-col rounded-lg border border-border bg-card">
              <div className="flex items-start justify-between gap-2 border-b border-border p-3">
                <div className="flex items-start gap-2">
                  <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium">{ex.title}</p>
                    <p className="text-xs text-muted-foreground">{ex.description}</p>
                  </div>
                </div>
                <SafetyBadge op={cls.op} label={cls.label} />
              </div>
              <pre className="overflow-x-auto bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
{ex.sql}
              </pre>
              <div className="flex items-center justify-between border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => run(ex, i)}
                  disabled={st?.running || !info.connected}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {st?.running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/console")}
                  className="inline-flex items-center gap-1 px-2 py-1 text-sm text-primary hover:bg-accent"
                >
                  Open in console <ArrowRight className="size-3.5" />
                </button>
              </div>
              {st && (st.error || st.data) && (
                <div className="max-h-72 overflow-auto border-t border-border p-2">
                  {st.error ? (
                    <ErrorPanel error={st.error} />
                  ) : st.data && st.data.columns.length > 0 ? (
                    <ResultTable data={st.data} />
                  ) : st.data ? (
                    <div className="flex items-center gap-1.5 px-1 py-2 text-sm text-muted-foreground">
                      <Database className="size-4 text-emerald-500" />
                      {st.data.command} — {st.data.rowCount} row(s) affected.
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DestructiveConfirm
        open={!!pending}
        classification={pending?.cls ?? null}
        sql={pending?.sql ?? ""}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) run(EXAMPLES[p.index], p.index, true);
        }}
      />
    </div>
  );
}