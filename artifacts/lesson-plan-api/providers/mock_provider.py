"""
Deterministic, offline LLM provider used for local development and tests.

Returns a syntactically complete lesson plan in the same nine-section format
described in ``prompts/lesson_plan.txt``, with every cited ``[CODE]`` taken
verbatim from the standards block in the user prompt. No network calls, no
API key required, sub-millisecond response time.

Enable by setting ``PROVIDER=mock`` in the environment.
"""

import re

from .base import LLMProvider


_STANDARD_LINE = re.compile(r"^\s*\[([^\]]+)\]\s*(.*)$", re.MULTILINE)
_TEACHER_REQUEST = re.compile(
    r"<teacher_request>\s*(.*?)\s*</teacher_request>", re.DOTALL
)
_SUBJECT_LINE = re.compile(r"^Subject:\s*(.+)$", re.MULTILINE)
_GRADE_LINE = re.compile(r"^Grade:\s*(.+)$", re.MULTILINE)


class MockProvider(LLMProvider):
    """Deterministic fake LLM. See module docstring."""

    def generate(self, system_prompt: str, user_prompt: str, **params) -> str:
        subject = _first_match(_SUBJECT_LINE, user_prompt, default="(unknown subject)")
        grade = _first_match(_GRADE_LINE, user_prompt, default="(unknown grade)")
        teacher_request = _first_match(
            _TEACHER_REQUEST, user_prompt, default="(no teacher request provided)"
        )
        standards = _parse_standards(user_prompt)

        return _render_plan(
            subject=subject,
            grade=grade,
            teacher_request=teacher_request,
            standards=standards,
        )


def _first_match(pattern: re.Pattern, text: str, *, default: str) -> str:
    m = pattern.search(text)
    return m.group(1).strip() if m else default


def _parse_standards(user_prompt: str) -> list[tuple[str, str]]:
    """Extract ``(code, description)`` tuples from the user prompt's standards block.

    The block, built by ``prompt_builder._format_standards``, looks like::

        Relevant curriculum standards:
          [MTH1W.B1.1] Strand B: research a number concept… (source: …)

    We only consume lines after the ``Relevant curriculum standards:`` header
    and stop at the next blank line so we do not accidentally pick up the
    ``[CODE]`` markers inside the citation-rules sentence below the block.
    """
    header = "Relevant curriculum standards:"
    idx = user_prompt.find(header)
    if idx == -1:
        return []
    after = user_prompt[idx + len(header):]
    block, _, _ = after.partition("\n\n")
    standards: list[tuple[str, str]] = []
    seen: set[str] = set()
    for match in _STANDARD_LINE.finditer(block):
        code = match.group(1).strip()
        rest = match.group(2).strip()
        # Drop the trailing "(source: …)" annotation if present.
        rest = re.sub(r"\s*\(source:[^)]*\)\s*$", "", rest).strip()
        if code and code not in seen:
            seen.add(code)
            standards.append((code, rest))
    return standards


def _cite(codes: list[str]) -> str:
    """Render a citation tail ``[A] [B]`` from a list of codes (possibly empty)."""
    return " ".join(f"[{c}]" for c in codes)


def _render_plan(
    *,
    subject: str,
    grade: str,
    teacher_request: str,
    standards: list[tuple[str, str]],
) -> str:
    """Render a deterministic nine-section lesson plan using real codes."""
    if not standards:
        # Still emit a valid-shaped plan so callers don't crash, just without
        # any citations. The validator will warn on zero citations.
        return _empty_plan(subject, grade, teacher_request)

    codes = [c for c, _ in standards]

    # Pick a stable, repeatable subset for each section. Wrap with modulo so
    # this works for buckets with very few standards too.
    def pick(start: int, count: int) -> list[str]:
        return [codes[(start + i) % len(codes)] for i in range(min(count, len(codes)))]

    objectives = pick(0, 3)
    warmup = pick(0, 1)
    direct = pick(1, 2)
    guided = pick(2, 2)
    independent = pick(3, 1)
    closure = pick(4, 1)
    assessments = pick(0, 2)

    standards_addressed_lines = [
        f"- `[{code}]` — addressed in objectives, guided practice, and assessment."
        for code in codes[:5]
    ]

    references_lines = [
        f"- `[{code}]` — {desc or '(no description provided)'}"
        for code, desc in standards[:8]
    ]

    return f"""1. **Lesson Title**
{subject} (Grade {grade}): A Standards-Aligned Sample Lesson (mock)

2. **Grade & Subject**
Grade {grade} {subject}

3. **Standards Addressed**
{chr(10).join(standards_addressed_lines)}

4. **Learning Objectives**
- Students will identify the key idea from today's focus standard. {_cite(objectives[:1])}
- Students will apply the concept to a guided example. {_cite(objectives[1:2])}
- Students will demonstrate understanding through an exit task. {_cite(objectives[2:3])}

5. **Materials Needed**
- Whiteboard or projector
- Student notebooks
- Printed exit-ticket slips

6. **Lesson Outline**
- **Warm-Up / Hook (5-10 min):** Pose a quick question tied to the teacher's request to surface prior knowledge. {_cite(warmup)}
- **Direct Instruction (10-15 min):** Walk through a worked example aligned to the focus standards. {_cite(direct[:1])}
  Model the reasoning step-by-step on the board. {_cite(direct[1:2])}
- **Guided Practice (10-15 min):** Students work in pairs on a structured problem set with teacher check-ins. {_cite(guided[:1])}
  Circulate and prompt students to articulate their reasoning. {_cite(guided[1:2])}
- **Independent Practice (10-15 min):** Each student completes a short task individually. {_cite(independent)}
- **Closure / Exit Ticket (5 min):** One short prompt that mirrors the lesson objective. {_cite(closure)}

7. **Assessment**
- Exit-ticket prompt graded for accuracy and reasoning. {_cite(assessments[:1])}
- Observation notes from guided practice circulation. {_cite(assessments[1:2])}

8. **Differentiation Notes**
- Support: provide a partially worked example and sentence stems.
- Extension: ask students to generate an additional example and explain their choice.

9. **References**
{chr(10).join(references_lines)}

---
_Teacher request received: {teacher_request[:200]}_
_(Generated by MockProvider — no LLM was called.)_
"""


def _empty_plan(subject: str, grade: str, teacher_request: str) -> str:
    return f"""1. **Lesson Title**
{subject} (Grade {grade}): Sample Lesson (mock, no standards available)

2. **Grade & Subject**
Grade {grade} {subject}

3. **Standards Addressed**
(No curriculum standards were retrieved for this subject and grade.)

4. **Learning Objectives**
- Students will engage with the topic described in the teacher request.

5. **Materials Needed**
- Whiteboard or projector
- Student notebooks

6. **Lesson Outline**
- **Warm-Up / Hook (5-10 min):** Quick discussion question.
- **Direct Instruction (10-15 min):** Brief explanation of the topic.
- **Guided Practice (10-15 min):** Pair activity.
- **Independent Practice (10-15 min):** Short individual task.
- **Closure / Exit Ticket (5 min):** One reflection question.

7. **Assessment**
- Exit-ticket response.

8. **Differentiation Notes**
- Support: sentence stems.
- Extension: open-ended follow-up question.

9. **References**
(None — no standards available for citation.)

---
_Teacher request received: {teacher_request[:200]}_
_(Generated by MockProvider — no LLM was called.)_
"""
