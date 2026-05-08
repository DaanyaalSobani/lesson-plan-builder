import sqlite3
import os
import json

DB_PATH = os.path.join(os.path.dirname(__file__), "curriculum.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the curriculum and lesson_plans tables if they don't exist."""
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS curriculum (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                subject         TEXT NOT NULL,
                grade           TEXT NOT NULL,
                standard_code   TEXT NOT NULL UNIQUE,
                strand          TEXT,
                description     TEXT NOT NULL,
                source_version  TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lesson_plans (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                subject          TEXT NOT NULL,
                grade            TEXT NOT NULL,
                teacher_request  TEXT NOT NULL,
                lesson_plan      TEXT NOT NULL,
                citations        TEXT,
                title            TEXT,
                created_at       TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        # Inline migrations: add columns if upgrading from an older schema.
        # Safe to run on every startup.
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(lesson_plans)").fetchall()}
        if "citations" not in cols:
            conn.execute("ALTER TABLE lesson_plans ADD COLUMN citations TEXT")
        if "title" not in cols:
            conn.execute("ALTER TABLE lesson_plans ADD COLUMN title TEXT")
        conn.commit()


def save_lesson_plan(
    subject: str,
    grade: str,
    teacher_request: str,
    lesson_plan: str,
    citations: list[dict] | None = None,
) -> int:
    """Insert a generated lesson plan and return its new id."""
    citations_json = json.dumps(citations) if citations is not None else None
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO lesson_plans (subject, grade, teacher_request, lesson_plan, citations)
            VALUES (?, ?, ?, ?, ?)
            """,
            (subject, grade, teacher_request, lesson_plan, citations_json),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_lesson_plans(limit: int = 50) -> list[dict]:
    """Return saved lesson plan summaries in reverse chronological order (newest first)."""
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
    """Return a single lesson plan by id, or None if not found.

    The `citations` field is decoded from JSON to a list of dicts (or [] if absent).
    """
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, subject, grade, teacher_request, lesson_plan, citations, title, created_at
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
        return result


def delete_lesson_plan(plan_id: int) -> bool:
    """Delete a lesson plan by id. Returns True if a row was removed."""
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM lesson_plans WHERE id = ?", (plan_id,))
        conn.commit()
        return cur.rowcount > 0


def update_lesson_plan_title(plan_id: int, title: str | None) -> bool:
    """Update the title of a lesson plan. Pass None or empty string to clear it. Returns True if the row exists."""
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
    """Return True if the curriculum table has no rows."""
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM curriculum").fetchone()
        return row["n"] == 0
