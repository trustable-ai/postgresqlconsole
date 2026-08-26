// Client-side SQL statement classification, mirroring the backend policy so
// the UI can label operations (READ/WRITE/DDL/DESTRUCTIVE/CONTROL) and trigger
// destructive-operation confirmation. The backend enforces the same policy
// independently — these checks are for UX only.
//
// The console operates as a single configured PostgreSQL user. User/role
// management and identity-switching commands are blocked on the backend; the
// helpers below mirror that restriction in the UI so the user gets an
// immediate, clear message instead of a round-trip rejection.

export type OperationClass =
  | "READ"
  | "WRITE"
  | "DDL"
  | "DESTRUCTIVE"
  | "CONTROL"
  | "FORBIDDEN";

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
  const forbidden = detectForbiddenIdentity(sql);
  if (forbidden) return { op: "FORBIDDEN", label: forbidden };
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

// ---------------------------------------------------------------------------
// Identity protection (UX mirror of the backend restriction)
// ---------------------------------------------------------------------------

const FORBIDDEN_IDENTITY_RE = [
  /^\s*CREATE\s+(?:USER|ROLE)\b/i,
  /^\s*ALTER\s+(?:USER|ROLE)\b/i,
  /^\s*DROP\s+(?:USER|ROLE)\b/i,
  /^\s*SET\s+ROLE\b/i,
  /^\s*SET\s+SESSION\s+AUTHORIZATION\b/i,
  /^\s*RESET\s+ROLE\b/i,
];

/** Detect a forbidden user/role-management or identity-switching command.
 *
 * Checks every ;-separated statement in the batch (defends against stacked
 * queries). Returns a human-readable label, or null when the SQL is allowed.
 * Role-membership GRANT/REVOKE (no ON clause) are blocked; object-privilege
 * GRANT/REVOKE (with an ON clause) are allowed because they are constrained by
 * the configured user's natural privileges.
 */
export function detectForbiddenIdentity(sql: string): string | null {
  const s = stripSql(sql);
  if (!s) return null;
  for (const stmt of s.split(";")) {
    const t = stmt.trim();
    if (!t) continue;
    for (const re of FORBIDDEN_IDENTITY_RE) {
      if (re.test(t)) return labelFor(t);
    }
    const tokens = t.split(/\s+/);
    const first = tokens[0]?.toUpperCase() ?? "";
    if (first === "GRANT" && /\bTO\b/i.test(t) && !/\bON\b/i.test(t)) return "GRANT role";
    if (first === "REVOKE" && /\bFROM\b/i.test(t) && !/\bON\b/i.test(t)) return "REVOKE role";
  }
  return null;
}

function labelFor(stmt: string): string {
  const m = stmt.match(/^\s*(\w+)\s+(\w+)/i);
  if (!m) return "identity operation";
  const a = m[1].toUpperCase();
  const b = m[2].toUpperCase();
  if (a === "SET" && b === "SESSION") return "SET SESSION AUTHORIZATION";
  return `${a} ${b}`;
}

export function isForbiddenIdentity(sql: string): boolean {
  return detectForbiddenIdentity(sql) !== null;
}