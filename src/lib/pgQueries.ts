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
    usename AS "user",
    datname AS database,
    application_name,
    client_addr,
    state,
    query_start,
    state_change,
    LEFT(query, 120) AS query_preview
FROM pg_catalog.pg_stat_activity
WHERE datname IS NOT NULL
ORDER BY query_start DESC NULLS LAST
LIMIT 50;`;

export function explainQuery(sql: string, analyze: boolean): string {
  const opts = analyze
    ? "(ANALYZE, BUFFERS, FORMAT TEXT)"
    : "(FORMAT TEXT)";
  return `EXPLAIN ${opts}\n${sql.trim()}`;
}

export const EXAMPLES: { title: string; description: string; sql: string }[] = [
  {
    title: "Server identity",
    description: "PostgreSQL version, database and current user.",
    sql: `SELECT
    version() AS version,
    current_database() AS database,
    current_user AS "user";`,
  },
  {
    title: "List schemas",
    description: "All non-system schemas in this database.",
    sql: `SELECT n.nspname AS schema_name,
       pg_catalog.pg_get_userbyid(n.nspowner) AS owner
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT LIKE 'pg\\_%'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname;`,
  },
  {
    title: "Table sizes",
    description: "Top 20 tables by total size in the public schema.",
    sql: `SELECT c.relname AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       c.reltuples::bigint AS estimate_rows
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;`,
  },
  {
    title: "Active connections",
    description: "Currently running backend processes.",
    sql: `SELECT pid, usename AS "user", datname AS database, state,
       LEFT(query, 80) AS query_preview
FROM pg_catalog.pg_stat_activity
WHERE datname IS NOT NULL
ORDER BY query_start DESC NULLS LAST;`,
  },
  {
    title: "Row count demo",
    description: "A simple computed row to confirm the console works.",
    sql: `SELECT 1 AS one, 2 AS two, now() AS now;`,
  },
];