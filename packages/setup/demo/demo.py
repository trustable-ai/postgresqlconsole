"""Setup: create the safe demo table for the PostgreSQL Console examples.

Creates ``pg_console_demo`` (IF NOT EXISTS) in the user's default schema and
seeds a few rows idempotently (ON CONFLICT DO NOTHING). Never drops or deletes
existing objects.

Run via: ops ide setup
"""

import os
from urllib.parse import urlparse, unquote, parse_qs

import psycopg
from psycopg.rows import dict_row

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


def _connect(args):
    kwargs = _conn_kwargs(args)
    if not (kwargs.get("host") or kwargs.get("dbname")) and not kwargs.get("user"):
        raise RuntimeError("PostgreSQL connection not configured")
    kwargs["options"] = "-c statement_timeout=%d" % _statement_timeout_ms()
    return psycopg.connect(**kwargs)


_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS pg_console_demo (
    id       integer PRIMARY KEY,
    name     text NOT NULL,
    email    text,
    balance  numeric(10,2) DEFAULT 0,
    created_at timestamptz DEFAULT now()
);
"""

_SEED_SQL = """
INSERT INTO pg_console_demo (id, name, email, balance) VALUES
    (1, 'Alice', 'alice@example.com', 100.00),
    (2, 'Bob',   'bob@example.com',   50.00),
    (3, 'Carol', 'carol@example.com', 250.00)
ON CONFLICT (id) DO NOTHING;
"""

_SCHEMA_SQL = "SELECT current_schema() AS schema, count(*)::int AS rows FROM pg_console_demo;"


def main(args, ctx=None):
    try:
        with _connect(args) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(_CREATE_SQL)
                cur.execute(_SEED_SQL)
                seeded = cur.rowcount if (cur.rowcount is not None and cur.rowcount >= 0) else 0
                cur.execute(_SCHEMA_SQL)
                row = cur.fetchone() or {}
            conn.commit()
            return {
                "ok": True,
                "data": {
                    "table": "pg_console_demo",
                    "schema": row.get("schema"),
                    "seededRows": seeded,
                    "currentRows": row.get("rows"),
                },
                "error": None,
            }
    except Exception as exc:
        return {"ok": False, "data": None, "error": {"type": type(exc).__name__, "message": str(exc)}}