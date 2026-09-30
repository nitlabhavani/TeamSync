"""
ML TRAINING STEP 5F — Focused tests for TeamSync synthetic-dev RF hybrid
integration.

Covers:
  1. Step 3 (analyze_student_work) output is unaffected by ML integration.
  2. TeamSync synthetic-dev RF model loads (teamsyncRfModelLoader.model_status).
  3. Valid 15-feature TeamSync sample -> real numeric ML_PREDICTION, tagged
     modelSource=SYNTHETIC_DEVELOPMENT_DATA, isProductionModel=False, with
     the required development warning.
  4. Missing feature (14/15 present) -> ML_NOT_APPLICABLE, nothing fabricated.
  5. Invalid/null feature value -> ML_NOT_APPLICABLE, nothing fabricated.
  6. RULE_BASED_PREDICTION and ML_PREDICTION are never averaged; Step 3 stays
     HYBRID_RESULT.primary in every case.
  7. Existing UCI fallback path (Step 5B/5C) still works through the same
     build_hybrid_result() entrypoint, unaffected by the TeamSync addition.

Run: python ai-engine/ml/test_teamsync_hybrid_integration.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `analyzers.*` / `ml.*` imports like app.py does

from analyzers.performanceAnalyzer import analyze_student_work
from analyzers.hybridAnalyzer import build_hybrid_result, ML_NOT_APPLICABLE
from ml.teamsyncRfModelLoader import model_status as teamsync_model_status, predict as teamsync_predict


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


def valid_teamsync_feature_dict():
    """A genuine, complete 15-column TeamSync feature object — matches
    exactly what backend/src/services/mlFeatureService.js:computeStudentFeatures
    would produce for a real (or, here, synthetic-test) student."""
    return {
        "taskCompletionRatio": 0.75,
        "onTimeCompletionRate": 0.8,
        "overdueTaskCount": 1,
        "remainingTaskCount": 2,
        "inProgressTaskCount": 1,
        "estimatedEffortAssignedHours": 40.0,
        "completedEffortPlannedHours": 28.0,
        "deadlineProximityDays": 5,
        "relevantFileCount": 3,
        "meaningfulChatMessageCount": 12,
        "blockerMentionCount": 1,
        "progressUpdateMentionCount": 4,
        "activeChatDays": 9,
        "activityConsistency": 0.62,
        "totalTasksAssigned": 6,
    }


def missing_feature_dict():
    """Only 14 of the 15 required columns — 'totalTasksAssigned' omitted."""
    d = valid_teamsync_feature_dict()
    del d["totalTasksAssigned"]
    return d


def invalid_null_feature_dict():
    """All 15 columns present, but one value is None (invalid/null input)."""
    d = valid_teamsync_feature_dict()
    d["blockerMentionCount"] = None
    return d


def main():
    passed = 0

    # ---- 1. Step 3 output unaffected ----
    payload = sample_payload()
    work_direct = analyze_student_work(payload, "u1")
    assert work_direct["status"] == "ok", work_direct
    print("ok - Step 3 (analyze_student_work) works independent of ML integration")
    passed += 1

    # ---- 2. TeamSync synthetic-dev RF model loads ----
    status = teamsync_model_status()
    assert status["available"] is True, status
    assert status["featureList"] and len(status["featureList"]) == 15
    assert status["modelSource"] == "SYNTHETIC_DEVELOPMENT_DATA"
    assert status["isProductionModel"] is False
    assert "synthetic development data" in status["warning"]
    print(f"ok - TeamSync synthetic-dev RF model loads "
          f"(15-feature schema verified, datasetSource={status['datasetSource']!r})")
    passed += 1

    # ---- 2b. Direct loader-level prediction sanity check ----
    val, reason = teamsync_predict(valid_teamsync_feature_dict())
    assert val is not None and reason is None, (val, reason)
    assert isinstance(val, float)
    print(f"ok - direct teamsyncRfModelLoader.predict() returns numeric value ({val:.3f})")
    passed += 1

    # ---- 3. Valid 15-feature TeamSync sample -> real ML_PREDICTION via hybrid ----
    hybrid_valid = build_hybrid_result(payload, "u1", ml_features=valid_teamsync_feature_dict())
    ml_pred = hybrid_valid["ML_PREDICTION"]
    assert ml_pred != ML_NOT_APPLICABLE, ml_pred
    assert isinstance(ml_pred["value"], float)
    assert ml_pred["modelSource"] == "SYNTHETIC_DEVELOPMENT_DATA"
    assert ml_pred["isProductionModel"] is False
    assert "synthetic development data" in ml_pred["warning"]
    assert hybrid_valid["HYBRID_RESULT"]["mlSignalApplicable"] is True
    print(f"ok - valid 15-feature TeamSync sample -> numeric ML_PREDICTION "
          f"(value={ml_pred['value']}, modelSource={ml_pred['modelSource']}, "
          f"isProductionModel={ml_pred['isProductionModel']})")
    passed += 1

    # ---- 4. Missing feature -> ML_NOT_APPLICABLE ----
    hybrid_missing = build_hybrid_result(payload, "u1", ml_features=missing_feature_dict())
    assert hybrid_missing["ML_PREDICTION"] == ML_NOT_APPLICABLE
    assert hybrid_missing["HYBRID_RESULT"]["mlSignalApplicable"] is False
    assert "missing required TeamSync feature columns" in hybrid_missing["HYBRID_RESULT"]["mlSignalNote"]
    print("ok - missing feature (14/15 present) -> ML_NOT_APPLICABLE, nothing fabricated")
    passed += 1

    # ---- 5. Invalid/null feature -> ML_NOT_APPLICABLE ----
    hybrid_invalid = build_hybrid_result(payload, "u1", ml_features=invalid_null_feature_dict())
    assert hybrid_invalid["ML_PREDICTION"] == ML_NOT_APPLICABLE
    assert hybrid_invalid["HYBRID_RESULT"]["mlSignalApplicable"] is False
    assert "non-numeric or null values" in hybrid_invalid["HYBRID_RESULT"]["mlSignalNote"]
    print("ok - invalid/null feature value -> ML_NOT_APPLICABLE, nothing fabricated")
    passed += 1

    # ---- 6. Step 3 output unchanged by ML outcome; no averaging, ever ----
    for hr in (hybrid_valid, hybrid_missing, hybrid_invalid):
        assert hr["OBSERVED"]["status"] == "ok"
        assert hr["RULE_BASED_PREDICTION"]["status"] in ("ON_TRACK", "AT_RISK", "BEHIND")
        assert hr["HYBRID_RESULT"]["primary"] == hr["RULE_BASED_PREDICTION"]
        assert hr["HYBRID_RESULT"]["mlSignal"] == hr["ML_PREDICTION"]
        # No combined numeric field anywhere in HYBRID_RESULT.
        assert "value" not in hr["HYBRID_RESULT"] or not isinstance(hr["HYBRID_RESULT"].get("value"), (int, float))
    # Rule-based prediction is identical across all three ML scenarios (same
    # payload/student every time) -> proves ML outcome never touches it.
    assert hybrid_valid["RULE_BASED_PREDICTION"] == hybrid_missing["RULE_BASED_PREDICTION"] == hybrid_invalid["RULE_BASED_PREDICTION"]
    print("ok - RULE_BASED_PREDICTION identical across all ML scenarios; Step 3 stays "
          "HYBRID_RESULT.primary; RF prediction stays a separate mlSignal; no averaging")
    passed += 1

    # ---- 7. Existing UCI fallback path still reachable through build_hybrid_result ----
    uci_features = {
        "age": 17, "Medu": 3, "Fedu": 2, "traveltime": 1, "studytime": 2,
        "failures": 0, "famrel": 4, "freetime": 3, "goout": 3, "Dalc": 1,
        "Walc": 2, "health": 4, "absences": 4, "sex_M": 0, "address_U": 1,
        "schoolsup_yes": 0, "famsup_yes": 1, "paid_yes": 0, "activities_yes": 1,
        "higher_yes": 1, "internet_yes": 1, "romantic_yes": 0,
    }
    hybrid_uci = build_hybrid_result(payload, "u1", ml_features=uci_features)
    assert hybrid_uci["ML_PREDICTION"] != ML_NOT_APPLICABLE
    assert "UCI" in hybrid_uci["ML_PREDICTION"]["modelSource"]
    print("ok - existing UCI-schema fallback (Step 5B/5C) still works, unaffected by the TeamSync addition")
    passed += 1

    print(f"\n{passed} passed, 0 failed")


if __name__ == "__main__":
    main()
