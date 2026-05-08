-- Persist the provider key (anthropic/openai/mock) used to generate each plan.
-- Until now we've only stored the model name string and inferred the provider
-- from a prefix match, which is fragile across SDK versions / model renames.
ALTER TABLE lesson_plans ADD COLUMN provider_name TEXT;
