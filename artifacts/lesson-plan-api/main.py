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

from db import init_db, is_empty
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

STANDARD_CODE_PATTERN = re.compile(r"\b[A-Z]{2,6}\.\d+\.[A-Z0-9]+\.\d+\b")


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


class GenerateResponse(BaseModel):
    lesson_plan: str


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

    _validate_codes(lesson_plan, curriculum_rows)

    return GenerateResponse(lesson_plan=lesson_plan)


def _validate_codes(response: str, curriculum_rows: list[dict]) -> None:
    """
    Check the LLM response for hallucinated curriculum codes.
    Logs any codes that appear in the response but were NOT in the retrieved set.
    Does NOT block or modify the response.
    """
    retrieved_codes = {row["standard_code"] for row in curriculum_rows}
    mentioned_codes = set(STANDARD_CODE_PATTERN.findall(response))
    hallucinated = mentioned_codes - retrieved_codes
    if hallucinated:
        log.warning(
            f"Output validation: LLM cited standard code(s) not in the retrieved set: "
            f"{sorted(hallucinated)}"
        )
    else:
        log.info("Output validation: all cited codes are from the retrieved curriculum set.")
