from db import get_connection


def get_curriculum(subject: str, grade: str) -> list[dict]:
    """
    Retrieve all curriculum standards matching the given subject and grade.

    Args:
        subject: e.g. "Math", "ELA", "Science"
        grade:   e.g. "3", "4", "5"

    Returns:
        List of dicts with keys: standard_code, strand, description, source_version.

    # TODO: Replace this structured lookup with semantic / embedding-based search
    #       when higher-quality retrieval is needed. At that point, the subject+grade
    #       filter can be relaxed or removed, and results can be ranked by cosine
    #       similarity against an embedded version of the teacher_request.
    """
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT standard_code, strand, description, source_version
            FROM   curriculum
            WHERE  subject = ? AND grade = ?
            ORDER  BY standard_code
            """,
            (subject, grade),
        ).fetchall()
    return [dict(row) for row in rows]
