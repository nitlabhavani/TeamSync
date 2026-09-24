# TeamSync AI — Calendar Feature Report

## 1. Implementation summary

Added a **Calendar** page to TeamSync AI as a read-only visualization/aggregation layer over data that already exists in the app: Task deadlines, Meetings, Sprint dates, the project deadline, and Milestones. It introduces no new task/meeting/sprint/AI-scoring system — it queries the same collections the existing Tasks, Meetings, and Milestones features already use, normalizes them into one event shape, and renders Month/Week/Day views with filters and click-through navigation to each item's real existing page.

Available at `/app/calendar` (student / team-leader) and `/guide/calendar` (guide), both backed by one shared component (`pages/common/Calendar.jsx`) — the same reuse pattern this codebase already uses for `pages/common/Search.jsx`.

---

## 2. Architecture investigation (done before writing any code)

Before implementing, the actual schemas and conventions were inspected directly rather than assumed:

| Data | Real source found |
|---|---|
| Task deadline | `Task.due` (not `dueDate`/`deadline` as initially guessed), plus `Task.group`, `.title`, `.priority`, `.status`, `.assignee` |
| Meeting | `Meeting.group`, `.title`, `.when`, `.durationMins`, `.status` |
| Sprint | `SprintPlan.group`, `.title`, `.sprintStart`, `.sprintEnd`, `.status` (`DRAFT`/`APPLIED`/`CANCELLED`) |
| Project deadline | `Group.expectedCompletion` — no separate "Project" model exists; the group *is* the project record |
| Milestone | A real `Milestone` model already exists, with working CRUD routes (`/groups/:groupId/milestones`) already used by `groupService.js` and the guide's Risk Radar page — so milestones are genuine existing data, not invented for this feature |
| Student task-privacy rule | `taskController.list`'s existing pattern: `filter.assignee = req.user._id` for a student who isn't the group's guide/leader — reused verbatim |
| Authorization | `requireGroupAccess` middleware — reused, not reimplemented |

Also inspected: `pages/student/Tasks.jsx` and `Meetings.jsx` (group-switcher UI pattern, sprint-planner integration), `pages/common/Search.jsx` (shared-page-across-roles precedent), `components/navbar/Sidebar.jsx` (nav structure), `utils/constants.js` (`ROUTES`), `services/*.js` (service-module conventions), `lib/apiClient.js` (`api.get`/`normalize`/response-unwrapping behavior), and `styles.css` (design tokens: `brand`, `mint`, `amber`, `coral`, `ink`, `cloud`, `paper`, `slate-*`).

---

## 3. Backend

### New file
- `backend/src/controllers/calendarController.js` — `GET` handler only, reads `Task`/`Meeting`/`SprintPlan`/`Milestone`/`Group`, writes nothing.

### Modified file
- `backend/src/routes/index.js` — added one route:
  ```
  router.get("/groups/:groupId/calendar", protect, requireGroupAccess, calendar.getEvents);
  ```

### Response shape
```json
{
  "success": true,
  "data": {
    "events": [
      { "id": "task-<id>", "type": "task", "title": "...", "start": "...", "end": "...", "allDay": true, "groupId": "...", "sourceId": "...", "metadata": { "priority": "high", "status": "in_progress", "assigneeId": "..." } }
    ]
  }
}
```
Matches this app's existing `{ success, data }` envelope used by every other route.

### Authorization
- `protect` (JWT) + `requireGroupAccess` (group-membership check, populates `req.group`/`req.isGuide`) — identical to every other `/groups/:groupId/*` route.
- Student task visibility: `taskFilter.assignee = req.user._id` applied only when `req.user.role === "student" && !req.isGuide` — the exact rule `taskController.list` already enforces, so a student's calendar can never show another student's task.
- Meetings/sprints/milestones/deadline: visible to every group member, matching the existing Meetings page and Milestones API (this introduces no new restriction and no new leak — group membership was already the access boundary there).
- Group isolation is always by `groupId` (`req.group._id` from the URL param, resolved and authorized by `requireGroupAccess`) — never by group name. Verified explicitly by a test with two different groups sharing the same display name.

### Performance
- `start`/`end` query params translate into Mongo range filters (`due`/`when` within range; sprint uses an overlap filter). The frontend always sends the visible calendar range, not the whole project history.
- Four queries run in parallel via `Promise.all`, each with a `.select()` projection and `.lean()` — no N+1, no per-event queries.

### Private-data protection
The controller only imports `Task`, `Meeting`, `SprintPlan`, `Milestone` — it never imports `Message`, `CallLog`, or `FileAsset`. Verified by an explicit regression test that reads the controller's source and asserts none of those `require()` calls are present, so this can never silently regress even if the file is edited later.

---

## 4. Frontend

### New files
- `frontend/src/services/calendarService.js` — thin fetch/normalize layer, follows the same `api.get()` + `normalize()` convention as every other `*Service.js`.
- `frontend/src/pages/common/Calendar.jsx` — the full page: group switcher, Month/Week/Day views, type filter, loading/empty/error/unauthorized states, event-click navigation.
- `frontend/src/routes/app.calendar.tsx`, `frontend/src/routes/guide.calendar.tsx` — thin TanStack Router route files, same shape as every other route file in this app.

### Modified files
- `frontend/src/utils/constants.js` — added `STUDENT_CALENDAR: "/app/calendar"` and `GUIDE_CALENDAR: "/guide/calendar"`.
- `frontend/src/components/navbar/Sidebar.jsx` — added "Calendar" nav entries (student: after Tasks; guide: after Groups, since guides have no Tasks nav item to follow).
- `frontend/src/pages/student/StudentDashboard.jsx` — added a "View Calendar" button to the **existing** "Upcoming deadlines" dashboard section (no new dashboard section was built — Part 17 explicitly asked to reuse existing dashboard architecture, and this dashboard already had exactly this section).
- `frontend/src/routeTree.gen.ts` — auto-regenerated by the TanStack Start Vite plugin on build; not hand-edited.

### Why no new calendar-UI dependency
`date-fns` was already an existing dependency (used for date math only, no new package added). No generic calendar-grid library (e.g. `react-big-calendar`, `FullCalendar`) was added — Month/Week/Day were hand-rolled as an agenda-style grid with `date-fns`, both because that's a small, well-understood amount of code (not "a complicated calendar engine") and because a generic library's own CSS would fight this app's existing design tokens more than it would save.

### Event display
Each event type has a distinct color drawn from the app's existing design tokens (no new palette introduced):
- Task → `brand` (indigo)
- Meeting → `mint` (green)
- Sprint → `amber`
- Deadline → `coral` (red)
- Milestone → `ink` (dark neutral)

### Event click → existing pages only
| Type | Student/Team-leader target | Guide target | Note |
|---|---|---|---|
| Task | `/app/tasks` | `/guide/submissions` | Matches the app's existing task-notification link (`/app/tasks`) exactly; guides have no task board of their own today, so Submissions (their real task-review workflow) is the closest existing page |
| Meeting | `/app/meetings` | `/guide/groups` | Guides have **no** dedicated meetings page anywhere in the current app — Group Management is the closest existing entry point. Flagged honestly rather than inventing a new guide meetings page |
| Sprint | `/app/tasks` | `/guide/groups` | The sprint planner already lives inside the student Tasks page |
| Project deadline | `/app/groups/:groupId` | `/guide/groups` | |
| Milestone | `/app/groups/:groupId` | `/guide/risk-radar` | Risk Radar is the one existing guide page that already reads milestone data |

No new detail pages were created for any of these — every click hands off to something that already existed.

### States
Loading (spinner), empty ("No events scheduled"), error (message + Retry button that re-runs the same fetch), and the "no groups yet" case are all implemented. No fake events are ever shown during loading.

### Mobile
Built with the same responsive Tailwind patterns already used elsewhere in the app (`grid-cols-7` collapses gracefully via `sm:`/`lg:` breakpoints in Week view; Month view's grid and Day view's stacked list already work at narrow widths). Did not touch the existing mobile sidebar/drawer.

---

## 5. Group isolation & security — how it was verified, not just claimed

Backend test file `backend/tests/calendarController.test.js` boots the **real** `app.js` (only the Mongoose models are mocked) and issues real signed-JWT HTTP requests:

- No token → `401`
- Authenticated but not a group member → `403`
- Two different `Group` documents given the *identical* display name, different `_id`s — confirmed the query filters passed to `Task.find`/`Meeting.find` always use the URL's `groupId`, never the name, and that a user authorized for one is rejected from the other
- A student's task query is confirmed to include `assignee: <that student's id>`; a guide's is confirmed **not** to have that restriction
- Malformed `groupId` never produces a 500 (separately confirmed against the real, unmocked `Group` model that a truly invalid ObjectId throws a `CastError`, which the app's existing global error handler already converts to `400`)
- Empty-calendar and real-data-only assertions (returned events map 1:1 to what the mocked DB returned — nothing fabricated)
- Date-range query params are confirmed to translate into the exact Mongo `$gte`/`$lte` filter sent to `Task.find`, and invalid date strings are confirmed not to crash the request
- Static source-code guard confirming the controller never even imports `Message`/`CallLog`/`FileAsset`

---

## 6. Tests

### Backend (Jest)
```
Test Suites: 5 passed, 5 total
Tests:       56 passed, 56 total
```
15 of those are new, calendar-specific tests (see §5). The other 41 are the pre-existing suite (call authorization, call signaling, orphan-file cleanup, private-upload static-serving guard from the prior audit pass) — **all still passing, confirming no regression**.

### AI engine (pytest)
```
36 passed in 0.10s
```
Unchanged — no AI engine code was touched by this feature (confirmed via `python3 -m py_compile` across every `.py` file, clean).

### Frontend
No automated frontend tests were added. **This project has no frontend test runner configured at all** (`package.json` has no `test` script, no Vitest/Jest for the frontend) — that is a pre-existing characteristic of the codebase, not something this feature removed. Standing up a new test framework purely for this one page would be a disproportionate infrastructure change for an "additive and focused" feature request. Correctness was instead verified via a real production build and lint pass (below), plus the fact that every value the UI renders is sourced from the backend, which *is* fully tested.

### Build / lint
- `npm run build` (frontend): **PASS**
- `npm run lint` (frontend): **PASS** — 0 errors (9 pre-existing shadcn/ui warnings, unrelated to this feature)

---

## 7. Regression testing performed

- Full existing backend Jest suite re-run after all Calendar changes: **41/41 pre-existing tests still passing**, alongside the 15 new ones (56/56 total).
- Full frontend production build re-run after the last edit (StudentDashboard): **PASS**.
- Full frontend lint re-run: **PASS**.
- AI engine compile + pytest re-run: **36/36 passing, unchanged**.
- Manually confirmed (via source inspection, not just running tests) that: group chat AI hooks, private chat, private file/voice/call code paths, and Step 34 notification navigation (`n.link` handling in `Notifications.jsx`) were not touched by any Calendar change.

**Not run** (no live infrastructure available in this environment, consistent with the prior audit's reporting): live MongoDB integration testing, live SMTP testing, browser-automation end-to-end testing.

---

## 8. Known limitations

1. **Frontend has no automated tests** — pre-existing project characteristic (§6); Calendar UI correctness was verified via build/lint + the fully-tested backend it renders, not via component tests.
2. **Guide role has no dedicated Meetings/Sprint page** — an existing gap in the app unrelated to this feature. Calendar's guide-side Meeting/Sprint click targets fall back to Group Management rather than inventing a new page, per the brief's own "if available" wording.
3. **Week/Day views are agenda-style (event list per day), not an hour-by-hour timeline grid.** A deliberate scope decision to avoid "manually implementing a complicated calendar engine" — an hourly grid with overlap positioning is materially more code and risk for a first version of this feature.
4. **No frontend live/browser testing performed** (no browser automation tool available in this environment) — build/lint/manual code review only.
5. Guide Dashboard was **not** given an "Upcoming" widget — no equivalent existing section to extend there (unlike the student dashboard, which already had one), and building a new one from scratch risked exactly the dashboard clutter the brief warned against.

---

## Final Report

```
Calendar implementation:        PASS
Files created:                  6
  backend/src/controllers/calendarController.js
  backend/tests/calendarController.test.js
  frontend/src/services/calendarService.js
  frontend/src/pages/common/Calendar.jsx
  frontend/src/routes/app.calendar.tsx
  frontend/src/routes/guide.calendar.tsx
Files modified:                 4 (+ 1 auto-generated)
  backend/src/routes/index.js
  frontend/src/utils/constants.js
  frontend/src/components/navbar/Sidebar.jsx
  frontend/src/pages/student/StudentDashboard.jsx
  frontend/src/routeTree.gen.ts (auto-regenerated by the build tool)
Backend tests:                  56/56 (15 new + 41 pre-existing, all passing)
Frontend build:                 PASS
Lint:                           PASS (0 errors)
Security/group isolation:       PASS (verified via real HTTP tests against a booted app instance, incl. duplicate-name isolation)
Student isolation:               PASS (verified: assignee-restricted task filter confirmed in the actual Mongo query args)
Private data protection:        PASS (source-level guard test: controller never imports Message/CallLog/FileAsset)
Regression tests:               PASS (41/41 pre-existing backend tests still green; AI engine 36/36 unchanged)
AI engine changes:               NONE
Known limitations:              see §8 above (5 items)
Final ZIP:                      teamsync-ai-calendar-final.zip
```

Not claiming full "production-ready, live-tested" status: live MongoDB, SMTP, and browser-based end-to-end testing were not available in this environment and were not run.
