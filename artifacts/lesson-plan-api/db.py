import sqlite3
import os
import json
import datetime

HERE = os.path.dirname(__file__)
DB_PATH = os.path.join(HERE, "curriculum.db")
SCHEMA_PATH = os.path.join(HERE, "db", "schema.sql")
MIGRATIONS_DIR = os.path.join(HERE, "db", "migrations")
SEED_PATH = os.path.join(HERE, "db", "seed_curriculum.sql")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _run_sql_file(conn: sqlite3.Connection, path: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        sql = f.read()
    conn.executescript(sql)


def _apply_migrations(conn: sqlite3.Connection) -> list[str]:
    """Apply any *.sql files in db/migrations/ that haven't been recorded yet.

    Migrations run in lexical order inside a transaction each. The
    schema_migrations table tracks which filenames have already been applied.
    """
    if not os.path.isdir(MIGRATIONS_DIR):
        return []
    applied = {row["filename"] for row in conn.execute(
        "SELECT filename FROM schema_migrations"
    ).fetchall()}
    pending = sorted(
        f for f in os.listdir(MIGRATIONS_DIR)
        if f.endswith(".sql") and f not in applied
    )
    newly_applied: list[str] = []
    for fname in pending:
        path = os.path.join(MIGRATIONS_DIR, fname)
        with open(path, "r", encoding="utf-8") as fh:
            sql = fh.read()
        # executescript() is not atomic on its own — wrap each migration in an
        # explicit transaction so a partial failure rolls back cleanly.
        try:
            conn.executescript("BEGIN;\n" + sql + "\nCOMMIT;")
            conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES (?)",
                (fname,),
            )
            conn.commit()
            newly_applied.append(fname)
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.OperationalError:
                pass
            raise
    return newly_applied


def init_db() -> None:
    """Create tables from db/schema.sql, apply migrations, and (best-effort)
    backfill columns added before the migration runner existed."""
    with get_connection() as conn:
        _run_sql_file(conn, SCHEMA_PATH)
        # Best-effort inline backfills for DBs that pre-date the migration runner.
        # Safe to run on every startup; ALTER TABLE only fires if the column is missing.
        plan_cols = {row["name"] for row in conn.execute(
            "PRAGMA table_info(lesson_plans)"
        ).fetchall()}
        if "citations" not in plan_cols:
            conn.execute("ALTER TABLE lesson_plans ADD COLUMN citations TEXT")
        if "considered_standards" not in plan_cols:
            conn.execute("ALTER TABLE lesson_plans ADD COLUMN considered_standards TEXT")
        if "title" not in plan_cols:
            conn.execute("ALTER TABLE lesson_plans ADD COLUMN title TEXT")
        curr_cols = {row["name"] for row in conn.execute(
            "PRAGMA table_info(curriculum)"
        ).fetchall()}
        if "ingested_at" not in curr_cols:
            conn.execute("ALTER TABLE curriculum ADD COLUMN ingested_at TEXT")
            now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                "UPDATE curriculum SET ingested_at = ? WHERE ingested_at IS NULL",
                (now,),
            )
        conn.commit()
        _apply_migrations(conn)


def apply_seed() -> int:
    """Execute db/seed_curriculum.sql against the database. Returns the
    curriculum row count after seeding. No-op if the seed file is missing."""
    if not os.path.exists(SEED_PATH):
        return 0
    with get_connection() as conn:
        _run_sql_file(conn, SEED_PATH)
        row = conn.execute("SELECT COUNT(*) AS n FROM curriculum").fetchone()
        return int(row["n"])


def rebuild_from_source(*, wipe_lesson_plans: bool = False) -> dict:
    """Rebuild the curriculum table from schema.sql + migrations + seed.

    By default, **only the curriculum table is wiped** — saved lesson plans in
    ``lesson_plans`` are preserved because they're user-generated data, not
    reproducible from source. Pass ``wipe_lesson_plans=True`` to delete the
    entire database file (e.g. for a hard reset in dev).
    """
    if wipe_lesson_plans:
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)
        init_db()
    else:
        init_db()
        with get_connection() as conn:
            conn.execute("DELETE FROM curriculum")
            conn.commit()
    seeded = apply_seed()
    return {"db_path": DB_PATH, "curriculum_rows": seeded}


def save_lesson_plan(
    subject: str,
    grade: str,
    teacher_request: str,
    lesson_plan: str,
    citations: list[dict] | None = None,
    considered_standards: list[dict] | None = None,
) -> int:
    citations_json = json.dumps(citations) if citations is not None else None
    considered_json = (
        json.dumps(considered_standards) if considered_standards is not None else None
    )
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO lesson_plans (subject, grade, teacher_request, lesson_plan, citations, considered_standards)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (subject, grade, teacher_request, lesson_plan, citations_json, considered_json),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_lesson_plans(limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, subject, grade, teacher_request, title, created_at
            FROM lesson_plans
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_lesson_plan(plan_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, subject, grade, teacher_request, lesson_plan, citations,
                   considered_standards, title, created_at
            FROM lesson_plans
            WHERE id = ?
            """,
            (plan_id,),
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        raw = result.pop("citations", None)
        try:
            result["citations"] = json.loads(raw) if raw else []
        except (ValueError, TypeError):
            result["citations"] = []
        raw_considered = result.pop("considered_standards", None)
        try:
            result["considered_standards"] = (
                json.loads(raw_considered) if raw_considered else []
            )
        except (ValueError, TypeError):
            result["considered_standards"] = []
        return result


def delete_lesson_plan(plan_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM lesson_plans WHERE id = ?", (plan_id,))
        conn.commit()
        return cur.rowcount > 0


def update_lesson_plan_title(plan_id: int, title: str | None) -> bool:
    normalized = title.strip() if isinstance(title, str) else None
    if normalized == "":
        normalized = None
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE lesson_plans SET title = ? WHERE id = ?",
            (normalized, plan_id),
        )
        conn.commit()
        return cur.rowcount > 0


def is_empty() -> bool:
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM curriculum").fetchone()
        return row["n"] == 0


def curriculum_summary() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT subject,
                   grade,
                   COUNT(*) AS count,
                   GROUP_CONCAT(DISTINCT source_version) AS source_versions,
                   MAX(ingested_at) AS last_ingested
            FROM curriculum
            GROUP BY subject, grade
            ORDER BY subject, grade
            """
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            raw = d.pop("source_versions") or ""
            d["source_versions"] = sorted([v for v in raw.split(",") if v])
            result.append(d)
        return result


def curriculum_totals() -> dict:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS total_standards,
                   COUNT(DISTINCT subject) AS total_subjects,
                   COUNT(DISTINCT grade) AS total_grades,
                   COUNT(DISTINCT strand) AS total_strands,
                   MAX(ingested_at) AS last_ingested
            FROM curriculum
            """
        ).fetchone()
        return dict(row)


def list_standards(subject: str, grade: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT standard_code, strand, description, source_version, ingested_at
            FROM curriculum
            WHERE subject = ? AND grade = ?
            ORDER BY standard_code
            """,
            (subject, grade),
        ).fetchall()
        return [dict(r) for r in rows]
