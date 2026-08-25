import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Database } from "lucide-react";
import { fetchTableData, type TableDataResponse, type ApiError } from "@/lib/explorerApi";
import { ResultTable } from "@/components/ResultTable";
import { ErrorPanel } from "@/components/useQuery";
import type { QueryData } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_LIMIT = 100;
const LIMITS = [50, 100, 200, 500];

interface DataTabProps {
  schema: string;
  table: string;
}

export function DataTab({ schema, table }: DataTabProps) {
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [order, setOrder] = useState<string>("");
  const [data, setData] = useState<TableDataResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  // Pagination state for both modes.
  const [keysetCursors, setKeysetCursors] = useState<unknown[]>([null]);
  const [keysetPos, setKeysetPos] = useState(0);
  const [offsetPage, setOffsetPage] = useState(0);

  const cursor = keysetCursors[keysetPos] ?? null;

  const load = () => {
    setLoading(true);
    setError(null);
    fetchTableData({ schema, table, limit, order: order || undefined, cursor, page: offsetPage })
      .then((res) => {
        if (res.ok && res.data) {
          setData(res.data);
          setError(null);
        } else {
          setError(res.error);
          setData(null);
        }
      })
      .finally(() => setLoading(false));
  };

  // Reload on param changes (but not on cursor/page changes handled by nav below).
  useEffect(() => {
    setKeysetCursors([null]);
    setKeysetPos(0);
    setOffsetPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table, limit, order]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, table, limit, order, cursor, offsetPage]);

  const mode = data?.pagination.mode;
  const hasMore = data?.pagination.hasMore ?? false;

  const goNext = () => {
    if (mode === "keyset") {
      const next = data?.pagination.nextCursor;
      if (next === null || next === undefined) return;
      setKeysetCursors((c) => [...c.slice(0, keysetPos + 1), next]);
      setKeysetPos((p) => p + 1);
    } else {
      setOffsetPage((p) => p + 1);
    }
  };

  const goPrev = () => {
    if (mode === "keyset") {
      setKeysetPos((p) => Math.max(0, p - 1));
    } else {
      setOffsetPage((p) => Math.max(0, p - 1));
    }
  };

  const atFirst = mode === "keyset" ? keysetPos === 0 : offsetPage === 0;
  const pageLabel = mode === "keyset"
    ? `page ${keysetPos + 1}`
    : `page ${offsetPage + 1}`;

  const gridData: QueryData | null = data
    ? {
        columns: data.columns,
        rows: data.rows,
        rowCount: data.rowCount,
        command: "SELECT",
        durationMs: 0,
      }
    : null;

  const colNames = data?.columns.map((c) => c.name) ?? [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="data-limit" className="text-muted-foreground">Limit</label>
        <select
          id="data-limit"
          name="data_limit"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
        >
          {LIMITS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <label htmlFor="data-order" className="ml-1 text-muted-foreground">Order by</label>
        <select
          id="data-order"
          name="data_order"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="h-7 max-w-[12rem] rounded-md border border-input bg-background px-1.5 text-xs"
        >
          <option value="">auto (primary key)</option>
          {colNames.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {data?.pagination && (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", data.pagination.mode === "keyset" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300")}>
            {data.pagination.mode}
          </span>
        )}
        {data?.pagination.totalEstimate !== undefined && data.pagination.totalEstimate >= 0 && (
          <span className="text-muted-foreground">~{data.pagination.totalEstimate} rows est.</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            disabled={atFirst || loading}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" /> Prev
          </button>
          <span className="px-1 text-muted-foreground">{pageLabel}</span>
          <button
            type="button"
            onClick={goNext}
            disabled={!hasMore || loading}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            Next <ChevronRight className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading rows…
          </div>
        ) : error ? (
          <ErrorPanel error={error} />
        ) : gridData ? (
          gridData.columns.length > 0 ? (
            <ResultTable data={gridData} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Database className="mr-2 size-4" /> No rows.
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}