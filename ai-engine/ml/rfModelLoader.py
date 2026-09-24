"""
ML TRAINING STEP 5C — Random Forest model loader (safe, read-only).
---------------------------------------------------------------------------
Loads the model trained in Step 5B (ai-engine/models/student_performance_rf_uci_public/)
and exposes a single guarded prediction function.

This module does NOT train anything, does NOT touch Step 3/4 files, and
does NOT invent a correspondence between TeamSync's real evidence fields
and the UCI schema this model was actually trained on. If the caller's
features don't genuinely match the trained schema, predict() returns None
(caller maps that to ML_NOT_APPLICABLE) rather than guessing or defaulting
missing values to 0/mean, which would silently fabricate a prediction.
"""
from __future__ import annotations

import json
import os
import threading

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "student_performance_rf_uci_public")
MODEL_PATH = os.path.join(MODEL_DIR, "model.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "metadata.json")

_lock = threading.Lock()
_cache = {"model": None, "metadata": None, "load_error": None, "attempted": False}


def _load():
    """Loads model + metadata once, caching the result (and any error) for reuse.
    Never raises to the caller — failures are reported via load_error."""
    with _lock:
        if _cache["attempted"]:
            return
        _cache["attempted"] = True
        try:
            if not os.path.exists(MODEL_PATH) or not os.path.exists(METADATA_PATH):
                _cache["load_error"] = f"model or metadata file not found under {MODEL_DIR}"
                return
            with open(METADATA_PATH, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            import joblib  # local import so a missing dependency only breaks ML, not Step 3
            model = joblib.load(MODEL_PATH)
            _cache["model"] = model
            _cache["metadata"] = metadata
        except Exception as exc:  # pragma: no cover - defensive
            _cache["load_error"] = f"failed to load Random Forest model: {exc}"


def model_status() -> dict:
    """Reports whether the model is available, without ever raising."""
    _load()
    return {
        "available": _cache["model"] is not None,
        "error": _cache["load_error"],
        "modelType": (_cache["metadata"] or {}).get("modelType"),
        "datasetSource": (_cache["metadata"] or {}).get("datasetSource"),
        "datasetScopeNote": (_cache["metadata"] or {}).get("datasetScopeNote"),
        "featureList": (_cache["metadata"] or {}).get("featureList"),
        "testR2": ((_cache["metadata"] or {}).get("evaluation") or {}).get("test", {}).get("r2")
            if _cache["metadata"] else None,
    }


def schema_compatible(features: dict | None) -> tuple[bool, str]:
    """
    Checks whether `features` genuinely matches the trained model's UCI feature
    schema — every required column present and numeric. Does NOT try to guess,
    rename, or remap TeamSync-style keys onto UCI columns: absence of a real
    match is reported as incompatible, never silently patched.
    """
    _load()
    if _cache["model"] is None:
        return False, _cache["load_error"] or "model not loaded"
    if not isinstance(features, dict):
        return False, "no feature dict supplied"
    required = (_cache["metadata"] or {}).get("featureList") or []
    if not required:
        return False, "model metadata has no featureList"
    missing = [c for c in required if c not in features]
    if missing:
        return False, f"missing required UCI feature columns: {missing}"
    non_numeric = [c for c in required if not isinstance(features.get(c), (int, float)) or isinstance(features.get(c), bool)]
    if non_numeric:
        return False, f"non-numeric values for required columns: {non_numeric}"
    return True, ""


def predict(features: dict | None):
    """
    Returns a float prediction (UCI G3 scale, 0-20) ONLY when `features` is a
    genuine, complete, numeric match for the trained schema. Otherwise returns
    (None, reason) — the caller must surface this as ML_NOT_APPLICABLE, never
    substitute a guessed or default value.
    """
    ok, reason = schema_compatible(features)
    if not ok:
        return None, reason
    model = _cache["model"]
    required = (_cache["metadata"] or {}).get("featureList")
    row = [[features[c] for c in required]]
    try:
        pred = model.predict(row)[0]
        return float(pred), None
    except Exception as exc:  # pragma: no cover - defensive
        return None, f"prediction failed: {exc}"
