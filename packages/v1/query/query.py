"""PostgreSQL Console query action.

Executes a SQL string from the React UI against PostgreSQL using psycopg v3
(``import psycopg`` — never psycopg2).

Connection configuration is read from backend environment variables
(``POSTGRES_HOST``, ``POSTGRES_PORT``, ``POSTGRES_DB``, ``POSTGRES_USER``,
``POSTGRES_PASSWORD``, ``POSTGRES_SSLMODE``) and falls back to parsing the
``POSTGRES_URL`` that the platform binds. Connection strings / passwords are
never exposed to the frontend.

Rows are read with the ``dict_row`` row factory so results are returned as
structured objects keyed by column name, with column type metadata resolved
through ``format_type``. Example response::

    {"ok": true, "data": {
        "columns": [{"name": "id", "type": "integer"}, ...],
        "rows": [{"id": 1, "name": "Alice", "email": "alice@example.com"}],
        "rowCount": 1, "command": "SELECT", "durationMs": 8,
        "notices": []
    }, "error": null}

A server-side ``statement_timeout`` caps console queries so a query such as
``SELECT pg_sleep(100000)`` cannot keep an action running indefinitely.
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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_STATEMENT_TIMEOUT_MS = 30000
_SCHEMA_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")


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
            parsed = _parse_pg_url(url)
            host = host or parsed.get("host")
            port = port or parsed.get("port")
            dbname = dbname or parsed.get("dbname")
            user = user or parsed.get("user")
            password = password or parsed.get("password")
            sslmode = sslmode or parsed.get("sslmode")

    kwargs = {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
        "sslmode": sslmode,
        "connect_timeout": 5,
    }
    return {k: v for k, v in kwargs.items() if v is not None}


class ConfigurationError(Exception):
    """Raised when required connection settings are missing."""


def _connect(args):
    kwargs = _conn_kwargs(args)
    if not (kwargs.get("host") or kwargs.get("dbname")) and not kwargs.get("user"):
        raise ConfigurationError("PostgreSQL connection not configured")
    kwargs["options"] = "-c statement_timeout=%d" % _statement_timeout_ms()
    return psycopg.connect(**kwargs)


# ---------------------------------------------------------------------------
# Response envelope
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
    if isinstance(exc, SafetyError):
        return {"type": "DestructiveOperation", "message": exc.message,
                "operation": exc.operation, "label": exc.label}
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
            return _classify_connection_error(exc, message)

        payload = {"type": type(exc).__name__, "message": message}
        if sqlstate:
            payload["sqlstate"] = sqlstate
        if diag is not None:
            for attr, key in (
                ("severity", "severity"),
                ("message_detail", "detail"),
                ("message_hint", "hint"),
                ("position", "position"),
                ("constraint_name", "constraint"),
                ("table_name", "table"),
                ("column_name", "column"),
                ("schema_name", "schema"),
            ):
                val = getattr(diag, attr, None)
                if val:
                    payload[key] = str(val)
        return payload

    return {"type": type(exc).__name__, "message": _scrub(str(exc))}


def _classify_connection_error(exc, message):
    text = (message + " " + str(exc).lower())
    if "canceling statement" in text or "statement timeout" in text or "query timeout" in text:
        return {"type": "QueryCanceled", "message": message or "Query was canceled due to statement timeout"}
    if "timeout" in text or "timed out" in text:
        if "connect" in text or "connection" in text:
            return {"type": "ConnectionTimeout", "message": "Connection timed out"}
        return {"type": "QueryTimeout", "message": message or "Query timed out"}
    if "name resolution" in text or "name or service not known" in text or "nodename" in text or "no address" in text:
        return {"type": "ConnectivityError", "message": "DNS resolution failed for PostgreSQL host"}
    if "authentication" in text or "password" in text:
        return {"type": "AuthenticationError", "message": "Authentication failed"}
    if "refused" in text or "could not connect" in text or "connection refused" in text:
        return {"type": "ConnectivityError", "message": "Could not connect to PostgreSQL"}
    return {"type": "OperationalError", "message": message or "Connection error"}


def _fail(exc):
    return {"ok": False, "data": None, "error": _error_payload(exc)}


# ---------------------------------------------------------------------------
# JSON-safe value conversion
# ---------------------------------------------------------------------------

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


def _rows_to_json(rows):
    out = []
    for row in rows:
        if isinstance(row, dict):
            out.append({k: _cell(v) for k, v in row.items()})
        else:
            out.append([_cell(v) for v in row])
    return out


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------

def _command_from_status(status):
    """Extract the command tag (e.g. 'SELECT', 'INSERT', 'CREATE TABLE') from a
    psycopg statusmessage such as 'INSERT 0 5' or 'CREATE TABLE'."""
    if not status:
        return ""
    parts = status.split()
    while parts and parts[-1].lstrip("-").isdigit():
        parts.pop()
    return " ".join(parts) or status


def _resolve_type_names(conn, description):
    """Map each column's type OID to a human type name via format_type.

    Uses only the type OID (format_type(oid, NULL)) so it is stable across
    psycopg versions whose Column description object may not expose the
    type modifier attribute.
    """
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


def _notice(obj):
    diag = getattr(obj, "diag", obj)
    return {
        "severity": getattr(diag, "severity", None),
        "code": getattr(diag, "sqlstate", None),
        "message": (getattr(diag, "message_primary", None) or "").strip(),
    }


# ---------------------------------------------------------------------------
# Safety: statement classification + destructive-operation enforcement
# ---------------------------------------------------------------------------

class SafetyError(Exception):
    def __init__(self, operation, label, message):
        super().__init__(message)
        self.operation = operation
        self.label = label
        self.message = message


def _strip_sql(sql):
    """Remove line/block comments and surrounding whitespace for classification."""
    s = re.sub(r"--[^\n]*", "", sql)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return s.strip()


# ---------------------------------------------------------------------------
# Identity protection: block user/role management + identity switching
# ---------------------------------------------------------------------------
#
# The console operates as exactly one PostgreSQL user (POSTGRES_USER). It must
# never let a browser session create/alter/drop users or roles, switch the
# session identity, or grant/revoke role memberships. These checks run on the
# backend BEFORE the statement reaches PostgreSQL, so even a hand-crafted
# frontend request cannot bypass them. Object-level GRANT/REVOKE (statements
# that contain an ON clause) remain allowed because they are constrained by the
# configured user's natural privileges and are not identity management.

_FORBIDDEN_IDENTITY_PATTERNS = [
    (re.compile(r"^\s*CREATE\s+(?:USER|ROLE)\b", re.I), "CREATE USER/ROLE"),
    (re.compile(r"^\s*ALTER\s+(?:USER|ROLE)\b", re.I), "ALTER USER/ROLE"),
    (re.compile(r"^\s*DROP\s+(?:USER|ROLE)\b", re.I), "DROP USER/ROLE"),
    (re.compile(r"^\s*SET\s+ROLE\b", re.I), "SET ROLE"),
    (re.compile(r"^\s*SET\s+SESSION\s+AUTHORIZATION\b", re.I),
     "SET SESSION AUTHORIZATION"),
    (re.compile(r"^\s*RESET\s+ROLE\b", re.I), "RESET ROLE"),
]


def _detect_forbidden_identity(sql):
    """Return a label for the first forbidden identity/user/role statement.

    Checks every ;-separated statement in the batch (defends against stacked
    queries). Returns None when the SQL is allowed.
    """
    s = _strip_sql(sql)
    if not s:
        return None
    for stmt in s.split(";"):
        stmt = stmt.strip()
        if not stmt:
            continue
        for pat, label in _FORBIDDEN_IDENTITY_PATTERNS:
            if pat.match(stmt):
                return label
        tokens = stmt.split()
        first = tokens[0].upper() if tokens else ""
        # Role-membership grants/revoke have no ON clause (GRANT role TO user,
        # REVOKE role FROM user). Object privilege grants/revoke always carry
        # an ON clause (GRANT priv ON obj TO user) and are allowed.
        if first == "GRANT" and re.search(r"\bTO\b", stmt, re.I) \
                and not re.search(r"\bON\b", stmt, re.I):
            return "GRANT role"
        if first == "REVOKE" and re.search(r"\bFROM\b", stmt, re.I) \
                and not re.search(r"\bON\b", stmt, re.I):
            return "REVOKE role"
    return None


def _classify_statement(sql):
    """Classify a SQL statement as READ / WRITE / DDL / DESTRUCTIVE / CONTROL.

    Returns (operation, label). Conservative: unknown verbs default to WRITE.
    Destructive: DROP, TRUNCATE, DELETE without WHERE, UPDATE without WHERE.
    """
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
# Request parsing
# ---------------------------------------------------------------------------

def _request_data(args):
    data = dict(args) if isinstance(args, dict) else {}
    body = data.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    merged = dict(body) if isinstance(body, dict) else {}
    # Identity / connection fields are never accepted from the frontend. The
    # backend connects exclusively with the configured POSTGRES_USER /
    # POSTGRES_PASSWORD, so browser-supplied user/role/password/connection
    # string values are dropped before they can reach business logic.
    ignored = {
        "body", "__ow_method", "__ow_headers", "__ow_path",
        "POSTGRES_URL", "user", "username", "role", "password",
        "connection_string", "connstring", "dsn",
    }
    merged.update({k: v for k, v in data.items() if k not in ignored})
    return merged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args, ctx=None):
    data = _request_data(args)
    sql = (data.get("sql") or "").strip()
    if not sql:
        return _fail_msg("BadRequest", "Missing 'sql' parameter")

    # Enforce the single-user restriction on the backend: user/role management
    # and identity-switching commands are rejected before reaching PostgreSQL.
    forbidden = _detect_forbidden_identity(sql)
    if forbidden:
        return _fail_msg(
            "ForbiddenIdentityOperation",
            "User/role management and identity-switching commands are not "
            "allowed (%s). The console operates as a single configured "
            "PostgreSQL user." % forbidden,
            operation=forbidden,
            label=forbidden,
        )

    schema = (data.get("schema") or "").strip()
    params = data.get("params")
    confirm_destructive = bool(data.get("confirm_destructive"))
    notices = []

    operation, operation_label = _classify_statement(sql)
    if operation == "DESTRUCTIVE" and not confirm_destructive:
        return _fail_msg(
            "DestructiveOperation",
            "Destructive operation (%s) requires explicit confirmation.",
            operation=operation,
            label=operation_label,
        )

    start = time.time()
    try:
        with _connect(args) as conn:
            conn.add_notice_handler(lambda d: notices.append(_notice(d)))
            with conn.cursor(row_factory=dict_row) as cur:
                if schema:
                    if not _SCHEMA_RE.match(schema):
                        return _fail_msg("BadRequest", "Invalid schema name: %r" % (schema,))
                    cur.execute('SET LOCAL search_path TO "%s"' % schema)

                if params is None:
                    cur.execute(sql)
                else:
                    if not isinstance(params, list):
                        return _fail_msg("BadRequest", "'params' must be a list")
                    cur.execute(sql, params)

                duration = int((time.time() - start) * 1000)

                if cur.description is not None:
                    desc = cur.description
                    rows = _rows_to_json(cur.fetchall())
                    type_names = _resolve_type_names(conn, desc)
                    columns_meta = [
                        {"name": c.name, "type": type_names.get(c.type_code, "unknown")}
                        for c in desc
                    ]
                    return _ok({
                        "columns": columns_meta,
                        "rows": rows,
                        "rowCount": len(rows),
                        "command": "SELECT",
                        "durationMs": duration,
                        "operation": operation,
                        "operationLabel": operation_label,
                        "notices": notices,
                    })

                conn.commit()
                status = getattr(cur, "statusmessage", "") or ""
                rc = getattr(cur, "rowcount", -1)
                row_count = rc if (rc is not None and rc >= 0) else 0
                return _ok({
                    "columns": [],
                    "rows": [],
                    "rowCount": row_count,
                    "command": _command_from_status(status),
                    "durationMs": duration,
                    "operation": operation,
                    "operationLabel": operation_label,
                    "notices": notices,
                })
    except Exception as exc:
        return _fail(exc)