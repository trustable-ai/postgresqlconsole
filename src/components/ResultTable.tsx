import { useState } from "react";
import { Copy, ChevronDown, ChevronRight, Braces, Hash } from "lucide-react";
import type { QueryData, ResultColumn } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function cellClass(value: unknown): string {
  if (value === null || value === undefined) return "text-muted-foreground italic";
  if (typeof value === "boolean") return "text-amber-600 dark:text-amber-400 font-medium";
  if (typeof value === "number") return "text-emerald-600 dark:text-emerald-400";
  if (typeof value === "object") return "text-violet-600 dark:text-violet-400";
  if (typeof value === "string" && isISODate(value)) return "text-sky-600 dark:text-sky-400";
  return "text-foreground";
}

function rowsToTSV(data: QueryData): string {
  const header = data.columns.map((c) => c.name).join("\t");
  const lines = data.rows.map((row) =>
    data.columns.map((c) => cellText(row[c.name])).join("\t"),
  );
  return [header, ...lines].join("\n");
}

function rowToTSV(data: QueryData, row: Record<string, unknown>): string {
  return data.columns.map((c) => cellText(row[c.name])).join("\t");
}

export function ResultTable({ data }: { data: QueryData }) {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No tabular result. {data.command ? <span className="ml-1 font-mono text-foreground">{data.command}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {rows.length} row{rows.length === 1 ? "" : "s"} · {columns.length} column{columns.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => copyText(rowsToTSV(data), "Result copied as TSV")}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="Copy all rows as TSV"
        >
          <Copy className="size-3.5" /> Copy result
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
            <tr>
              <th className="w-10 border-b border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
              <th className="w-8 border-b border-border px-1 py-2" />
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-border px-3 py-2 text-left"
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">{col.name}</span>
                    <span className="font-mono text-[10px] font-normal normal-case text-muted-foreground">{col.type}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No rows returned.
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">{ri + 1}</td>
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => copyText(rowToTSV(data, row), "Row copied as TSV")}
                      className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 hover:opacity-100"
                      title="Copy row as TSV"
                      aria-label="Copy row"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </td>
                  {columns.map((col, ci) => (
                    <td key={ci} className={cn("align-top px-3 py-1.5", cellClass(row[col.name]))}>
                      <Cell value={row[col.name]} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (value === null || value === undefined) {
    return <span className="font-mono text-[13px] italic text-muted-foreground">NULL</span>;
  }

  if (typeof value === "boolean") {
    return <span className="font-mono text-[13px]">{value ? "true" : "false"}</span>;
  }

  if (typeof value === "number") {
    return <span className="font-mono text-[13px]">{value}</span>;
  }

  if (typeof value === "object") {
    return <JsonCell value={value} />;
  }

  const text = String(value);
  const long = text.length > 120 || text.includes("\n");

  if (!long) {
    return (
      <button
        type="button"
        onClick={() => copyText(text, "Cell copied")}
        className="font-mono text-[13px] text-left hover:underline"
        title="Click to copy cell value"
      >
        {text}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (expanded) copyText(text, "Cell copied");
        setExpanded((v) => !v);
      }}
      className="flex max-w-[44rem] items-start gap-1 text-left font-mono text-[13px]"
      title={expanded ? "Click again to copy" : "Click to expand"}
    >
      {expanded ? (
        <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={cn("whitespace-pre-wrap break-words", !expanded && "line-clamp-2")}>{text}</span>
    </button>
  );
}

function JsonCell({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const pretty = (() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  const collapsed = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();

  return (
    <div className="flex max-w-[44rem] items-start gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        title={expanded ? "Collapse JSON" : "Expand JSON"}
        aria-label={expanded ? "Collapse JSON" : "Expand JSON"}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
      <Braces className="mt-0.5 size-3.5 shrink-0 text-violet-500/70" />
      <button
        type="button"
        onClick={() => copyText(pretty, "JSON copied")}
        className={cn(
          "whitespace-pre-wrap break-words text-left font-mono text-[13px] hover:underline",
          !expanded && "line-clamp-2",
        )}
        title="Click to copy JSON"
      >
        {expanded ? pretty : collapsed}
      </button>
    </div>
  );
}

// Re-export for the History/Execution tabs and Copy Results control.
export { rowsToTSV };