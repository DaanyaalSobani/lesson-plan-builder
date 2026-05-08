# Lesson Plan Generator

A teacher tool that generates standards-aligned lesson plans using AI. Teachers select a subject and grade, describe what they want to teach, and receive a fully structured lesson plan grounded in curriculum standards from a local SQLite database.

## Run & Operate

Both services start automatically when the repl is opened — no manual steps required:

- `Python Backend` workflow — FastAPI backend (port 8000); launched by the Run button via the `Project` composite workflow
- `artifacts/lesson-planner: web` workflow — React frontend (port 24954, preview at `/`); auto-started by the platform as a registered artifact workflow
- `artifacts/api-server: API Server` workflow — Node.js/Express API server (port 8080, path `/api`)
- Required env: `ANTHROPIC_API_KEY` — Anthropic Claude API key

To start both services manually from a shell: `bash start-dev.sh`

## Stack

- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui, react-hook-form + zod, TanStack Query
- **Backend:** Python FastAPI + Uvicorn, Anthropic SDK, SQLite
- **Monorepo:** pnpm workspaces, Node.js 24, TypeScript 5.9

## Where things live

- `artifacts/lesson-planner/` — React frontend
- `artifacts/lesson-plan-api/` — Python FastAPI backend
  - `main.py` — FastAPI app, startup hook, `/generate` endpoint
  - `db.py` — SQLite helpers; runs `db/schema.sql` + migrations + seed at startup
  - `db/schema.sql` — canonical CREATE TABLE statements (source of truth)
  - `db/migrations/` — incremental schema changes, tracked in `schema_migrations`
  - `db/seed_curriculum.sql` — auto-generated curriculum INSERTs
  - `ingest.py` — PDF parser + CLI (`--pdf`, `--all-pdfs`, `--rebuild-db`)
  - `curriculum_pdfs/` — drop new curriculum PDFs here, then re-ingest
  - `retrieval.py` — Curriculum lookup by subject + grade
  - `prompt_builder.py` — Assembles system + user prompts
  - `providers/base.py` — Abstract `LLMProvider` base class
  - `providers/anthropic_provider.py` — Anthropic Claude implementation
  - `prompts/lesson_plan.txt` — **Editable system prompt** (changes apply without restart)

## Reproducing the database

The database is rebuildable from source files:

```bash
cd artifacts/lesson-plan-api
python ingest.py --all-pdfs --rebuild-db
```

This wipes `curriculum.db`, runs `db/schema.sql` + migrations, re-parses every
PDF in `curriculum_pdfs/` into `db/seed_curriculum.sql`, and applies it. See
`db/README.md` and `curriculum_pdfs/README.md` for details.

## Architecture decisions

- LLM provider is abstracted behind `providers/base.py` — adding OpenAI requires only a new file
- System prompt lives in `prompts/lesson_plan.txt` and is loaded at request time (no restart needed)
- SQLite is used for the curriculum store — simple, file-based, no infrastructure needed
- The provider is lazy-loaded so the server starts cleanly even if `ANTHROPIC_API_KEY` is missing (returns a 503 at request time instead of crashing)
- Vite dev-server proxies `/lesson-api/*` → `http://localhost:8000/*` so the frontend and backend are served from the same origin in development

## Product

Teachers select **Subject** (ELA / Math / Science), **Grade Level** (3 / 4 / 5), and type a free-form request. The backend retrieves matching curriculum standards from SQLite, builds a structured prompt, calls Claude, validates the response for hallucinated standard codes, and returns a markdown lesson plan.

## User preferences

_Populate as you build._

## Gotchas

- Edit `prompts/lesson_plan.txt` to change the system prompt — no restart needed
- Run `python ingest.py` inside `artifacts/lesson-plan-api/` to re-seed the curriculum DB
- To add a new LLM provider, subclass `LLMProvider` in `providers/` and swap it in `main.py`
- `curriculum.db` is created at `artifacts/lesson-plan-api/curriculum.db` on first run

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Backend README: `artifacts/lesson-plan-api/README.md`
