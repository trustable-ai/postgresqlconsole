import { Database, Server, User, CircleDot, RefreshCw } from "lucide-react";
import { useServerInfo } from "@/hooks/useServerInfo";
import { useSchemas } from "@/hooks/useSchemas";
import { useSchema } from "@/lib/schema-context";
import { errorToString } from "@/lib/api";
import { cn } from "@/lib/utils";

export function Header() {
  const info = useServerInfo();
  const { schemas, loading: schemasLoading, refresh: refreshSchemas } = useSchemas();
  const { schema, setSchema } = useSchema();

  const statusText = info.loading
    ? "Connecting…"
    : info.connected
      ? "Connected"
      : "Disconnected";

  return (
    <header className="flex h-auto flex-col gap-3 border-b border-border bg-background px-4 py-2.5 md:h-14 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
            info.connected
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
          )}
          title={info.error ? errorToString(info.error) : statusText}
        >
          <CircleDot className="size-3" />
          {statusText}
        </span>

        {info.version && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Server className="size-3.5" />
            <span className="font-mono text-xs">{info.version}</span>
          </span>
        )}

        {info.database && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Database className="size-3.5" />
            <span className="font-mono text-xs">{info.database}</span>
          </span>
        )}

        {info.user && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <User className="size-3.5" />
            <span className="font-mono text-xs">{info.user}</span>
          </span>
        )}

        {!info.loading && !info.connected && info.error && (
          <span className="truncate text-xs text-destructive">{errorToString(info.error)}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="schema-select" className="text-xs font-medium text-muted-foreground">
          Schema
        </label>
        <select
          id="schema-select"
          name="schema"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={schemasLoading || !info.connected}
        >
          {schemasLoading && <option value="">Loading…</option>}
          {!schemasLoading && schemas.length === 0 && <option value={schema}>{schema}</option>}
          {schemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            info.refresh();
            refreshSchemas();
          }}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-sm hover:bg-accent"
          aria-label="Refresh status"
          title="Refresh status"
        >
          <RefreshCw className={cn("size-3.5", info.loading && "animate-spin")} />
        </button>
      </div>
    </header>
  );
}