import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Database, Table2, Eye, Layers, Hash, FunctionSquare, Boxes } from "lucide-react";
import { ExplorerTree, type SelectedObject } from "@/components/explorer/ExplorerTree";
import { TableDetail } from "@/components/explorer/TableDetail";
import { fetchTableDetail, type TableDetail as TableDetailData, type ApiError } from "@/lib/explorerApi";
import { useEffect } from "react";
import { ErrorPanel } from "@/components/useQuery";
import { Loader2 } from "lucide-react";

export default function Explorer() {
  const [selected, setSelected] = useState<SelectedObject | null>(null);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Schema Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Browse database objects. Internal schemas are hidden by default.
        </p>
      </div>

      <div className="min-h-0 flex-1 rounded-lg border border-border">
        <PanelGroup direction="horizontal" className="h-full">
          <Panel defaultSize={32} minSize={18} maxSize={50}>
            <ExplorerTree onSelect={setSelected} selected={selected} />
          </Panel>
          <PanelResizeHandle className="w-1.5 bg-transparent hover:bg-primary/20" />
          <Panel defaultSize={68} minSize={40}>
            <div className="h-full overflow-hidden p-2">
              {selected ? (
                <DetailPanel selected={selected} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Database className="mr-2 size-5" /> Select an object from the tree.
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function DetailPanel({ selected }: { selected: SelectedObject }) {
  if (selected.kind === "tables") {
    return <TableDetail schema={selected.schema} table={selected.name} />;
  }
  if (selected.kind === "views" || selected.kind === "matviews") {
    return <ViewDetail schema={selected.schema} table={selected.name} object={selected.object} />;
  }
  return <ObjectInfoPanel selected={selected} />;
}

function ViewDetail({ schema, table, object }: { schema: string; table: string; object?: Record<string, unknown> }) {
  const [detail, setDetail] = useState<TableDetailData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchTableDetail(schema, table)
      .then((res) => {
        if (res.ok && res.data) setDetail(res.data);
        else setError(res.error);
      })
      .finally(() => setLoading(false));
  }, [schema, table]);

  const definition = (object?.definition as string) ?? "";

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="shrink-0">
        <h2 className="font-mono text-sm font-semibold">
          <span className="text-muted-foreground">{schema}.</span>{table}
          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            {object && "estimate_rows" in object ? "MATERIALIZED VIEW" : "VIEW"}
          </span>
        </h2>
      </div>

      {definition && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Definition</p>
          <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed text-foreground">
{definition}
          </pre>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Columns</p>
        {loading ? (
          <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>
        ) : error ? (
          <ErrorPanel error={error} />
        ) : detail && detail.columns.length > 0 ? (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/90">
                <tr>
                  {["Name", "Type", "Nullable"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.columns.map((c) => (
                  <tr key={c.name} className="border-t border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-mono text-[13px] font-medium">{c.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[13px] text-violet-600 dark:text-violet-400">{c.type}</td>
                    <td className="px-3 py-1.5 text-[13px]">{c.nullable ? <span className="text-muted-foreground">yes</span> : <span className="text-amber-600 dark:text-amber-400">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-2 text-sm text-muted-foreground">No columns.</p>
        )}
      </div>
    </div>
  );
}

function ObjectInfoPanel({ selected }: { selected: SelectedObject }) {
  const obj = selected.object ?? {};
  const entries = Object.entries(obj).filter(([k]) => k !== "definition");
  const icon = {
    sequences: Hash,
    functions: FunctionSquare,
    types: Boxes,
    tables: Table2,
    views: Eye,
    matviews: Layers,
  }[selected.kind] ?? Database;
  const Icon = icon;

  const labelMap: Record<string, string> = {
    name: "Name",
    schema: "Schema",
    owner: "Owner",
    data_type: "Data type",
    start_value: "Start",
    increment: "Increment",
    min_value: "Minimum",
    max_value: "Maximum",
    cycle: "Cycle",
    cache_size: "Cache",
    language: "Language",
    arguments: "Arguments",
    result_type: "Result type",
    kind: "Kind",
    returns_set: "Returns set",
    estimate_rows: "Est. rows",
    size_pretty: "Size",
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="shrink-0">
        <h2 className="flex items-center gap-2 font-mono text-sm font-semibold">
          <Icon className="size-4 text-primary" />
          <span className="text-muted-foreground">{selected.schema}.</span>{selected.name}
        </h2>
      </div>
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-t border-border/60 first:border-t-0">
                <td className="w-40 whitespace-nowrap bg-muted/30 px-3 py-1.5 text-xs font-medium uppercase text-muted-foreground">
                  {labelMap[k] ?? k}
                </td>
                <td className="px-3 py-1.5 font-mono text-[13px] text-foreground">
                  {v === null || v === undefined ? (
                    <span className="italic text-muted-foreground">NULL</span>
                  ) : typeof v === "boolean" ? (
                    String(v)
                  ) : (
                    String(v)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}