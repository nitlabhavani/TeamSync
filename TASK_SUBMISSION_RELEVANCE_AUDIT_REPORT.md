# TeamSync AI — Task Submission, AI Relevance Check & Guide Notification Audit Report

**Date:** September 11, 2026  
**Status:** Audit Complete, Fully Implemented, 34/34 Workflow Tests Passed, All 65 Unit Tests Passed, Frontend Production Build Clean  
**Runtime Services:**
- Backend: `http://localhost:5000` (Node.js/Express + MongoDB `teamsync_ai`)
- AI Engine: `http://localhost:8000` (Python FastAPI)
- Frontend: `http://localhost:8080` (React/Vite/TanStack)

---

## Executive Summary

This report documents the complete implementation, security validation, automated testing, and audit of the **Student Task → ZIP Submission → AI Relevance Check → Guide Notification** workflow for TeamSync AI.

All 8 core requirements have been verified end-to-end:
1. **Task Creation Authorization**: Only Guide and Team Leader can create/assign tasks via UI, API, or Group Chat. Ordinary students have no Add Task button, cannot access the Add Task UI, and API/chat task creation attempts are rejected.
2. **Project Context**: Tasks convey 5 essential fields: Project Title, Project Description, Task Title, Task Description, and Deadline.
3. **Group Chat Task Assignment**: Guide and Team Leader group chat directives automatically create real `Task` records with deadline & assignee. Ordinary student messages and private 1-on-1 chats never trigger task creation.
4. **Task Page & Step 33 Isolation**: Chat-assigned and UI-assigned tasks appear in the assigned student's Tasks page with project context. Step 33 reassignment and submission isolation are preserved (students never see prior assignees' work).
5. **Safe ZIP Content Relevance Check**: Hardened safe extraction (mitigating Zip Slip, Zip Bomb, secret exposure) paired with explainable relevance scoring (`RELEVANT`, `POSSIBLY_RELEVANT`, `IRRELEVANT`). Excludes generic files (`README.md`, `package-lock.json`, `.gitignore`) from false-positive task matching.
6. **Student Warning & Guide Notification**: Non-accusatory student warning banner (`⚠️ Submission may be incorrect`) and deduplicated notifications to Guide and Team Leader without blocking guide review.
7. **Guidance for ZIP Submission**: Student-facing guidance card near the upload UI.
8. **34 Automated Tests**: Complete test suite created and passing (34/34 passed).

---

## 1. Architectural Changes & File Manifest

### Backend

| File | Change Description |
|---|---|
| `backend/src/utils/authz.js` | Added and exported `canAssignOrModifyTask` and `canCreateTask` authoritative helper aliases pointing to `isGuideOrLeader(req)`. |
| `backend/src/services/chatTaskService.js` | Restricted message processing authorization to `isGuide \|\| senderIsLeader`. Ordinary student chat messages are strictly blocked from triggering task creation. |
| `backend/src/services/aiService.js` | Enhanced `detectMessageTasks` to accept both array and object member signatures, resolve `assigneeId` via `member.id \|\| member._id`, added `parseAnyDate` to parse structured deadlines (`Task: ...`, `Deadline: ...`, `Assignee: ...`). |
| `backend/src/models/Task.js` | Added `relevance` subschema to `submissionSchema.aiAnalysis` (`status`, `isIrrelevant`, `score`, `reason`, `evidence`), added `irrelevantNotified: { type: Boolean, default: false }`. |
| `backend/src/services/safeZipExtractor.js` | Exported `resolveSafeEntryPath`, hardened Zip Slip, Zip Bomb, and secret file exclusion. |
| `backend/src/services/taskSubmissionAnalysisService.js` | Added `evaluateZipRelevance` function with generic keyword/filename exclusion, task/project token evaluation, archive basename matching, and explainable evidence. Updated `analyzeZipSubmission` and `buildUnreadableZipResult` to attach `relevance`. |
| `backend/src/controllers/submissionController.js` | Passed `projectTitle` and `projectDescription` to `analyzeZipSubmission`, persisted `submission.aiAnalysis.relevance`, set `submission.irrelevantNotified = true`, and dispatched deduplicated notifications to Guide and Team Leader (excluding the submitting student). |
| `backend/src/utils/taskSubmissionScope.js` | Updated `shapeTaskForViewer` to attach `projectContext: { title, description, groupName }` for all viewers. |
| `backend/src/controllers/taskController.js` | Populated `group` with `name project description` in `list` and `board` queries. |

### Frontend

| File | Change Description |
|---|---|
| `frontend/src/pages/student/Tasks.jsx` | Verified `canCreateTask` gating for "Add Task" button. Added structured Project Context card in `TaskCard` displaying Project Title, Description, Task Details, and Deadline. Added non-accusatory warning banner (`⚠️ Submission may be incorrect`) with archive details when `isIrrelevant` is true. Added "💡 Suggestions for Project Submission" guidance card in upload section. |
| `frontend/src/pages/guide/SubmissionReview.jsx` | Added prominent `⚠️ Possible Irrelevant Submission` badge with archive name, relevance score, reason, and expected keywords, without blocking guide review actions. |

---

## 2. Security & Safe ZIP Content Relevance Architecture

### Zip Slip & Zip Bomb Defense
- **Path Traversal Protection**: `resolveSafeEntryPath` enforces normalization, prevents absolute paths (`/` or `C:`), and rejects any segment containing `..`.
- **Zip Bomb Limits**: Enforces `maxEntries` (8,000), `maxTotalUncompressedBytes` (300MB), and `maxSingleEntryBytes` (25MB).
- **Secret File Exclusion**: Files matching `.env*`, `*.pem`, `*.key`, `*secret*`, and `*credentials*` are excluded from extraction and analysis.
- **Noise Stripping**: `node_modules`, `.git`, `.venv`, `dist`, `build`, `__pycache__`, and binary/executable extensions (`.exe`, `.dll`, `.so`, `.zip`, `.jar`) are skipped.

### Relevance Scoring Formula
1. **Token Extraction**: Strips stop words and generic project words (`app`, `code`, `system`, `feature`, `module`, `task`, `submission`, `index`, `main`, etc.) to produce clean `taskKeywords` and `projectKeywords`.
2. **Generic File Filter**: Ignores `README.md`, `package-lock.json`, `.gitignore`, `tsconfig.json`, `index.html`, etc. to prevent students from receiving relevance credit for template files.
3. **Multi-Signal Evaluation**:
   - Matches within non-generic source files (path + content).
   - Matches within ZIP archive name.
   - Project repository identity verification (`WRONG_PROJECT` flag).
4. **Classification**:
   - `RELEVANT` (score 70-100): Direct implementation of assigned task with 2+ matched task files.
   - `POSSIBLY_RELEVANT` (score 25-65): Shares project tokens but has limited or ambiguous task evidence.
   - `IRRELEVANT` (score 0-20): 0 task file matches, completely unrelated project, empty archive, or unreadable ZIP. Sets `isIrrelevant: true`.

---

## 3. Automated Test Verification Results

### 1. Dedicated Workflow Test Suite (`backend/scripts/testTaskSubmissionRelevanceWorkflow.js`)
**Result:** **34 PASSED / 0 FAILED** (100% pass rate)

```text
--- 1. Authorization & Role Verification ---
  [PASS] Test 1: Guide can create/assign tasks for their group
  [PASS] Test 2: Team Leader can create/assign tasks for their group
  [PASS] Test 3: Ordinary student member cannot create/assign tasks
  [PASS] Test 4: Outsider student cannot create/assign tasks
  [PASS] Test 5: Guide assigned to another group cannot create tasks for this group

--- 2. Group Chat Task Assignment ---
  [PASS] Test 6: Guide structured chat message extracts task with deadline and assignee
  [PASS] Test 7: Team Leader natural chat instruction extracts task
  [PASS] Test 8: Plain student chat message NEVER creates a task
  [PASS] Test 9: Private 1-on-1 chat route does not invoke processGroupMessageForTasks
  [PASS] Test 10: Assignee resolution correctly matches full or first names case-insensitively

--- 3. Project Context & Visibility ---
  [PASS] Test 11: Task contains project title and description from group
  [PASS] Test 12: shapeTaskForViewer attaches projectContext for assigned student
  [PASS] Test 13: shapeTaskForViewer attaches projectContext for guide and leader
  [PASS] Test 14: Task page view provides all 5 required context fields
  [PASS] Test 15: Step 33 isolation: reassigned student cannot view previous student submissions

--- 4. Safe ZIP Extraction & Security ---
  [PASS] Test 16: Safe extraction blocks path traversal (Zip Slip)
  [PASS] Test 17: Safe extraction gracefully flags invalid or corrupted file
  [PASS] Test 18: Safe extraction strips secret files (.env, .pem, id_rsa)
  [PASS] Test 19: Safe extraction ignores node_modules and .git folders
  [PASS] Test 20: Safe extraction enforces file size and entry limits (Zip Bomb defense)

--- 5. Safe ZIP Content Relevance Evaluation ---
  [PASS] Test 21: Relevant ZIP evaluates to RELEVANT status with high score
  [PASS] Test 22: Completely unrelated project ZIP evaluates to IRRELEVANT
  [PASS] Test 23: WRONG_PROJECT flag from AI engine forces IRRELEVANT outcome
  [PASS] Test 24: Empty or zero-source ZIP evaluates to IRRELEVANT with 0 score
  [PASS] Test 25: Generic files alone (README, package-lock, .gitignore) do not count as task evidence
  [PASS] Test 26: Partial match with project tokens but no task implementation evaluates to POSSIBLY_RELEVANT
  [PASS] Test 27: Relevance output evidence structure contains all required audit fields

--- 6. Notification & UI Flagging ---
  [PASS] Test 28: Irrelevant ZIP submission dispatches notification to Guide
  [PASS] Test 29: Irrelevant ZIP submission dispatches notification to Team Leader
  [PASS] Test 30: Submitting student is excluded from irrelevant notification
  [PASS] Test 31: Student submission response contains isIrrelevant: true flag and evidence

--- 7. Review & Workflow Continuity ---
  [PASS] Test 32: Irrelevant submission sets status to changes_requested and preserves submission for review
  [PASS] Test 33: Guide can still approve, reject, or request changes on an irrelevant-flagged submission
  [PASS] Test 34: Resubmission with a relevant ZIP resolves the issue and updates analysis

================================================================================
WORKFLOW TEST RESULTS: 34 PASSED, 0 FAILED (TOTAL 34 TESTS)
================================================================================
```

### 2. Chat Task Service Integration Suite (`backend/scripts/testChatTaskServiceIntegration.js`)
**Result:** **10 PASSED / 0 FAILED** (100% pass rate)

### 3. Backend Regression Suite (`npm test`)
**Result:** **6 test suites passed, 65 tests passed, 0 failed**

### 4. Frontend Production Build (`npm run build`)
**Result:** **Built in 1.38s with 0 errors**

---

## 4. Conclusion & Hand-off

The workflow implementation is robust, secure, production-ready, and adheres strictly to all project rules:
- No existing functionality was removed or broken.
- No duplicate AI engines or modules were created.
- Group ID isolation and private chat isolation were strictly preserved.
- Step 33 reassignment privacy and Step 34 chat highlight features remain intact.
