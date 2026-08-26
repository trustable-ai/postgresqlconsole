"""PostgreSQL table detail: columns, indexes, constraints, DDL.

Dedicated metadata action for the explorer's table detail panel. Uses psycopg
v3 with ``dict_row`` and PostgreSQL system catalogs. Dynamic identifiers in the
synthesized DDL are quoted with ``psycopg.sql.Identifier`` (never concatenated).

Request: {"schema": "...", "table": "..."}
Response: {"ok": true, "data": {"columns": [...], "indexes": [...],
                                "constraints": [...], "ddl": "..."}, "error": null}
"""

import datetime
import decimal
import json
import os
import re
import uuid
from urllib.parse import urlparse, unquote, parse_qs

import psycopg
from psycopg import errors as pg_errors
from psycopg import sql
from psycopg.rows import dict_row

DEFAULT_STATEMENT_TIMEOUT_MS = 30000
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Connection configuration
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


def _parse_pg_url(url):
    info = {}
    try:
        p = urlparse(url)
    except Exception:
        return info
    if p.hostname:
        info["host"] = p.hostname
    if p.port:
        info["port"] = str(p.port)
    path = p.path or ""
    if path.startswith("/"):
        db = path[1:]
        if db:
            info["dbname"] = db
    if p.username:
        info["user"] = unquote(p.username)
    if p.password:
        info["password"] = unquote(p.password)
    if p.query:
        qs = parse_qs(p.query)
        if "sslmode" in qs and qs["sslmode"]:
            info["sslmode"] = qs["sslmode"][0]
    return info


def _conn_kwargs(args):
    host = os.getenv("POSTGRES_HOST")
    port = os.getenv("POSTGRES_PORT")
    dbname = os.getenv("POSTGRES_DB") or os.getenv("POSTGRES_DATABASE")
    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    sslmode = os.getenv("POSTGRES_SSLMODE")
    # Connection credentials come ONLY from the backend. The platform binds a
    # final POSTGRES_URL secret to the action; OpenWhisk rejects any
    # frontend-supplied POSTGRES_URL/user/password as a reserved property, so
    # reading it here is safe and the browser can never choose a different
    # identity. Individual POSTGRES_* env vars are preferred when the user
    # configures them in the app environment.
    if not host and not dbname:
        url = os.getenv("POSTGRES_URL")
        if not url and isinstance(args, dict):
            url = args.get("POSTGRES_URL")
        if url:
            p = _parse_pg_url(url)
            host = host or p.get("host")
            port = port or p.get("port")
            dbname = dbname or p.get("dbname")
            user = user or p.get("user")
            password = password or p.get("password")
            sslmode = sslmode or p.get("sslmode")
    kwargs = {"host": host, "port": port, "dbname": dbname, "user": user,
              "password": password, "sslmode": sslmode, "connect_timeout": 5}
    return {k: v for k, v in kwargs.items() if v is not None}


class ConfigurationError(Exception):
    pass


def _connect(args):
    kwargs = _conn_kwargs(args)
    if not (kwargs.get("host") or kwargs.get("dbname")) and not kwargs.get("user"):
        raise ConfigurationError("PostgreSQL connection not configured")
    kwargs["options"] = "-c statement_timeout=%d" % _statement_timeout_ms()
    return psycopg.connect(**kwargs)


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
# Metadata queries
# ---------------------------------------------------------------------------

_COLUMNS_SQL = """
SELECT a.attname AS name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
       NOT a.attnotnull AS nullable,
       pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default,
       a.attidentity AS identity,
       a.attgenerated AS generated,
       a.attnum AS ordinal_position
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = %s AND c.relname = %s
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
"""

_INDEXES_SQL = """
SELECT i.relname AS name,
       pg_catalog.pg_get_indexdef(ix.indexrelid) AS definition,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary,
       am.amname AS method,
       (
         SELECT string_agg(att.attname, ', '
                           ORDER BY array_position(string_to_array(ix.indkey::text, ' ')::int[], att.attnum))
         FROM pg_catalog.pg_attribute att
         WHERE att.attrelid = c.oid AND att.attnum = ANY(string_to_array(ix.indkey::text, ' ')::int[])
       ) AS columns
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class c ON c.oid = ix.indrelid
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = i.relam
WHERE n.nspname = %s AND c.relname = %s
ORDER BY i.relname;
"""

_CONSTRAINTS_SQL = """
SELECT con.conname AS name,
       con.contype AS type,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition,
       con.conrelid::regclass::text AS source_table,
       con.confrelid::regclass::text AS target_table,
       con.confupdtype AS update_rule_type,
       con.confdeltype AS delete_rule_type,
       (SELECT string_agg(a.attname, ', ' ORDER BY u.ord)
        FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS source_columns,
       (SELECT string_agg(a.attname, ', ' ORDER BY u.ord)
        FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum) AS target_columns
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relname = %s
ORDER BY con.contype, con.conname;
"""

_CONTYPE_LABELS = {"p": "PRIMARY KEY", "f": "FOREIGN KEY", "u": "UNIQUE",
                   "c": "CHECK", "x": "EXCLUSION"}
_FK_RULE_LABELS = {"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE",
                   "n": "SET NULL", "d": "SET DEFAULT"}
_IDENTITY_LABELS = {"a": "ALWAYS", "d": "BY DEFAULT"}


def _normalize_columns(rows):
    for r in rows:
        r["identity"] = _IDENTITY_LABELS.get(r.get("identity") or "", "")
        r["generated"] = {"s": "STORED", "v": "VIRTUAL"}.get(r.get("generated") or "", "")
    return rows


def _normalize_constraints(rows):
    for r in rows:
        r["type"] = _CONTYPE_LABELS.get(r.get("type") or "", "OTHER")
        r["updateRule"] = _FK_RULE_LABELS.get(r.get("update_rule_type") or "", "")
        r["deleteRule"] = _FK_RULE_LABELS.get(r.get("delete_rule_type") or "", "")
        # Only FK rows carry target information.
        if not r.get("target_table") or r.get("target_table") == "-":
            r["target_table"] = None
            r["target_columns"] = None
            r["source_columns"] = None
            r["update_rule_type"] = None
            r["delete_rule_type"] = None
            r["updateRule"] = None
            r["deleteRule"] = None
    return rows


def _build_ddl(conn, schema, table, columns, constraints):
    """Synthesize a CREATE TABLE statement using sql.Identifier for safe quoting.

    This is a best-effort reconstruction from catalog metadata (PostgreSQL does
    not store the original CREATE TABLE source).
    """
    qtbl = sql.Identifier(schema, table).as_string(conn)

    col_lines = []
    for c in columns:
        parts = [sql.Identifier(c["name"]).as_string(conn), c["type"]]
        if not c.get("nullable", True):
            parts.append("NOT NULL")
        gen = c.get("generated") or ""
        ident = c.get("identity") or ""
        default = c.get("default") or ""
        if gen == "STORED" and default:
            parts.append("GENERATED ALWAYS AS (%s) STORED" % default)
        elif ident:
            parts.append("GENERATED %s AS IDENTITY" % ident)
        elif default:
            parts.append("DEFAULT %s" % default)
        col_lines.append("  " + " ".join(str(p) for p in parts))

    con_lines = []
    for con in constraints:
        ctype = con.get("type") or ""
        definition = con.get("definition") or ""
        if ctype and definition:
            con_lines.append("  CONSTRAINT %s %s" % (
                sql.Identifier(con["name"]).as_string(conn), definition))

    body = ",\n".join(col_lines + con_lines) if (col_lines or con_lines) else ""
    header = "CREATE TABLE %s (" % qtbl
    footer = ");"
    note = "-- Synthesized from pg_catalog metadata (not the original source)."
    if body:
        return "%s\n%s\n%s\n%s" % (note, header, body, footer)
    return "%s\n%s%s" % (note, header, footer)


def main(args, ctx=None):
    data = _request_data(args)
    schema = (data.get("schema") or "").strip()
    table = (data.get("table") or "").strip()
    if not schema or not _IDENT_RE.match(schema):
        return _fail_msg("BadRequest", "Invalid or missing schema name")
    if not table or not _IDENT_RE.match(table):
        return _fail_msg("BadRequest", "Invalid or missing table name")

    try:
        with _connect(args) as conn:
            columns = indexes = constraints = []
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(_COLUMNS_SQL, (schema, table))
                columns = _normalize_columns(_rows(cur.fetchall()))
                cur.execute(_INDEXES_SQL, (schema, table))
                indexes = _rows(cur.fetchall())
                cur.execute(_CONSTRAINTS_SQL, (schema, table))
                constraints = _normalize_constraints(_rows(cur.fetchall()))
            ddl = _build_ddl(conn, schema, table, columns, constraints)
            return _ok({
                "schema": schema,
                "table": table,
                "columns": columns,
                "indexes": indexes,
                "constraints": constraints,
                "ddl": ddl,
            })
    except Exception as exc:
        return _fail(exc)