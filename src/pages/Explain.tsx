import { useState } from "react";
import { AlertCircle, GitBranch, Loader2, Play } from "lucide-react";
import { runQuery, type ApiError, type QueryData, DEFAULT_QUERY } from "@/lib/api";
import { useSchema } from "@/lib/schema-context";
import { explainQuery } from "@/lib/pgQueries";
import { ErrorPanel } from "@/components/useQuery";

export default function Explain() {
  const { schema } = useSchema();
  const [sql, setSql] = useState<string>("SELECT * FROM pg_catalog.pg_class LIMIT 5;");
  const [analyze, setAnalyze] = useState(false);
  const [data, setData] = useState<QueryData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = () => {
    if (!sql.trim()) return;
    setRunning(true);
    setError(null);
    runQuery({ sql: explainQuery(sql, analyze), schema })
      .then((res) => {
        if (res.ok) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error);
          setData(null);
        }
      })
      .finally(() => setRunning(false));
  };

  const plan = (data?.rows ?? [])
    .map((row) => (Array.isArray(row) ? row[0] : Object.values(row)[0]))
    .join("\n");

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Explain</h1>
        <p className="text-sm text-muted-foreground">
          Inspect the query execution plan. Toggle ANALYZE to actually run the statement.
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <label htmlFor="explain-sql" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Query
        </label>
        <textarea
          id="explain-sql"
          name="explain_sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={4}
          spellCheck={false}
          className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={DEFAULT_QUERY}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              id="explain-analyze"
              name="explain_analyze"
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
              className="size-4"
            />
            <span className="text-muted-foreground">ANALYZE (executes the query)</span>
          </label>
          <button
            type="button"
            onClick={run}
            disabled={running || !sql.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Explain
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className="flex h-full flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <GitBranch className="size-3.5" /> Execution Plan
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {running ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Planning…
              </div>
            ) : error ? (
              <ErrorPanel error={error} />
            ) : plan ? (
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-foreground">{plan}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Run a query to see its plan.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}