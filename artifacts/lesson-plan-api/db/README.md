# Database layout

The lesson-plan backend uses SQLite (`curriculum.db`, auto-created in
`artifacts/lesson-plan-api/`). Everything needed to rebuild that database
from source lives in this folder.

## Files

- `schema.sql` — canonical `CREATE TABLE` statements for `curriculum`,
  `lesson_plans`, and the `schema_migrations` tracking table. `db.py`'s
  `init_db()` executes this file at startup.
- `migrations/` — numbered SQL files for incremental schema changes. They run
  in lexical order and each is recorded in `schema_migrations` so they apply
  exactly once. Currently empty; add `0001_<name>.sql` etc. as the schema
  evolves.
- `seed_curriculum.sql` — auto-generated curriculum INSERTs derived from the
  PDFs in `../curriculum_pdfs/`. **Do not edit by hand**; regenerate with
  `python ingest.py --all-pdfs`.

## Rebuilding the database from source

```bash
cd artifacts/lesson-plan-api
python ingest.py --rebuild-db
```

That wipes the `curriculum` table, applies any pending migrations, and
re-executes `seed_curriculum.sql`. After the command finishes the curriculum
content matches what's in the seed file (and therefore what's in the source
PDFs).

**Saved lesson plans in `lesson_plans` are preserved by default** because
they're user-generated and not reproducible from source. To do a full reset
(delete the whole `curriculum.db` file, including saved plans), pass
`--wipe-lesson-plans`:

```bash
python ingest.py --rebuild-db --wipe-lesson-plans
```

## First-run behaviour

If `curriculum.db` is missing on backend startup, `init_db()` creates it from
`schema.sql` and then `apply_seed()` runs `seed_curriculum.sql`. No manual
steps required.
