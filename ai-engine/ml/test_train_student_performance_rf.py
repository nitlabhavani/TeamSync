"""
Smoke test for ml/train_student_performance_rf.py — verifies the trained/
evaluated code path executes correctly end-to-end and BLOCKED logic fires
correctly on bad input.

Uses hand-written FIXTURE data written to a temp file standing in for
backend/data/ml/student_performance_dataset.json — this is a test fixture
to validate the script's code, never real or claimed-real training data,
and it is never left in backend/data/ml/.

Run: python ai-engine/ml/test_train_student_performance_rf.py
"""
import importlib.util
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "train_student_performance_rf.py")

FEATURE_COLUMNS = ["taskCompletionRatio", "overdueTaskCount", "meaningfulChatMessageCount", "blockerMentionCount"]


def make_fixture_dataset(n_train=80, n_val=20, n_test=20, seed=1):
    """Builds a small synthetic dataset (clearly a test fixture, not training data)
    with the same JSON shape Step 3's prepareTrainingDataset.js produces."""
    rng = random.Random(seed)

    def make_rows(n, prefix):
        rows = []
        for i in range(n):
            completion = rng.uniform(0, 1)
            overdue = rng.randint(0, 5)
            chat = rng.randint(0, 20)
            blockers = rng.randint(0, 3)
            # label correlated with completion so the model has something real to learn in the test
            label_value = max(1.0, min(5.0, 3 + 2 * completion - 0.3 * overdue + rng.gauss(0, 0.3)))
            rows.append({
                "id": f"{prefix}{i}",
                "studentId": f"{prefix}{i}",
                "groupId": "g1",
                "features": {
                    "taskCompletionRatio": completion,
                    "overdueTaskCount": overdue,
                    "meaningfulChatMessageCount": chat,
                    "blockerMentionCount": blockers,
                },
                "label": {"value": label_value, "scale": "1-5 continuous", "source": "PeerReview.scores", "sourceCount": 1},
            })
        return rows

    return {
        "featureColumns": FEATURE_COLUMNS,
        "split": {
            "train": make_rows(n_train, "tr"),
            "val": make_rows(n_val, "va"),
            "test": make_rows(n_test, "te"),
        },
        "generatedAt": "TEST-FIXTURE-not-real",
    }


def run_script(dataset_path, repo_root):
    # Run the COPY of the script that lives inside the temp repo root (not the real one),
    # so its __file__-derived paths resolve against the temp backend/data/ml/ fixture,
    # never against the real repo.
    copied_script = os.path.join(repo_root, "ai-engine", "ml", "train_student_performance_rf.py")
    return subprocess.run([sys.executable, copied_script], cwd=os.path.join(repo_root, "ai-engine"), capture_output=True, text=True)


def main():
    passed = 0

    # ---- case 1: BLOCKED when no dataset file exists ----
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "ai-engine", "ml"))
        os.makedirs(os.path.join(tmp, "backend", "data", "ml"))
        shutil.copy(SCRIPT, os.path.join(tmp, "ai-engine", "ml", "train_student_performance_rf.py"))
        result = run_script(None, tmp)
        assert "RANDOM FOREST TRAINING BLOCKED" in result.stdout, result.stdout
        assert result.returncode == 1
        print("ok - BLOCKED when dataset file is missing")
        passed += 1

    # ---- case 2: BLOCKED when train split is too small ----
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "ai-engine", "ml"))
        ml_dir = os.path.join(tmp, "backend", "data", "ml")
        os.makedirs(ml_dir)
        shutil.copy(SCRIPT, os.path.join(tmp, "ai-engine", "ml", "train_student_performance_rf.py"))
        small = make_fixture_dataset(n_train=5, n_val=2, n_test=2)
        with open(os.path.join(ml_dir, "student_performance_dataset.json"), "w") as f:
            json.dump(small, f)
        result = run_script(None, tmp)
        assert "RANDOM FOREST TRAINING BLOCKED" in result.stdout, result.stdout
        assert not os.path.exists(os.path.join(tmp, "ai-engine", "models")), "must not write a model on BLOCKED"
        print("ok - BLOCKED when training split is below the minimum sample threshold")
        passed += 1

    # ---- case 3: trains and evaluates on a sufficiently large fixture set ----
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "ai-engine", "ml"))
        ml_dir = os.path.join(tmp, "backend", "data", "ml")
        os.makedirs(ml_dir)
        shutil.copy(SCRIPT, os.path.join(tmp, "ai-engine", "ml", "train_student_performance_rf.py"))
        big = make_fixture_dataset(n_train=80, n_val=20, n_test=20)
        with open(os.path.join(ml_dir, "student_performance_dataset.json"), "w") as f:
            json.dump(big, f)
        result = run_script(None, tmp)
        assert "RANDOM FOREST TRAINED AND EVALUATED" in result.stdout, result.stdout
        model_path = os.path.join(tmp, "ai-engine", "models", "student_performance_rf", "model.joblib")
        meta_path = os.path.join(tmp, "ai-engine", "models", "student_performance_rf", "metadata.json")
        assert os.path.exists(model_path), "model.joblib should have been written"
        assert os.path.exists(meta_path), "metadata.json should have been written"
        with open(meta_path) as f:
            meta = json.load(f)
        assert meta["trainingSampleCount"] == 80
        assert meta["validationSampleCount"] == 20
        assert meta["testSampleCount"] == 20
        assert meta["featureList"] == FEATURE_COLUMNS
        assert "evaluation" in meta and meta["evaluation"]["test"] is not None
        print("ok - trains, evaluates, and persists model+metadata on a sufficiently large fixture set")
        passed += 1

    # ---- case 4 (Step 5B addition): ML_DATASET_PATH/ML_MODEL_DIR env override
    # trains against an alternate dataset file (e.g. the UCI public dataset shape)
    # without touching the default (Step 4) file paths, and correctly reflects the
    # alternate dataset's own datasetSource/scopeNote in the saved metadata. ----
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "ai-engine", "ml"))
        os.makedirs(os.path.join(tmp, "backend", "data", "ml"))
        shutil.copy(SCRIPT, os.path.join(tmp, "ai-engine", "ml", "train_student_performance_rf.py"))

        alt_columns = ["studytime", "failures", "absences"]
        rng = random.Random(2)

        def make_alt_rows(n, prefix):
            rows = []
            for i in range(n):
                studytime = rng.randint(1, 4)
                failures = rng.randint(0, 3)
                absences = rng.randint(0, 20)
                g3 = max(0.0, min(20.0, 15 + 1.5 * studytime - 3 * failures - 0.1 * absences + rng.gauss(0, 1)))
                rows.append({
                    "id": f"{prefix}{i}",
                    "features": {"studytime": studytime, "failures": failures, "absences": absences},
                    "label": {"value": g3, "source": "UCI.G3"},
                })
            return rows

        alt_dataset_path = os.path.join(tmp, "backend", "data", "ml", "alt_public_dataset.json")
        alt_dataset = {
            "featureColumns": alt_columns,
            "split": {
                "train": make_alt_rows(80, "tr"),
                "val": make_alt_rows(20, "va"),
                "test": make_alt_rows(20, "te"),
            },
            "generatedAt": "TEST-FIXTURE-not-real",
            "datasetSource": "TEST-FIXTURE UCI-shaped dataset",
            "scopeNote": "TEST-FIXTURE scope note",
        }
        with open(alt_dataset_path, "w") as f:
            json.dump(alt_dataset, f)

        alt_model_dir = os.path.join(tmp, "ai-engine", "models", "alt_model")
        env = dict(os.environ)
        env["ML_DATASET_PATH"] = alt_dataset_path
        env["ML_MODEL_DIR"] = alt_model_dir
        copied_script = os.path.join(tmp, "ai-engine", "ml", "train_student_performance_rf.py")
        result = subprocess.run(
            [sys.executable, copied_script],
            cwd=os.path.join(tmp, "ai-engine"),
            capture_output=True, text=True, env=env,
        )
        assert "RANDOM FOREST TRAINED AND EVALUATED" in result.stdout, result.stdout

        # default (Step 4) locations must NOT have been touched
        default_dataset_would_be = os.path.join(tmp, "backend", "data", "ml", "student_performance_dataset.json")
        default_model_dir = os.path.join(tmp, "ai-engine", "models", "student_performance_rf")
        assert not os.path.exists(default_dataset_would_be), "default dataset path must be untouched"
        assert not os.path.exists(default_model_dir), "default model dir must be untouched when overridden"

        alt_meta_path = os.path.join(alt_model_dir, "metadata.json")
        assert os.path.exists(os.path.join(alt_model_dir, "model.joblib"))
        assert os.path.exists(alt_meta_path)
        with open(alt_meta_path) as f:
            alt_meta = json.load(f)
        assert alt_meta["featureList"] == alt_columns
        assert alt_meta["datasetSource"] == "TEST-FIXTURE UCI-shaped dataset"
        assert alt_meta["datasetScopeNote"] == "TEST-FIXTURE scope note"
        print("ok - ML_DATASET_PATH/ML_MODEL_DIR override trains against an alternate dataset "
              "without touching Step 4's default paths, and metadata reflects the alternate "
              "dataset's own source/scope")
        passed += 1

    print(f"\n{passed} passed, 0 failed")


if __name__ == "__main__":
    main()
