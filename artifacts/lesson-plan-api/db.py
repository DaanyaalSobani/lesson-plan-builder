import sqlite3
import os

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
                created_at       TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.commit()


def save_lesson_plan(subject: str, grade: str, teacher_request: str, lesson_plan: str) -> int:
    """Insert a generated lesson plan and return its new id."""
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO lesson_plans (subject, grade, teacher_request, lesson_plan)
            VALUES (?, ?, ?, ?)
            """,
            (subject, grade, teacher_request, lesson_plan),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_lesson_plans(limit: int = 50) -> list[dict]:
    """Return saved lesson plan summaries in reverse chronological order (newest first)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, subject, grade, teacher_request, created_at
            FROM lesson_plans
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_lesson_plan(plan_id: int) -> dict | None:
    """Return a single lesson plan by id, or None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, subject, grade, teacher_request, lesson_plan, created_at
            FROM lesson_plans
            WHERE id = ?
            """,
            (plan_id,),
        ).fetchone()
        return dict(row) if row else None


def is_empty() -> bool:
    """Return True if the curriculum table has no rows."""
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM curriculum").fetchone()
        return row["n"] == 0
