"""
ML TRAINING STEP 5F — TeamSync (synthetic-dev) Random Forest model loader.
---------------------------------------------------------------------------
Loads the model trained in Step 5E
(ai-engine/models/student_performance_rf_synthetic_dev/) and exposes a
single guarded prediction function, mirroring the safety pattern of
ml/rfModelLoader.py (the UCI loader) exactly — but pointed at a DIFFERENT
model directory and a DIFFERENT (TeamSync, not UCI) feature schema.

This module is intentionally separate from ml/rfModelLoader.py:
  - ml/rfModelLoader.py       -> ai-engine/models/student_performance_rf_uci_public/
                                  (UCI schema, UNTOUCHED by this step)
  - ml/teamsyncRfModelLoader.py -> ai-engine/models/student_performance_rf_synthetic_dev/
                                  (TeamSync 15-feature schema, this step)

IMPORTANT — this model was trained ONLY on procedurally-generated synthetic
data (see backend/scripts/generateSyntheticTeamsyncDataset.js and
ML_TRAINING_STEP5E notes). It is a development/pipeline-validation artifact,
not a production model. Every prediction this module returns is tagged with:
  modelSource:       "SYNTHETIC_DEVELOPMENT_DATA"
  isProductionModel: False
  warning:           "RF model trained on synthetic development data;
                       replace with real TeamSync-trained model before
                       production use."
so nothing downstream can mistake this for a claim about real TeamSync users.

Like the UCI loader, this module does NOT train anything, does NOT touch
Step 3 files, and does NOT fabricate missing feature values. If the
caller's features don't genuinely match the trained 15-column TeamSync
schema (any column missing, or any value non-numeric/None/bool), predict()
returns None (caller maps that to ML_NOT_APPLICABLE).
"""
from __future__ import annotations

import json
import os
import threading

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models", "student_performance_rf_synthetic_dev")
MODEL_PATH = os.path.join(MODEL_DIR, "model.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "metadata.json")

MODEL_SOURCE_LABEL = "SYNTHETIC_DEVELOPMENT_DATA"
IS_PRODUCTION_MODEL = False
DEVELOPMENT_WARNING = (
    "RF model trained on synthetic development data; replace with real "
    "TeamSync-trained model before production use."
)

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
            _cache["load_error"] = f"failed to load TeamSync synthetic-dev Random Forest model: {exc}"


def model_status() -> dict:
    """Reports whether the model is available, without ever raising. Always
    includes the synthetic/development markers so any caller inspecting
    status alone still sees the non-production warning."""
    _load()
    return {
        "available": _cache["model"] is not None,
        "error": _cache["load_error"],
        "modelType": (_cache["metadata"] or {}).get("modelType"),
        "datasetSource": (_cache["metadata"] or {}).get("datasetSource"),
        "featureList": (_cache["metadata"] or {}).get("featureList"),
        "testR2": ((_cache["metadata"] or {}).get("evaluation") or {}).get("test", {}).get("r2")
            if _cache["metadata"] else None,
        "modelSource": MODEL_SOURCE_LABEL,
        "isProductionModel": IS_PRODUCTION_MODEL,
        "warning": DEVELOPMENT_WARNING,
    }


def schema_compatible(features: dict | None) -> tuple[bool, str]:
    """
    Checks whether `features` genuinely matches the trained model's 15-column
    TeamSync feature schema — every required column present and numeric
    (int/float, not bool, not None). Does NOT guess, rename, or fill in
    missing/invalid values: an incomplete or invalid match is reported as
    incompatible, never silently patched.
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
        return False, f"missing required TeamSync feature columns: {missing}"
    invalid = [
        c for c in required
        if features.get(c) is None or isinstance(features.get(c), bool) or not isinstance(features.get(c), (int, float))
    ]
    if invalid:
        return False, f"non-numeric or null values for required columns: {invalid}"
    return True, ""


def predict(features: dict | None):
    """
    Returns a float prediction (synthetic TeamSync performance label, 1-5
    scale) ONLY when `features` is a genuine, complete, numeric match for
    the trained 15-column TeamSync schema. Otherwise returns (None, reason)
    — the caller must surface this as ML_NOT_APPLICABLE, never substitute a
    guessed or default value.
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
