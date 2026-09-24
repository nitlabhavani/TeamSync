"""Configuration for the TeamSync AI engine (env driven)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

try:  # optional
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


def _bool(name: str, default: bool) -> bool:
    return str(os.getenv(name, str(default))).lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("AI_ENGINE_HOST", "127.0.0.1")
    port: int = int(os.getenv("AI_ENGINE_PORT", "8000"))
    debug: bool = _bool("AI_ENGINE_DEBUG", True)
    api_key: str = os.getenv("AI_ENGINE_KEY", "")
    upload_dir: str = os.getenv("AI_ENGINE_UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "uploads"))
    allowed_origins: list[str] = field(
        default_factory=lambda: os.getenv("AI_ENGINE_ORIGINS", "*").split(",")
    )

    # Scoring weights
    weight_participation: float = 0.25
    weight_task_completion: float = 0.35
    weight_communication: float = 0.15
    weight_collaboration: float = 0.25

    # Deadline reminder schedule (days before due date)
    reminder_days: tuple = (5, 2, 1, 0)


settings = Settings()
