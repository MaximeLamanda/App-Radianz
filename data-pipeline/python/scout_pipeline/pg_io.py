from __future__ import annotations

import os
from pathlib import Path


def _read_env_file(dotenv_path: Path) -> dict[str, str]:
    if not dotenv_path.is_file():
        return {}
    out: dict[str, str] = {}
    for raw in dotenv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
            v = v[1:-1]
        out[k] = v
    return out


def resolve_database_url(repo_root: Path | None = None) -> str | None:
    keys = (
        "LOCAL_DATABASE_URL",
        "RADIANZ_DATABASE_URL",
        "Radianz_DATABASE_URL",
        "DATABASE_URL",
        "POSTGRES_URL",
    )
    for k in keys:
        v = os.getenv(k)
        if v and str(v).strip():
            return str(v).strip()
    root = repo_root or Path(__file__).resolve().parents[3]
    dot = _read_env_file(root / ".env.local")
    for k in keys:
        v2 = dot.get(k)
        if v2 and str(v2).strip():
            return str(v2).strip()
    return None


def apply_schema(conn, schema_sql_path: Path) -> None:
    raw = schema_sql_path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(raw)
    conn.commit()
