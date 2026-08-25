// Predefined PostgreSQL introspection queries used by the section pages.
// Each helper returns the SQL string; pages pass the selected schema where
// relevant. Keep queries read-only and dependency-light (catalog views only).

export interface SchemaQuery {
  label: string;
  description: string;
  sql: (schema: string) => string;
  needsSchema?: boolean;
}

export const STATUS_QUERY = `SELECT
    version() AS version,
    current_database() AS database,
    current_user AS "user",
    inet_server_addr() AS server_addr,
    inet_server_port() AS server_port;`;

// Overview dashboard: safe runtime stats in a single row.
export const STATS_QUERY = `SELECT
    version() AS version,
    current_database() AS database,
    current_user AS current_user,
    pg_postmaster_start_time() AS server_start,
    (now() - pg_postmaster_start_time())::text AS uptime,
    pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty,
    pg_database_size(current_database()) AS db_size_bytes,
    (SELECT count(*) FROM pg_catalog.pg_namespace n
       WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema') AS schema_count,
    (SELECT count(*) FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg\\_%') AS table_count,
    (SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname = current_database()) AS active_connections,
    current_setting('max_connections')::int AS max_connections,
    s.xact_commit AS transactions_committed,
    s.xact_rollback AS transactions_rolled_back,
    CASE WHEN (s.blks_hit + s.blks_read) = 0 THEN NULL
         ELSE round(s.blks_hit::numeric / (s.blks_hit + s.blks_read), 4) END AS cache_hit_ratio,
    s.blks_hit AS blocks_hit,
    s.blks_read AS blocks_read
FROM pg_catalog.pg_stat_database s
WHERE s.datname = current_database();`;

export const SCHEMAS_QUERY = `SELECT
    n.nspname AS schema_name,
    pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
    pg_catalog.obj_description(n.oid, 'pg_namespace') AS description
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT LIKE 'pg\\_%'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname;`;

export const DATABASES_QUERY = `SELECT
    d.datname AS database_name,
    pg_catalog.pg_get_userbyid(d.datdba) AS owner,
    pg_encoding_to_char(d.encoding) AS encoding,
    pg_catalog.shobj_description(d.oid, 'pg_database') AS description,
    d.datistemplate AS is_template,
    d.datallowconn AS allow_conn
FROM pg_catalog.pg_database d
ORDER BY d.datname;`;

export const TABLES_QUERY = (schema: string) => `SELECT
    c.relname AS table_name,
    pg_catalog.pg_get_userbyid(c.relowner) AS owner,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_relation_size(c.oid)) AS data_size,
    c.reltuples::bigint AS estimate_rows,
    pg_catalog.obj_description(c.oid, 'pg_class') AS description
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${schema}'
  AND c.relkind = 'r'
ORDER BY c.relname;`;

export const VIEWS_QUERY = (schema: string) => `SELECT
    c.relname AS view_name,
    pg_catalog.pg_get_userbyid(c.relowner) AS owner,
    pg_catalog.pg_get_viewdef(c.oid, true) AS definition,
    pg_catalog.obj_description(c.oid, 'pg_class') AS description
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${schema}'
  AND c.relkind = 'v'
ORDER BY c.relname;`;

export const COLUMNS_QUERY = (schema: string) => `SELECT
    c.relname AS table_name,
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    a.attnotnull AS not_null,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
    a.attnum AS ordinal_position,
    pg_catalog.col_description(a.attrelid, a.attnum) AS description
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = '${schema}'
  AND c.relkind IN ('r', 'v', 'm')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;`;

export const INDEXES_QUERY = (schema: string) => `SELECT
    c.relname AS table_name,
    i.relname AS index_name,
    pg_get_indexdef(ix.indexrelid) AS index_definition,
    ix.indisunique AS is_unique,
    ix.indisprimary AS is_primary,
    am.amname AS index_type
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = i.relam
WHERE n.nspname = '${schema}'
ORDER BY c.relname, i.relname;`;

export const CONSTRAINTS_QUERY = (schema: string) => `SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${schema}'
ORDER BY c.relname, con.contype, con.conname;`;

export const SEQUENCES_QUERY = (schema: string) => `SELECT
    c.relname AS sequence_name,
    pg_catalog.pg_get_userbyid(c.relowner) AS owner,
    c.reltuples::bigint AS estimate_rows,
    pg_catalog.obj_description(c.oid, 'pg_class') AS description
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${schema}'
  AND c.relkind = 'S'
ORDER BY c.relname;`;

export const FUNCTIONS_QUERY = (schema: string) => `SELECT
    p.proname AS function_name,
    pg_catalog.pg_get_userbyid(p.proowner) AS owner,
    l.lanname AS language,
    pg_catalog.pg_get_function_result(p.oid) AS result_type,
    pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
    p.prokind AS kind
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = '${schema}'
ORDER BY p.proname;`;

export const ACTIVITY_QUERY = `SELECT
    pid,
    datname AS database,
    usename AS "user",
    application_name AS application,
    client_addr,
    state,
    query_start,
    (now() - query_start)::text AS duration,
    wait_event_type,
    wait_event,
    LEFT(query, 120) AS query_preview
FROM pg_catalog.pg_stat_activity
WHERE datname IS NOT NULL
ORDER BY query_start DESC NULLS LAST
LIMIT 50;`;

export type ExplainFormat = "text" | "json";

export function explainQuery(sql: string, format: ExplainFormat, analyze: boolean): string {
  // Prefer EXPLAIN (FORMAT JSON) for initial inspection. ANALYZE actually
  // executes the statement, so it is opt-in and never applied to writes here.
  const opts = analyze
    ? "(ANALYZE, BUFFERS, FORMAT " + format.toUpperCase() + ")"
    : "(FORMAT " + format.toUpperCase() + ")";
  return `EXPLAIN ${opts}\n${sql.trim()}`;
}

export interface Example {
  title: string;
  description: string;
  sql: string;
  note?: string;
}

export const EXAMPLES: Example[] = [
  {
    title: "SELECT",
    description: "Project columns from the demo table.",
    sql: `SELECT id, name, email, balance\nFROM pg_console_demo\nORDER BY id;`,
  },
  {
    title: "WHERE",
    description: "Filter rows with a predicate.",
    sql: `SELECT id, name, balance\nFROM pg_console_demo\nWHERE balance >= 100\nORDER BY balance DESC;`,
  },
  {
    title: "ORDER BY",
    description: "Sort rows by one or more columns.",
    sql: `SELECT name, balance\nFROM pg_console_demo\nORDER BY balance DESC, name ASC;`,
  },
  {
    title: "GROUP BY",
    description: "Aggregate rows per group.",
    sql: `SELECT (balance >= 100) AS high_balance,\n       count(*) AS cnt,\n       min(balance) AS min_bal,\n       max(balance) AS max_bal\nFROM pg_console_demo\nGROUP BY (balance >= 100)\nORDER BY high_balance;`,
  },
  {
    title: "JOIN",
    description: "Self-join to pair rows.",
    sql: `SELECT a.name AS first, b.name AS second\nFROM pg_console_demo a\nJOIN pg_console_demo b ON a.id < b.id\nORDER BY a.id, b.id;`,
  },
  {
    title: "CTE",
    description: "Common table expression (WITH).",
    sql: `WITH high AS (\n    SELECT name, balance FROM pg_console_demo WHERE balance >= 100\n)\nSELECT name, balance FROM high\nORDER BY balance DESC;`,
  },
  {
    title: "Recursive CTE",
    description: "A recursive countdown using WITH RECURSIVE.",
    sql: `WITH RECURSIVE countdown(n) AS (\n    SELECT 5\n    UNION ALL\n    SELECT n - 1 FROM countdown WHERE n > 1\n)\nSELECT n FROM countdown ORDER BY n;`,
  },
  {
    title: "Window functions",
    description: "Rank rows without collapsing them.",
    sql: `SELECT name, balance,\n       rank() OVER (ORDER BY balance DESC) AS rank_desc,\n       sum(balance) OVER () AS total\nFROM pg_console_demo\nORDER BY rank_desc;`,
  },
  {
    title: "INSERT",
    description: "Insert a row (WRITE — modifies the demo table).",
    sql: `INSERT INTO pg_console_demo(id, name, email, balance)\nVALUES (90, 'Demo', 'demo@example.com', 5);`,
    note: "WRITE",
  },
  {
    title: "UPDATE",
    description: "Update rows matching a predicate (WRITE).",
    sql: `UPDATE pg_console_demo SET balance = balance + 1\nWHERE id = 1;`,
    note: "WRITE",
  },
  {
    title: "DELETE",
    description: "Delete rows matching a predicate (WRITE).",
    sql: `DELETE FROM pg_console_demo WHERE id = 90;`,
    note: "WRITE",
  },
  {
    title: "UPSERT",
    description: "Insert, and on conflict update (WRITE).",
    sql: `INSERT INTO pg_console_demo(id, name, email, balance)\nVALUES (1, 'Alice', 'alice@example.com', 150)\nON CONFLICT (id) DO UPDATE\n  SET balance = EXCLUDED.balance;`,
    note: "WRITE",
  },
  {
    title: "RETURNING",
    description: "Return the affected rows (WRITE).",
    sql: `UPDATE pg_console_demo SET balance = balance\nWHERE id = 1\nRETURNING id, name, balance;`,
    note: "WRITE",
  },
  {
    title: "JSON",
    description: "Construct and access a json value.",
    sql: `SELECT '{"name":"Alice","tags":["a","b"]}'::json AS j,\n       ('{"name":"Alice"}'::json ->> 'name') AS name;`,
  },
  {
    title: "JSONB",
    description: "Binary JSON with indexing and containment.",
    sql: `SELECT '{"name":"Alice","balance":100}'::jsonb AS jb,\n       ('{"name":"Alice","balance":100}'::jsonb ->> 'name') AS name,\n       ('{"name":"Alice"}'::jsonb <@ '{"name":"Alice","balance":100}'::jsonb) AS contained;`,
  },
  {
    title: "Arrays",
    description: "Construct and unnest arrays.",
    sql: `SELECT ARRAY[1, 2, 3] AS arr,\n       array_length(ARRAY[1, 2, 3], 1) AS len,\n       unnest(ARRAY['x', 'y', 'z']) AS elem;`,
  },
  {
    title: "generate_series",
    description: "Generate a set of rows.",
    sql: `SELECT generate_series(1, 5) AS n,\n       generate_series(1, 5) * 2 AS doubled;`,
  },
  {
    title: "Transactions",
    description: "Inspect a transaction setting (see the Transactions page for BEGIN/COMMIT/ROLLBACK/SAVEPOINT).",
    sql: `SELECT current_setting('default_transaction_isolation') AS isolation,\n       current_setting('default_transaction_read_only') AS read_only;`,
  },
  {
    title: "Indexes",
    description: "List indexes on the demo table.",
    sql: `SELECT indexname, indexdef\nFROM pg_indexes\nWHERE schemaname = current_schema() AND tablename = 'pg_console_demo'\nORDER BY indexname;`,
  },
  {
    title: "EXPLAIN",
    description: "Inspect the execution plan as JSON (see the Explain page for a visual plan).",
    sql: `EXPLAIN (FORMAT JSON)\nSELECT * FROM pg_console_demo WHERE balance > 50;`,
  },
];