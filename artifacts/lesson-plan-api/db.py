import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "curriculum.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the curriculum table if it doesn't exist."""
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
        conn.commit()


def is_empty() -> bool:
    """Return True if the curriculum table has no rows."""
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM curriculum").fetchone()
        return row["n"] == 0
