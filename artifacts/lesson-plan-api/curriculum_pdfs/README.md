# Curriculum PDFs

This folder is the source of truth for curriculum standards. Drop a PDF here,
run the ingest, commit both the PDF and the regenerated `db/seed_curriculum.sql`.

## Adding a new PDF

```bash
cp /path/to/your_curriculum.pdf curriculum_pdfs/
python ingest.py --all-pdfs --rebuild-db
```

Optional overrides if auto-detection misses:

```bash
python ingest.py --pdf curriculum_pdfs/foo.pdf --subject Science --grade 9 --source "Ontario SNC1W 2022"
```

## Supported PDF format

The shipped parser targets the **Ontario Grade 9 Mathematics (MTH1W) 2021**
layout. It expects:

- A title page with course name, grade, and course code
- Front matter (table of contents, introduction, principles, etc.) on the first
  ~30–60 pages — the parser skips these via `--front-matter-pages` (default 59
  for MTH1W)
- Standards organised under "Strand A" through "Strand F" (plus "Strand AA")
- Specific expectations whose code starts a line: `B3.4 Applications` then a
  description on the following line(s)
- Overall expectations formatted as `F1. Financial Decisions: <description>`
- A "Teacher supports / Examples / Instructional Tips" block after each
  expectation that the parser uses as a section terminator
- "Sample task" preview index lines (e.g. `B2.1 Sample task that highlights ...`)
  are skipped — the real definition appears later in the document and wins

To add a new curriculum that uses a different layout, add a parser function in
`ingest.py` and dispatch to it from `_parser_for(pdf_path)`.

## Output

Parsing emits SQL into `db/seed_curriculum.sql`, which is the checked-in
source of truth for what's loaded into `curriculum.db`. The seed file uses
`INSERT OR REPLACE` keyed on `standard_code`, sorted deterministically, so
re-running ingest produces a stable git diff.
