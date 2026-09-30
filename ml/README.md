# TeamSync Machine Learning (ML) Engine

This folder contains the consolidated Machine Learning infrastructure for TeamSync.

## Directory Structure

```
ml/
├── models/
│   ├── student_performance_rf_synthetic_dev/   # 15-feature TeamSync RF Model
│   │   ├── metadata.json
│   │   └── model.joblib
│   └── student_performance_rf_uci_public/      # UCI Public Student Performance Model
│       ├── metadata.json
│       └── model.joblib
├── loaders/
│   ├── rfModelLoader.py                         # Safe UCI RF model loader
│   └── teamsyncRfModelLoader.py                 # Safe TeamSync synthetic RF model loader
├── training/
│   └── train_student_performance_rf.py          # Random Forest training pipeline
├── datasets/                                    # Dataset generators & validators
│   ├── generateSyntheticTeamsyncDataset.js
│   ├── generateTeamsyncDataset.js
│   ├── preparePublicStudentDataset.js
│   ├── prepareTrainingDataset.js
│   ├── validatePublicStudentDataset.js
│   └── testMlDatasetService.js
├── tests/                                       # ML regression and integration tests
│   ├── test_train_student_performance_rf.py
│   ├── test_hybrid_integration.py
│   └── test_teamsync_hybrid_integration.py
└── reports/                                     # ML correctness & audit documentation
    └── AI_ML_CORRECTNESS_AUDIT_REPORT.md
```

## Key Capabilities & Safeguards

1. **Multi-Candidate Path Resolution**:
   Model loaders automatically locate the pre-trained `model.joblib` and `metadata.json` regardless of whether tests or services are run from `ai-engine`, `ml`, or root.
2. **Safe Predictions**:
   Missing features or invalid types safely return `None` (mapped to `ML_NOT_APPLICABLE`) rather than hallucinating or fabricating values.
3. **Dual Model Architecture**:
   - UCI Public Dataset Model (`student_performance_rf_uci_public`): Baseline academic benchmark.
   - Synthetic Dev Model (`student_performance_rf_synthetic_dev`): 15-feature TeamSync telemetry model.
