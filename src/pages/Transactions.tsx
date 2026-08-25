import { useState } from "react";
import { Play, Loader2, Plus, Trash2, CheckCircle2, XCircle, ArrowLeftRight, BookOpen, Save, Undo2 } from "lucide-react";
import { runTransaction, type ApiError, type TransactionData, type TransactionStatement, type StmtResult } from "@/lib/api";
import { ErrorPanel } from "@/components/useQuery";
import { SafetyBadge } from "@/components/SafetyBadge";
import { DestructiveConfirm } from "@/components/DestructiveConfirm";
import { ResultTable } from "@/components/ResultTable";
import { classifyStatement, findDestructive, type Classification } from "@/lib/safety";
import { useServerInfo } from "@/hooks/useServerInfo";
import { cn } from "@/lib/utils";

interface StmtEditor {
  id: string;
  sql: string;
  params: string; // JSON array text
}

interface Preset {
  title: string;
  description: string;
  statements: { sql: string; params: string }[];
  commit: boolean;
}

const PRESETS: Preset[] = [
  {
    title: "Commit (BEGIN … COMMIT)",
    description: "Insert + update inside one transaction, then commit.",
    commit: true,
    statements: [
      { sql: "INSERT INTO pg_console_demo(id,name,email,balance) VALUES (%s,%s,%s,%s)", params: '[60, "Frank", "frank@example.com", 30]' },
      { sql: "UPDATE pg_console_demo SET balance = %s WHERE name = %s", params: '[999, "Frank"]' },
      { sql: "SELECT id, name, balance FROM pg_console_demo WHERE name = %s", params: '["Frank"]' },
    ],
  },
  {
    title: "Rollback (BEGIN … ROLLBACK)",
    description: "Insert a row, read it, then roll the whole transaction back.",
    commit: false,
    statements: [
      { sql: "INSERT INTO pg_console_demo(id,name,email) VALUES (%s,%s,%s)", params: '[88, "Temp", "temp@example.com"]' },
      { sql: "SELECT count(*)::int AS c FROM pg_console_demo", params: "[]" },
    ],
  },
  {
    title: "SAVEPOINT + ROLLBACK TO",
    description: "Set a savepoint, insert, roll back to the savepoint, then verify.",
    commit: true,
    statements: [
      { sql: "SAVEPOINT sp1", params: "[]" },
      { sql: "INSERT INTO pg_console_demo(id,name,email) VALUES (%s,%s,%s)", params: '[77, "Sneaky", "s@x.com"]' },
      { sql: "ROLLBACK TO SAVEPOINT sp1", params: "[]" },
      { sql: "SELECT count(*)::int AS c FROM pg_console_demo WHERE id = 77", params: "[]" },
    ],
  },
];

let _id = 0;
const newId = () => `s${++_id}`;

export default function Transactions() {
  const info = useServerInfo();
  const [stmts, setStmts] = useState<StmtEditor[]>(() => PRESETS[0].statements.map((s) => ({ id: newId(), sql: s.sql, params: s.params })));
  const [commit, setCommit] = useState<boolean>(PRESETS[0].commit);
  const [result, setResult] = useState<TransactionData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<{ cls: Classification; index: number } | null>(null);

  const updateStmt = (id: string, patch: Partial<StmtEditor>) =>
    setStmts((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addStmt = () => setStmts((arr) => [...arr, { id: newId(), sql: "", params: "[]" }]);
  const removeStmt = (id: string) => setStmts((arr) => (arr.length > 1 ? arr.filter((s) => s.id !== id) : arr));

  const loadPreset = (p: Preset) => {
    setStmts(p.statements.map((s) => ({ id: newId(), sql: s.sql, params: s.params })));
    setCommit(p.commit);
    setResult(null);
    setError(null);
  };

  const buildStatements = (): TransactionStatement[] | string => {
    const out: TransactionStatement[] = [];
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (!s.sql.trim()) return `Statement ${i + 1} is empty.`;
      let params: unknown[] = [];
      const text = s.params.trim();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) return `Statement ${i + 1}: params must be a JSON array.`;
          params = parsed;
        } catch {
          return `Statement ${i + 1}: params are not valid JSON.`;
        }
      }
      out.push({ sql: s.sql, params });
    }
    return out;
  };

  const run = (confirm = false) => {
    const built = buildStatements();
    if (typeof built === "string") {
      setError({ type: "BadRequest", message: built });
      setResult(null);
      return;
    }
    const dest = findDestructive(built);
    if (dest && !confirm) {
      setPending({ cls: dest.cls, index: dest.index });
      return;
    }
    setRunning(true);
    setError(null);
    runTransaction({ statements: built, commit, confirmDestructive: confirm })
      .then((res) => {
        if (res.ok && res.data) {
          setResult(res.data);
          setError(null);
        } else {
          setError(res.error);
          setResult(res.data);
        }
      })
      .finally(() => setRunning(false));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          A transaction runs entirely within one backend request and one psycopg connection
          (<code className="font-mono">with conn.transaction()</code>). No transaction state is kept across invocations.
        </p>
      </div>

      {/* Presets */}
      <div className="shrink-0">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <BookOpen className="size-3.5" /> Guided examples
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.title} type="button" onClick={() => loadPreset(p)} className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-accent" title={p.description}>
              {p.title}
            </button>
          ))}
        </div>
      </div>

      {/* Statements */}
      <div className="shrink-0 space-y-2">
        {stmts.map((s, i) => {
          const cls = classifyStatement(s.sql);
          return (
            <div key={s.id} className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                <SafetyBadge op={cls.op} label={cls.label} />
                <button type="button" onClick={() => removeStmt(s.id)} disabled={stmts.length <= 1} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Remove statement">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
                <textarea
                  value={s.sql}
                  onChange={(e) => updateStmt(s.id, { sql: e.target.value })}
                  rows={2}
                  spellCheck={false}
                  placeholder="SQL with %s placeholders"
                  className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <textarea
                  value={s.params}
                  onChange={(e) => updateStmt(s.id, { params: e.target.value })}
                  rows={2}
                  spellCheck={false}
                  placeholder='["value", 1]'
                  className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          );
        })}
        <button type="button" onClick={addStmt} className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
          <Plus className="size-4" /> Add statement
        </button>
      </div>

      {/* Commit toggle + run */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-input p-0.5">
          <button
            type="button"
            onClick={() => setCommit(true)}
            className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm", commit ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "text-muted-foreground")}
          >
            <Save className="size-3.5" /> COMMIT
          </button>
          <button
            type="button"
            onClick={() => setCommit(false)}
            className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm", !commit ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "text-muted-foreground")}
          >
            <Undo2 className="size-3.5" /> ROLLBACK
          </button>
        </div>
        <button
          type="button"
          onClick={() => run()}
          disabled={running || !info.connected}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Run transaction
        </button>
        {result && (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", result.committed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300")}>
            {result.committed ? <><CheckCircle2 className="size-3.5" /> Committed</> : <><XCircle className="size-3.5" /> Rolled back</>}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 space-y-2">
        {error && !result && <ErrorPanel error={error} />}
        {result && (
          <>
            {error && (
              <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                Transaction failed and was rolled back: {error.message}
              </div>
            )}
            {result.results.map((r: StmtResult, i) => (
              <StmtResultCard key={i} index={i} result={r} />
            ))}
          </>
        )}
        {!result && !error && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <ArrowLeftRight className="mr-2 size-4" /> Run a transaction to see per-statement results.
          </div>
        )}
      </div>

      <DestructiveConfirm
        open={!!pending}
        classification={pending?.cls ?? null}
        sql={pending ? stmts[pending.index]?.sql ?? "" : ""}
        onCancel={() => setPending(null)}
        onConfirm={() => { setPending(null); run(true); }}
      />
    </div>
  );
}

function StmtResultCard({ index, result }: { index: number; result: StmtResult }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
        <SafetyBadge op={result.operation as never} label={result.operationLabel} />
        {result.command && <span className="font-mono text-xs font-medium text-foreground">{result.command}</span>}
        {result.rowCount !== undefined && <span className="text-xs text-muted-foreground">{result.rowCount} row(s)</span>}
        <span className="text-xs text-muted-foreground">{result.durationMs} ms</span>
        {result.error ? <XCircle className="ml-auto size-4 text-destructive" /> : <CheckCircle2 className="ml-auto size-4 text-emerald-500" />}
      </div>
      <div className="px-3 py-1.5">
        <code className="block truncate font-mono text-[11px] text-muted-foreground">{result.sql}</code>
      </div>
      <div className="p-2">
        {result.error ? (
          <ErrorPanel error={result.error} />
        ) : result.columns && result.columns.length > 0 ? (
          <ResultTable data={{ columns: result.columns, rows: result.rows || [], rowCount: result.rowCount || 0, command: result.command || "SELECT", durationMs: result.durationMs }} />
        ) : null}
      </div>
    </div>
  );
}