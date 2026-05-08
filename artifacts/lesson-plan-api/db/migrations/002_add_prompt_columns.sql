-- Persist the exact prompts and provider parameters sent to the LLM, so the
-- frontend can show a teacher the full request payload that produced a plan
-- (useful for debugging hallucinated citations and prompt-engineering work).
ALTER TABLE lesson_plans ADD COLUMN system_prompt TEXT;
ALTER TABLE lesson_plans ADD COLUMN user_prompt TEXT;
ALTER TABLE lesson_plans ADD COLUMN provider_model TEXT;
ALTER TABLE lesson_plans ADD COLUMN provider_max_tokens INTEGER;
