import { useState } from "react";
import { Play, Loader2, ShieldCheck, ShieldAlert, BookOpen, ArrowRight } from "lucide-react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { ResultTable } from "@/components/ResultTable";
import { ErrorPanel } from "@/components/useQuery";
import { SafetyBadge } from "@/components/SafetyBadge";
import { DestructiveConfirm } from "@/components/DestructiveConfirm";
import { classifyStatement, type Classification } from "@/lib/safety";
import { useServerInfo } from "@/hooks/useServerInfo";
import { cn } from "@/lib/utils";

interface Preset {
  title: string;
  description: string;
  sql: string;
  params: string; // JSON array as text
}

const PRESETS: Preset[] = [
  {
    title: "Safe lookup by email",
    description: "The email value is bound as a parameter — never interpolated into SQL.",
    sql: "SELECT id, name, email, balance\nFROM pg_console_demo\nWHERE email = %s\nORDER BY id;",
    params: '["alice@example.com"]',
  },
  {
    title: "No SQL injection",
    description: "A malicious string is treated as a literal value, not as SQL.",
    sql: "SELECT id, name FROM pg_console_demo WHERE email = %s;",
    params: '["x\' OR \'1\'=\'1"]',
  },
  {
    title: "Parameterized INSERT",
    description: "Four values bound with %s placeholders (a WRITE operation).",
    sql: "INSERT INTO pg_console_demo(id, name, email, balance)\nVALUES (%s, %s, %s, %s);",
    params: '[50, "Eve", "eve@example.com", 200]',
  },
  {
    title: "Multiple parameters",
    description: "Range query with two bound numeric parameters.",
    sql: "SELECT id, name, balance FROM pg_console_demo\nWHERE balance >= %s AND balance <= %s\nORDER BY balance DESC;",
    params: "[0, 150]",
  },
];

export default function Parameterized() {
  const info = useServerInfo();
  const [sql, setSql] = useState<string>(PRESETS[0].sql);
  const [paramsText, setParamsText] = useState<string>(PRESETS[0].params);
  const [data, setData] = useState<QueryData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<{ sql: string; cls: Classification } | null>(null);

  const cls = classifyStatement(sql);

  const parseParams = (): unknown[] | string => {
    const text = paramsText.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return "Parameters must be a JSON array.";
      return parsed;
    } catch {
      return "Parameters are not valid JSON.";
    }
  };

  const run = (confirm = false) => {
    const parsed = parseParams();
    if (typeof parsed === "string") {
      setError({ type: "BadRequest", message: parsed });
      setData(null);
      return;
    }
    if (cls.op === "DESTRUCTIVE" && !confirm) {
      setPending({ sql, cls });
      return;
    }
    setRunning(true);
    setError(null);
    runQuery({ sql, params: parsed, confirmDestructive: confirm })
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

  const placeholderCount = (sql.match(/%s/g) || []).length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Parameterized Queries</h1>
        <p className="text-sm text-muted-foreground">
          Values are always bound with psycopg parameters (<code className="font-mono">%s</code>) — never
          interpolated with f-strings or Python <code className="font-mono">%</code> formatting.
        </p>
      </div>

      {/* Teaching panel */}
      <div className="grid shrink-0 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-300/50 bg-emerald-50/50 p-3 dark:border-emerald-700/40 dark:bg-emerald-950/20">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4" /> Safe — parameter binding
          </div>
          <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-[12px] text-foreground">
{`cursor.execute(
    "SELECT * FROM users WHERE email = %s",
    (email,),
)`}
          </pre>
          <p className="mt-1.5 text-xs text-muted-foreground">
            psycopg sends the SQL and values separately. No quotes around <code className="font-mono">%s</code>;
            the value cannot become SQL syntax.
          </p>
        </div>
        <div className="rounded-lg border border-rose-300/50 bg-rose-50/50 p-3 dark:border-rose-700/40 dark:bg-rose-950/20">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
            <ShieldAlert className="size-4" /> Unsafe — never do this
          </div>
          <pre className="overflow-x-auto rounded bg-card p-2 font-mono text-[12px] text-foreground">
{`# f-string interpolation -> SQL injection
cursor.execute(f"... email = '{email}'")

# Python % formatting -> SQL injection
cursor.execute("... email = '%s'" % email)`}
          </pre>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Building SQL with values lets user input become part of the command.
          </p>
        </div>
      </div>

      {/* Presets */}
      <div className="shrink-0">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <BookOpen className="size-3.5" /> Examples (demo table: pg_console_demo)
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => { setSql(p.sql); setParamsText(p.params); setData(null); setError(null); }}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs hover:bg-accent"
              title={p.description}
            >
              {p.title}
            </button>
          ))}
        </div>
      </div>

      {/* Editor + params */}
      <div className="grid shrink-0 gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="pq-sql" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SQL</label>
            <SafetyBadge op={cls.op} label={cls.label} />
          </div>
          <textarea
            id="pq-sql"
            name="pq_sql"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            rows={6}
            spellCheck={false}
            className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            {placeholderCount} <code className="font-mono">%s</code> placeholder{placeholderCount === 1 ? "" : "s"} detected.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pq-params" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Parameters (JSON array)
          </label>
          <textarea
            id="pq-params"
            name="pq_params"
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            rows={6}
            spellCheck={false}
            className="resize-y rounded-md border border-input bg-background p-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder='["alice@example.com"]'
          />
          <button
            type="button"
            onClick={() => run()}
            disabled={running || !info.connected || !sql.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run with parameters
          </button>
        </div>
      </div>

      {/* Result */}
      <div className="min-h-0 flex-1">
        {running ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Running…</div>
        ) : error ? (
          <ErrorPanel error={error} />
        ) : data ? (
          data.columns.length > 0 ? (
            <ResultTable data={data} />
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              <SafetyBadge op={(data.operation as never) || "WRITE"} label={data.operationLabel} />{" "}
              {data.command} — {data.rowCount} row(s) affected.
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <ArrowRight className="mr-2 size-4" /> Run a parameterized query to see results.
          </div>
        )}
      </div>

      <DestructiveConfirm
        open={!!pending}
        classification={pending?.cls ?? null}
        sql={pending?.sql ?? ""}
        onCancel={() => setPending(null)}
        onConfirm={() => { setPending(null); run(true); }}
      />
    </div>
  );
}