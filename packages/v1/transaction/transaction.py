"""PostgreSQL guided transactions.

Runs a sequence of parameterized statements inside a single psycopg connection
and a single transaction (``with conn.transaction()``). The whole transaction
executes within one backend request — no transaction state is kept across
serverless invocations.

Values are always bound with psycopg parameters (``cur.execute(sql, params)``);
they are never interpolated into the SQL string.

Request:
    {"statements": [{"sql": "...", "params": [...]}, ...],
     "commit": true|false,
     "confirm_destructive": false}

Response:
    {"ok": true, "data": {"results": [...], "committed": bool, "rolledBack": bool},
     "error": null}
"""

import datetime
import decimal
import json
import os
import re
import time
import uuid
from urllib.parse import urlparse, unquote, parse_qs

import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

DEFAULT_STATEMENT_TIMEOUT_MS = 30000


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
    ignored = {"body", "__ow_method", "__ow_headers", "__ow_path", "POSTGRES_URL"}
    merged.update({k: v for k, v in data.items() if k not in ignored})
    return merged


# ---------------------------------------------------------------------------
# Safety classification (mirrors v1/query)
# ---------------------------------------------------------------------------

def _strip_sql(sql):
    s = re.sub(r"--[^\n]*", "", sql)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return s.strip()


def _classify_statement(sql):
    s = _strip_sql(sql)
    if not s:
        return "READ", "empty"
    first = s.split(None, 1)[0].upper().rstrip(";")
    if first in ("SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN", "FETCH"):
        return "READ", first
    if first in ("INSERT", "UPDATE", "DELETE", "MERGE", "COPY"):
        if first in ("UPDATE", "DELETE") and not re.search(r"\bWHERE\b", s, re.I):
            return "DESTRUCTIVE", "%s without WHERE" % first
        return "WRITE", first
    if first in ("DROP", "TRUNCATE"):
        return "DESTRUCTIVE", first
    if first in ("CREATE", "ALTER", "GRANT", "REVOKE", "COMMENT", "REINDEX",
                 "VACUUM", "ANALYZE", "CLUSTER", "REFRESH", "ATTACH", "DETACH"):
        return "DDL", first
    if first in ("BEGIN", "START", "COMMIT", "END", "ROLLBACK", "SAVEPOINT",
                 "RELEASE", "SET", "RESET", "DISCARD", "LOCK"):
        return "CONTROL", first
    return "WRITE", first


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_type_names(conn, description):
    names = {}
    oids = [c.type_code for c in description if c.type_code]
    if not oids:
        return names
    try:
        with conn.cursor() as tcur:
            tcur.execute("SELECT oid, format_type(oid, NULL) FROM pg_type WHERE oid = ANY(%s)", (oids,))
            for oid, name in tcur.fetchall():
                if name:
                    names[oid] = name
    except Exception:
        for oid in oids:
            names.setdefault(oid, "unknown")
    return names


def _command_from_status(status):
    if not status:
        return ""
    parts = status.split()
    while parts and parts[-1].lstrip("-").isdigit():
        parts.pop()
    return " ".join(parts) or status


def _normalize_stmt(stmt):
    if not isinstance(stmt, dict):
        return None
    sql = (stmt.get("sql") or "").strip()
    if not sql:
        return None
    params = stmt.get("params")
    if params is not None and not isinstance(params, list):
        raise ValueError("'params' must be a list")
    return {"sql": sql, "params": params}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args, ctx=None):
    data = _request_data(args)
    raw_statements = data.get("statements")
    if not isinstance(raw_statements, list) or not raw_statements:
        return _fail_msg("BadRequest", "'statements' must be a non-empty list")
    commit = bool(data.get("commit", True))
    confirm_destructive = bool(data.get("confirm_destructive"))

    # Parse + classify all statements up front; reject destructive without
    # confirmation before touching the database.
    statements = []
    for i, stmt in enumerate(raw_statements):
        try:
            norm = _normalize_stmt(stmt)
        except ValueError as e:
            return _fail_msg("BadRequest", "Statement %d: %s" % (i + 1, e))
        if norm is None:
            return _fail_msg("BadRequest", "Statement %d is empty or invalid" % (i + 1,))
        op, label = _classify_statement(norm["sql"])
        if op == "DESTRUCTIVE" and not confirm_destructive:
            return _fail_msg(
                "DestructiveOperation",
                "Statement %d is destructive (%s) and requires explicit confirmation." % (i + 1, label),
                operation=op, label=label,
            )
        statements.append({**norm, "operation": op, "operationLabel": label})

    notices = []
    results = []
    committed = False
    rolled_back = False
    stmt_failed = False

    class _RollbackSignal(Exception):
        """Raised to make conn.transaction() roll back cleanly (commit=false)."""

    try:
        with _connect(args) as conn:
            conn.add_notice_handler(lambda d: notices.append({
                "severity": getattr(d, "severity", None),
                "code": getattr(d, "sqlstate", None) or getattr(getattr(d, "diag", d), "sqlstate", None),
                "message": (getattr(getattr(d, "diag", d), "message_primary", None) or "").strip(),
            }))
            try:
                with conn.transaction():
                    with conn.cursor(row_factory=dict_row) as cur:
                        for stmt in statements:
                            start = time.time()
                            item = {
                                "sql": stmt["sql"],
                                "operation": stmt["operation"],
                                "operationLabel": stmt["operationLabel"],
                                "durationMs": 0,
                            }
                            try:
                                if stmt["params"] is None:
                                    cur.execute(stmt["sql"])
                                else:
                                    cur.execute(stmt["sql"], stmt["params"])
                                item["durationMs"] = int((time.time() - start) * 1000)
                                if cur.description is not None:
                                    desc = cur.description
                                    type_names = _resolve_type_names(conn, desc)
                                    item["columns"] = [
                                        {"name": c.name, "type": type_names.get(c.type_code, "unknown")}
                                        for c in desc
                                    ]
                                    item["rows"] = _rows(cur.fetchall())
                                    item["rowCount"] = len(item["rows"])
                                    item["command"] = "SELECT"
                                else:
                                    rc = getattr(cur, "rowcount", -1)
                                    item["rowCount"] = rc if (rc is not None and rc >= 0) else 0
                                    item["command"] = _command_from_status(getattr(cur, "statusmessage", "") or "")
                                results.append(item)
                            except Exception as e:
                                item["durationMs"] = int((time.time() - start) * 1000)
                                item["error"] = _error_payload(e)
                                results.append(item)
                                stmt_failed = True
                                raise  # conn.transaction() rolls back
                    if not commit:
                        raise _RollbackSignal()
            except _RollbackSignal:
                rolled_back = True
            except Exception:
                # A statement failed: the transaction context already rolled back.
                if not stmt_failed:
                    raise  # unexpected connection/transaction-level error
                rolled_back = True

            if not stmt_failed and not rolled_back and commit:
                committed = True

        return _ok({
            "results": results,
            "committed": committed,
            "rolledBack": rolled_back or stmt_failed,
            "notices": notices,
        })
    except Exception as exc:
        # If we already collected partial results, include them in the error.
        if results:
            return {
                "ok": False,
                "data": {"results": results, "committed": False, "rolledBack": True, "notices": notices},
                "error": _error_payload(exc),
            }
        return {"ok": False, "data": None, "error": _error_payload(exc)}