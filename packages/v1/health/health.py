"""PostgreSQL Console health/status action.

Returns safe connection status information using psycopg v3.

The connection is supplied by the generated wrapper as ``ctx.POSTGRESQL``,
built from the platform-bound ``EXT_POSTGRES_URL``. This module never reads
connection settings itself. No secrets are exposed to the frontend.

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


class ConfigurationError(Exception):
    """Raised when required connection settings are missing."""


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


def _short_version(version):
    if not version:
        return None
    m = re.search(r"PostgreSQL\s+([\d.]+)", version)
    return ("PostgreSQL " + m.group(1)) if m else version[:64]


def main(args, ctx=None):
    if ctx is None or getattr(ctx, "POSTGRESQL", None) is None:
        return _fail(ConfigurationError("Database not configured"))
    conn = ctx.POSTGRESQL
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = %d" % _statement_timeout_ms())
            cur.execute(
                "SELECT version(), current_database(), current_user, session_user, "
                "inet_server_addr(), inet_server_port()"
            )
            row = cur.fetchone() or (None, None, None, None, None, None)
        # Close the read transaction so the borrowed connection is not
        # left idle-in-transaction between invocations.
        conn.commit()
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
        _rollback(conn)
        return _fail(exc)