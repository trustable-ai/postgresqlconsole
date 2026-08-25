import { useState } from "react";
import { Loader2, Play, ArrowLeftRight, CheckCircle2, XCircle } from "lucide-react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { useSchema } from "@/lib/schema-context";

const DEMO_SCRIPT = `-- Multi-statement transaction in a single request.
-- Statements split on ";" are executed sequentially in the same request scope.
BEGIN;
SELECT 1 AS step_a;
SELECT 2 AS step_b;
COMMIT;
SELECT 'done' AS status;`;

interface StmtResult {
  sql: string;
  ok: boolean;
  data: QueryData | null;
  error: ApiError | null;
}

export default function Transactions() {
  const { schema } = useSchema();
  const [sql, setSql] = useState<string>(DEMO_SCRIPT);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<StmtResult[] | null>(null);

  const run = () => {
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (statements.length === 0) return;
    setRunning(true);
    setOutput([]);

    (async () => {
      const acc: StmtResult[] = [];
      for (const stmt of statements) {
        const res = await runQuery({ sql: stmt.endsWith(";") ? stmt : stmt + ";", schema });
        const item: StmtResult = {
          sql: stmt,
          ok: res.ok,
          data: res.ok ? (res.data as QueryData) : null,
          error: res.ok ? null : (res.error as ApiError),
        };
        acc.push(item);
        setOutput([...acc]);
        if (!res.ok) break;
      }
    })()
      .finally(() => setRunning(false));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Run a multi-statement script. Statements split on <code className="font-mono">;</code> are executed
          sequentially in the same request scope.
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <label htmlFor="txn-sql" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Transaction script
        </label>
        <textarea
          id="txn-sql"
          name="txn_sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={8}
          spellCheck={false}
          className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !sql.trim()}
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run script
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3">
        {output?.map((item, i) => (
          <div key={i} className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <ArrowLeftRight className="size-3.5 text-muted-foreground" />
              <code className="font-mono text-xs text-muted-foreground">
                {item.sql.slice(0, 80)}{item.sql.length > 80 ? "…" : ""}
              </code>
              {item.ok ? (
                <CheckCircle2 className="ml-auto size-4 text-emerald-500" />
              ) : (
                <XCircle className="ml-auto size-4 text-destructive" />
              )}
            </div>
            <div className="p-2 text-sm">
              {item.ok ? (
                item.data?.columns ? (
                  <span className="text-muted-foreground">{item.data.rowCount ?? 0} rows</span>
                ) : (
                  <span className="font-mono text-xs text-foreground">{item.data?.command ?? "OK"}</span>
                )
              ) : (
                <span className="font-mono text-xs text-destructive">
                  {item.error?.type}: {item.error?.message}
                  {item.error?.sqlstate ? ` (SQLSTATE ${item.error.sqlstate})` : ""}
                </span>
              )}
            </div>
          </div>
        ))}
        {!output && (
          <p className="text-sm text-muted-foreground">Run a script to see per-statement results.</p>
        )}
      </div>
    </div>
  );
}