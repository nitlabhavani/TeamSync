# STEP 28 — AI Project Memory Assistant / Contextual Project Q&A

## 1. Feature Summary

An additive, grounded Q&A layer over data that already exists in the
TeamSync AI project. A member of a group can ask a natural-language
question ("What decisions were made?", "What tasks are overdue?", "What
happened in the last meeting?") and get back a deterministic answer that
is always traceable to real, already-persisted records — Project Knowledge
/ Decision Memory (Step 27), Meeting Intelligence (Step 26), Conflict
Snapshots (Step 24), Tasks, and — for the guide/team leader — the reused
Project Health / Forecast / Team Risk / Sprint Planner services.

**No external LLM/API is used and none is required.** This is a
deterministic keyword/phrase retrieval and templated-answer system, not a
generative model. If there isn't enough evidence to answer, the assistant
says so explicitly instead of guessing.

## 2. Architecture

```
Question
  → normalizeQuestion (trim/whitespace only)
  → classifyIntent (ordered regex rules → one of 17 intents)
  → extractKeywords (strip question-filler words)
  → per-intent retrieval, ALWAYS scoped to req.group._id
      - ProjectKnowledge.find({ group, status: ACTIVE[, SUPERSEDED] })
      - MeetingIntelligenceSnapshot.findOne/find({ group })  [guide/leader only]
      - ConflictSnapshot.find({ group, status })
      - Task.find({ group[, assignee] })
      - reused: projectHealthService.getProjectHealth(group, {persist:false})
                projectForecastService.runProjectForecast(group, {persist:false})
                teamRiskAnalyzer.analyzeGroupRisk(group, {persist:false})
                sprintPlannerService.buildSprintPreview(group, {})
  → rankByOverlap (conflictDetectionService.subjectTokens/tokenOverlap, UNCHANGED)
  → classifyConfidence (deterministic HIGH/MEDIUM/LOW/INSUFFICIENT_DATA)
  → templated answer + evidence[] + relatedItems[] + limitations[]
```

## 3. Files Added

- `backend/src/services/projectMemoryAssistantService.js` — intent
  classification, keyword extraction, ranking, per-intent answer builders,
  and the `askProjectMemory` orchestrator. Fully documented header
  explaining reuse and privacy guarantees.
- `backend/src/controllers/projectMemoryAssistantController.js` — the
  `POST /groups/:groupId/ai/project-memory/ask` handler. Ephemeral — never
  persists the question or answer.
- `backend/scripts/testProjectMemoryAssistant.js` — 30 checks (see §9).
- `frontend/src/services/projectMemoryAssistantService.js` — thin
  `askProjectMemory(groupId, question)` wrapper around the existing
  `apiClient`.
- `frontend/src/components/ai/ProjectMemoryAssistant.jsx` — the question
  input, example-question chips, answer card (intent badge, confidence
  badge, evidence list, related items, limitations), and a privacy note.

## 4. Files Modified

- `backend/src/routes/index.js` — one new route registered (protect +
  requireGroupAccess, same as every other group-scoped AI route). No
  existing route, import, or line was removed.
- `frontend/src/pages/guide/GuideDashboard.jsx` — one new icon import, one
  new component import, one new `useState`, one new collapsible section
  placed directly after the Project Knowledge card. No existing card,
  state, or import was removed.

**Nothing else changed.** `diff -rq` against the original upload shows
exactly these 5 new files and 2 modified files (see §14).

## 5. Supported Intents

`PROJECT_OVERVIEW`, `DECISIONS`, `RECENT_DECISIONS`, `DECISION_REASON`,
`TASK_STATUS`, `TASK_ASSIGNMENT`, `DEADLINES`, `BLOCKERS`, `RISKS`,
`CONFLICTS`, `MEETING_SUMMARY`, `MEETING_ACTION_ITEMS`, `FOLLOW_UPS`,
`PROJECT_HEALTH`, `PROJECT_FORECAST`, `SPRINT_STATUS`, `KNOWLEDGE_SEARCH`,
`UNKNOWN`.

Classification is ordered, most-specific-pattern-first regex matching over
normalized keywords (never exact-phrase-only) — see `INTENT_RULES` in
`projectMemoryAssistantService.js`. `UNKNOWN` falls through to a last-resort
grounded knowledge search before giving up.

## 6. Retrieval Approach

Deterministic token/phrase overlap, reusing
`conflictDetectionService.normalizeSubject` / `subjectTokens` /
`tokenOverlap` unchanged — no second similarity implementation, no
embeddings, no vector database (none exists elsewhere in this codebase
either). A local `QUESTION_FILLER` word list (distinct from — and
additive to — the existing `STOPWORDS`) trims obvious question words
("what", "did", "we"…) before search-term extraction.

A specific-but-unmatched question (e.g. "why did we choose Redis?" when
only a MongoDB decision exists) is distinguished from a genuinely generic
listing question (e.g. "what decisions were made?") via a small
`GENERIC_DECISION_WORDS` set — the former always returns
`INSUFFICIENT_DATA` rather than surfacing an unrelated record as if it
answered the specific question (see test 16).

## 7. Evidence Model

```json
{
  "sourceType": "PROJECT_KNOWLEDGE | MEETING_INTELLIGENCE | CONFLICT | TASK | PROJECT_HEALTH | PROJECT_FORECAST | TEAM_RISK | SPRINT_PLANNER | TASK_SUMMARY | KNOWLEDGE_SUMMARY",
  "sourceId": "real Mongo _id (or groupId for reused whole-project services)",
  "label": "short human label",
  "snippet": "verbatim excerpt of the real record's own field, truncated to 220 chars"
}
```
Every `sourceId` is verified in tests to correspond to a record that still
exists in the store it was drawn from (test 22).

## 8. Authorization & Privacy

- `groupId` is **only ever** taken from `req.group` (set by the existing
  `requireGroupAccess` middleware after verifying membership) — **never**
  from the request body. This matches every other AI route in this
  codebase.
- `isGuideOrLeader` is decided by the **controller**, using the same
  `canRequestRecommendation({ isGuide, groupLeaderId, userId })` helper
  already used by `projectKnowledgeController.js`. The service itself
  never re-derives authorization.
- **Private chat is never read.** The service touches only
  `ProjectKnowledge`, `MeetingIntelligenceSnapshot`, `ConflictSnapshot`,
  and `Task` — the `Message` model is never imported or queried here.
- **Student-safe shaping** reuses, unchanged:
  `projectKnowledgeService.shapeForStudent` (knowledge) and
  `conflictDetectionService.shapeForStudent` (conflicts — a student only
  ever sees conflicts they're involved in). A plain student's task
  questions are scoped to `assignee = userId`, mirroring
  `taskController.list`'s existing rule.
- Data sources with **no existing student-safe shape at all** in this
  codebase (full Meeting Intelligence, Project Health, Forecast, Team
  Risk, Sprint planning) return a plain "guide or team leader only"
  message to a student — never a 500, never the underlying data.
- Question text is **never** used to build a raw query string or passed to
  `eval`/`$where` — every DB touchpoint is a safe, hardcoded
  Mongoose filter (`{ group, status: {$in:[...]} }`, `{ group, assignee }`,
  etc.); the free-text question only ever flows into the in-memory
  `tokenOverlap` ranking function, never into the database layer.
- The endpoint is **ephemeral** — no question or answer is persisted
  anywhere.

## 9. Tests — `backend/scripts/testProjectMemoryAssistant.js`

30 checks, **30/30 passing**, covering (mapped to the spec's 25 minimum
cases): pure intent classification, keyword extraction, ranking/confidence
(pure units), basic project-knowledge question, generic decisions
question, historical/superseded handling (current vs. superseded, spec
§21), task status, task assignment, deadline/overdue filtering, blocker
question (conflict-sourced), meeting summary + "no meeting intelligence"
case, meeting-intelligence question, conflict question, project-health
guide-gate, project-forecast guide-gate (never throws even against a
DB-less fake group), unknown question, insufficient evidence / no
fabrication (spec §12's exact Redis example), confidence classification,
groupId isolation (group A cannot see group B), duplicate-same-name-group
isolation, student-safe shaping (conflicts, knowledge status, tasks — 3
separate checks), evidence references are real, multiple evidence sources
in one overview answer, empty project state, and malformed/empty/very-long
question handling.

```
$ node backend/scripts/testProjectMemoryAssistant.js
...
30 checks passed.
```

## 10. Regression Results

All 29 applicable pre-existing backend test scripts were re-run after this
change, unmodified:

```
testChatTaskExtractionService      17 passed
testChatTaskServiceIntegration      9 passed
testCodeReviewAnalyzer             32 passed
testCollaborationRisk              10 passed
testConflictDetection              57 passed, 0 failed
testDeadlineNudge                  11 passed
testGroupAccessIsolation           PASS (5/5)
testMeetingActionItems             11 passed
testMeetingIntelligence            67 passed, 0 failed
testNotificationSystem             PASS
testPlagiarismAnalyzer             15 passed
testProjectExecutionCopilot        40 passed
testProjectForecast                20 passed
testProjectHealth                  31 passed
testProjectKnowledge               28 passed
testProjectPlanTaskService         10 passed
testProjectWhatIfSimulator         60 passed
testSameNameGroupIsolation          5 passed
testSmartTaskAssignmentService     16 passed
testSprintPlanner                  53 passed, 0 failed
testStudentIsolation               PASS (4/4)
testSubmissionHistory              19 passed
testSubmissionReviewWorkflow       13 passed
testTaskExpansionService            8 passed
testTaskPlanService                22 passed
testTaskSubmissionAnalysis         22 passed
testTasksPageGroupIsolation         5 passed
testTeamPerformance                49 passed
testTeamRiskAnalyzer               18 passed
testWeeklyNarrativeReport          12 passed
```

**Result: PASS. Zero regressions.**

Not run: `testEmail.js`, `validateMailer.js`, `checkRealDataAvailability.js`,
`generate*Dataset.js`, `prepare*Dataset.js`, and `runtimeSmokeTest.js` —
these require a live SMTP provider, a live running server, and/or a real
MongoDB connection with seeded data, none of which are available in this
offline sandbox. This is a pre-existing constraint of the environment, not
something Step 28 caused, and none of these touch any file Step 28
modified.

## 11. Frontend Build Result

```
$ npm run build
✓ built in 1.34s
```
**PASS**, no errors or new warnings.

## 12. Step 28 Lint

```
$ npm run lint   (full repo eslint . run)
✖ 222 problems (212 errors, 10 warnings)
```
All 212 pre-existing errors are in files Step 28 never touched (mostly
Windows line-ending / prettier formatting issues in `reportService.js`,
`toastService.js`, `workspaceData.js`, `taskService.js`, etc. — confirmed
pre-existing by diffing against the original upload). **Zero lint errors
or warnings in any Step 28 file** (`ProjectMemoryAssistant.jsx`,
`projectMemoryAssistantService.js`, or the modified lines of
`GuideDashboard.jsx`) — verified by grepping the lint output for these
filenames, which returns no matches.

## 13. Syntax Checks

```
node --check backend/src/routes/index.js                              OK
node --check backend/src/services/projectMemoryAssistantService.js    OK
node --check backend/src/controllers/projectMemoryAssistantController.js  OK
node --check backend/scripts/testProjectMemoryAssistant.js            OK
node -e "require('./src/routes/index.js')"                            OK (all routes load)
```

## 14. Diff Review

```
$ diff -rq <original upload> <this submission> --exclude node_modules --exclude dist
Only in .../backend/scripts: testProjectMemoryAssistant.js
Only in .../backend/src/controllers: projectMemoryAssistantController.js
Files .../backend/src/routes/index.js differ            (additive — see below)
Only in .../backend/src/services: projectMemoryAssistantService.js
Only in .../frontend/src/components/ai: ProjectMemoryAssistant.jsx
Files .../frontend/src/pages/guide/GuideDashboard.jsx differ  (additive — see below)
Only in .../frontend/src/services: projectMemoryAssistantService.js
```
Both modified-file diffs were inspected line-by-line and are **purely
additive** — no line was deleted, no existing route/import/state/section
was touched. No `.env`, secret, credential, `node_modules`, `dist`, or
cache file is part of the diff.

## 15. Known Limitations

- **Deterministic keyword/phrase retrieval only** — no semantic
  understanding beyond token overlap (reused from Step 24's
  `tokenOverlap`). A question phrased very differently from the stored
  record's wording may under-match.
- **No external LLM.** Answers are templated over real retrieved fields,
  not generated prose.
- **No vector database** — none existed in this codebase before Step 28,
  and none was added.
- **No automatic task mutation or conflict resolution.** The assistant is
  read-only; it can mention an open conflict alongside a task's real
  assignee, but it never changes ownership or resolves anything.
- **Answers depend entirely on what's already been extracted/persisted**
  by Steps 24/26/27 — if a decision was never recorded as Project
  Knowledge, this assistant cannot know about it (by design — it never
  falls back to reading raw chat).
- **No answer when evidence is insufficient** — the assistant always
  prefers `INSUFFICIENT_DATA` over a guess.
- **Meeting Intelligence, Project Health, Forecast, Team Risk, and Sprint
  answers are guide/team-leader only**, matching the existing lack of a
  student-safe shape for these features elsewhere in the codebase (Step
  19 of the spec: do not invent a new student page/shape where none
  exists yet).
- **History is ephemeral by design** — no per-question audit log is
  created, matching the spec's "do not persist every question by
  default" instruction, since no existing appropriate audit/history
  mechanism for this kind of ad-hoc query exists in the codebase yet.

## 16. Exact Commands Run

```
cd backend && npm install --no-audit --no-fund
cd backend && node --check src/services/projectMemoryAssistantService.js
cd backend && node --check src/controllers/projectMemoryAssistantController.js
cd backend && node -e "require('./src/routes/index.js')"
cd backend && node scripts/testProjectMemoryAssistant.js
cd backend && for f in <29 existing test scripts>; do node scripts/$f.js; done
cd frontend && npm install --no-audit --no-fund
cd frontend && npm run build
cd frontend && npm run lint
diff -rq <original> <modified> --exclude node_modules --exclude dist
```
