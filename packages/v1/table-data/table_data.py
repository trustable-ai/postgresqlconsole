"""PostgreSQL table data browser with safe pagination.

Dedicated action for the explorer's Data tab. Uses psycopg v3 with
``dict_row`` and ``psycopg.sql`` composition (``sql.Identifier``) so schema,
table and ordering-column identifiers are never built by string concatenation.

Pagination strategy:
  - Keyset pagination when a suitable unique ordering key exists (single-column
    primary key, or an explicit unique NOT NULL column). Uses
    ``WHERE "col" > cursor ORDER BY "col" LIMIT n``.
  - Otherwise controlled OFFSET/LIMIT pagination with a deterministic order.

A sensible default LIMIT (100, max 1000) prevents accidentally selecting all
rows of a huge table.

Request: {"schema": "...", "table": "...", "limit": 100, "order": "...",
          "cursor": <last order value>, "page": 0}
Response: {"ok": true, "data": {"columns": [...], "rows": [...], "rowCount": n,
          "pagination": {...}}, "error": null}
"""

import datetime
import decimal
import json
import os
import re
import uuid

import psycopg
from psycopg import errors as pg_errors
from psycopg import sql
from psycopg.rows import dict_row

DEFAULT_STATEMENT_TIMEOUT_MS = 30000
DEFAULT_LIMIT = 100
MAX_LIMIT = 1000
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Statement timeout
# ---------------------------------------------------------------------------

def _statement_timeout_ms():
    raw = os.getenv("PG_STATEMENT_TIMEOUT_MS")
    if not raw:
        return DEFAULT_STATEMENT_TIMEOUT_MS
    try:
        val = int(raw)
        return val if val > 0 else DEFAULT_STATEMENT_TIMEOUT_MS
    except (TypeError, ValueError):
        return DEFAULT_STATEMENT_TIMEOUT_MS


class ConfigurationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Response envelope + error handling
# ---------------------------------------------------------------------------

def _ok(data):
    return {"ok": True, "data": data, "error": None}


def _fail_msg(type_name, message, **extra):
    err = {"type": type_name, "message": message}
    err.update({k: v for k, v in extra.items() if v})
    return {"ok": False, "data": None, "error": err}


def _scrub(text):
    if not text:
        return ""
    text = re.sub(r"password=[^\s,)]+", "password=***", text, flags=re.I)
    text = re.sub(r"(postgres(?:ql)?://)[^\s@/]+@[^\s,)]+", r"\1***", text, flags=re.I)
    return text.strip()


def _error_payload(exc):
    if isinstance(exc, ConfigurationError):
        return {"type": "ConfigurationError", "message": str(exc)}
    if isinstance(exc, psycopg.Error):
        sqlstate = getattr(exc, "pgcode", None)
        diag = getattr(exc, "diag", None)
        message = ""
        if diag is not None:
            message = (getattr(diag, "message_primary", None) or "").strip()
        if not message:
            message = _scrub(str(exc))
        if isinstance(exc, pg_errors.QueryCanceled):
            payload = {"type": "QueryCanceled", "message": message or "Query was canceled"}
            if sqlstate:
                payload["sqlstate"] = sqlstate
            return payload
        if not sqlstate and isinstance(exc, pg_errors.OperationalError):
            text = (message + " " + str(exc).lower())
            if "canceling statement" in text or "statement timeout" in text:
                return {"type": "QueryCanceled", "message": message}
            if "timeout" in text:
                return {"type": "ConnectionTimeout", "message": "Connection timed out"}
            if "name resolution" in text or "nodename" in text or "no address" in text:
                return {"type": "ConnectivityError", "message": "DNS resolution failed"}
            if "authentication" in text or "password" in text:
                return {"type": "AuthenticationError", "message": "Authentication failed"}
            if "refused" in text or "could not connect" in text:
                return {"type": "ConnectivityError", "message": "Could not connect to PostgreSQL"}
            return {"type": "OperationalError", "message": message or "Connection error"}
        payload = {"type": type(exc).__name__, "message": message}
        if sqlstate:
            payload["sqlstate"] = sqlstate
        return payload
    return {"type": type(exc).__name__, "message": _scrub(str(exc))}


def _fail(exc):
    return {"ok": False, "data": None, "error": _error_payload(exc)}


def _rollback(conn):
    """Reset a borrowed connection after a failure.

    The connection belongs to the wrapper (``ctx.POSTGRESQL``) and is reused
    across invocations in a warm container, so a failed request must not leave
    it in an aborted transaction.
    """
    try:
        conn.rollback()
    except Exception:
        pass


def _cell(value):
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, datetime.timedelta):
        return value.total_seconds()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return bytes(value).decode("utf-8")
        except Exception:
            return bytes(value).hex()
    if isinstance(value, (list, tuple, set)):
        return [_cell(v) for v in value]
    if isinstance(value, dict):
        return {k: _cell(v) for k, v in value.items()}
    return value


def _rows(rows):
    out = []
    for row in rows:
        if isinstance(row, dict):
            out.append({k: _cell(v) for k, v in row.items()})
        else:
            out.append([_cell(v) for v in row])
    return out


def _request_data(args):
    data = dict(args) if isinstance(args, dict) else {}
    body = data.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    merged = dict(body) if isinstance(body, dict) else {}
    ignored = {
        "body", "__ow_method", "__ow_headers", "__ow_path",
        "POSTGRES_URL", "user", "username", "role", "password",
        "connection_string", "connstring", "dsn",
    }
    merged.update({k: v for k, v in data.items() if k not in ignored})
    return merged


# ---------------------------------------------------------------------------
# Metadata helpers (catalog queries; schema/table passed as bound params)
# ---------------------------------------------------------------------------

_COLUMN_NAMES_SQL = """
SELECT a.attname AS name
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relname = %s
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
"""

_PK_COLUMNS_SQL = """
SELECT a.attname AS name
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
WHERE n.nspname = %s AND c.relname = %s AND con.contype = 'p'
ORDER BY k.ord;
"""

# True if `col` is the sole key of a unique index and is NOT NULL.
_UNIQUE_NOTNULL_SQL = """
SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_index ix
  JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = %s AND c.relname = %s AND a.attname = %s
    AND ix.indisunique AND ix.indisready
    AND array_length(string_to_array(ix.indkey::text, ' ')::int[], 1) = 1
    AND a.attnum = ANY(string_to_array(ix.indkey::text, ' ')::int[])
    AND a.attnotnull
) AS ok;
"""

_TOTAL_ESTIMATE_SQL = """
SELECT c.reltuples::bigint AS estimate
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relname = %s;
"""


def _resolve_type_names(conn, description):
    names = {}
    oids = [c.type_code for c in description if c.type_code]
    if not oids:
        return names
    try:
        with conn.cursor() as tcur:
            tcur.execute(
                "SELECT oid, format_type(oid, NULL) FROM pg_type WHERE oid = ANY(%s)",
                (oids,),
            )
            for oid, name in tcur.fetchall():
                if name:
                    names[oid] = name
    except Exception:
        for oid in oids:
            names.setdefault(oid, "unknown")
    return names


def _to_int(value, default):
    try:
        v = int(value)
        return v
    except (TypeError, ValueError):
        return default


def main(args, ctx=None):
    data = _request_data(args)
    schema = (data.get("schema") or "").strip()
    table = (data.get("table") or "").strip()
    if not schema or not _IDENT_RE.match(schema):
        return _fail_msg("BadRequest", "Invalid or missing schema name")
    if not table or not _IDENT_RE.match(table):
        return _fail_msg("BadRequest", "Invalid or missing table name")

    limit = _to_int(data.get("limit"), DEFAULT_LIMIT)
    if limit <= 0:
        limit = DEFAULT_LIMIT
    limit = min(limit, MAX_LIMIT)

    explicit_order = (data.get("order") or "").strip()
    if explicit_order and not _IDENT_RE.match(explicit_order):
        return _fail_msg("BadRequest", "Invalid order column name")
    cursor = data.get("cursor")
    page = _to_int(data.get("page"), 0)
    if page < 0:
        page = 0

    if ctx is None or getattr(ctx, "POSTGRESQL", None) is None:
        return _fail(ConfigurationError("Database not configured"))
    conn = ctx.POSTGRESQL
    try:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SET statement_timeout = %d" % _statement_timeout_ms())
            # 1. Column names of the table.
            cur.execute(_COLUMN_NAMES_SQL, (schema, table))
            col_names = [r["name"] for r in cur.fetchall()]
            if not col_names:
                return _fail_msg("NotFound", "Table not found or has no columns")

            # 2. Primary key columns.
            cur.execute(_PK_COLUMNS_SQL, (schema, table))
            pk_cols = [r["name"] for r in cur.fetchall()]

            # 3. Resolve the ordering column + keyset eligibility.
            keyset = False
            if explicit_order:
                if explicit_order not in col_names:
                    return _fail_msg("BadRequest", "order column does not exist in table")
                order_col = explicit_order
                keyset = (explicit_order in pk_cols and len(pk_cols) == 1)
                if not keyset:
                    cur.execute(_UNIQUE_NOTNULL_SQL, (schema, table, explicit_order))
                    keyset = bool(cur.fetchone()["ok"])
            elif len(pk_cols) == 1:
                order_col = pk_cols[0]
                keyset = True
            else:
                order_col = col_names[0]
                keyset = False

            # 4. Total row estimate (for display).
            cur.execute(_TOTAL_ESTIMATE_SQL, (schema, table))
            total_est = cur.fetchone()
            total_estimate = int(total_est["estimate"]) if total_est else None

            # 5. Build the paginated query with sql.Identifier composition.
            base = sql.SQL("SELECT * FROM {tbl}").format(
                tbl=sql.Identifier(schema, table)
            )
            col_ident = sql.Identifier(order_col)

            if keyset:
                if cursor is not None and cursor != "":
                    query = sql.SQL("{base} WHERE {col} > %s ORDER BY {col} LIMIT %s").format(
                        base=base, col=col_ident
                    )
                    params = [cursor, limit]
                else:
                    query = sql.SQL("{base} ORDER BY {col} LIMIT %s").format(
                        base=base, col=col_ident
                    )
                    params = [limit]
            else:
                offset = page * limit
                query = sql.SQL("{base} ORDER BY {col} LIMIT %s OFFSET %s").format(
                    base=base, col=col_ident
                )
                params = [limit, offset]

            cur.execute(query, params)
            description = cur.description
            rows = _rows(cur.fetchall())

            type_names = _resolve_type_names(conn, description)
            columns_meta = [
                {"name": d.name, "type": type_names.get(d.type_code, "unknown")}
                for d in description
            ] if description else [{"name": c, "type": "unknown"} for c in col_names]

            row_count = len(rows)
            has_more = row_count == limit
            next_cursor = None
            if keyset and has_more and rows:
                next_cursor = rows[-1].get(order_col)

            return _ok({
                "schema": schema,
                "table": table,
                "columns": columns_meta,
                "rows": rows,
                "rowCount": row_count,
                "pagination": {
                    "mode": "keyset" if keyset else "offset",
                    "order": order_col,
                    "limit": limit,
                    "page": page if not keyset else None,
                    "hasMore": has_more,
                    "nextCursor": next_cursor,
                    "totalEstimate": total_estimate,
                },
            })
    except Exception as exc:
        _rollback(conn)
        return _fail(exc)
    finally:
        # This action only reads. Whether it returned a page, a BadRequest or
        # raised, the borrowed connection must not be left idle-in-transaction.
        _rollback(conn)