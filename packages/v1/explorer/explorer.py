"""PostgreSQL schema explorer: schema + object listing.

Dedicated metadata action for the visual explorer. Uses psycopg v3 with the
``dict_row`` row factory and PostgreSQL system catalogs (pg_catalog). Schema
names are passed as bound parameters (never string-concatenated).

Operations (``op`` request field):
  - ``schemas``  -> list all schemas with an ``is_internal`` flag
  - ``objects``  -> list objects of a given ``kind`` in a ``schema``

Response envelope: {"ok": true, "data": {...}, "error": null}
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
from psycopg.rows import dict_row

DEFAULT_STATEMENT_TIMEOUT_MS = 30000
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Connection configuration (env vars, fallback to POSTGRES_URL)
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

_SCHEMAS_SQL = """
SELECT n.nspname AS name,
       pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
       (n.nspname LIKE 'pg\\_%' OR n.nspname = 'information_schema') AS is_internal
FROM pg_catalog.pg_namespace n
ORDER BY is_internal, n.nspname;
"""

_TABLES_SQL = """
SELECT c.relname AS name, n.nspname AS schema,
       c.reltuples::bigint AS estimate_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
       pg_total_relation_size(c.oid) AS size_bytes,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relkind = 'r'
ORDER BY c.relname;
"""

_VIEWS_SQL = """
SELECT c.relname AS name, n.nspname AS schema,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relkind = 'v'
ORDER BY c.relname;
"""

_MATVIEWS_SQL = """
SELECT c.relname AS name, n.nspname AS schema,
       c.reltuples::bigint AS estimate_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = %s AND c.relkind = 'm'
ORDER BY c.relname;
"""

_SEQUENCES_SQL = """
SELECT c.relname AS name, n.nspname AS schema,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       s.seqstart AS start_value,
       s.seqincrement AS increment,
       s.seqmin AS min_value,
       s.seqmax AS max_value,
       s.seqcycle AS cycle,
       s.seqcache AS cache_size
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = 1
WHERE n.nspname = %s AND c.relkind = 'S'
ORDER BY c.relname;
"""

_FUNCTIONS_SQL = """
SELECT p.proname AS name, n.nspname AS schema,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       l.lanname AS language,
       pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       p.prokind AS kind,
       p.proretset AS returns_set
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = %s
ORDER BY p.proname;
"""

_TYPES_SQL = """
SELECT t.typname AS name, n.nspname AS schema,
       pg_catalog.pg_get_userbyid(t.typowner) AS owner,
       CASE t.typtype
         WHEN 'e' THEN 'enum' WHEN 'c' THEN 'composite'
         WHEN 'd' THEN 'domain' WHEN 'r' THEN 'range' ELSE 'base'
       END AS kind,
       pg_catalog.format_type(t.oid, t.typtypmod) AS data_type
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = %s
  AND t.typtype IN ('e', 'c', 'd', 'r')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.reltype = t.oid)
ORDER BY t.typname;
"""

_KIND_QUERIES = {
    "tables": _TABLES_SQL,
    "views": _VIEWS_SQL,
    "matviews": _MATVIEWS_SQL,
    "sequences": _SEQUENCES_SQL,
    "functions": _FUNCTIONS_SQL,
    "types": _TYPES_SQL,
}


def main(args, ctx=None):
    data = _request_data(args)
    op = (data.get("op") or "").strip()
    try:
        with _connect(args) as conn, conn.cursor(row_factory=dict_row) as cur:
            if op == "schemas":
                cur.execute(_SCHEMAS_SQL)
                return _ok({"schemas": _rows(cur.fetchall())})

            if op == "objects":
                kind = (data.get("kind") or "").strip()
                schema = (data.get("schema") or "").strip()
                if kind not in _KIND_QUERIES:
                    return _fail_msg("BadRequest", "Unknown object kind: %r" % (kind,))
                if not schema or not _IDENT_RE.match(schema):
                    return _fail_msg("BadRequest", "Invalid or missing schema name")
                cur.execute(_KIND_QUERIES[kind], (schema,))
                return _ok({"kind": kind, "schema": schema, "objects": _rows(cur.fetchall())})

            return _fail_msg("BadRequest", "Unknown op: %r (expected 'schemas' or 'objects')" % (op,))
    except Exception as exc:
        return _fail(exc)