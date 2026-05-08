"""End-to-end tests for the offline MockProvider.

Boots the FastAPI app with ``PROVIDER=mock`` and exercises ``/generate``
without any network call or API key. Verifies that the mock:

- returns a non-empty plan with the expected nine-section structure,
- emits ``[CODE]`` markers that all resolve to real curriculum rows
  (``found_in_curriculum=True``),
- persists the plan and surfaces it via ``/history/{id}``,
- is deterministic for the same input.
"""

import importlib
import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("PROVIDER", "mock")
    # Ensure any cached provider singleton from a prior test is reset, then
    # reload main so _create_provider re-reads the env var.
    import main
    main._llm_provider = None  # type: ignore[attr-defined]
    importlib.reload(main)
    return TestClient(main.app)


def _post_generate(client: TestClient, **overrides):
    payload = {
        "subject": "Math",
        "grade": "9",
        "teacher_request": "A 50-minute lesson on solving one-variable linear equations.",
    }
    payload.update(overrides)
    return client.post("/generate", json=payload)


def test_generate_with_mock_provider_returns_valid_plan(client):
    resp = _post_generate(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["lesson_plan"].strip(), "lesson_plan should not be empty"
    # Nine-section format markers from prompts/lesson_plan.txt.
    for section in (
        "Lesson Title",
        "Learning Objectives",
        "Lesson Outline",
        "Assessment",
        "References",
    ):
        assert section in body["lesson_plan"], f"missing section: {section}"

    citations = body["citations"]
    assert citations, "mock should emit at least one [CODE] citation"
    assert all(c["found_in_curriculum"] for c in citations), (
        f"mock cited codes not in curriculum: "
        f"{[c['code'] for c in citations if not c['found_in_curriculum']]}"
    )

    considered = body["considered_standards"]
    assert considered, "considered_standards should be populated"
    assert any(c["cited"] for c in considered), (
        "at least one considered standard should be flagged as cited"
    )


def test_mock_plan_is_persisted_to_history(client):
    resp = _post_generate(client)
    plan_id = resp.json()["id"]

    detail = client.get(f"/history/{plan_id}")
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert detail_body["lesson_plan"] == resp.json()["lesson_plan"]
    assert detail_body["subject"] == "Math"
    assert detail_body["grade"] == "9"


def test_mock_provider_is_deterministic(client):
    a = _post_generate(client).json()["lesson_plan"]
    b = _post_generate(client).json()["lesson_plan"]
    assert a == b, "MockProvider should return identical output for identical input"


def test_parse_standards_ignores_literal_code_markers_below_block():
    """The citation-rules sentence under the standards block contains the
    literal token ``[CODE]``. The parser must stop at the blank line after
    the standards block so it never harvests that token as a real code."""
    from prompt_builder import build_prompt
    from providers.mock_provider import _parse_standards

    rows = [
        {
            "standard_code": "MTH1W.B1.1",
            "strand": "Strand B",
            "description": "Sample description.",
            "source_version": "Ontario MTH1W 2021",
        },
    ]
    _, user_prompt = build_prompt(
        subject="Math",
        grade="9",
        teacher_request="x",
        curriculum_rows=rows,
    )
    # Sanity: the literal `[CODE]` sentence really is in the prompt.
    assert "[CODE]" in user_prompt

    parsed = _parse_standards(user_prompt)
    codes = [c for c, _ in parsed]
    assert codes == ["MTH1W.B1.1"]
    assert "CODE" not in codes


def test_render_plan_with_single_standard_only_cites_that_standard():
    """With exactly one standard, every citation tail must use that code —
    making any accidental inclusion of stray tokens immediately observable."""
    from providers.mock_provider import _render_plan
    import re

    plan = _render_plan(
        subject="Math",
        grade="9",
        teacher_request="t",
        standards=[("MTH1W.B1.1", "desc")],
    )
    cited = set(re.findall(r"\[([A-Z][A-Z0-9.\-]*\d[A-Z0-9.\-]*)\]", plan))
    assert cited == {"MTH1W.B1.1"}, f"unexpected codes in rendered plan: {cited}"


def test_mock_provider_works_without_anthropic_key(monkeypatch):
    """A teacher running locally without ANTHROPIC_API_KEY should still get a plan."""
    monkeypatch.setenv("PROVIDER", "mock")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    import main
    main._llm_provider = None  # type: ignore[attr-defined]
    importlib.reload(main)
    c = TestClient(main.app)

    resp = _post_generate(c)
    assert resp.status_code == 200, resp.text
    assert resp.json()["citations"], "should still produce citations"
