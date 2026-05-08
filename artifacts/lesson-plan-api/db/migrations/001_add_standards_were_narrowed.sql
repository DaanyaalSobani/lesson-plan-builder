-- Track whether a saved plan was generated from a narrowed (teacher-picked)
-- subset of the available standards, vs the full bucket for that subject+grade.
ALTER TABLE lesson_plans ADD COLUMN standards_were_narrowed INTEGER NOT NULL DEFAULT 0;
