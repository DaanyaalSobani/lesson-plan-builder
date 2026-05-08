"""
Tests for the deterministic seed-SQL emitter and helpers in ingest.py.

These run without the curriculum PDF — they only exercise pure functions on
in-memory records. Run with:

    pytest artifacts/lesson-plan-api/tests -q
"""

import os
import tempfile

from ingest import _sort_key, _sql_escape, write_seed_sql


def test_sql_escape_doubles_single_quotes():
    assert _sql_escape("don't") == "don''t"
    assert _sql_escape("it's a 'quoted' phrase") == "it''s a ''quoted'' phrase"
    assert _sql_escape("plain") == "plain"


def test_sort_key_orders_strands_then_overall_then_specific():
    codes = ["B2.1", "AA1", "A1", "B2", "B1", "B10", "B2.10", "B2.2"]
    ordered = sorted(codes, key=_sort_key)
    # Strand letters sort lexicographically (so "A" before "AA"), then within a
    # strand the overall (B1, B2, B10) sort numerically, and the specifics
    # (B2.1, B2.2, B2.10) sort numerically alongside their parent.
    assert ordered == ["A1", "AA1", "B1", "B2", "B2.1", "B2.2", "B2.10", "B10"]


def test_write_seed_sql_emits_deterministic_inserts(tmp_path=None):
    records = [
        {
            "subject": "Math",
            "grade": "9",
            "standard_code": "MTH1W.B2",
            "strand": "Strand B: Number",
            "description": "Demonstrate an understanding of the development of numbers.",
            "source_version": "Ontario MTH1W 2021",
        },
        {
            "subject": "Math",
            "grade": "9",
            "standard_code": "MTH1W.A1",
            "strand": "Strand A — apostrophe's check",
            "description": "Apply the mathematical processes to develop a conceptual understanding.",
            "source_version": "Ontario MTH1W 2021",
        },
    ]

    with tempfile.NamedTemporaryFile("w+", suffix=".sql", delete=False) as fh:
        path = fh.name
    try:
        n = write_seed_sql(records, path=path)
        assert n == 2
        with open(path, encoding="utf-8") as fh:
            sql = fh.read()
    finally:
        os.unlink(path)

    # File starts with the AUTO-GENERATED banner that warns against hand-edits.
    assert "AUTO-GENERATED" in sql
    # Inserts use INSERT OR REPLACE so re-running the seed is idempotent.
    assert "INSERT OR REPLACE INTO curriculum" in sql
    # Both inserts present.
    assert "MTH1W.A1" in sql
    assert "MTH1W.B2" in sql
    # Single quotes inside strand text are doubled, not left raw.
    assert "apostrophe''s check" in sql
    # Determinism: a second emit produces byte-identical output.
    with tempfile.NamedTemporaryFile("w+", suffix=".sql", delete=False) as fh:
        path2 = fh.name
    try:
        write_seed_sql(records, path=path2)
        with open(path2, encoding="utf-8") as fh:
            sql2 = fh.read()
    finally:
        os.unlink(path2)
    assert sql == sql2
