// Client for the PostgreSQL Console backend.
//
// All backend responses use a consistent envelope:
//   { ok: true,  data: {...}, error: null }
//   { ok: false, data: null, error: { type, message, sqlstate?, detail?, ... } }
//
// Never read, log, or forward connection strings or passwords — the backend
// scrubs them. The frontend only consumes the structured error object.

export interface ResultColumn {
  name: string;
  type: string;
}

export interface Notice {
  severity?: string | null;
  code?: string | null;
  message: string;
}

export interface QueryData {
  columns: ResultColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command: string;
  durationMs: number;
  operation?: string;
  operationLabel?: string;
  notices?: Notice[];
}

export interface HealthData {
  connected: boolean;
  database?: string;
  serverVersion?: string;
  currentUser?: string;
  sessionUser?: string;
  serverAddr?: string | null;
  serverPort?: number | null;
  statementTimeoutMs?: number;
}

export interface ApiError {
  type: string;
  message: string;
  sqlstate?: string;
  severity?: string;
  detail?: string;
  hint?: string;
  position?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

export interface RunQueryOptions {
  sql: string;
  params?: unknown[];
  schema?: string;
  confirmDestructive?: boolean;
  signal?: AbortSignal;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function unwrap<T>(res: Response): Promise<ApiResponse<T>> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, data: null, error: { type: "NetworkError", message: "Invalid JSON response from server" } };
  }
  const data = (isObject(raw) && "body" in raw ? raw.body : raw) as ApiResponse<T>;
  if (!isObject(data)) {
    return { ok: false, data: null, error: { type: "NetworkError", message: "Unexpected response shape" } };
  }
  return data;
}

export async function runQuery(opts: RunQueryOptions): Promise<ApiResponse<QueryData>> {
  const { sql, params, schema, signal } = opts;
  let res: Response;
  try {
    res = await fetch("/api/my/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params, schema, confirm_destructive: opts.confirmDestructive }),
      signal,
    });
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: { type: "NetworkError", message: err instanceof Error ? err.message : "Network request failed" },
    };
  }

  const data = await unwrap<QueryData>(res);
  if (!res.ok && data.ok) {
    return { ok: false, data: null, error: { type: "HttpError", message: `Request failed: ${res.status}` } };
  }
  return data;
}

export async function fetchHealth(): Promise<ApiResponse<HealthData>> {
  let res: Response;
  try {
    res = await fetch("/api/my/v1/health");
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: { type: "NetworkError", message: err instanceof Error ? err.message : "Network request failed" },
    };
  }
  const data = await unwrap<HealthData>(res);
  if (!res.ok && data.ok) {
    return { ok: false, data: null, error: { type: "HttpError", message: `Request failed: ${res.status}` } };
  }
  return data;
}

/** Render a structured backend error as a single displayable string. */
export function errorToString(error: ApiError | null): string {
  if (!error) return "Unknown error";
  const parts = [error.message];
  if (error.sqlstate) parts.push(`(SQLSTATE ${error.sqlstate})`);
  if (error.hint) parts.push(`Hint: ${error.hint}`);
  return parts.join(" — ");
}

export const DEFAULT_QUERY = `SELECT
    version(),
    current_database(),
    current_user;`;

// ---------------------------------------------------------------------------
// Guided transactions (v1/transaction)
// ---------------------------------------------------------------------------

export interface TransactionStatement {
  sql: string;
  params?: unknown[];
}

export interface StmtResult {
  sql: string;
  operation: string;
  operationLabel: string;
  durationMs: number;
  columns?: ResultColumn[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  command?: string;
  error?: ApiError;
}

export interface TransactionData {
  results: StmtResult[];
  committed: boolean;
  rolledBack: boolean;
  notices?: Notice[];
}

export interface RunTransactionOptions {
  statements: TransactionStatement[];
  commit: boolean;
  confirmDestructive?: boolean;
}

export async function runTransaction(opts: RunTransactionOptions): Promise<ApiResponse<TransactionData>> {
  let res: Response;
  try {
    res = await fetch("/api/my/v1/transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statements: opts.statements,
        commit: opts.commit,
        confirm_destructive: opts.confirmDestructive,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: { type: "NetworkError", message: err instanceof Error ? err.message : "Network request failed" },
    };
  }
  const data = await unwrap<TransactionData>(res);
  if (!res.ok && data.ok) {
    return { ok: false, data: null, error: { type: "HttpError", message: `Request failed: ${res.status}` } };
  }
  return data;
}