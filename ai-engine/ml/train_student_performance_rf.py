"""
ML TRAINING STEP 4 — Random Forest: STUDENT PERFORMANCE / RISK PREDICTION
--------------------------------------------------------------------------
Loads the dataset produced by Step 3
(backend/data/ml/student_performance_dataset.json — real MongoDB data
only, never seed/fixture data) and trains a RandomForest on the
pre-computed train split, evaluating on the pre-computed val/test splits
from that same pipeline (no re-splitting here, no leakage between splits).

This script is READ-ONLY with respect to the rest of the project: it does
not modify ai-engine/analyzers/*, does not touch the Flask app, and does
not create a second AI engine. It only adds a new, separate ai-engine/ml/
module plus a new ai-engine/models/ directory for persisted artifacts,
since no model-storage convention existed before this (Step 3 confirmed
the engine itself is stateless and persists nothing).

HARD STOP CONDITIONS (checked before any model is fit — this script must
never train on too little data or on missing/invalid input):
  - dataset file does not exist
  - training split is empty or below MIN_TRAIN_SAMPLES
  - validation or test split is empty
  - fewer than MIN_LABEL_VARIANCE distinct label values in the training
    split (a model can't learn anything from a constant target)
On any of these, the script prints
"RANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA", writes NO
model file, and exits non-zero.

USAGE
    cd ai-engine
    python ml/train_student_performance_rf.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

MIN_TRAIN_SAMPLES = 50   # mirrors the same conservative threshold used in Step 3's assessSufficiency()
MIN_LABEL_VARIANCE = 2   # need at least 2 distinct label values to fit anything meaningful

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Default (Step 4, unchanged): the real-MongoDB TeamSync dataset produced by
# backend/scripts/prepareTrainingDataset.js. Optionally overridable via
# ML_DATASET_PATH / ML_MODEL_DIR env vars (Step 5B addition) so this script can
# also be pointed at a differently-scoped dataset (e.g. the UCI public dataset)
# WITHOUT touching any of the loading/training/evaluation/blocking logic below.
# When the env vars are unset, behavior is 100% identical to Step 4.
DATASET_PATH = os.environ.get(
    "ML_DATASET_PATH",
    os.path.join(REPO_ROOT, "backend", "data", "ml", "student_performance_dataset.json"),
)
MODEL_DIR = os.environ.get(
    "ML_MODEL_DIR",
    os.path.join(os.path.dirname(__file__), "..", "models", "student_performance_rf"),
)


def load_dataset(path: str):
    """Loads the Step 3 dataset. Returns None (never a fabricated stand-in) if it's missing,
    unreadable, or structurally invalid — the caller must treat that as BLOCKED, not proceed."""
    if not os.path.exists(path):
        return None, f"dataset file not found at {path} — Step 3's prepareTrainingDataset.js has not been run against a real database yet"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        return None, f"dataset file exists but could not be parsed as JSON: {exc}"

    split = data.get("split")
    columns = data.get("featureColumns")
    if not split or not columns:
        return None, "dataset file is missing 'split' or 'featureColumns' — not a valid Step 3 output"
    for part in ("train", "val", "test"):
        if part not in split:
            return None, f"dataset file is missing the '{part}' split"
    return data, None


def to_xy(rows, feature_columns):
    """Converts Step 3 records into (X, y). Uses ONLY the columns Step 3 approved
    (feature_columns) — never the label, never any other field on the record, so the
    target can never leak into the features."""
    X, y, ids = [], [], []
    for r in rows:
        feats = r.get("features", {})
        row = [feats.get(c, 0) for c in feature_columns]  # missing-flag columns (created by Step 3) are
        # deliberately NOT included unless explicitly listed in feature_columns, keeping the
        # feature set identical to what Step 3 documented and approved.
        X.append(row)
        y.append(r["label"]["value"])
        ids.append(r.get("id"))
    return X, y, ids


def main():
    print("ML TRAINING STEP 4 — Random Forest: Student Performance / Risk Prediction")
    print("-" * 70)

    data, err = load_dataset(DATASET_PATH)
    if err:
        print(f"\nBLOCKED: {err}")
        print("No seed/fixture data was substituted. No model was trained. No files were written.")
        print("\nRANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA")
        sys.exit(1)

    feature_columns = data["featureColumns"]
    split = data["split"]
    train_rows, val_rows, test_rows = split["train"], split["val"], split["test"]

    print(f"Dataset: {DATASET_PATH}")
    print(f"Generated at: {data.get('generatedAt')}")
    print(f"Samples — train={len(train_rows)} val={len(val_rows)} test={len(test_rows)}")
    print(f"Features ({len(feature_columns)}): {', '.join(feature_columns)}")

    if len(train_rows) < MIN_TRAIN_SAMPLES:
        print(f"\nBLOCKED: training split has {len(train_rows)} real labeled samples, "
              f"below the minimum of {MIN_TRAIN_SAMPLES} needed to attempt training.")
        print("No model was trained. This is not a claim that more data would fail — only that "
              "this few samples cannot be trusted to produce a generalizable model.")
        print("\nRANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA")
        sys.exit(1)

    if not val_rows or not test_rows:
        print("\nBLOCKED: validation or test split is empty — cannot evaluate on held-out real data.")
        print("\nRANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA")
        sys.exit(1)

    X_train, y_train, _ = to_xy(train_rows, feature_columns)
    distinct_labels = len(set(y_train))
    if distinct_labels < MIN_LABEL_VARIANCE:
        print(f"\nBLOCKED: training split has only {distinct_labels} distinct label value(s) — "
              "a model cannot learn from a constant target, and this usually signals unreliable "
              "or over-narrow labeling upstream, not a modeling problem to solve here.")
        print("\nRANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA")
        sys.exit(1)

    try:
        import numpy as np
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
        import joblib
    except ImportError as exc:
        print(f"\nBLOCKED: required ML dependency not installed ({exc}). "
              "Install with: pip install -r ai-engine/requirements.txt")
        print("\nRANDOM FOREST TRAINING BLOCKED — INSUFFICIENT/INVALID DATA")
        sys.exit(1)

    X_val, y_val, _ = to_xy(val_rows, feature_columns)
    X_test, y_test, _ = to_xy(test_rows, feature_columns)

    # Label source / target type: Step 3's deriveStudentLabel() always produces a continuous
    # value (1-5 PeerReview average, or a 0-1 submission-approval ratio) — never a class label.
    # -> regression is the correct primary model; a thresholded view is reported additionally
    # below purely for interpretability, not as a second target.
    label_sources = {r["label"]["source"] for r in train_rows + val_rows + test_rows}
    print(f"Target sources present: {', '.join(sorted(label_sources))}")

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    def evaluate(X, y, name):
        if not X:
            return None
        pred = model.predict(X)
        mae = mean_absolute_error(y, pred)
        rmse = mean_squared_error(y, pred) ** 0.5
        r2 = r2_score(y, pred) if len(set(y)) > 1 else None
        metrics = {"n": len(y), "mae": mae, "rmse": rmse, "r2": r2}

        # Derived binary view for interpretability (median-split of true y as the threshold),
        # so accuracy/precision/recall/F1/confusion matrix requested in the brief are reported
        # even though the underlying target is continuous. Clearly labeled as derived, not a
        # separate model or a separate target.
        if len(set(y)) > 1:
            thresh = float(np.median(y_train))
            y_bin = [1 if v >= thresh else 0 for v in y]
            pred_bin = [1 if v >= thresh else 0 for v in pred]
            if len(set(y_bin)) > 1:
                metrics["derived_binary_threshold"] = thresh
                metrics["accuracy"] = accuracy_score(y_bin, pred_bin)
                metrics["precision"] = precision_score(y_bin, pred_bin, zero_division=0)
                metrics["recall"] = recall_score(y_bin, pred_bin, zero_division=0)
                metrics["f1"] = f1_score(y_bin, pred_bin, zero_division=0)
                metrics["confusion_matrix"] = confusion_matrix(y_bin, pred_bin).tolist()
        print(f"\n{name} (n={len(y)}): MAE={mae:.4f} RMSE={rmse:.4f} R2={r2 if r2 is not None else 'n/a (constant y)'}")
        if "accuracy" in metrics:
            print(f"  derived binary (>= median train label {metrics['derived_binary_threshold']:.2f}): "
                  f"accuracy={metrics['accuracy']:.3f} precision={metrics['precision']:.3f} "
                  f"recall={metrics['recall']:.3f} f1={metrics['f1']:.3f} confusion_matrix={metrics['confusion_matrix']}")
        return metrics

    train_metrics = evaluate(X_train, y_train, "TRAIN")
    val_metrics = evaluate(X_val, y_val, "VALIDATION")
    test_metrics = evaluate(X_test, y_test, "TEST")

    # class imbalance check on the derived binary view (train split)
    thresh = float(np.median(y_train))
    y_bin_train = [1 if v >= thresh else 0 for v in y_train]
    pos = sum(y_bin_train)
    neg = len(y_bin_train) - pos
    imbalance_ratio = max(pos, neg) / max(1, min(pos, neg))
    print(f"\nClass balance (derived binary, train): positive={pos} negative={neg} ratio={imbalance_ratio:.2f}:1")

    importances = sorted(zip(feature_columns, model.feature_importances_.tolist()), key=lambda x: -x[1])
    print("\nFeature importance (descending):")
    for name, imp in importances:
        print(f"  {name}: {imp:.4f}")

    # honest limitations, not boilerplate — computed from what actually happened above
    limitations = []
    if len(train_rows) < 200:
        limitations.append(f"Small training set ({len(train_rows)} samples) — RandomForest metrics above have high variance and should not be treated as a stable estimate of real-world accuracy.")
    if val_metrics and val_metrics.get("r2") is not None and val_metrics["r2"] < 0.3:
        limitations.append(f"Low validation R² ({val_metrics['r2']:.2f}) — the model explains little of the variance in real outcomes; do not treat predictions as reliable.")
    if imbalance_ratio >= 3:
        limitations.append(f"Notable class imbalance in the derived binary view ({imbalance_ratio:.1f}:1) — accuracy alone would be misleading; weight precision/recall/F1 more heavily.")
    if "PeerReview.scores" not in label_sources:
        limitations.append("No PeerReview-sourced labels present — training relied entirely on the weaker submission-verdict fallback signal.")
    if not limitations:
        limitations.append("No additional caveats beyond the metrics above — this does NOT mean the model is production-ready, only that no further red flag was detected by this script.")
    print("\nLimitations:")
    for l in limitations:
        print(f"  - {l}")

    # persist — new directory, first model ever produced, nothing to overwrite
    os.makedirs(MODEL_DIR, exist_ok=True)
    model_path = os.path.join(MODEL_DIR, "model.joblib")
    joblib.dump(model, model_path)

    metadata = {
        "modelType": "RandomForestRegressor (scikit-learn)",
        "target": "student performance / risk (continuous)",
        "targetSources": sorted(label_sources),
        "trainingDate": datetime.now(timezone.utc).isoformat(),
        "featureList": feature_columns,
        "trainingSampleCount": len(train_rows),
        "validationSampleCount": len(val_rows),
        "testSampleCount": len(test_rows),
        "hyperparameters": model.get_params(),
        "evaluation": {"train": train_metrics, "validation": val_metrics, "test": test_metrics},
        "featureImportance": importances,
        "classBalanceDerivedBinary": {"positive": pos, "negative": neg, "ratio": imbalance_ratio},
        "limitations": limitations,
        "datasetVersion": data.get("generatedAt"),
        # Reports the dataset's own self-description rather than assuming Step 4's default
        # (real MongoDB) — accurate whether this ran against the real TeamSync pipeline
        # output or an alternate dataset file such as the UCI public dataset (Step 5B).
        "datasetSource": data.get("datasetSource")
            or data.get("datasetName")
            or "real MongoDB (backend/scripts/prepareTrainingDataset.js), no seed/fixture data",
        "datasetScopeNote": data.get("scopeNote"),
        "notIntegrated": "Not connected to the Flask API or the rule-based prediction system. Training artifact only.",
    }
    metadata_path = os.path.join(MODEL_DIR, "metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, default=str)

    print(f"\nModel saved to: {model_path}")
    print(f"Metadata saved to: {metadata_path}")
    print("\nNot connected to the Flask API. Rule-based Step 3 prediction is untouched.")
    print("\nRANDOM FOREST TRAINED AND EVALUATED")
    sys.exit(0)


if __name__ == "__main__":
    main()
