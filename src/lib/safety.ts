// Client-side SQL statement classification, mirroring the backend policy so
// the UI can label operations (READ/WRITE/DDL/DESTRUCTIVE/CONTROL) and trigger
// destructive-operation confirmation. The backend enforces the same policy
// independently — these checks are for UX only.

export type OperationClass = "READ" | "WRITE" | "DDL" | "DESTRUCTIVE" | "CONTROL";

export interface Classification {
  op: OperationClass;
  label: string;
}

const READ_VERBS = new Set(["SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN", "FETCH"]);
const WRITE_VERBS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "COPY"]);
const DDL_VERBS = new Set([
  "CREATE", "ALTER", "GRANT", "REVOKE", "COMMENT", "REINDEX",
  "VACUUM", "ANALYZE", "CLUSTER", "REFRESH", "ATTACH", "DETACH",
]);
const CONTROL_VERBS = new Set([
  "BEGIN", "START", "COMMIT", "END", "ROLLBACK", "SAVEPOINT",
  "RELEASE", "SET", "RESET", "DISCARD", "LOCK",
]);

function stripSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

export function classifyStatement(sql: string): Classification {
  const s = stripSql(sql);
  if (!s) return { op: "READ", label: "empty" };
  const first = s.split(/\s+/)[0].toUpperCase().replace(/;+$/, "");
  if (READ_VERBS.has(first)) return { op: "READ", label: first };
  if (WRITE_VERBS.has(first)) {
    if (first === "UPDATE" || first === "DELETE") {
      if (!/\bWHERE\b/i.test(s)) return { op: "DESTRUCTIVE", label: `${first} without WHERE` };
    }
    return { op: "WRITE", label: first };
  }
  if (first === "DROP" || first === "TRUNCATE") return { op: "DESTRUCTIVE", label: first };
  if (DDL_VERBS.has(first)) return { op: "DDL", label: first };
  if (CONTROL_VERBS.has(first)) return { op: "CONTROL", label: first };
  return { op: "WRITE", label: first };
}

export function isDestructive(sql: string): boolean {
  return classifyStatement(sql).op === "DESTRUCTIVE";
}

/** Check a list of statements; returns the first destructive one, if any. */
export function findDestructive(statements: { sql: string }[]): { index: number; cls: Classification } | null {
  for (let i = 0; i < statements.length; i++) {
    const cls = classifyStatement(statements[i].sql);
    if (cls.op === "DESTRUCTIVE") return { index: i, cls };
  }
  return null;
}