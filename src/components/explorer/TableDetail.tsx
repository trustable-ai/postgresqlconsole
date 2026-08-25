import { useEffect, useState } from "react";
import { Loader2, Table2, KeyRound, Link2, Braces, FileCode2, Database } from "lucide-react";
import { fetchTableDetail, type TableDetail as TableDetailData, type ApiError, type ConstraintInfo } from "@/lib/explorerApi";
import { DataTab } from "@/components/explorer/DataTab";
import { ErrorPanel } from "@/components/useQuery";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type Tab = "data" | "columns" | "indexes" | "constraints" | "fkeys" | "ddl";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "data", label: "Data", icon: Database },
  { id: "columns", label: "Columns", icon: Table2 },
  { id: "indexes", label: "Indexes", icon: KeyRound },
  { id: "constraints", label: "Constraints", icon: Link2 },
  { id: "fkeys", label: "Foreign Keys", icon: Link2 },
  { id: "ddl", label: "DDL", icon: FileCode2 },
];

export function TableDetail({ schema, table }: { schema: string; table: string }) {
  const [tab, setTab] = useState<Tab>("data");
  const [detail, setDetail] = useState<TableDetailData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTableDetail(schema, table)
      .then((res) => {
        if (res.ok && res.data) {
          setDetail(res.data);
          setError(null);
        } else {
          setError(res.error);
          setDetail(null);
        }
      })
      .finally(() => setLoading(false));
  }, [schema, table]);

  const fkeys = (detail?.constraints ?? []).filter((c) => c.type === "FOREIGN KEY");

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="font-mono text-sm font-semibold">
          <span className="text-muted-foreground">{schema}.</span>{table}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.id === "fkeys" && fkeys.length > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">{fkeys.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading table metadata…
          </div>
        ) : error ? (
          <ErrorPanel error={error} />
        ) : detail ? (
          <>
            {tab === "data" && <DataTab schema={schema} table={table} />}
            {tab === "columns" && <ColumnsTab detail={detail} />}
            {tab === "indexes" && <IndexesTab detail={detail} />}
            {tab === "constraints" && <ConstraintsTab detail={detail} />}
            {tab === "fkeys" && <ForeignKeysTab fkeys={fkeys} />}
            {tab === "ddl" && <DdlTab detail={detail} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ColumnsTab({ detail }: { detail: TableDetailData }) {
  const cols = detail.columns;
  if (cols.length === 0) return <Empty text="No columns." />;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/90">
          <tr>
            {["#", "Name", "Type", "Nullable", "Default", "Identity", "Generated"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.name} className="border-t border-border/60 hover:bg-muted/40">
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{c.ordinal_position}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] font-medium text-foreground">{c.name}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-violet-600 dark:text-violet-400">{c.type}</td>
              <td className="px-3 py-1.5 text-[13px]">{c.nullable ? <span className="text-muted-foreground">yes</span> : <span className="font-medium text-amber-600 dark:text-amber-400">no</span>}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-muted-foreground">{c.default ?? <span className="italic text-muted-foreground/60">—</span>}</td>
              <td className="px-3 py-1.5 text-[13px] text-muted-foreground">{c.identity || <span className="italic text-muted-foreground/60">—</span>}</td>
              <td className="px-3 py-1.5 text-[13px] text-muted-foreground">{c.generated || <span className="italic text-muted-foreground/60">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndexesTab({ detail }: { detail: TableDetailData }) {
  const idx = detail.indexes;
  if (idx.length === 0) return <Empty text="No indexes." />;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/90">
          <tr>
            {["Name", "Columns", "Unique", "Primary", "Method", "Definition"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {idx.map((i) => (
            <tr key={i.name} className="border-t border-border/60 align-top hover:bg-muted/40">
              <td className="px-3 py-1.5 font-mono text-[13px] font-medium text-foreground">{i.name}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-muted-foreground">{i.columns || "—"}</td>
              <td className="px-3 py-1.5 text-[13px]">{i.is_unique ? <span className="text-emerald-600 dark:text-emerald-400">yes</span> : <span className="text-muted-foreground">no</span>}</td>
              <td className="px-3 py-1.5 text-[13px]">{i.is_primary ? <span className="text-emerald-600 dark:text-emerald-400">yes</span> : <span className="text-muted-foreground">no</span>}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-violet-600 dark:text-violet-400">{i.method}</td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-muted-foreground">{i.definition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConstraintsTab({ detail }: { detail: TableDetailData }) {
  const cons = detail.constraints;
  if (cons.length === 0) return <Empty text="No constraints." />;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/90">
          <tr>
            {["Name", "Type", "Definition"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cons.map((c) => (
            <tr key={c.name} className="border-t border-border/60 align-top hover:bg-muted/40">
              <td className="px-3 py-1.5 font-mono text-[13px] font-medium text-foreground">{c.name}</td>
              <td className="px-3 py-1.5">
                <ConstraintBadge type={c.type} />
              </td>
              <td className="px-3 py-1.5 font-mono text-[12px] text-muted-foreground">{c.definition}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForeignKeysTab({ fkeys }: { fkeys: ConstraintInfo[] }) {
  if (fkeys.length === 0) return <Empty text="No foreign keys." />;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/90">
          <tr>
            {["Name", "Source columns", "Target table", "Target columns", "On update", "On delete"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fkeys.map((c) => (
            <tr key={c.name} className="border-t border-border/60 align-top hover:bg-muted/40">
              <td className="px-3 py-1.5 font-mono text-[13px] font-medium text-foreground">{c.name}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-foreground">{c.source_columns || "—"}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-primary">{c.target_table || "—"}</td>
              <td className="px-3 py-1.5 font-mono text-[13px] text-foreground">{c.target_columns || "—"}</td>
              <td className="px-3 py-1.5 text-[13px] text-muted-foreground">{c.updateRule || "—"}</td>
              <td className="px-3 py-1.5 text-[13px] text-muted-foreground">{c.deleteRule || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DdlTab({ detail }: { detail: TableDetailData }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => copyText(detail.ddl, "DDL copied")}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
        >
          <Braces className="size-3.5" /> Copy DDL
        </button>
      </div>
      <pre className="flex-1 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed text-foreground">
{detail.ddl}
      </pre>
    </div>
  );
}

function ConstraintBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    "PRIMARY KEY": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    "FOREIGN KEY": "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    "UNIQUE": "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    "CHECK": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    "EXCLUSION": "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", colors[type] || "bg-muted text-muted-foreground")}>
      {type}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-4 text-sm text-muted-foreground">{text}</div>;
}