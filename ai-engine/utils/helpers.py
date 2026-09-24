"""Small shared helpers used by the analyzers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable


def clamp(value: float, low: float = 0, high: float = 100) -> int:
    return int(max(low, min(high, round(value))))


def pct(part: float, total: float) -> int:
    return int(round((part / total) * 100)) if total else 0


def parse_date(value: Any):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def now() -> datetime:
    return datetime.now(timezone.utc)


def days_between(a: datetime, b: datetime) -> float:
    return (a - b).total_seconds() / 86400


def dedupe(items: Iterable[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


# ---------------------------------------------------------------------------
# Step 3 — shared "evidence" helper.
#
# Every Step 3 prediction/warning/observation should be traceable back to a
# concrete piece of project data. Rather than every analyzer inventing its
# own shape, they all build evidence rows through this one helper so the
# format stays consistent project-wide (see ai-engine STEP3 spec, "Evidence
# Model": source -> observation -> impact).
# ---------------------------------------------------------------------------
def make_evidence(source: str, source_id, observation: str, timestamp=None, impact: str = "neutral") -> dict:
    """Build one traceable evidence row.

    source:      short tag for where this came from, e.g. "task", "chat",
                 "file", "activity".
    source_id:   id of the underlying record (task id, message id, file id).
                 May be None when there isn't a single record to point at.
    observation: plain-language statement of what was actually observed
                 (OBSERVED, not predicted/recommended — see STEP3R).
    timestamp:   ISO string / datetime / None.
    impact:      "positive" | "negative" | "neutral" — whether this evidence
                 pushes the related prediction/score up, down, or is purely
                 informational.
    """
    if impact not in {"positive", "negative", "neutral"}:
        impact = "neutral"
    ts = timestamp
    if isinstance(ts, datetime):
        ts = ts.isoformat()
    return {
        "source": source,
        "sourceId": source_id,
        "observation": observation,
        "timestamp": ts,
        "impact": impact,
    }


def has_min_evidence(*groups: Iterable, minimum: int = 1) -> bool:
    """True when at least `minimum` total items exist across the given groups.

    Used everywhere Step 3 needs to decide between producing a real
    estimate and returning "insufficient_data" instead of guessing.
    """
    total = 0
    for group in groups:
        try:
            total += len(group)
        except TypeError:
            total += 1 if group else 0
    return total >= minimum
