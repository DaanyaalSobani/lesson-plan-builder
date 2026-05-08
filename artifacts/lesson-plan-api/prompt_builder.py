import os


PROMPTS_DIR = os.path.join(os.path.dirname(__file__), "prompts")


def load_prompt(filename: str, **placeholders) -> str:
    """
    Load a prompt template from the prompts/ directory and fill in placeholders.

    Editing the .txt file takes effect immediately on the next request —
    no server restart required.
    """
    path = os.path.join(PROMPTS_DIR, filename)
    with open(path) as f:
        template = f.read()
    return template.format(**placeholders)


def build_prompt(
    subject: str,
    grade: str,
    teacher_request: str,
    curriculum_rows: list[dict],
) -> tuple[str, str]:
    """
    Assemble the final system and user prompt strings.

    Args:
        subject:          The selected subject (e.g. "Math").
        grade:            The selected grade level (e.g. "4").
        teacher_request:  The teacher's free-text request.
        curriculum_rows:  Rows returned by retrieval.get_curriculum().

    Returns:
        (system_prompt, user_prompt) tuple ready to pass to the LLM provider.
    """
    system_prompt = load_prompt("lesson_plan.txt", tone="professional and encouraging")

    standards_block = _format_standards(curriculum_rows)

    user_prompt = f"""\
Subject: {subject}
Grade: {grade}

Relevant curriculum standards:
{standards_block}

<teacher_request>
{teacher_request.strip()}
</teacher_request>

Please generate a complete lesson plan following the format described in your instructions."""

    return system_prompt, user_prompt


def _format_standards(rows: list[dict]) -> str:
    if not rows:
        return "(No curriculum standards found for this subject and grade.)"
    lines = []
    for r in rows:
        lines.append(
            f"  [{r['standard_code']}] {r['strand'] or ''}: {r['description']} "
            f"(source: {r['source_version'] or 'unknown'})"
        )
    return "\n".join(lines)
