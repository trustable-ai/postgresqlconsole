"""PostgreSQL Console health/status action.

Returns safe connection status information using psycopg v3.

Connection configuration is read from backend environment variables
(``POSTGRES_HOST``, ``POSTGRES_PORT``, ``POSTGRES_DB``, ``POSTGRES_USER``,
``POSTGRES_PASSWORD``, ``POSTGRES_SSLMODE``) with a fallback to the
platform-bound ``POSTGRES_URL``. No secrets are exposed to the frontend.

Response envelope::

    {"ok": True,  "data": {"connected": True, "database": "...",
                           "serverVersion": "...", "currentUser": "..."},
     "error": None}

On failure::

    {"ok": False, "data": None,
     "error": {"type": "OperationalError", "message": "..."}}
"""

import os
import re
from urllib.parse import urlparse, unquote, parse_qs

import psycopg
from psycopg import errors as pg_errors

# ---------------------------------------------------------------------------
# Configuration (mirrors query.py)
# ---------------------------------------------------------------------------

DEFAULT_STATEMENT_TIMEOUT_MS = 30000


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

        # Query cancellation (e.g. statement timeout) is a subclass of
        # OperationalError and may carry no SQLSTATE in some runtimes, so it
        # must be detected before the generic connection classification below.
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
    """Classify a connection-time OperationalError lacking SQLSTATE.

    Distinguishes a query/statement cancellation (which may arrive without a
    SQLSTATE in some runtimes) from genuine DNS/connectivity/auth failures.
    """
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
# Main
# ---------------------------------------------------------------------------

def _short_version(version):
    if not version:
        return None
    m = re.search(r"PostgreSQL\s+([\d.]+)", version)
    return ("PostgreSQL " + m.group(1)) if m else version[:64]


def main(args, ctx=None):
    try:
        with _connect(args) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT version(), current_database(), current_user, session_user, "
                "inet_server_addr(), inet_server_port()"
            )
            row = cur.fetchone() or (None, None, None, None, None, None)
        return _ok({
            "connected": True,
            "database": row[1],
            "serverVersion": _short_version(row[0]),
            "currentUser": row[2],
            "sessionUser": row[3],
            "serverAddr": str(row[4]) if row[4] is not None else None,
            "serverPort": row[5],
            "statementTimeoutMs": _statement_timeout_ms(),
        })
    except Exception as exc:
        return _fail(exc)