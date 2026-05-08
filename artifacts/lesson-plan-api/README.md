# Lesson Plan Generator — Backend

A FastAPI backend that generates standards-aligned lesson plans using an LLM.

> For an explanation of how curriculum grounding works (and why this project does **not** use embeddings or a vector DB), see [`README-rag.md`](../../README-rag.md) at the repo root.

## Setup

```bash
cd artifacts/lesson-plan-api
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The server starts at `http://localhost:8000`.

On first start, `sample_curriculum.json` is automatically loaded into `curriculum.db` if the database is empty.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| POST | `/generate` | Generate a lesson plan |

### POST /generate

**Request body:**
```json
{
  "subject": "Math",
  "grade": "4",
  "teacher_request": "I want a lesson on multiplying fractions with visual models."
}
```

**Response:**
```json
{
  "lesson_plan": "..."
}
```

## Editing the system prompt

Open `prompts/lesson_plan.txt` and edit freely. Changes take effect on the next request — no restart needed.

The `{tone}` placeholder is filled in at request time. You can add more placeholders and pass them through `build_prompt()` in `prompt_builder.py`.

## Adding a new LLM provider

1. Create `providers/your_provider.py` subclassing `LLMProvider` from `providers/base.py`.
2. Implement the `generate(system_prompt, user_prompt, **params) -> str` method.
3. In `main.py`, replace `AnthropicProvider()` with `YourProvider()`.

## Ingest script

```bash
# Load from the sample JSON (default):
python ingest.py

# Future: load from a real curriculum PDF (not yet implemented):
python ingest.py --pdf path/to/curriculum.pdf
```

## Architecture

```
main.py               FastAPI app, startup hook, /generate endpoint
db.py                 SQLite setup (schema + helpers)
ingest.py             Populates the DB from JSON (or future PDF)
retrieval.py          Structured lookup of curriculum rows by subject + grade
prompt_builder.py     Assembles system + user prompt from template + retrieved data
providers/
  base.py             Abstract LLMProvider base class
  anthropic_provider.py  Anthropic Claude implementation
prompts/
  lesson_plan.txt     Editable system prompt template
sample_curriculum.json  Sample standards for ELA, Math, Science (grades 3-5)
curriculum.db         SQLite database (auto-created on first run)
```
