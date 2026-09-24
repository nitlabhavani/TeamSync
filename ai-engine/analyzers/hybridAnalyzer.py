"""
ML TRAINING STEP 5C/5F — Hybrid AI integration.
---------------------------------------------------------------------------
Combines EXISTING Step 3 (analyzers/performanceAnalyzer.py) evidence/
rule-based analysis with an OPTIONAL Random Forest ML signal. Does not
replace or modify Step 3 in any way — this module only calls it and adds a
clearly-separated ML layer alongside it.

Response shape (per student) — UNCHANGED since Step 5C:
  OBSERVED               -> Step 3 evidence (analyze_student_work output)
  RULE_BASED_PREDICTION  -> Step 3 prediction (predict_student_performance)
  ML_PREDICTION          -> Random Forest prediction, OR the literal string
                             "ML_NOT_APPLICABLE" when the caller's features
                             don't genuinely match either trained schema.
  HYBRID_RESULT          -> Step 3's result stays authoritative/primary.
                             The ML signal is attached alongside it, never
                             blended into a single number.

STEP 5F ADDITION: two independent RF models can now supply ML_PREDICTION,
tried in this order, with NO feature remapping/guessing between them:
  1. ml/teamsyncRfModelLoader.py -> ai-engine/models/student_performance_rf_synthetic_dev/
     Real TeamSync-shaped feature object (the 15 existing feature columns,
     e.g. taskCompletionRatio, meaningfulChatMessageCount, ...) passed
     DIRECTLY to this model, unmodified. Trained ONLY on synthetic
     development data (see backend/scripts/generateSyntheticTeamsyncDataset.js
     and ai-engine/models/student_performance_rf_synthetic_dev/metadata.json)
     — NOT real TeamSync users. Every prediction from this model is tagged
     modelSource="SYNTHETIC_DEVELOPMENT_DATA", isProductionModel=False, plus
     an explicit warning, so nothing downstream can mistake it for a
     production/real-user result.
  2. ml/rfModelLoader.py (UNCHANGED, Step 5B) -> ai-engine/models/student_performance_rf_uci_public/
     Existing UCI-schema fallback, exactly as before — untouched code path,
     untouched model file, untouched dataset.

`ml_features` is checked against the TeamSync schema first (since that's
what a real TeamSync caller will actually have), then the UCI schema. If it
matches neither schema completely and numerically, ML_PREDICTION is
"ML_NOT_APPLICABLE" — this module NEVER fills in missing/invalid values or
remaps one schema's fields onto the other.
"""
from __future__ import annotations

from analyzers.performanceAnalyzer import analyze_student_work, score_student, predict_student_performance
from ml.rfModelLoader import predict as uci_rf_predict, model_status as uci_rf_model_status
from ml.teamsyncRfModelLoader import (
    predict as teamsync_rf_predict,
    model_status as teamsync_rf_model_status,
    MODEL_SOURCE_LABEL as TEAMSYNC_MODEL_SOURCE_LABEL,
    IS_PRODUCTION_MODEL as TEAMSYNC_IS_PRODUCTION_MODEL,
    DEVELOPMENT_WARNING as TEAMSYNC_DEVELOPMENT_WARNING,
)

ML_NOT_APPLICABLE = "ML_NOT_APPLICABLE"


def _resolve_ml_prediction(ml_features: dict | None):
    """
    Tries the TeamSync synthetic-dev model first (real TeamSync-shaped
    features, passed through unmodified), then falls back to the UCI model
    (unchanged Step 5B behavior) for UCI-shaped test/demo features. Returns
    (ml_prediction_dict_or_None, ml_value_or_None, ml_reason_or_None).
    Never fabricates a value when neither schema matches.
    """
    ts_value, ts_reason = teamsync_rf_predict(ml_features)
    if ts_value is not None:
        return {
            "value": round(ts_value, 3),
            "scale": "TeamSync synthetic performance label, 1-5 (NOT a real-user prediction)",
            "modelSource": TEAMSYNC_MODEL_SOURCE_LABEL,
            "isProductionModel": TEAMSYNC_IS_PRODUCTION_MODEL,
            "warning": TEAMSYNC_DEVELOPMENT_WARNING,
        }, ts_value, None

    uci_value, uci_reason = uci_rf_predict(ml_features)
    if uci_value is not None:
        return {
            "value": round(uci_value, 3),
            "scale": "UCI G3 final grade, 0-20 (NOT a TeamSync collaboration score)",
            "modelSource": "UCI Student Performance dataset (see ML_TRAINING_STEP5A/5B docs) — not TeamSync-trained",
        }, uci_value, None

    # Neither schema matched — report both reasons so the caller can see why.
    combined_reason = f"TeamSync schema: {ts_reason}; UCI schema: {uci_reason}"
    return None, None, combined_reason


def build_hybrid_result(payload: dict, student_id: str, ml_features: dict | None = None) -> dict:
    """
    Step 3 (OBSERVED + RULE_BASED_PREDICTION) is computed exactly as it
    always was — this function does not alter analyze_student_work,
    score_student, or predict_student_performance in any way, and their
    output is returned unchanged under OBSERVED / RULE_BASED_PREDICTION.
    """
    work = analyze_student_work(payload, student_id)
    score = score_student(work)
    rule_prediction = predict_student_performance(work, score)

    resolved, ml_value, ml_reason = _resolve_ml_prediction(ml_features)
    ml_prediction = resolved if resolved is not None else ML_NOT_APPLICABLE
    ml_note = ml_reason if resolved is None else None

    return {
        "studentId": student_id,
        "OBSERVED": work,
        "RULE_BASED_PREDICTION": rule_prediction,
        "ML_PREDICTION": ml_prediction,
        "HYBRID_RESULT": {
            "primary": rule_prediction,
            "primarySource": "Step 3 rule/evidence-based analysis (authoritative)",
            "mlSignal": ml_prediction,
            "mlSignalApplicable": ml_value is not None,
            "mlSignalNote": ml_note,
            "combinationMethod": (
                "ML signal attached alongside the rule-based result, not numerically "
                "averaged or blended — Step 3 remains the authoritative primary result "
                "in every case."
                if ml_value is not None
                else "No ML signal available for this input — HYBRID_RESULT is the "
                     "Step 3 rule-based result alone."
            ),
        },
        "modelStatus": {
            "teamsyncSyntheticDev": teamsync_rf_model_status(),
            "uciPublic": uci_rf_model_status(),
        },
    }
