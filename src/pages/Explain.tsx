import { useState } from "react";
import { AlertCircle, GitBranch, Loader2, Play, AlertTriangle, Braces, FileText } from "lucide-react";
import { runQuery, type ApiError, type QueryData, DEFAULT_QUERY } from "@/lib/api";
import { useSchema } from "@/lib/schema-context";
import { explainQuery, type ExplainFormat } from "@/lib/pgQueries";
import { ErrorPanel } from "@/components/useQuery";
import { classifyStatement } from "@/lib/safety";
import { SafetyBadge } from "@/components/SafetyBadge";
import { cn } from "@/lib/utils";

interface PlanNode {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Alias"?: string;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Actual Rows"?: number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Shared Dirtied Blocks"?: number;
  "Shared Written Blocks"?: number;
  "Plans"?: PlanNode[];
  [k: string]: unknown;
}

interface ExplainRoot {
  Plan?: PlanNode;
  "Execution Time"?: number;
  "Planning Time"?: number;
  [k: string]: unknown;
}

export default function Explain() {
  const { schema } = useSchema();
  const [sql, setSql] = useState<string>("SELECT * FROM pg_console_demo WHERE balance > 50 ORDER BY balance;");
  const [format, setFormat] = useState<ExplainFormat>("json");
  const [analyze, setAnalyze] = useState(false);
  const [data, setData] = useState<QueryData | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const queryClass = classifyStatement(sql);
  // EXPLAIN ANALYZE executes the statement; block it for write operations.
  const analyzeOnWrite = analyze && (queryClass.op === "WRITE" || queryClass.op === "DDL" || queryClass.op === "DESTRUCTIVE");
  const canRun = !!sql.trim() && !analyzeOnWrite;

  const run = () => {
    if (!sql.trim() || analyzeOnWrite) return;
    setRunning(true);
    setError(null);
    runQuery({ sql: explainQuery(sql, format, analyze), schema })
      .then((res) => {
        if (res.ok) { setData(res.data); setError(null); }
        else { setError(res.error); setData(null); }
      })
      .finally(() => setRunning(false));
  };

  // Extract the JSON plan root from the result.
  let planRoot: ExplainRoot | null = null;
  if (data && data.rows.length > 0) {
    const col = data.columns[0]?.name || "QUERY PLAN";
    const val = data.rows[0][col];
    if (format === "json" && Array.isArray(val) && val.length > 0) {
      planRoot = val[0] as ExplainRoot;
    }
  }
  const textPlan = data && format === "text"
    ? (data.rows.map((r) => Object.values(r)[0]).join("\n"))
    : "";

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Explain</h1>
        <p className="text-sm text-muted-foreground">
          Inspect the query execution plan. Prefer <code className="font-mono">EXPLAIN (FORMAT JSON)</code> for inspection;
          toggle ANALYZE to actually run the statement.
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <label htmlFor="explain-sql" className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Query</span>
          <SafetyBadge op={queryClass.op} label={queryClass.label} />
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-input p-0.5">
            <button type="button" onClick={() => setFormat("json")} className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs", format === "json" ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
              <Braces className="size-3.5" /> JSON
            </button>
            <button type="button" onClick={() => setFormat("text")} className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs", format === "text" ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
              <FileText className="size-3.5" /> Text
            </button>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input id="explain-analyze" name="explain_analyze" type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} className="size-4" />
            <span className="text-muted-foreground">ANALYZE (executes the query)</span>
          </label>
          {analyze && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertTriangle className="size-3" /> ANALYZE runs the statement
            </span>
          )}
          <button type="button" onClick={run} disabled={running || !canRun} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Explain
          </button>
        </div>
        {analyzeOnWrite && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              EXPLAIN ANALYZE executes the statement. It is blocked for <strong>{queryClass.label}</strong> operations here.
              Turn off ANALYZE or use a read-only query.
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <div className="flex h-full flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <GitBranch className="size-3.5" /> {format === "json" ? "Execution plan (visual)" : "Execution plan (text)"}
            {data?.durationMs !== undefined && <span className="ml-auto normal-case text-muted-foreground/70">{data.durationMs} ms</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {running ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Planning…</div>
            ) : error ? (
              <ErrorPanel error={error} />
            ) : format === "json" && planRoot ? (
              <JsonPlanView root={planRoot} />
            ) : textPlan ? (
              <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-foreground">{textPlan}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Run a query to see its plan.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function JsonPlanView({ root }: { root: ExplainRoot }) {
  return (
    <div className="space-y-3">
      {(root["Execution Time"] !== undefined || root["Planning Time"] !== undefined) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {root["Planning Time"] !== undefined && <span className="rounded bg-muted px-2 py-0.5 font-mono">Planning: {root["Planning Time"]} ms</span>}
          {root["Execution Time"] !== undefined && <span className="rounded bg-muted px-2 py-0.5 font-mono">Execution: {root["Execution Time"]} ms</span>}
        </div>
      )}
      {root.Plan && <PlanTreeNode node={root.Plan} depth={0} />}
    </div>
  );
}

function PlanTreeNode({ node, depth }: { node: PlanNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const children = node.Plans ?? [];
  const hasChildren = children.length > 0;
  return (
    <div className="select-none">
      <div
        className="flex flex-wrap items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 text-muted-foreground" aria-label={open ? "Collapse" : "Expand"}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="font-mono text-[13px] font-semibold text-foreground">{node["Node Type"] ?? "Node"}</span>
        {node["Relation Name"] && (
          <span className="font-mono text-[12px] text-primary">on {node["Relation Name"]}{node["Alias"] && node["Alias"] !== node["Relation Name"] ? ` (${node["Alias"]})` : ""}</span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          cost {fmt(node["Startup Cost"])}..{fmt(node["Total Cost"])} · rows {fmt(node["Plan Rows"])}
        </span>
        {node["Actual Rows"] !== undefined && (
          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
            actual {fmt(node["Actual Rows"])} rows{node["Actual Loops"] !== undefined && node["Actual Loops"] !== 1 ? ` ×${fmt(node["Actual Loops"])}` : ""}
          </span>
        )}
        {node["Actual Total Time"] !== undefined && (
          <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400">{fmt(node["Actual Total Time"])} ms</span>
        )}
        {(node["Shared Hit Blocks"] || node["Shared Read Blocks"]) && (
          <span className="font-mono text-[11px] text-violet-600 dark:text-violet-400">
            buffers hit {fmt(node["Shared Hit Blocks"])} / read {fmt(node["Shared Read Blocks"])}
          </span>
        )}
      </div>
      {open && hasChildren && children.map((child, i) => <PlanTreeNode key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
  return String(v);
}