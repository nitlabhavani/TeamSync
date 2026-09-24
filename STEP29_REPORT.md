# STEP 29 — AI Actionable Project Insights & Recommendation Engine

## 1. Feature Summary

An **orchestration layer**, not a new scoring engine. It turns the outputs
of every existing TeamSync AI intelligence system into a short,
deduplicated, ranked list of "what needs attention / why / what to do /
evidence" recommendation cards:

- What needs attention → `title`
- Why → `reason`
- What action is recommended → `recommendation`
- Evidence → `evidence[]` (real source ids)
- Priority/severity → `priority` (CRITICAL/HIGH/MEDIUM/LOW)
- Related object → `relatedItems[]`
- What happens if ignored → `consequenceIfIgnored` (only when an existing
  forecast/risk/team-risk system already provides that language)

No external LLM/API. No new task/health/risk/forecast score. Read-only —
never persists a new snapshot, never mutates a Task/Conflict/
ProjectKnowledge/Meeting/SprintPlan/Health/Forecast/Risk document.

## 2. Architecture

Two layers, matching every other AI module in this codebase
(`projectMemoryAssistantService.js`, `projectExecutionCopilotService.js`):

1. **`gatherActionableInsightsEvidence(group, opts)`** (DB access only) —
   reads real documents. A plain student's evidence bundle stops after
   Tasks (scoped to `assignee: userId`) and Conflicts (scoped to
   `involvedUserIds: userId`) — every guide-only source (`teamRisk`,
   `forecast`, `health`, `executionCopilot`, `sprintPlan`,
   `meetingIntelligence`, `knowledge`) is returned `null`/`[]` **and is
   never even fetched** for a student (`if (!isGuideOrLeader) return
   evidence;` — an early return before any guide-only service call).

2. **`buildActionableInsights(evidence, opts)`** (pure, deterministic) —
   no DB, no I/O. Same evidence in → same recommendation list out, always.
   This is what `backend/scripts/testActionableInsights.js` exercises
   directly (40 checks, no database required).

`generateActionableInsights(group, opts)` orchestrates both and is what
the controller calls.

Files:
- `backend/src/services/actionableInsightsService.js` (new)
- `backend/src/controllers/actionableInsightsController.js` (new)
- `backend/src/routes/index.js` (+15 lines, one new route, additive only)
- `backend/scripts/testActionableInsights.js` (new)
- `frontend/src/services/actionableInsightsService.js` (new)
- `frontend/src/components/ai/ActionableInsightsPanel.jsx` (new)
- `frontend/src/pages/guide/GuideDashboard.jsx` (+29 lines: 1 icon import,
  1 component import, 1 state hook, 1 new collapsible `<section>` — no
  existing section touched or removed)

## 3. Recommendation Categories (17)

`OVERDUE_TASK`, `BLOCKED_TASK`, `DEADLINE_RISK`, `WORKLOAD_IMBALANCE`,
`TEAM_RISK`, `PROJECT_FORECAST_RISK`, `PROJECT_HEALTH_RISK`,
`REVIEW_BACKLOG`, `COLLABORATION_RISK`, `OPEN_CONFLICT`,
`UNRESOLVED_MEETING_ACTION`, `UNRESOLVED_DECISION`, `STALE_KNOWLEDGE`,
`SPRINT_RISK`, `EXECUTION_RISK`, `PRIORITY_MISMATCH`, `DEPENDENCY_RISK`.

Only generated when real evidence supports them — an empty/healthy
project produces an empty list (test #21).

## 4. Evidence Model

Every recommendation carries `evidence: [{ sourceType, sourceId, label,
snippet }]` with **real, queried source ids** — a Task `_id`, a
`ConflictSnapshot._id`, a `MeetingIntelligenceSnapshot._id`, a
`ProjectKnowledge._id`, a `SprintPlan._id`, or a deterministic
`groupId:source:status` pointer for group-level Team
Risk/Forecast/Health cards (those systems don't persist a snapshot when
called with `{persist:false}`, so there is no document id to cite — the
pointer instead cites the exact status/score that was reused, verifiable
against the live Team Risk / Forecast / Health panels). Nothing is ever
invented; test #19/#29 assert evidence ids match the real input ids.

## 5. Reuse of Existing Intelligence (no duplicate scoring)

| Category | Reused from | How |
|---|---|---|
| `TEAM_RISK` | `teamRiskAnalyzer.analyzeGroupRisk(group,{persist:false})` | `riskLevel`/`riskScore`/`reasons` quoted verbatim |
| `WORKLOAD_IMBALANCE` | same — `warnings[type=STUDENT_OVERLOAD]` | quoted verbatim, no new workload formula |
| `COLLABORATION_RISK` | same — `collaborationRisks[]` | quoted verbatim |
| `PROJECT_FORECAST_RISK` / `DEADLINE_RISK` (group-level) | `projectForecastService.runProjectForecast(group,{persist:false})` | `status`/`probability`/`evidence` quoted, never recomputed |
| `PROJECT_HEALTH_RISK` | `projectHealthService.getProjectHealth(group,{persist:false})` | `health`/`healthScore`/`topIssues` quoted |
| `EXECUTION_RISK` | `projectExecutionCopilotService.getExecutionCopilot(group,{persist:false})` | only its `recommendedReassignments[]` (task-specific, not already covered by `WORKLOAD_IMBALANCE`) |
| `SPRINT_RISK` | latest persisted `SprintPlan.riskSummary` | read directly, never re-run through the planner |
| `DEPENDENCY_RISK` | `sprintPlannerService.computeBlockingCounts` | called directly, unmodified |
| `OPEN_CONFLICT` | `ConflictSnapshot` + `conflictDetectionService.shapeForStudent` | read-only query + existing shaping fn |
| `UNRESOLVED_MEETING_ACTION` | `MeetingIntelligenceSnapshot` | read-only query |
| `UNRESOLVED_DECISION` / `STALE_KNOWLEDGE` | `ProjectKnowledge` | read-only query |
| `OVERDUE_TASK` / `BLOCKED_TASK` / `DEADLINE_RISK` (task) / `REVIEW_BACKLOG` / `PRIORITY_MISMATCH` | `Task` + `teamRiskAnalyzer.OPEN_TASK_STATUSES`/`DONE_STATUSES` | direct query using the **same thresholds already used elsewhere in this codebase** — 7-day stalled, 14-day "blocked→HIGH", 3-day "overdue→HIGH", 2-day due-soon, review-backlog>2 (all copied from `teamRiskAnalyzer.js` / `projectExecutionCopilotService.js` / `interventionRecommendationService.js`, never reinvented) |

`interventionRecommendationService.js` (the existing forecast-only
recommendation generator) was inspected; its category and threshold
conventions were reused where they overlapped, rather than a second
implementation of the same idea.

## 6. Priority Rules (deterministic, §15 of spec)

- **CRITICAL** — underlying Team Risk/Forecast/Health/Sprint system
  itself reports CRITICAL.
- **HIGH** — that system reports HIGH/LIKELY_LATE/AT_RISK(health); an
  overdue task ≥3 days or priority high/critical; a blocked task stalled
  ≥14 days; review backlog ≥5; a HIGH/CRITICAL conflict severity (quoted).
- **MEDIUM** — moderate risk, unresolved meeting/decision follow-up,
  workload imbalance, dependency bottleneck, priority mismatch, near-term
  deadline.
- **LOW** — stale (unconfirmed) knowledge, minor unresolved meeting item.

No probabilities are claimed — this is an if/else mapping over already-computed values.

## 7. Deduplication (§16)

`buildFingerprint(groupId, category, relatedItems)` = `groupId:category
[:type:id,...]`. Group-level categories (Team Risk/Forecast/Health/
Workload/Sprint — no specific related item) collapse to exactly one card
per generation run. Task/conflict/knowledge-specific categories key on
the real object id, so the same task can never produce two cards in the
*same* category. Cross-signal duplication is prevented at the source:
a Meeting Intelligence blocker that references a task already flagged as
`BLOCKED_TASK`/`OVERDUE_TASK` is merged in as **extra evidence on that
same card** instead of creating a second card (test #18). `deduplicate()`
additionally collapses any accidental exact-fingerprint collision as a
final safety net (test #17).

## 8. Ranking (§17)

`rankInsights()` sorts by: 1) priority, 2) whether the category is
inherently deadline-bearing (OVERDUE_TASK/DEADLINE_RISK/SPRINT_RISK/
DEPENDENCY_RISK first), 3) a fixed category-impact table (health →
forecast → team risk → sprint → task-level → conflict → …), 4) evidence
confidence, 5) recency of the underlying evidence. No randomness, no
learned ordering (test #30 asserts input-order independence).

## 9. API

`POST /groups/:groupId/ai/actionable-insights`

Body (all optional): `{ limit, priority, category }`. `groupId` always
comes from `req.group` (verified by the existing `requireGroupAccess`
middleware against `req.params.groupId`) — **never** trusted from the
request body. Malformed `limit` is silently ignored (returns unlimited);
an invalid `priority`/`category` returns `400`.

Response:
```json
{
  "success": true,
  "groupId": "...",
  "generatedAt": "...",
  "summary": { "total": 5, "critical": 1, "high": 2, "medium": 2, "low": 0 },
  "recommendations": [ ... ]
}
```

## 10. Authorization & Privacy

- Reuses `requireGroupAccess` (route-level) and `canRequestRecommendation`
  (`smartTaskAssignmentService.js` — the same guide/team-leader check used
  by Sprint Planner, Conflicts, and Project Memory Assistant).
- A plain student receives **only** `OVERDUE_TASK`/`BLOCKED_TASK` for
  tasks assigned to them and `OPEN_CONFLICT` for conflicts they're
  involved in (via the existing `shapeForStudent`) — verified structurally
  (early-return before any guide-only fetch) and behaviorally (tests
  #24/#25).
- This module never requires or queries the `Message` model — private/
  direct chat can never reach it (test #26 greps the source for this).
- Every query is scoped by `group: group._id` (ObjectId), never a group
  name, so two same-name groups can never see each other's insights
  (tests #22/#23).
- `automaticAction` is hardcoded `false` on every recommendation (test
  #36) — this endpoint only ever reads; it never creates/updates/deletes
  a Task, Conflict, ProjectKnowledge, Meeting, SprintPlan, or any
  snapshot (test #28 greps the service for mutating Mongoose calls).

## 11. Frontend

- `frontend/src/services/actionableInsightsService.js` — one function,
  `getActionableInsights(groupId, options)`, using the existing `api`
  helper from `lib/apiClient.js` (same pattern as
  `projectMemoryAssistantService.js`).
- `frontend/src/components/ai/ActionableInsightsPanel.jsx` — header,
  description, CRITICAL/HIGH/MEDIUM/LOW summary chips, an All/Critical/
  High/Medium/Low filter row, and recommendation cards (priority badge,
  category, title, reason, recommendation, confidence badge, expandable
  evidence list). Loading/error/empty states mirror
  `ProjectMemoryAssistant.jsx` exactly (same `friendlyError()` pattern).
  **No "Review" navigation button was added** — the spec explicitly
  forbids inventing URLs, and no existing task/conflict/knowledge detail
  route was confirmed during inspection, so evidence is shown inline
  (expand/collapse) instead. See Known Limitations.
- Wired into `GuideDashboard.jsx` as a new collapsible section, styled
  identically to the existing Project Health/Execution/Knowledge/Memory
  Assistant sections, placed directly after "AI Project Memory Assistant".

## 12. Tests

`backend/scripts/testActionableInsights.js` — **40/40 passed** (minimum
required: 30). Pure-function tests against hand-built evidence objects,
no database required (same convention as
`testProjectExecutionCopilot.js`/`testProjectHealth.js`). Covers every
item in the spec's list: basic generation, overdue/blocked/deadline/
team-risk/forecast/health/conflict/meeting/decision reuse, superseded-
decision exclusion, workload, dependency, priority mismatch, deterministic
priority, fingerprinting, dedup, multi-source evidence merging, real
evidence ids, empty-project, group isolation, same-name-group isolation,
unauthorized/student-safe shaping, private-chat structural exclusion,
guide access, no-DB-mutation, no-fabrication, deterministic ordering,
limit handling, malformed input, resolved-conflict exclusion, completed/
rejected-task exclusion — plus 5 extra checks (automaticAction invariant,
category filter, priority filter, and two builder-level edge cases).

## 13. Regression

All 36 pre-existing backend test scripts were re-run after the Step 29
changes:

- **35/36 pass**, unchanged from before this step.
- `testEmail.js` fails — but purely on missing `SMTP_HOST/SMTP_USER/
  SMTP_PASS` in `backend/.env`, the exact same pre-documented Step 28
  environment limitation. Not a regression; not silently converted to a
  PASS.
- `routes/index.js` loads with no errors after the new route was added.
- `ai-engine/app.py` (Python, untouched) still compiles (`py_compile`).

## 14. Build / Lint / Syntax

- `node --check` on all 3 new backend files: clean.
- `npx eslint@8` (temporary flat rule set) on the 2 new backend source
  files + the new test script: **0 errors, 0 warnings**.
- `npm run build` (frontend, Vite/TanStack Start): **succeeds**.
- `npx eslint .` (frontend's own `eslint.config.js`) on the 3 new/modified
  frontend files: the new `.js` service file lints clean (0
  errors/warnings). The two `.jsx` files show "File ignored because no
  matching configuration was supplied" — this is a **pre-existing,
  repo-wide condition**: the project's `eslint.config.js` only targets
  `**/*.{ts,tsx}`, so no `.jsx` file in the whole codebase is linted by
  `npm run lint` today. Verified by running the same command against the
  pre-existing `ProjectMemoryAssistant.jsx` (Step 28), which shows the
  identical warning. Step 29 did not introduce or worsen this gap.

## 15. Diff Review

No `.git` history was present in the uploaded zip, so a manual diff was
run against a pristine extraction of the original upload. Result:
- 5 new files (3 backend, 2 frontend) — exactly the ones listed in §2.
- 2 modified files — `backend/src/routes/index.js` (+15 lines, one new
  route block) and `frontend/src/pages/guide/GuideDashboard.jsx` (+29
  lines: 1 icon import, 1 component import, 1 state hook, 1 new
  section) — both diffs shown to add-only, no line removed, no existing
  section/route touched.
- No `.env`/secrets/credentials, no `node_modules`, no `dist`/build
  caches, no unrelated refactor anywhere in the diff.
- Step 28 Project Memory Assistant's own files are byte-identical to the
  original upload.

## 16. Known Limitations

- Deterministic rule-based recommendations only — no external LLM, no
  learned/ML recommendation model.
- No automatic actions of any kind: no task reassignment, no deadline or
  priority change, no conflict resolution, no task creation.
- Recommendations depend entirely on already-persisted project
  intelligence — if Team Risk/Forecast/Health haven't been computed
  recently for a group, those categories simply won't fire (this is by
  design: `{persist:false}` reads live but never backfills).
- Workload/priority-mismatch recommendations depend on the task data
  actually present — no invented capacity or estimated-hours values are
  ever used (none are stored in this schema).
- No private-chat analysis; no prediction invented by this feature beyond
  what the reused systems already compute.
- The frontend "View evidence" control expands evidence inline rather
  than navigating to the underlying task/conflict/knowledge page — no
  confirmed detail route existed for all evidence types during
  inspection, and the spec explicitly prohibits inventing a URL. A future
  step could wire real navigation once those routes are confirmed.
- `EXECUTION_RISK` deliberately fires only on Execution Copilot's
  *reassignment* suggestions (not its overall status/score), since that
  score is itself reused verbatim from Project Health — surfacing it
  again under a different category would violate the anti-duplication
  rule (§16 of the request).

## 17. Exact Commands Run

```
node --check backend/src/services/actionableInsightsService.js
node --check backend/src/controllers/actionableInsightsController.js
node --check backend/src/routes/index.js
node backend/scripts/testActionableInsights.js                  # 40/40
for f in backend/scripts/test*.js; do node "$f"; done            # 35/36 (+testEmail.js SMTP-only)
node -e "require('./backend/src/routes/index.js')"               # route loading
python3 -m py_compile ai-engine/app.py                            # untouched, still compiles
cd backend && npm install && npx eslint@8 <3 new files>           # 0 errors/warnings
cd frontend && npm install && npm run build                       # success
cd frontend && npx eslint <3 new/modified files>                  # 0 errors on .js; pre-existing .jsx gap only
diff -rq <pristine extraction> <working copy>                     # manual diff review (no .git in upload)
```
