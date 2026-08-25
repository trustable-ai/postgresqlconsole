import { useState } from "react";
import { AlertCircle, Loader2, Play, ListChecks } from "lucide-react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { useSchema } from "@/lib/schema-context";
import { ResultTable } from "@/components/ResultTable";
import { ErrorPanel } from "@/components/useQuery";

interface SavedQuery {
  title: string;
  description: string;
  sql: string;
  needsSchema?: boolean;
}

const SAVED: SavedQuery[] = [
  {
    title: "Top 20 tables by size",
    description: "Largest tables across all schemas.",
    needsSchema: false,
    sql: `SELECT
    n.nspname AS schema,
    c.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    c.reltuples::bigint AS estimate_rows
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg\\_%'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;`,
  },
  {
    title: "Index usage stats",
    description: "How often each index is scanned (pg_stat_user_indexes).",
    needsSchema: true,
    sql: `SELECT
    schemaname AS schema_name,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan AS scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched
FROM pg_catalog.pg_stat_user_indexes
ORDER BY idx_scan DESC;`,
  },
  {
    title: "Long-running queries",
    description: "Currently active queries older than 30 seconds.",
    sql: `SELECT
    pid,
    usename AS "user",
    state,
    now() - query_start AS duration,
    LEFT(query, 120) AS query_preview
FROM pg_catalog.pg_stat_activity
WHERE state <> 'idle' AND now() - query_start > interval '30 seconds'
ORDER BY query_start;`,
  },
  {
    title: "Connection summary",
    description: "Active vs idle backends by user.",
    sql: `SELECT
    usename AS "user",
    state,
    COUNT(*) AS connections
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
GROUP BY usename, state
ORDER BY connections DESC;`,
  },
  {
    title: "Cache hit ratio",
    description: "Buffer cache effectiveness for user tables.",
    needsSchema: true,
    sql: `SELECT
    relname AS table_name,
    heap_blks_read AS heap_blocks_read,
    heap_blks_hit AS heap_blocks_hit,
    CASE WHEN (heap_blks_hit + heap_blks_read) = 0 THEN 0
         ELSE round(heap_blks_hit::numeric / (heap_blks_hit + heap_blks_read), 4) END AS hit_ratio
FROM pg_catalog.pg_statio_user_tables
ORDER BY heap_blks_hit DESC NULLS LAST;`,
  },
];

export default function Queries() {
  const { schema } = useSchema();
  const [active, setActive] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<number, QueryData>>({});
  const [errors, setErrors] = useState<Record<number, ApiError>>({});

  const run = (q: SavedQuery, idx: number) => {
    setActive(idx);
    setRunning(true);
    setErrors((p) => {
      const next = { ...p };
      delete next[idx];
      return next;
    });
    runQuery({ sql: q.sql, schema: q.needsSchema ? schema : undefined })
      .then((res) => {
        if (res.ok) {
          setResults((p) => ({ ...p, [idx]: res.data as QueryData }));
        } else {
          setErrors((p) => ({ ...p, [idx]: res.error as ApiError }));
        }
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Queries</h1>
        <p className="text-sm text-muted-foreground">
          A library of ready-to-run diagnostic SQL queries. Click Run to execute inline.
        </p>
      </div>

      <div className="space-y-3">
        {SAVED.map((q, i) => (
          <div key={i} className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-3">
              <div className="flex items-start gap-2">
                <ListChecks className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="font-medium">{q.title}</p>
                  <p className="text-xs text-muted-foreground">{q.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => run(q, i)}
                disabled={running && active === i}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {running && active === i ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Run
              </button>
            </div>
            <pre className="overflow-x-auto bg-muted/30 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
{q.sql}
            </pre>
            {active === i && (errors[i] ? (
              <div className="p-2"><ErrorPanel error={errors[i]} /></div>
            ) : results[i] ? (
              <div className="overflow-auto p-2">
                {results[i].columns ? <ResultTable data={results[i]} /> : (
                  <span className="px-1 py-2 font-mono text-xs text-foreground">{results[i].command ?? "OK"}</span>
                )}
              </div>
            ) : null)}
          </div>
        ))}
      </div>
    </div>
  );
}