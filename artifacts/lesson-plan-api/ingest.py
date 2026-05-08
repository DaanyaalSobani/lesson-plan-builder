"""
ingest.py — Build the curriculum database from source-controlled SQL.

Workflows
---------
1. Drop a curriculum PDF into ``curriculum_pdfs/`` and parse it into the seed file:

       python ingest.py --pdf curriculum_pdfs/ontario_math_9_mth1w_2021.pdf

2. Re-parse every PDF in ``curriculum_pdfs/`` (clobbers the seed file):

       python ingest.py --all-pdfs

3. Wipe ``curriculum.db`` and rebuild it from ``db/schema.sql`` + migrations
   + ``db/seed_curriculum.sql``:

       python ingest.py --rebuild-db

The ``--pdf`` / ``--all-pdfs`` paths emit SQL into ``db/seed_curriculum.sql``
rather than writing to the live database. This keeps parsed standards
versioned in git so they're reviewable in pull requests.
"""

import argparse
import os
import re
import sys
from typing import Iterable

import pdfplumber

from db import (
    SEED_PATH,
    apply_seed,
    init_db,
    rebuild_from_source,
)

HERE = os.path.dirname(__file__)
PDF_DIR = os.path.join(HERE, "curriculum_pdfs")


# ---------------------------------------------------------------------------
# Ontario MTH1W parser
# ---------------------------------------------------------------------------

# Strand AA + A through F. Codes are like "B1", "B1.1", "AA1", "F1.4".
SPECIFIC_RE = re.compile(r"^([A-F]{1,2}\d+\.\d+)\s+(.+)$")
OVERALL_RE = re.compile(r"^([A-F]{1,2}\d+)\.\s+([^:]+):\s*(.+)$")

# Lines that mark the end of a standard's description block.
SECTION_END_PREFIXES = (
    "Teacher supports",
    "Examples",
    "Instructional Tips",
    "Teacher Prompts",
    "Sample Tasks",
    "Sample task",
    "Specific expectations",
    "Overall expectation",
    "Overall Expectation",
    "By the end of this course",
)

ONTARIO_STRAND_TITLES = {
    "AA": "Social-Emotional Learning Skills in Mathematics",
    "A": "Mathematical Thinking and Making Connections",
    "B": "Number",
    "C": "Algebra",
    "D": "Data",
    "E": "Geometry and Measurement",
    "F": "Financial Literacy",
}


def _strand_for(code: str) -> str:
    return "AA" if code.startswith("AA") else code[0]


def _is_section_end(line: str) -> bool:
    return any(line.startswith(p) for p in SECTION_END_PREFIXES)


def _is_page_number(line: str) -> bool:
    return bool(re.fullmatch(r"\d{1,3}", line))


def parse_ontario_pdf(
    pdf_path: str,
    *,
    subject: str = "Math",
    grade: str = "9",
    source_version: str = "Ontario MTH1W 2021",
    code_prefix: str = "MTH1W",
    front_matter_pages: int = 59,
) -> tuple[list[dict], dict]:
    """Parse the Ontario Grade 9 Mathematics (MTH1W) curriculum PDF.

    Returns ``(records, summary)`` where ``records`` is a list of standard
    dicts ready for seed-SQL emission and ``summary`` is per-strand counts
    and skipped-page info for logging.
    """
    records: dict[str, dict] = {}  # later occurrence wins (real defs come after sample-tasks index)
    pages_processed = 0

    with pdfplumber.open(pdf_path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_no = page_idx + 1
            if page_no < front_matter_pages + 1:
                continue
            pages_processed += 1
            text = page.extract_text() or ""
            lines = text.split("\n")
            i = 0
            while i < len(lines):
                line = lines[i].strip()
                m_spec = SPECIFIC_RE.match(line)
                m_over = OVERALL_RE.match(line) if not m_spec else None

                # Skip "B2.1 Sample task that highlights ..." index lines —
                # the real definition appears later in the document.
                if m_spec and "Sample task" in m_spec.group(2):
                    i += 1
                    continue

                if m_over:
                    code = m_over.group(1)
                    title = m_over.group(2).strip()
                    first = m_over.group(3).strip()
                    desc_parts = [first]
                    j = i + 1
                    while j < len(lines):
                        nxt = lines[j].strip()
                        if not nxt:
                            break
                        if _is_section_end(nxt):
                            break
                        if SPECIFIC_RE.match(nxt) or OVERALL_RE.match(nxt):
                            break
                        if _is_page_number(nxt):
                            j += 1
                            continue
                        desc_parts.append(nxt)
                        j += 1
                    records[code] = {
                        "code": code,
                        "kind": "overall",
                        "strand_part": title,
                        "description": " ".join(desc_parts).strip(),
                        "page": page_no,
                    }
                    i = j
                    continue

                if m_spec:
                    code = m_spec.group(1)
                    rest = m_spec.group(2).strip()
                    title = ""
                    desc_parts: list[str] = []
                    if len(rest) <= 60 and not rest.endswith(".") and rest[:1].isupper():
                        title = rest
                    else:
                        desc_parts.append(rest)
                    j = i + 1
                    while j < len(lines):
                        nxt = lines[j].strip()
                        if not nxt:
                            if desc_parts:
                                break
                            j += 1
                            continue
                        if _is_section_end(nxt):
                            break
                        if SPECIFIC_RE.match(nxt) or OVERALL_RE.match(nxt):
                            break
                        if _is_page_number(nxt):
                            j += 1
                            continue
                        desc_parts.append(nxt)
                        j += 1
                        if len(desc_parts) >= 8:
                            break
                    records[code] = {
                        "code": code,
                        "kind": "specific",
                        "strand_part": title,
                        "description": " ".join(desc_parts).strip(),
                        "page": page_no,
                    }
                    i = j
                    continue
                i += 1

    out: list[dict] = []
    for code in sorted(records, key=_sort_key):
        r = records[code]
        strand_letter = _strand_for(code)
        strand_label = f"Strand {strand_letter}: {ONTARIO_STRAND_TITLES.get(strand_letter, '')}".strip(": ").strip()
        if r["strand_part"]:
            strand = f"{strand_label} — {r['strand_part']}"
        else:
            strand = strand_label
        full_code = f"{code_prefix}.{code}" if code_prefix else code
        out.append({
            "subject": subject,
            "grade": grade,
            "standard_code": full_code,
            "strand": strand,
            "description": r["description"],
            "source_version": source_version,
        })

    # Summary
    by_strand: dict[str, int] = {}
    for r in out:
        s = r["standard_code"].split(".", 1)[1]
        by_strand[_strand_for(s)] = by_strand.get(_strand_for(s), 0) + 1
    summary = {
        "pages_total": len(pdf.pages) if False else pages_processed + front_matter_pages,
        "pages_skipped_front_matter": front_matter_pages,
        "pages_processed": pages_processed,
        "standards_extracted": len(out),
        "by_strand": by_strand,
    }
    return out, summary


def _sort_key(code: str) -> tuple:
    """Sort like AA1, A1, A1.1, B1, B1.1, ..., B10, B10.2."""
    m = re.match(r"^([A-Z]+)(\d+)(?:\.(\d+))?$", code)
    if not m:
        return (code,)
    letters, major, minor = m.group(1), int(m.group(2)), int(m.group(3) or 0)
    return (letters, major, minor)


# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------

SEED_HEADER = """\
-- AUTO-GENERATED by ingest.py from PDFs in curriculum_pdfs/.
-- Do not edit by hand. Run:  python ingest.py --all-pdfs
-- Then commit this file alongside the PDF source.
"""


def _sql_escape(s: str) -> str:
    return (s or "").replace("'", "''")


def _row_to_insert(r: dict) -> str:
    return (
        "INSERT OR REPLACE INTO curriculum "
        "(subject, grade, standard_code, strand, description, source_version, ingested_at) "
        "VALUES ("
        f"'{_sql_escape(r['subject'])}', "
        f"'{_sql_escape(r['grade'])}', "
        f"'{_sql_escape(r['standard_code'])}', "
        f"'{_sql_escape(r['strand'])}', "
        f"'{_sql_escape(r['description'])}', "
        f"'{_sql_escape(r['source_version'])}', "
        "datetime('now'));"
    )


def write_seed_sql(records: Iterable[dict], path: str = SEED_PATH) -> int:
    """Write a deterministic seed_curriculum.sql. Sorted by standard_code."""
    rows = sorted(records, key=lambda r: r["standard_code"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(SEED_HEADER)
        f.write("\n")
        for r in rows:
            f.write(_row_to_insert(r))
            f.write("\n")
    return len(rows)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parser_for(pdf_path: str):
    """Pick a parser based on the filename. Today we only ship the Ontario
    MTH1W parser; future PDFs would dispatch here."""
    name = os.path.basename(pdf_path).lower()
    if "ontario" in name and "mth1w" in name:
        return parse_ontario_pdf
    # Fallback to Ontario parser — it's permissive enough for similar layouts.
    return parse_ontario_pdf


def _parse_one(pdf_path: str, **overrides) -> list[dict]:
    parser = _parser_for(pdf_path)
    records, summary = parser(pdf_path, **overrides)
    print(
        f"  parsed {pdf_path}: {summary['standards_extracted']} standards "
        f"(skipped {summary['pages_skipped_front_matter']} front-matter pages, "
        f"by strand: {summary['by_strand']})"
    )
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", metavar="PATH", help="Parse a single PDF and write/merge seed SQL.")
    parser.add_argument("--all-pdfs", action="store_true", help=f"Parse every PDF in {PDF_DIR}/.")
    parser.add_argument("--rebuild-db", action="store_true", help="Wipe the curriculum table and rebuild from schema + seed (lesson_plans preserved).")
    parser.add_argument("--wipe-lesson-plans", action="store_true", help="With --rebuild-db, also delete saved lesson plans (full DB reset).")
    parser.add_argument("--subject", default=None, help="Override subject (default: auto from parser).")
    parser.add_argument("--grade", default=None, help="Override grade (default: auto from parser).")
    parser.add_argument("--source", default=None, help="Override source_version (default: auto from parser).")
    parser.add_argument("--code-prefix", default=None, help="Override standard_code prefix, e.g. MTH1W (default: auto from parser).")
    args = parser.parse_args()

    if not (args.pdf or args.all_pdfs or args.rebuild_db):
        parser.print_help()
        sys.exit(1)

    overrides = {}
    if args.subject:
        overrides["subject"] = args.subject
    if args.grade:
        overrides["grade"] = args.grade
    if args.source:
        overrides["source_version"] = args.source
    if args.code_prefix is not None:
        overrides["code_prefix"] = args.code_prefix

    if args.pdf or args.all_pdfs:
        all_records: list[dict] = []
        if args.pdf:
            all_records.extend(_parse_one(args.pdf, **overrides))
        if args.all_pdfs:
            if not os.path.isdir(PDF_DIR):
                print(f"No PDF directory at {PDF_DIR}", file=sys.stderr)
                sys.exit(1)
            for fname in sorted(os.listdir(PDF_DIR)):
                if fname.lower().endswith(".pdf"):
                    all_records.extend(_parse_one(os.path.join(PDF_DIR, fname), **overrides))
        # De-dup by standard_code, last-wins (matches in-DB INSERT OR REPLACE semantics).
        deduped: dict[str, dict] = {}
        for r in all_records:
            deduped[r["standard_code"]] = r
        n = write_seed_sql(deduped.values())
        print(f"Wrote {n} standards to {SEED_PATH}")

    if args.rebuild_db:
        result = rebuild_from_source(wipe_lesson_plans=args.wipe_lesson_plans)
        scope = "full DB (incl. lesson_plans)" if args.wipe_lesson_plans else "curriculum table only"
        print(
            f"Rebuilt {scope} at {result['db_path']} from schema + seed: "
            f"{result['curriculum_rows']} curriculum rows."
        )
    elif args.pdf or args.all_pdfs:
        # If user only re-parsed, also seed the existing DB so changes show up immediately.
        init_db()
        n = apply_seed()
        print(f"Applied seed to {os.path.basename(SEED_PATH)}: curriculum now has {n} rows.")


if __name__ == "__main__":
    main()
