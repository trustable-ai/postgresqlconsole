import { useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  Play,
  PlaySquare,
  Sparkles,
  Eraser,
  Copy,
  ClipboardList,
  History as HistoryIcon,
  X,
  Clock,
  Hash,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { SqlEditor, type SqlEditorHandle } from "@/components/SqlEditor";
import { ResultTable, rowsToTSV } from "@/components/ResultTable";
import { ErrorPanel } from "@/components/useQuery";
import { runQuery, type ApiError, type QueryData, DEFAULT_QUERY } from "@/lib/api";
import { useSchema } from "@/lib/schema-context";
import { useServerInfo } from "@/hooks/useServerInfo";
import { formatSQL } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import { addHistory, clearHistory, loadHistory, type HistoryEntry } from "@/lib/history";
import { classifyStatement, detectForbiddenIdentity, type Classification } from "@/lib/safety";
import { SafetyBadge } from "@/components/SafetyBadge";
import { DestructiveConfirm } from "@/components/DestructiveConfirm";
import { cn } from "@/lib/utils";

type Tab = "results" | "messages" | "error" | "execution";

export default function Console() {
  const { schema } = useSchema();
  const info = useServerInfo();
  const editorRef = useRef<SqlEditorHandle>(null);

  const [sql, setSql] = useState<string>(DEFAULT_QUERY);
  const [data, setData] = useState<QueryData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<Tab>("results");
  const [lastSql, setLastSql] = useState<string>("");
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const [pendingDestructive, setPendingDestructive] = useState<{ sql: string; cls: Classification } | null>(null);

  const execute = (query: string, confirm = false) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const cls = classifyStatement(trimmed);
    // User/role management and identity-switching commands are never allowed:
    // the console operates as a single configured PostgreSQL user. Block them
    // in the UI (the backend enforces the same rule independently).
    if (cls.op === "FORBIDDEN") {
      const label = detectForbiddenIdentity(trimmed) ?? "identity operation";
      setError({
        type: "ForbiddenIdentityOperation",
        message: `User/role management and identity-switching commands are not allowed (${label}). The console operates as a single configured PostgreSQL user.`,
      });
      setData(null);
      setTab("error");
      setRunning(false);
      setLastSql(trimmed);
      setLastAt(Date.now());
      setHistory(addHistory(trimmed, null, {
        type: "ForbiddenIdentityOperation",
        message: `Forbidden identity operation: ${label}`,
      }));
      return;
    }
    if (cls.op === "DESTRUCTIVE" && !confirm) {
      setPendingDestructive({ sql: trimmed, cls });
      return;
    }
    setRunning(true);
    setLastSql(trimmed);
    setLastAt(Date.now());
    runQuery({ sql: trimmed, schema, confirmDestructive: confirm })
      .then((res) => {
        if (res.ok) {
          setData(res.data);
          setError(null);
          setTab(res.data && res.data.columns.length > 0 ? "results" : "messages");
          setHistory(addHistory(trimmed, res.data, null));
        } else {
          setError(res.error);
          setData(null);
          setTab("error");
          setHistory(addHistory(trimmed, null, res.error));
        }
      })
      .finally(() => setRunning(false));
  };

  const runFull = () => execute(editorRef.current?.getValue() ?? sql);
  const runSelection = () => {
    const sel = (editorRef.current?.getSelection() ?? "").trim();
    execute(sel || (editorRef.current?.getValue() ?? sql));
  };
  const runSmart = runSelection; // Ctrl/Cmd+Enter: selection if present, else full.

  const format = () => setSql((s) => formatSQL(s));
  const clear = () => setSql("");
  const copySql = () => copyText(editorRef.current?.getValue() ?? sql, "SQL copied");
  const copyResults = () => {
    if (data && data.columns.length > 0) {
      copyText(rowsToTSV(data), "Results copied as TSV");
    } else if (data) {
      copyText(`${data.command} — ${data.rowCount} row(s)`, "Result copied");
    } else {
      copyText("", "No results to copy");
    }
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    setSql(entry.sql);
    setShowHistory(false);
    editorRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <ConsoleButton onClick={runFull} disabled={running || !info.connected} primary icon={Play}>
          Run
        </ConsoleButton>
        <ConsoleButton onClick={runSelection} disabled={running || !info.connected} icon={PlaySquare}>
          Run Selection
        </ConsoleButton>
        <ConsoleButton onClick={format} disabled={running} icon={Sparkles}>
          Format
        </ConsoleButton>
        <ConsoleButton onClick={clear} disabled={running} icon={Eraser}>
          Clear
        </ConsoleButton>
        <ConsoleButton onClick={copySql} disabled={!sql.trim()} icon={Copy}>
          Copy SQL
        </ConsoleButton>
        <ConsoleButton onClick={copyResults} disabled={!data} icon={ClipboardList}>
          Copy Results
        </ConsoleButton>
        <div className="ml-auto flex items-center gap-2">
          {info.statementTimeoutMs ? (
            <span className="hidden text-xs text-muted-foreground/70 sm:inline">
              timeout {info.statementTimeoutMs}ms
            </span>
          ) : null}
          <ConsoleButton onClick={() => setShowHistory((v) => !v)} icon={HistoryIcon} active={showHistory}>
            History
          </ConsoleButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <PanelGroup direction="vertical" className="h-full">
          <Panel defaultSize={45} minSize={15}>
            <div className="flex h-full flex-col rounded-lg border border-border bg-card">
              <div className="border-b border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                SQL Editor
                <span className="ml-2 font-normal normal-case text-muted-foreground/70">
                  Ctrl/Cmd+Enter to run · select text for Run Selection
                </span>
              </div>
              <div className="min-h-0 flex-1">
                <SqlEditor
                  ref={editorRef}
                  value={sql}
                  onChange={setSql}
                  onRunSmart={runSmart}
                  running={running}
                  disabled={!info.connected}
                />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="h-1.5 bg-transparent hover:bg-primary/20" />
          <Panel defaultSize={55} minSize={15}>
            <ResultArea
              data={data}
              error={error}
              running={running}
              tab={tab}
              setTab={setTab}
              lastSql={lastSql}
              lastAt={lastAt}
              schema={schema}
            />
          </Panel>
        </PanelGroup>
      </div>

      {showHistory && (
        <HistoryPanel
          history={history}
          onPick={loadFromHistory}
          onClear={() => setHistory(clearHistory())}
          onClose={() => setShowHistory(false)}
        />
      )}

      <DestructiveConfirm
        open={!!pendingDestructive}
        classification={pendingDestructive?.cls ?? null}
        sql={pendingDestructive?.sql ?? ""}
        onCancel={() => setPendingDestructive(null)}
        onConfirm={() => {
          const p = pendingDestructive;
          setPendingDestructive(null);
          if (p) execute(p.sql, true);
        }}
      />
    </div>
  );
}

function ConsoleButton({
  children,
  onClick,
  disabled,
  primary,
  active,
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : active
            ? "bg-accent text-accent-foreground"
            : "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function ResultArea({
  data,
  error,
  running,
  tab,
  setTab,
  lastSql,
  lastAt,
  schema,
}: {
  data: QueryData | null;
  error: ApiError | null;
  running: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  lastSql: string;
  lastAt: number | null;
  schema: string;
}) {
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: "results", label: "Results", icon: Hash },
    { id: "messages", label: "Messages", icon: Info, badge: data?.notices?.length },
    { id: "error", label: "Error", icon: AlertTriangle },
    { id: "execution", label: "Execution", icon: Clock },
  ];

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-1.5 text-xs">
        {data ? (
          <>
            <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground">
              <Terminal className="size-3.5 text-primary" />
              {data.command || "—"}
            </span>
            {data.operation && (
              <SafetyBadge op={data.operation as never} label={data.operationLabel} />
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Hash className="size-3.5" />
              {data.rowCount} {data.columns.length > 0 ? "rows" : "affected"}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3.5" />
              {data.durationMs} ms
            </span>
            {data.columns.length > 0 && (
              <span className="text-muted-foreground/70">{data.columns.length} columns</span>
            )}
          </>
        ) : error ? (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="size-3.5" /> {error.type}
          </span>
        ) : running ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3.5 animate-pulse" /> Running…
          </span>
        ) : (
          <span className="text-muted-foreground">Run a query to see results.</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.badge ? (
              <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "results" && (
          data && data.columns.length > 0 ? (
            <ResultTable data={data} />
          ) : data ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <CheckCircle2 className="mr-2 size-4 text-emerald-500" />
              {data.command || "OK"} — {data.rowCount} row(s) affected. See Messages for details.
            </div>
          ) : error ? (
            <ErrorPanel error={error} />
          ) : (
            <EmptyState />
          )
        )}

        {tab === "messages" && <MessagesTab data={data} running={running} />}

        {tab === "error" && (error ? <ErrorPanel error={error} /> : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No error.
          </div>
        ))}

        {tab === "execution" && (
          <ExecutionTab data={data} error={error} lastSql={lastSql} lastAt={lastAt} schema={schema} />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
      Run a query to see results here.
    </div>
  );
}

function MessagesTab({ data, running }: { data: QueryData | null; running: boolean }) {
  if (running) return <div className="p-2 text-sm text-muted-foreground">Running…</div>;
  if (!data) return <div className="p-2 text-sm text-muted-foreground">No messages.</div>;
  const notices = data.notices ?? [];
  return (
    <div className="space-y-2 p-1">
      <div className="rounded-md border border-border bg-muted/30 p-2 text-sm">
        <span className="font-mono text-xs font-semibold text-foreground">{data.command || "OK"}</span>
        <span className="ml-2 text-muted-foreground">
          {data.rowCount} {data.columns.length > 0 ? "rows" : "row(s) affected"} · {data.durationMs} ms
        </span>
      </div>
      {notices.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No notices.</p>
      ) : (
        <ul className="space-y-1">
          {notices.map((n, i) => (
            <li key={i} className="rounded-md border border-border bg-muted/20 p-2 text-sm">
              <div className="flex items-center gap-2">
                {n.severity && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {n.severity}
                  </span>
                )}
                {n.code && <span className="font-mono text-[10px] text-muted-foreground">{n.code}</span>}
              </div>
              <p className="mt-1 font-mono text-[13px] text-foreground">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExecutionTab({
  data,
  error,
  lastSql,
  lastAt,
  schema,
}: {
  data: QueryData | null;
  error: ApiError | null;
  lastSql: string;
  lastAt: number | null;
  schema: string;
}) {
  return (
    <div className="space-y-3 p-1 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        <Meta label="Status" value={error ? "Error" : data ? "OK" : "—"} />
        <Meta label="Command" value={data?.command ?? "—"} />
        <Meta label="Rows" value={data ? String(data.rowCount) : "—"} />
        <Meta label="Duration" value={data ? `${data.durationMs} ms` : "—"} />
        <Meta label="Columns" value={data ? String(data.columns.length) : "—"} />
        <Meta label="Schema" value={schema} />
        <Meta label="Executed at" value={lastAt ? new Date(lastAt).toLocaleTimeString() : "—"} />
        <Meta label="Error type" value={error?.type ?? "—"} />
      </dl>
      {lastSql && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Executed SQL</p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[12px] text-foreground">
{lastSql}
          </pre>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function HistoryPanel({
  history,
  onPick,
  onClear,
  onClose,
}: {
  history: HistoryEntry[];
  onPick: (e: HistoryEntry) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-border bg-card p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent queries ({history.length}/20)
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={history.length === 0}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
            aria-label="Close history"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {history.length === 0 ? (
        <p className="px-1 py-3 text-center text-sm text-muted-foreground">No history yet.</p>
      ) : (
        <ul className="space-y-1">
          {history.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onPick(e)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                <span
                  className={cn(
                    "mt-0.5 size-2 shrink-0 rounded-full",
                    e.ok ? "bg-emerald-500" : "bg-destructive",
                  )}
                  title={e.ok ? "succeeded" : "failed"}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-foreground">{e.sql.split("\n")[0]}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                    {e.command && <span>{e.command}</span>}
                    <span>{e.rowCount} rows</span>
                    <span>{e.durationMs} ms</span>
                    <span>{new Date(e.at).toLocaleTimeString()}</span>
                    {!e.ok && e.errorType && <span className="text-destructive">{e.errorType}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}