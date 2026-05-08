"""
Lesson Plan Generator — FastAPI backend

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Environment variables:
    ANTHROPIC_API_KEY  (required) — your Anthropic API key
"""

import os
import re
import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import (
    init_db,
    is_empty,
    save_lesson_plan,
    list_lesson_plans,
    get_lesson_plan,
    delete_lesson_plan,
    update_lesson_plan_title,
    curriculum_summary,
    curriculum_totals,
    list_standards,
)
from ingest import load_from_json, ingest, SAMPLE_JSON
from retrieval import get_curriculum
from prompt_builder import build_prompt
from providers.base import LLMProvider

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Lesson Plan Generator", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_llm_provider: LLMProvider | None = None


def _create_provider() -> LLMProvider:
    """
    Factory that selects the concrete LLM provider from the PROVIDER env var.
    Defaults to 'anthropic'. To add a new provider, create providers/<name>_provider.py
    and add a branch here — no other file needs changing.
    """
    provider_name = os.getenv("PROVIDER", "anthropic").lower()
    if provider_name == "anthropic":
        from providers.anthropic_provider import AnthropicProvider
        return AnthropicProvider()
    raise ValueError(f"Unknown provider: {provider_name!r}. Set PROVIDER env var to a supported value.")


def get_llm_provider() -> LLMProvider:
    """Lazy-initialise the provider so the server starts even before the API key is set."""
    global _llm_provider
    if _llm_provider is None:
        _llm_provider = _create_provider()
    return _llm_provider


# Matches `[CODE]` markers where CODE looks like a standards code:
# starts with letters, then any mix of letters/digits/dots/dashes (must contain at
# least one digit). Captures both Common Core (`ELA.3.RL.1`) and Ontario
# (`MTH1W.B1.1`) style codes.
CITATION_MARKER_PATTERN = re.compile(r"\[([A-Z][A-Z0-9.\-]*\d[A-Z0-9.\-]*)\]")


@app.on_event("startup")
async def startup_event():
    init_db()
    if is_empty():
        log.info("Curriculum database is empty — loading sample data from sample_curriculum.json")
        records = load_from_json(SAMPLE_JSON)
        count = ingest(records)
        log.info(f"Loaded {count} curriculum standards.")
    else:
        log.info("Curriculum database already populated — skipping ingest.")


class GenerateRequest(BaseModel):
    subject: str
    grade: str
    teacher_request: str


class Citation(BaseModel):
    code: str
    description: str
    found_in_curriculum: bool


class GenerateResponse(BaseModel):
    id: int
    lesson_plan: str
    citations: list[Citation]


class LessonPlanSummary(BaseModel):
    id: int
    subject: str
    grade: str
    teacher_request: str
    title: str | None = None
    created_at: str


class LessonPlanDetail(LessonPlanSummary):
    lesson_plan: str
    citations: list[Citation] = []


class HistoryResponse(BaseModel):
    plans: list[LessonPlanSummary]


class UpdatePlanRequest(BaseModel):
    title: str | None = None


@app.get("/healthz")
async def health():
    return {"status": "ok"}


@app.post("/generate", response_model=GenerateResponse)
async def generate_lesson_plan(req: GenerateRequest):
    if not req.subject.strip() or not req.grade.strip() or not req.teacher_request.strip():
        raise HTTPException(status_code=422, detail="subject, grade, and teacher_request are required.")

    curriculum_rows = get_curriculum(req.subject, req.grade)
    if not curriculum_rows:
        log.warning(f"No curriculum rows found for subject={req.subject!r} grade={req.grade!r}")

    system_prompt, user_prompt = build_prompt(
        subject=req.subject,
        grade=req.grade,
        teacher_request=req.teacher_request,
        curriculum_rows=curriculum_rows,
    )

    try:
        provider = get_llm_provider()
    except EnvironmentError as e:
        raise HTTPException(status_code=503, detail=str(e))

    lesson_plan = provider.generate(system_prompt, user_prompt)

    citations = _validate_codes(lesson_plan, curriculum_rows)

    plan_id = save_lesson_plan(
        subject=req.subject,
        grade=req.grade,
        teacher_request=req.teacher_request,
        lesson_plan=lesson_plan,
        citations=[c.model_dump() for c in citations],
    )

    return GenerateResponse(id=plan_id, lesson_plan=lesson_plan, citations=citations)


@app.get("/history", response_model=HistoryResponse)
async def history(limit: int = 50):
    limit = max(1, min(limit, 200))
    rows = list_lesson_plans(limit=limit)
    summaries = [
        LessonPlanSummary(
            id=r["id"],
            subject=r["subject"],
            grade=r["grade"],
            teacher_request=r["teacher_request"],
            title=r.get("title"),
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return HistoryResponse(plans=summaries)


@app.get("/history/{plan_id}", response_model=LessonPlanDetail)
async def history_detail(plan_id: int):
    row = get_lesson_plan(plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lesson plan not found.")
    return LessonPlanDetail(**row)


@app.delete("/history/{plan_id}")
async def history_delete(plan_id: int):
    if not delete_lesson_plan(plan_id):
        raise HTTPException(status_code=404, detail="Lesson plan not found.")
    return {"status": "deleted", "id": plan_id}


@app.patch("/history/{plan_id}", response_model=LessonPlanDetail)
async def history_update(plan_id: int, req: UpdatePlanRequest):
    if req.title is not None and len(req.title) > 200:
        raise HTTPException(status_code=422, detail="Title must be 200 characters or fewer.")
    if not update_lesson_plan_title(plan_id, req.title):
        raise HTTPException(status_code=404, detail="Lesson plan not found.")
    row = get_lesson_plan(plan_id)
    if not row:
        raise HTTPException(status_code=404, detail="Lesson plan not found.")
    return LessonPlanDetail(**row)


class CurriculumBucket(BaseModel):
    subject: str
    grade: str
    count: int
    source_versions: list[str]
    last_ingested: str | None = None


class MissingCombination(BaseModel):
    subject: str
    grade: str


class CurriculumTotals(BaseModel):
    total_standards: int
    total_subjects: int
    total_grades: int
    total_strands: int
    last_ingested: str | None = None
    is_empty: bool
    status: str  # "green" | "amber" | "red"
    missing_combinations: list[MissingCombination] = []


class CurriculumSummaryResponse(BaseModel):
    buckets: list[CurriculumBucket]
    totals: CurriculumTotals


class CurriculumStandard(BaseModel):
    standard_code: str
    strand: str | None = None
    description: str
    source_version: str | None = None
    ingested_at: str | None = None


class CurriculumStandardsResponse(BaseModel):
    subject: str
    grade: str
    standards: list[CurriculumStandard]


@app.get("/curriculum/summary", response_model=CurriculumSummaryResponse)
async def curriculum_summary_endpoint():
    """Per-(subject, grade) breakdown plus overall totals — drives the
    Curriculum Library page and the data-driven dropdowns on the Generate form."""
    buckets = [CurriculumBucket(**b) for b in curriculum_summary()]
    totals_row = curriculum_totals()
    is_empty = totals_row["total_standards"] == 0

    # Compute cross-product gaps. The Generate dropdown only ever advertises
    # combinations present in `buckets`, but if one subject covers grades 3-5
    # while another only covers 3, that asymmetry is still worth surfacing as
    # an amber pipeline-health signal so admins know coverage is uneven.
    present = {(b.subject, b.grade) for b in buckets}
    all_subjects = sorted({b.subject for b in buckets})
    all_grades = sorted({b.grade for b in buckets})
    missing = [
        MissingCombination(subject=s, grade=g)
        for s in all_subjects
        for g in all_grades
        if (s, g) not in present
    ]

    if is_empty:
        status = "red"
    elif missing:
        status = "amber"
    else:
        status = "green"

    totals = CurriculumTotals(
        **totals_row,
        is_empty=is_empty,
        status=status,
        missing_combinations=missing,
    )
    return CurriculumSummaryResponse(buckets=buckets, totals=totals)


@app.get("/curriculum/standards", response_model=CurriculumStandardsResponse)
async def curriculum_standards_endpoint(subject: str, grade: str):
    """Every standard for a (subject, grade) — used to populate the
    expandable detail tables in the Curriculum Library."""
    if not subject.strip() or not grade.strip():
        raise HTTPException(status_code=422, detail="subject and grade are required.")
    rows = list_standards(subject, grade)
    return CurriculumStandardsResponse(
        subject=subject,
        grade=grade,
        standards=[CurriculumStandard(**r) for r in rows],
    )


def _validate_codes(response: str, curriculum_rows: list[dict]) -> list[Citation]:
    """
    Extract every `[CODE]` citation marker the LLM emitted, cross-reference
    against the retrieved curriculum, and return a structured list of
    Citation records (one per unique code, in the order they first appear
    in the response).

    A code with `found_in_curriculum=False` is a hallucination — the
    description will be empty and the frontend should warn the teacher.
    """
    by_code: dict[str, dict] = {row["standard_code"]: row for row in curriculum_rows}

    seen: set[str] = set()
    ordered_codes: list[str] = []
    for match in CITATION_MARKER_PATTERN.finditer(response):
        code = match.group(1)
        if code not in seen:
            seen.add(code)
            ordered_codes.append(code)

    citations: list[Citation] = []
    for code in ordered_codes:
        row = by_code.get(code)
        if row is not None:
            citations.append(
                Citation(
                    code=code,
                    description=row["description"],
                    found_in_curriculum=True,
                )
            )
        else:
            citations.append(
                Citation(
                    code=code,
                    description="",
                    found_in_curriculum=False,
                )
            )

    hallucinated = [c.code for c in citations if not c.found_in_curriculum]
    if hallucinated:
        log.warning(
            f"Output validation: LLM cited standard code(s) not in the retrieved set: {hallucinated}"
        )
    elif citations:
        log.info(f"Output validation: all {len(citations)} cited codes are from the retrieved curriculum set.")
    else:
        log.warning("Output validation: LLM emitted no [CODE] citation markers.")

    return citations
