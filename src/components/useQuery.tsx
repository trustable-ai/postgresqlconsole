import { useEffect, useState } from "react";
import { runQuery, type ApiError, type QueryData } from "@/lib/api";
import { Loader2, AlertCircle } from "lucide-react";
import { ResultTable } from "@/components/ResultTable";

interface UseQueryState {
  data: QueryData | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => void;
}

export function useSchemaQuery(sqlFn: (schema: string) => string, schema: string): UseQueryState {
  const [data, setData] = useState<QueryData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runQuery({ sql: sqlFn(schema), schema })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
          setError(null);
        } else {
          setData(null);
          setError(res.error);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError({ type: "NetworkError", message: "Request failed" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, nonce]);

  return { data, error, loading, refresh: () => setNonce((n) => n + 1) };
}

export function useFixedQuery(sql: string): UseQueryState {
  const [data, setData] = useState<QueryData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runQuery({ sql })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
          setError(null);
        } else {
          setData(null);
          setError(res.error);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError({ type: "NetworkError", message: "Request failed" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, nonce]);

  return { data, error, loading, refresh: () => setNonce((n) => n + 1) };
}

interface PageProps {
  title: string;
  description: string;
  loading: boolean;
  error: ApiError | null;
  data: QueryData | null;
  onRefresh?: () => void;
  extra?: React.ReactNode;
}

export function MetadataPage({ title, description, loading, error, data, onRefresh, extra }: PageProps) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {extra}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Loader2 className={loading ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Running query…
        </div>
      ) : error ? (
        <ErrorPanel error={error} />
      ) : data ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <ResultTable data={data} />
        </div>
      ) : null}
    </div>
  );
}

export function ErrorPanel({ error }: { error: ApiError }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            <span className="font-mono text-xs uppercase tracking-wide">{error.type}</span>
            {" — "}
            <span>{error.message}</span>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-destructive/80">
            {error.sqlstate && <span>SQLSTATE: {error.sqlstate}</span>}
            {error.severity && <span>severity: {error.severity}</span>}
            {error.position && <span>position: {error.position}</span>}
            {error.schema && <span>schema: {error.schema}</span>}
            {error.table && <span>table: {error.table}</span>}
            {error.column && <span>column: {error.column}</span>}
            {error.constraint && <span>constraint: {error.constraint}</span>}
          </div>
          {error.detail && <p className="text-xs text-destructive/80">Detail: {error.detail}</p>}
          {error.hint && <p className="text-xs text-destructive/80">Hint: {error.hint}</p>}
        </div>
      </div>
    </div>
  );
}