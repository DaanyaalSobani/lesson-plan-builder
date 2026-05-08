# RAG & Embeddings in the Lesson Plan Generator

This is a plain-English explainer of how the lesson plan generator grounds its
output in real curriculum standards, and whether it uses RAG or embeddings.
It is meant for teachers, PMs, and any developer new to the project.

## Short answer

**No, this project does not use embeddings or a vector database today.** It
grounds the LLM's output using a much simpler approach: a SQL lookup against a
small SQLite curriculum table, the matching standards are pasted directly into
the Claude prompt, and the model's response is then validated to catch any
standard codes it tried to invent. That is still a form of Retrieval-Augmented
Generation — just without the embeddings layer most tutorials assume.

## How curriculum grounding actually works today

1. **Ingest.** A small JSON file (`sample_curriculum.json`) of real curriculum
   standards is loaded into a local SQLite table called `curriculum`. Each row
   has `subject`, `grade`, `standard_code`, `strand`, `description`, and
   `source_version`. PDF ingestion is wired up as a CLI flag but is not
   implemented yet (see "Current limitations").
2. **Retrieve (SQL, not embeddings).** When a teacher hits "Generate", the
   backend does a plain `SELECT … WHERE subject = ? AND grade = ?` against the
   curriculum table. There is no similarity search, no embeddings, no vector
   index — just an exact-match SQL filter on the two dropdown values.
3. **Assemble the prompt.** The retrieved rows are formatted into a bulleted
   "Relevant curriculum standards" block and pasted into the user prompt, along
   with the teacher's free-text request. The system prompt tells Claude it may
   only cite codes that appear verbatim in that block.
4. **Generate.** Claude returns a full lesson plan with `[CODE]` markers next
   to each objective, activity step, and assessment item.
5. **Validate.** The backend scans the response for every `[CODE]` marker and
   checks each one against the codes that were actually retrieved in step 2.
   Any code Claude invented is flagged with `found_in_curriculum: false` so the
   frontend can warn the teacher instead of silently shipping a hallucinated
   standard.

## Is this RAG?

Yes, in the broad sense. RAG just means "fetch some grounding facts, stuff
them into the prompt, then generate." That is exactly what happens here — the
retrieval step is a SQL query instead of a vector similarity search, but the
overall pattern (retrieve → augment → generate) is the same. People often use
"RAG" as a synonym for "embeddings + vector DB", but the embeddings part is an
implementation detail of the retrieval step, not a requirement.

## Do we need embeddings?

**Probably not yet.** SQL retrieval works well here because:

- The dataset is tiny (a handful of subjects × grades × a few dozen standards).
- The query is fully structured — the teacher picks subject and grade from
  dropdowns, so an exact-match filter returns the right slice every time.
- The standards within a (subject, grade) bucket are short enough that we can
  hand all of them to the model rather than trying to pick the "best" few.

Embeddings would start to pay off when any of these change:

- **The curriculum grows large.** If a single (subject, grade) bucket starts
  returning hundreds of standards, the prompt gets noisy and expensive, and
  ranking by semantic similarity to the teacher's request becomes worth it.
- **Queries become free-form.** If teachers start typing things like "find me
  standards about fractions and visual models across grades 3–5", a structured
  subject+grade filter is no longer sufficient and semantic search wins.
- **Messy PDF ingestion lands.** Real curriculum PDFs from school boards are
  rarely cleanly tagged by subject and grade. Once we ingest those, exact-match
  SQL filters will miss things, and embedding-based retrieval becomes a much
  better default.

A `TODO` comment in `artifacts/lesson-plan-api/retrieval.py` already calls this
out as the natural place to swap in semantic search when the time comes.

## Current limitations

- **PDF ingestion is a stub.** `ingest.py` accepts a `--pdf` flag, but the
  `parse_pdf()` function raises `NotImplementedError`. All real curriculum data
  has to come in through the JSON path for now.
- **Retrieval is exact-match on subject + grade only.** Nothing about the
  teacher's free-text request influences which standards are pulled — every
  standard for that (subject, grade) bucket is included, and Claude is trusted
  to pick the relevant ones.
- **No cross-grade or cross-subject retrieval.** A request that legitimately
  spans grades or subjects will only see one bucket's standards.

## Where to look in the code

- `artifacts/lesson-plan-api/retrieval.py` — the SQL "retriever". This is
  where embeddings would eventually slot in.
- `artifacts/lesson-plan-api/ingest.py` — loads `sample_curriculum.json` into
  the DB; contains the `parse_pdf()` stub for future PDF ingestion.
- `artifacts/lesson-plan-api/db.py` — SQLite schema for the `curriculum` and
  `lesson_plans` tables, plus query helpers.
- `artifacts/lesson-plan-api/prompt_builder.py` — formats the retrieved
  standards into the prompt block sent to Claude.
- `artifacts/lesson-plan-api/prompts/lesson_plan.txt` — system prompt with
  the citation rules that force Claude to only quote retrieved codes.
- `artifacts/lesson-plan-api/main.py` — wires it all together; the
  `_validate_codes()` function is the post-generation hallucination check.
- `artifacts/lesson-plan-api/requirements.txt` — note the absence of any
  embeddings or vector-DB dependency, by design.
