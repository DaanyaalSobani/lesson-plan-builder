"""
Smoke tests for the Ontario MTH1W PDF parser.

These pin the parser's output for the curriculum PDF that ships in
``curriculum_pdfs/``. They are intentionally light: enough to catch a silent
regression (e.g. a parser change that drops a strand or returns an empty
description), without re-asserting every standard's exact wording.

Run with:

    pytest artifacts/lesson-plan-api/tests -q

Drop another PDF into ``curriculum_pdfs/`` and add a new test file here that
calls ``parse_ontario_pdf(other_pdf, code_prefix="...", grade="...")`` to
extend coverage.
"""

import os

import pytest

from ingest import parse_ontario_pdf

PDF = os.path.join(
    os.path.dirname(__file__),
    "..",
    "curriculum_pdfs",
    "ontario_math_9_mth1w_2021.pdf",
)


@pytest.fixture(scope="module")
def parsed():
    if not os.path.exists(PDF):
        pytest.skip(f"Curriculum PDF not present at {PDF}")
    records, summary = parse_ontario_pdf(PDF)
    return records, summary


def test_extracts_expected_total_standards(parsed):
    records, summary = parsed
    # If the parser regresses (e.g. front-matter offset off by one, or a
    # section-end keyword change swallows real lines), this count will move.
    assert len(records) == 57
    assert summary["standards_extracted"] == 57


def test_every_strand_present(parsed):
    _records, summary = parsed
    by_strand = summary["by_strand"]
    # AA = social-emotional, A = math thinking, B-F = the five content strands.
    for strand in ("AA", "A", "B", "C", "D", "E", "F"):
        assert by_strand.get(strand, 0) > 0, f"Strand {strand} missing from parse output"


def test_codes_are_well_formed_and_unique(parsed):
    records, _summary = parsed
    codes = [r["standard_code"] for r in records]
    assert len(codes) == len(set(codes)), "Duplicate standard_code in parse output"
    for code in codes:
        # Format: MTH1W.<strand><n>[.<n>] — e.g. MTH1W.B1, MTH1W.B2.1, MTH1W.AA1.
        assert code.startswith("MTH1W."), f"Unexpected code prefix: {code}"
        suffix = code.split(".", 1)[1]
        assert suffix[0].isalpha(), f"Strand letter missing in {code}"


def test_descriptions_are_non_empty(parsed):
    records, _summary = parsed
    blank = [r["standard_code"] for r in records if not r["description"].strip()]
    assert blank == [], f"Standards with empty descriptions: {blank}"


def test_known_standards_have_expected_content(parsed):
    """Spot-check a handful of well-known MTH1W codes.

    We assert keyword presence rather than exact strings so small wording
    tweaks (e.g. the parser joining a hyphenated line) don't break the test.
    """
    records, _summary = parsed
    by_code = {r["standard_code"]: r for r in records}

    expectations = {
        # Coding (algebra strand)
        "MTH1W.C2": ["coding"],
        # Powers (number strand specific)
        "MTH1W.B2.1": ["power"],
        # Financial literacy overall
        "MTH1W.F1": ["financial"],
    }
    for code, keywords in expectations.items():
        assert code in by_code, f"Expected standard {code} not found"
        text = by_code[code]["description"].lower()
        for kw in keywords:
            assert kw in text, f"Expected keyword {kw!r} in description of {code}; got: {text!r}"


def test_subject_grade_source_are_set(parsed):
    records, _summary = parsed
    for r in records:
        assert r["subject"] == "Math"
        assert r["grade"] == "9"
        assert r["source_version"] == "Ontario MTH1W 2021"
        assert r["strand"], f"Empty strand on {r['standard_code']}"
