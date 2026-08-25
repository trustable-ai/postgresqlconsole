import { Database, Server, User, Table2, Boxes, Activity, AlertCircle, Loader2 } from "lucide-react";
import { useServerInfo } from "@/hooks/useServerInfo";
import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, ErrorPanel } from "@/components/useQuery";
import { errorToString, type ApiError } from "@/lib/api";
import { TABLES_QUERY } from "@/lib/pgQueries";

export default function Overview() {
  const info = useServerInfo();
  const { schema } = useSchema();
  const tables = useSchemaQuery(TABLES_QUERY, schema);

  const tableCount = tables.data?.rowCount ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Live snapshot of the connected PostgreSQL instance.</p>
      </div>

      {info.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Connecting to database…
        </div>
      ) : !info.connected ? (
        <ErrorPanel error={info.error ?? { type: "ConnectionError", message: "Cannot connect to PostgreSQL." }} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard icon={Server} label="Server Version" value={info.version} />
          <StatCard icon={Database} label="Database" value={info.database} />
          <StatCard icon={User} label="Current User" value={info.user} />
          <StatCard icon={Boxes} label="Current Schema" value={schema} />
          <StatCard icon={Table2} label={`Tables in "${schema}"`} value={tables.loading ? "…" : String(tableCount)} />
          <StatCard icon={Activity} label="Connection" value="OK" valueClass="text-emerald-600 dark:text-emerald-400" />
        </div>
      )}

      <div className="min-h-0">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tables in <span className="text-foreground">{schema}</span>
        </h2>
        {tables.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading tables…
          </div>
        ) : tables.error ? (
          <ErrorPanel error={tables.error} />
        ) : tables.data && tables.data.columns ? (
          <TablePreview data={tables.data} />
        ) : null}
      </div>
    </div>
  );
}

function TablePreview({ data }: { data: { columns?: { name: string; type: string }[]; rows?: Record<string, unknown>[] } }) {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/80">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t border-border/60 hover:bg-muted/40">
              {columns.map((c, ci) => {
                const cell = row[c.name];
                return (
                  <td key={ci} className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">
                    {cell === null || cell === undefined ? (
                      <span className="italic text-muted-foreground">NULL</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-center text-muted-foreground">
                No tables in this schema.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  valueClass?: string;
}

function StatCard({ icon: Icon, label, value, valueClass }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`truncate font-mono text-sm font-semibold ${valueClass ?? ""}`}>{value ?? "—"}</p>
      </div>
    </div>
  );
}