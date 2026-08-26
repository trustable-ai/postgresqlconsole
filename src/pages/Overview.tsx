import { useEffect, useState } from "react";
import {
  Server, Database, User, Clock, HardDrive, Boxes, Table2,
  Activity, Users, CheckCircle2, XCircle, Gauge, Loader2, AlertCircle,
} from "lucide-react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { STATS_QUERY } from "@/lib/pgQueries";
import { ErrorPanel } from "@/components/useQuery";

interface Stats {
  version: string;
  database: string;
  current_user: string;
  session_user: string;
  server_start: string;
  uptime: string;
  db_size_pretty: string;
  db_size_bytes: number;
  schema_count: number;
  table_count: number;
  active_connections: number;
  max_connections: number;
  transactions_committed: number;
  transactions_rolled_back: number;
  cache_hit_ratio: number | null;
  blocks_hit: number;
  blocks_read: number;
}

function shortVersion(v: string): string {
  const m = v.match(/PostgreSQL\s+([\d.]+)/);
  return m ? `PostgreSQL ${m[1]}` : v.slice(0, 40);
}

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runQuery({ sql: STATS_QUERY })
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data && res.data.rows.length > 0) {
          setStats(res.data.rows[0] as unknown as Stats);
        } else {
          setError(res.error);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nonce]);

  const cachePct = stats?.cache_hit_ratio != null ? (stats.cache_hit_ratio * 100).toFixed(2) + "%" : "—";

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">Safe runtime information for the connected PostgreSQL instance.</p>
        </div>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Loader2 className={loading ? "size-4 animate-spin" : "size-4"} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading runtime stats…</div>
      ) : error ? (
        <ErrorPanel error={error} />
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat icon={Server} label="Version" value={shortVersion(stats.version)} />
          <Stat icon={Database} label="Database" value={stats.database} />
          <Stat icon={User} label="Current user" value={stats.current_user} />
          <Stat icon={User} label="Session user" value={stats.session_user} />
          <Stat icon={Clock} label="Server uptime" value={stats.uptime} />
          <Stat icon={HardDrive} label="Database size" value={stats.db_size_pretty} />
          <Stat icon={Boxes} label="Schemas" value={String(stats.schema_count)} />
          <Stat icon={Table2} label="Tables" value={String(stats.table_count)} />
          <Stat icon={Users} label="Active connections" value={String(stats.active_connections)} />
          <Stat icon={Activity} label="Max connections" value={String(stats.max_connections)} />
          <Stat icon={CheckCircle2} label="Transactions committed" value={String(stats.transactions_committed)} valueClass="text-emerald-600 dark:text-emerald-400" />
          <Stat icon={XCircle} label="Transactions rolled back" value={String(stats.transactions_rolled_back)} valueClass="text-amber-600 dark:text-amber-400" />
          <Stat icon={Gauge} label="Cache hit ratio" value={cachePct} valueClass={stats.cache_hit_ratio != null && stats.cache_hit_ratio >= 0.9 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"} />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertCircle className="size-4" /> No stats returned.</div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon, label, value, valueClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`truncate font-mono text-sm font-semibold ${valueClass ?? ""}`}>{value ?? "—"}</p>
      </div>
    </div>
  );
}