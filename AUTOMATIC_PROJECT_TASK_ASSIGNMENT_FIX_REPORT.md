# AUTOMATIC PROJECT TASK ASSIGNMENT FIX REPORT
**TeamSync AI — Automatic Task Planning, Member Assignment & Deadline Generation**

Date: September 13, 2026  
Status: **RESOLVED, VERIFIED, AND FULLY OPERATIONAL**

---

## 1. Executive Summary & Root Cause Analysis

### The Problem
When a Guide or Team Leader created or updated a project group and provided:
1. **Project title**
2. **Project description**

TeamSync AI failed to automatically analyze the project, generate actionable modular tasks with realistic deadlines, and assign them to eligible group members.

### Root Cause Identification
1. **Unwired Backend Controller**:
   - In `backend/src/controllers/groupController.js`, `exports.create` saved the group record with `name`, `project`, and `description`, but **never invoked any project planning or task creation service**.
   - Similarly, `exports.update` updated attributes (`project`, `description`, etc.) but did not trigger task generation when title/description were provided or updated.
2. **Roster Initialization Race**:
   - When a Guide created a group with `memberEmails`, `group.members` was initialized as `[]` because students were expected to verify OTP invitations first.
   - Even when invited students were already registered, active students in the database, they were not resolved or associated with the group at creation time. This prevented the AI planner from identifying any eligible active student members to receive task assignments.
3. **Mongoose Model Validation Incompatibility**:
   - In `backend/src/controllers/reportController.js`, line 369 fell back to `"Task Deliverable"` when `task.deliverableType` was empty. Because `deliverableType` in `backend/src/models/Task.js` is strictly enumerated (`["", "code", "frontend", "backend", "database", "documentation", "presentation", "report"]`), non-empty un-normalized strings caused Mongoose validation failure during task insertion.
4. **Missing UI Automation & Feedback**:
   - `frontend/src/components/groups/CreateGroupModal.jsx` had no project deadline input, lacked an automated planning toggle option, and did not display AI planning progress or task generation feedback.

---

## 2. Solution Architecture & Files Changed

### Architecture Overview
An additive, production-quality solution was implemented that preserves all existing features, schemas, and security boundaries without introducing duplicate planners or fabricated data:

```
[Guide / Team Leader]
         │
         ▼
[CreateGroupModal.jsx / updateGroup / autoPlanTasks]
         │  (Sends name, project, description, expectedCompletion, memberEmails)
         ▼
[groupController.create / groupController.update / autoPlanTasks]
         │  1. Saves Group document
         │  2. Resolves registered active students into group.members & leader
         │  3. Issues invitations & notifications
         │  4. Calls autoPlanAndAssignTasks
         ▼
[autoProjectPlanningService.js]
         │  - Enforces groupId isolation
         │  - Checks duplicate protection (source: "ai")
         │  - Formats real student members
         │  - Calls Python AI Engine /analyze/project-plan (with deterministic fallback)
         │  - Sanitizes tasks & normalizes deliverableType
         │  - Calculates topological finish offsets & due dates <= project deadline
         │  - Distributes tasks evenly across active members (real MongoDB ObjectIds)
         │  - Inserts Task documents into MongoDB
         │  - Sends notifications to assignees
         │  - Recalculates group progress (recalcGroupProgress)
         ▼
[MongoDB Task Collection]
         │
         ▼
[Frontend Tasks Page / Group Details / Guide Dashboard]
   (Live display with student-level privacy: students see only their assigned tasks)
```

### Files Changed

1. **`backend/src/services/autoProjectPlanningService.js` (NEW)**:
   - Core reusable service `autoPlanAndAssignTasks({ group, reqUser, projectTitle, projectDescription, deadline, force })`.
   - Resolves active student members (`resolveGroupStudentMembers`) using real MongoDB `_id`s.
   - Connects to AI engine with robust deterministic fallback contextualized to the project title and description.
   - Enforces duplicate protection, topological deadline calculation, and notification dispatch.
2. **`backend/src/controllers/groupController.js` (MODIFIED)**:
   - In `exports.create`: Resolves registered student invitees into `group.members` and `group.leader`; automatically triggers `autoPlanAndAssignTasks`; returns `meta.autoTasksCreated` and `meta.tasks`.
   - In `exports.update`: Automatically triggers planning when project title/description changes or upon request; returns task generation metadata.
   - Added `exports.autoPlanTasks`: Explicit endpoint (`POST /api/groups/:groupId/ai/auto-plan-tasks`) for Guide and Team Leader to trigger or retry automatic task planning.
3. **`backend/src/routes/index.js` (MODIFIED)**:
   - Added route: `POST /api/groups/:groupId/ai/auto-plan-tasks`, guarded by `protect` and `requireGroupAccess`.
4. **`backend/src/controllers/reportController.js` (MODIFIED)**:
   - Fixed `deliverableType` sanitization to strictly use `planTaskService.normalizeDeliverableType(task.deliverableType) || ""` to prevent Mongoose validation errors.
5. **`frontend/src/services/groupService.js` (MODIFIED)**:
   - `createGroup`: Added support for `expectedCompletion` and `autoGenerateTasks`, attaching `autoTasksCreated` and `autoTasks` to the returned group.
   - Added `autoPlanTasks(groupId, payload)` client method.
   - `updateGroup`: Updated to capture `autoTasksCreated` and `autoTasks` metadata via `patchRaw`.
6. **`frontend/src/lib/apiClient.js` (MODIFIED)**:
   - Added `patchRaw` method to the `api` client object.
7. **`frontend/src/components/groups/CreateGroupModal.jsx` (MODIFIED)**:
   - Added `expectedCompletion` date picker for project target deadline.
   - Added AI auto-planning toggle with descriptive explanation.
   - Added real-time loading feedback during submission: `"Creating & planning tasks…"`.
   - Passes `autoTasksCreated` to parent `onCreated` callback.
8. **`frontend/src/pages/guide/GroupManagement.jsx` (MODIFIED)**:
   - Updated `handleCreated` to celebrate and display generated AI task count.

---

## 3. Detailed Data Flow & Business Rules

### A. How Project Title & Description Reach the Planner
1. The user inputs `project` ("Project title") and `description` ("Project description") in `CreateGroupModal` or via group settings.
2. The payload is sent to `POST /api/groups` or `PATCH /api/groups/:groupId`.
3. The controller extracts and trims `project` and `description`. Minimum requirements: title >= 3 chars, description >= 5 chars.
4. If valid, the controller invokes `autoPlanAndAssignTasks({ group, reqUser, projectTitle, projectDescription, deadline })`.

### B. How Members Are Selected & Filtered
- Only **real, active student members** are selected from MongoDB:
  ```javascript
  User.find({ _id: { $in: group.members }, isActive: true, role: "student" })
  ```
- If the group leader is a student, the leader is included.
- For brand-new groups, registered students matching invite emails are automatically resolved into active members.
- Non-existent, inactive, or removed members are **never** assigned tasks.
- Guides and admins are never treated as student assignees.

### C. How Tasks Are Assigned
1. Tasks generated by the AI engine or deterministic planner are mapped to student members.
2. If the AI specifies `assigneeId` or `studentEmail`, it is matched against the resolved student roster.
3. If unassigned, a fair round-robin distribution is applied across all active student members.
4. **Workload Balance**: Every eligible student receives tasks; tasks are never concentrated on a single individual when multiple members exist.

### D. How Deadlines Are Calculated
1. Tasks are topologically sorted according to their prerequisites:
   - Prerequisites land earlier in the timeline.
   - Dependent tasks land later in the timeline.
2. The deadline math computes finish offsets based on estimated effort (`estimatedDays`).
3. If a project deadline (`expectedCompletion`) exists:
   - Every task due date is scaled between `now` and `project deadline`.
   - No task due date ever exceeds the project deadline.
4. If no project deadline is provided, a standard staggered schedule (7-30 days) is applied.
5. All dates are validated as valid future dates before persisting in MongoDB.

### E. Duplicate Protection
- Tasks created from the plan receive `source: "ai"`.
- If `source: "ai"` tasks already exist for the group and `force` is not set, planning skips recreation and returns `skipped: true`.
- If re-planning is forced, tasks are deduplicated by title (case-insensitive) against existing tasks.
- **Manual tasks are never deleted, overwritten, or modified.**

### F. Authorization & Privacy Rules
- **Guide & Team Leader Authorization**:
  - Only Guides (`req.isGuide`) and Team Leaders (`req.group.leader === req.user._id` or `leaderEmail === req.user.email`) can trigger task generation.
  - Ordinary students receive `403 Forbidden` if they attempt to trigger task generation.
- **Group Isolation**:
  - Every query and mutation uses `group: group._id` (ObjectId). Group names are **never** used for isolation.
  - Two groups with the identical name remain completely isolated with zero cross-leakage.
- **Student Privacy**:
  - When students fetch tasks (`GET /api/groups/:groupId/tasks`), the backend filters by `assignee: req.user._id`. Students only see their own assigned tasks.
  - Guides see all tasks for the entire group.
- **Private Data Protection**:
  - Direct 1-on-1 private messages, private calls, and private voice recordings are **never** queried or sent to the project planner.

---

## 4. Verification & Testing Results

### 1. Comprehensive Backend Unit & Integration Tests
**Script**: `backend/scripts/testAutoProjectPlanningComprehensive.js`  
**Execution Command**: `node backend/scripts/testAutoProjectPlanningComprehensive.js`  
**Results**:
```
[PASS] 1. Auto-planning generates structured tasks with clear details and deadlines
[PASS] 2. Workload is balanced across all active student members
[PASS] 3. Task dependencies and topological deadline order are preserved
[PASS] 4. Duplicate protection prevents re-generating duplicate AI tasks
[PASS] 5. Manual tasks are preserved and not overwritten
[PASS] 6. Group isolation: A second group with identical name has isolated tasks
[PASS] 7. Student privacy: Student query only returns their assigned tasks
ALL 7 COMPREHENSIVE TESTS PASSED SUCCESSFULLY!
```

### 2. Live HTTP API & Authorization Tests
**Script**: `backend/scripts/testAutoProjectPlanningHttp.js`  
**Execution Command**: `node backend/scripts/testAutoProjectPlanningHttp.js`  
**Results**:
```
--- TEST 1: Guide creates group with title and description -> Auto tasks generated ---
Created group: Team Quantum HTTP 1789284042531 (ID: 6aa64ecbf6214de5e1434683)
[PASS] Group creation returned 8 automatically planned tasks!
[PASS] Real Task documents created in MongoDB: 8

--- TEST 2: Ordinary student forbidden from creating groups ---
[PASS] Ordinary student received 403 Forbidden on group creation

--- TEST 3: Ordinary student forbidden from triggering AI auto-plan ---
[PASS] Ordinary student received 403 Forbidden on auto-plan endpoint

--- TEST 4: Outsider student forbidden from group endpoints ---
[PASS] Outsider student received 403 Forbidden

--- TEST 5: Team Leader CAN trigger auto-planning ---
[PASS] Team Leader authorized and duplicate protection reported skipped=true

--- TEST 6: Student sees only their assigned tasks on /groups/:groupId/tasks ---
[PASS] Student privacy preserved: Student sees 4 assigned tasks out of 8 total team tasks!

--- TEST 7: Guide sees all team tasks on /groups/:groupId/tasks ---
[PASS] Guide sees all 8 tasks!
ALL HTTP & AUTHORIZATION TESTS PASSED PERFECTLY!
```

### 3. Existing Regression Test Suites
- `testProjectPlanTaskService.js`: **10 / 10 passed**.
- `testTasksPageGroupIsolation.js`: **5 / 5 passed**.
- `testSameNameGroupIsolation.js`: **5 / 5 passed**.
- `testAddTaskAuthorization.js`: **6 / 6 passed**.

### 4. AI Engine Compilation & Syntax Verification
- Ran `python -m py_compile planning/projectPlanner.py app.py` -> **Exited with code 0 (zero errors)**.

### 5. Frontend Production Build Verification
- Ran `npm run build` in `frontend` -> **Built successfully in 2.11s with zero errors or warnings**.

---

## 5. Live Testing Status & Remaining Limitations

### Live Status
- **MongoDB**: Active and connected (`teamsync_ai` on `127.0.0.1:27017`).
- **Backend Service**: Active on `http://localhost:5000` (PID daemon).
- **AI Engine**: Active on `http://localhost:8000` (Python FastAPI daemon).
- **Frontend App**: Active on `http://localhost:8080` (Vite dev server).

### Limitations
- Automatic task planning requires at least one active registered student member in the group. If a guide creates a group with email addresses that have not yet registered accounts in the database, task assignment waits until registered members exist or until students accept their invitations, or the Guide/Leader can click "AI Project Understanding" once members have registered.

---

## 6. Conclusion
The critical bug has been completely resolved. When a Guide or Team Leader creates or updates a group with a project title and description:
- The project requirements are fully understood.
- Actionable modular tasks with rich instructions (`whatToDo`), deliverables (`expectedOutput`), and acceptance criteria (`completionCriteria`) are generated.
- Deadlines are logically sequenced using topological dependency ordering and constrained to the project deadline.
- Real Task documents are created in MongoDB, assigned to real active student members, and immediately visible across the Tasks page, Group Details page, and Guide Dashboard.
- All authorization, isolation, and privacy constraints are strictly preserved.
