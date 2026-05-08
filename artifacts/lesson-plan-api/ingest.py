"""
ingest.py — Populate the curriculum database.

Usage:
    python ingest.py                     # load from sample_curriculum.json
    python ingest.py --pdf path/to/file  # placeholder for future PDF parsing

The --pdf flag is accepted but PDF parsing is NOT yet implemented.
Wire up a real PDF parser (e.g. pypdf, pdfplumber) in the parse_pdf() stub
below when you're ready.
"""

import argparse
import json
import os
import sqlite3

from db import get_connection, init_db

SAMPLE_JSON = os.path.join(os.path.dirname(__file__), "sample_curriculum.json")


def parse_pdf(pdf_path: str) -> list[dict]:
    """
    Parse a curriculum PDF and return a list of standard dicts.

    Each dict should have the keys:
        subject, grade, standard_code, strand, description, source_version

    TODO: implement real PDF parsing here (e.g. pdfplumber + regex extraction).
    """
    raise NotImplementedError(
        f"PDF parsing not yet implemented. Got path: {pdf_path}\n"
        "Wire up a parser in the parse_pdf() function in ingest.py."
    )


def load_from_json(json_path: str) -> list[dict]:
    with open(json_path) as f:
        return json.load(f)


def ingest(records: list[dict]) -> int:
    """Insert records into the curriculum table, skipping duplicates. Returns count inserted."""
    inserted = 0
    with get_connection() as conn:
        for r in records:
            try:
                conn.execute(
                    """
                    INSERT INTO curriculum (subject, grade, standard_code, strand, description, source_version)
                    VALUES (:subject, :grade, :standard_code, :strand, :description, :source_version)
                    """,
                    r,
                )
                inserted += 1
            except sqlite3.IntegrityError:
                pass
        conn.commit()
    return inserted


def main():
    parser = argparse.ArgumentParser(description="Ingest curriculum data into the DB.")
    parser.add_argument("--pdf", metavar="PATH", help="Path to a curriculum PDF (not yet implemented)")
    args = parser.parse_args()

    init_db()

    if args.pdf:
        records = parse_pdf(args.pdf)
    else:
        records = load_from_json(SAMPLE_JSON)

    count = ingest(records)
    print(f"Ingested {count} new standards into the database.")


if __name__ == "__main__":
    main()
