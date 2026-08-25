// Client for the PostgreSQL schema explorer backend actions
// (v1/explorer, v1/table, v1/table-data). Uses the same {ok, data, error}
// envelope as the rest of the app.

export interface SchemaInfo {
  name: string;
  owner: string;
  is_internal: boolean;
}

export interface TableInfo {
  name: string;
  schema: string;
  estimate_rows: number;
  size_pretty: string;
  size_bytes: number;
  owner: string;
}

export interface ViewInfo {
  name: string;
  schema: string;
  owner: string;
  estimate_rows?: number;
  size_pretty?: string;
  definition: string;
}

export interface SequenceInfo {
  name: string;
  schema: string;
  data_type: string;
  start_value: number;
  increment: number;
  min_value: number;
  max_value: number;
  cycle: boolean;
  cache_size: number;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  owner: string;
  language: string;
  arguments: string;
  result_type: string;
  kind: string;
  returns_set: boolean;
}

export interface TypeInfo {
  name: string;
  schema: string;
  owner: string;
  kind: string;
  data_type: string;
}

export type ObjectKind = "tables" | "views" | "matviews" | "sequences" | "functions" | "types";

export interface ObjectsResponse {
  kind: ObjectKind;
  schema: string;
  objects: TableInfo[] | ViewInfo[] | SequenceInfo[] | FunctionInfo[] | TypeInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: string;
  generated: string;
  ordinal_position: number;
}

export interface IndexInfo {
  name: string;
  definition: string;
  is_unique: boolean;
  is_primary: boolean;
  method: string;
  columns: string | null;
}

export interface ConstraintInfo {
  name: string;
  type: string;
  definition: string;
  source_table: string | null;
  target_table: string | null;
  source_columns: string | null;
  target_columns: string | null;
  updateRule: string | null;
  deleteRule: string | null;
}

export interface TableDetail {
  schema: string;
  table: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  ddl: string;
}

export interface ResultColumnMeta {
  name: string;
  type: string;
}

export interface Pagination {
  mode: "keyset" | "offset";
  order: string;
  limit: number;
  page: number | null;
  hasMore: boolean;
  nextCursor: unknown;
  totalEstimate: number | null;
}

export interface TableDataResponse {
  schema: string;
  table: string;
  columns: ResultColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
  pagination: Pagination;
}

export interface ApiError {
  type: string;
  message: string;
  sqlstate?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function unwrap<T>(res: Response): Promise<ApiResponse<T>> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, data: null, error: { type: "NetworkError", message: "Invalid JSON response" } };
  }
  const data = (isObject(raw) && "body" in raw ? raw.body : raw) as ApiResponse<T>;
  if (!isObject(data)) {
    return { ok: false, data: null, error: { type: "NetworkError", message: "Unexpected response shape" } };
  }
  return data;
}

async function postJSON<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, data: null, error: { type: "NetworkError", message: err instanceof Error ? err.message : "Network request failed" } };
  }
  const data = await unwrap<T>(res);
  if (!res.ok && data.ok) {
    return { ok: false, data: null, error: { type: "HttpError", message: `Request failed: ${res.status}` } };
  }
  return data;
}

export function fetchSchemas(): Promise<ApiResponse<{ schemas: SchemaInfo[] }>> {
  return postJSON("/api/my/v1/explorer", { op: "schemas" });
}

export function fetchObjects(kind: ObjectKind, schema: string): Promise<ApiResponse<ObjectsResponse>> {
  return postJSON("/api/my/v1/explorer", { op: "objects", kind, schema });
}

export function fetchTableDetail(schema: string, table: string): Promise<ApiResponse<TableDetail>> {
  return postJSON("/api/my/v1/table", { schema, table });
}

export interface FetchTableDataOpts {
  schema: string;
  table: string;
  limit?: number;
  order?: string;
  cursor?: unknown;
  page?: number;
}

export function fetchTableData(opts: FetchTableDataOpts): Promise<ApiResponse<TableDataResponse>> {
  return postJSON("/api/my/v1/table-data", {
    schema: opts.schema,
    table: opts.table,
    limit: opts.limit,
    order: opts.order,
    cursor: opts.cursor,
    page: opts.page,
  });
}