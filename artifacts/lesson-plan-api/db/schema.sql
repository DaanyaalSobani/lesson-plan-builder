-- Canonical schema for the lesson-plan-generator backend.
-- This file is the source of truth — db.py executes it via init_db().
-- Add follow-on changes as numbered files in db/migrations/, never by editing this file.

CREATE TABLE IF NOT EXISTS curriculum (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subject         TEXT NOT NULL,
    grade           TEXT NOT NULL,
    standard_code   TEXT NOT NULL UNIQUE,
    strand          TEXT,
    description     TEXT NOT NULL,
    source_version  TEXT,
    ingested_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_curriculum_subject_grade
    ON curriculum (subject, grade);

CREATE TABLE IF NOT EXISTS lesson_plans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subject          TEXT NOT NULL,
    grade            TEXT NOT NULL,
    teacher_request  TEXT NOT NULL,
    lesson_plan      TEXT NOT NULL,
    citations        TEXT,
    considered_standards TEXT,
    title            TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lesson_plans_created
    ON lesson_plans (created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
