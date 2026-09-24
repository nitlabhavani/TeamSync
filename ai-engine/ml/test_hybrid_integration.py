"""
ML TRAINING STEP 5C — Focused tests for hybrid AI integration.

Covers:
  1. Step 3 (analyze_student_work / project-performance) still works unchanged.
  2. RF model loads (rfModelLoader.model_status).
  3. Valid UCI-schema prediction works (genuine feature dict -> real ML_PREDICTION).
  4. Incompatible / TeamSync-shaped input is safely rejected -> ML_NOT_APPLICABLE.
  5. No fake ML prediction is ever produced for mismatched or missing features.
  6. HYBRID_RESULT never forces a numeric average of RULE_BASED_PREDICTION and
     ML_PREDICTION.

Run: python ai-engine/ml/test_hybrid_integration.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `analyzers.*` / `ml.*` imports like app.py does

from analyzers.performanceAnalyzer import analyze_student_work, analyze_project_performance
from analyzers.hybridAnalyzer import build_hybrid_result, ML_NOT_APPLICABLE
from ml.rfModelLoader import model_status, predict as rf_predict


def sample_payload():
    return {
        "groupId": "g1",
        "members": [{"userId": "u1", "name": "Alice"}],
        "tasks": [
            {"id": "t1", "title": "Build login page", "assignee": "u1", "status": "done", "completedAt": "2026-08-01T00:00:00Z"},
            {"id": "t2", "title": "Write tests", "assignee": "u1", "status": "in_progress", "progress": 40},
        ],
        "files": [{"id": "f1", "filename": "login.zip", "uploadedBy": "u1", "taskId": "t1", "uploadedAt": "2026-08-01T00:00:00Z"}],
        "messages": [{"sender": "u1", "group": "g1", "text": "finished the login page, pushed the zip", "createdAt": "2026-08-01T00:00:00Z"}],
    }


def real_uci_feature_dict():
    """A genuine, complete UCI-schema feature dict (all 22 required columns,
    plausible real-range values) — used to test the ONE case where a real
    ML prediction should be produced."""
    return {
        "age": 17, "Medu": 3, "Fedu": 2, "traveltime": 1, "studytime": 2,
        "failures": 0, "famrel": 4, "freetime": 3, "goout": 3, "Dalc": 1,
        "Walc": 2, "health": 4, "absences": 4, "sex_M": 0, "address_U": 1,
        "schoolsup_yes": 0, "famsup_yes": 1, "paid_yes": 0, "activities_yes": 1,
        "higher_yes": 1, "internet_yes": 1, "romantic_yes": 0,
    }


def teamsync_shaped_feature_dict():
    """What a real TeamSync caller would actually have available — its own
    telemetry, not UCI survey fields. Must never be force-mapped."""
    return {
        "taskCompletionRatio": 0.8,
        "overdueTaskCount": 0,
        "meaningfulChatMessageCount": 5,
        "blockerMentionCount": 0,
    }


def main():
    passed = 0

    # ---- 1. Step 3 still works unchanged ----
    payload = sample_payload()
    work = analyze_student_work(payload, "u1")
    assert work["status"] == "ok", work
    assert len(work["completedWork"]) == 1
    assert len(work["evidence"]) >= 2  # file + task evidence at minimum
    proj = analyze_project_performance(payload)
    assert "studentAnalysis" in proj and len(proj["studentAnalysis"]) == 1
    print("ok - Step 3 (analyze_student_work / analyze_project_performance) still works unchanged")
    passed += 1

    # ---- 2. RF model loads ----
    status = model_status()
    assert status["available"] is True, status
    assert status["featureList"] and len(status["featureList"]) == 22
    print(f"ok - RF model loads (featureList has {len(status['featureList'])} columns, "
          f"datasetSource={status['datasetSource']!r})")
    passed += 1

    # ---- 3. Valid UCI-schema prediction works ----
    val, reason = rf_predict(real_uci_feature_dict())
    assert val is not None and reason is None, (val, reason)
    assert 0 <= val <= 20, val
    print(f"ok - valid UCI-schema prediction works (predicted G3={val:.2f})")
    passed += 1

    # ---- 4. Incompatible TeamSync input is safely rejected ----
    val2, reason2 = rf_predict(teamsync_shaped_feature_dict())
    assert val2 is None, "TeamSync-shaped features must NEVER produce a numeric ML prediction"
    assert "missing required UCI feature columns" in reason2, reason2
    print(f"ok - incompatible TeamSync input safely rejected ({reason2})")
    passed += 1

    # ---- 4b. Missing/None features also rejected, not defaulted ----
    val3, reason3 = rf_predict(None)
    assert val3 is None
    val4, reason4 = rf_predict({})
    assert val4 is None
    print("ok - missing/empty features rejected rather than defaulted to zero/mean")
    passed += 1

    # ---- 5. No fake ML prediction produced end-to-end via build_hybrid_result ----
    hybrid_no_features = build_hybrid_result(payload, "u1", ml_features=None)
    assert hybrid_no_features["ML_PREDICTION"] == ML_NOT_APPLICABLE, hybrid_no_features["ML_PREDICTION"]
    assert hybrid_no_features["HYBRID_RESULT"]["mlSignalApplicable"] is False

    hybrid_wrong_features = build_hybrid_result(payload, "u1", ml_features=teamsync_shaped_feature_dict())
    assert hybrid_wrong_features["ML_PREDICTION"] == ML_NOT_APPLICABLE
    assert hybrid_wrong_features["HYBRID_RESULT"]["mlSignalApplicable"] is False
    # Step 3's result must be present and unaffected by the ML miss
    assert hybrid_wrong_features["OBSERVED"]["status"] == "ok"
    assert hybrid_wrong_features["RULE_BASED_PREDICTION"]["status"] in ("ON_TRACK", "AT_RISK", "BEHIND")
    print("ok - no fake ML prediction produced for missing or TeamSync-shaped features; "
          "Step 3 result still returned in full")
    passed += 1

    # ---- 5b. Genuine UCI features DO produce a real ML_PREDICTION in the hybrid result ----
    hybrid_with_ml = build_hybrid_result(payload, "u1", ml_features=real_uci_feature_dict())
    assert hybrid_with_ml["ML_PREDICTION"] != ML_NOT_APPLICABLE
    assert isinstance(hybrid_with_ml["ML_PREDICTION"], dict)
    assert "UCI" in hybrid_with_ml["ML_PREDICTION"]["modelSource"]
    assert hybrid_with_ml["HYBRID_RESULT"]["mlSignalApplicable"] is True
    print("ok - genuine UCI-schema features produce a real ML_PREDICTION, clearly labeled as UCI-sourced")
    passed += 1

    # ---- 6. HYBRID_RESULT never forces a numeric average ----
    hr = hybrid_with_ml["HYBRID_RESULT"]
    # The two predictions must never be blended into one number: HYBRID_RESULT
    # exposes them as separate fields (primary / mlSignal), not a combined score.
    assert "value" not in hr or not isinstance(hr.get("value"), (int, float))
    assert set(hr.keys()) >= {"primary", "mlSignal", "mlSignalApplicable", "combinationMethod"}
    assert hr["primary"] == hybrid_with_ml["RULE_BASED_PREDICTION"]  # Step 3 stays primary/authoritative
    assert hr["mlSignal"] == hybrid_with_ml["ML_PREDICTION"]  # ML kept as a distinct, separate signal
    print("ok - HYBRID_RESULT keeps Step 3 as primary and ML as a separate signal, never numerically averaged")
    passed += 1

    print(f"\n{passed} passed, 0 failed")


if __name__ == "__main__":
    main()
