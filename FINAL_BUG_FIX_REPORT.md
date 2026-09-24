# TeamSync AI — Final Bug Fix Report

Scope: Guide Dashboard AI Memory Assistant, Private Chat file sharing, Add Task role permission.
No new features, no rewrite, no external LLM, no fabricated data. All claims below are backed by
tests actually run in this environment (commands and output included).

---

## 1–5. Issue 1 — AI Project Memory Assistant

**Reported symptom:** different questions return the same (or effectively the same) answer.

**Investigation:** traced the full pipeline end to end:
`ProjectMemoryAssistant.jsx` → `services/projectMemoryAssistantService.js` →
`POST /groups/:groupId/ai/project-memory/ask` → `projectMemoryAssistantController.ask` →
`askProjectMemory()` → `classifyIntent()` → per-intent retrieval → answer builder → response →
frontend render.

I did **not** find the reported bug in this codebase:
- The route is wired correctly to the correct controller (no duplicate/shadow route).
- `classifyIntent()` is a pure, deterministic regex-rule table. Run directly against your exact
  example questions:
  ```
  "What are the current project deadlines?" -> DEADLINES
  "What decisions were made in the project?" -> DECISIONS
  "What are the current blockers?"           -> BLOCKERS
  "Which tasks are overdue?"                 -> DEADLINES
  "How is the project doing?"                -> PROJECT_OVERVIEW
  "What conflicts are open?"                 -> CONFLICTS
  "What happened in the last meeting?"       -> MEETING_SUMMARY
  "What is the current sprint?"              -> SPRINT_STATUS
  ```
  Eight different, correct intents.
- Each intent has its own retrieval + answer-builder function (decisions, tasks, deadlines,
  blockers, conflicts, meetings, health, forecast, sprint, knowledge search) that queries
  different Mongo collections/fields and produces different templated text.
- No caching layer, no response-reuse, no shared/module-level mutable state in the controller,
  service, or frontend component that could cause a stale answer to be redisplayed.
- The frontend correctly sends the freshly-typed question on every ask and replaces `result`
  state with the new response; it does not reuse a previous answer while loading.

**Root cause:** none reproducible in this shipped code.

**Fix applied anyway (hardening, not a bug fix):** added a request-id race-guard in
`ProjectMemoryAssistant.jsx` so that if two "ask" calls were ever in flight concurrently (e.g. a
slow request followed by a fast one), only the response to the *most recently sent* question is
ever applied to state. This closes a theoretical gap even though I could not trigger it.

**Test results (existing suite, re-run, unchanged):**
```
node backend/scripts/testProjectMemoryAssistant.js
30 checks passed.
```
This suite already asserts (among other things) that 4+ materially different questions produce
different intents, that evidence/source types match the question, that group isolation holds,
and that an empty/no-data project never fabricates an answer.

**If this is still reproducible in your real deployment**, the most likely explanations are
outside this code: a stale frontend build being served (no `frontend/dist` was present in the
uploaded zip, so this can't be confirmed either way here), a reverse proxy/CDN caching the POST
response by URL only, or a different (older) build of this file being deployed. I flag this
honestly rather than claim a fix for a bug I could not find or trigger.

---

## 6–14. Issue 2 — Private/Single Chat file sharing

**Root cause (confirmed, three independent points of failure):**
1. `ChatInput.jsx`'s attach button and `useFileUpload` call were hard-gated on a `groupId` prop.
   `SingleChat.jsx` never passed one (correct — a DM isn't a group), so the button was always
   disabled in private chat.
2. `chatService.js`'s `sendMessage()` explicitly dropped `attachments` when `scope === "direct"`.
3. `PrivateChat.jsx`'s `onSend` handler only accepted `(text)`, not `(text, attachments)`.

**Fix (reusing the existing architecture, kept private data private):**
- New `backend/src/middleware/directUpload.js` — same multer config/size-limit
  (`MAX_UPLOAD_MB`) and filename-safety pattern as the existing group `middleware/upload.js`,
  but stores files per-conversation (`uploads/private/<conversationKey>/`) instead of per-group.
  Deliberately does **not** create a `FileAsset` document (that model requires a `group`, and
  using one would put a private file in the group's "Shared Files" tab / group file AI analysis
  — exactly what the spec forbids).
- New endpoints: `POST /chat/direct/:userId/files` (upload) and
  `GET /chat/direct/:userId/files/:filename/download` (authenticated download). Both derive the
  storage/access folder from `Message.conversationKey(req.user._id, :userId)` — the same helper
  already used by `directMessages`/`sendDirectMessage` — so a non-participant can never resolve
  the real folder even if they know the exact filename and guess a userId.
- `sendDirectMessage` now accepts and sanitizes `attachments` the same way `sendGroupMessage`
  already did (reused `sanitizeAttachments`).
- Frontend: `ChatInput` now accepts an optional `peerUserId`; `useFileUpload`/`fileService` route
  through the new direct endpoint when there's no `groupId`; `chatService.sendMessage` no longer
  drops attachments for direct scope; `PrivateChat.jsx` forwards them.
- Group chat's own file-sharing code path (`fileController.js`, `/groups/:groupId/files`) is
  **untouched** except exporting its existing internal `kindOf()` helper for reuse (no duplicate
  file-type-classification logic).

**Privacy/security verification (real, run):**
```
node backend/scripts/testPrivateChatFileSharing.js
ok - 1. private attachment upload succeeds and returns {name,url,size,type,mimeType}
ok - 2. private attachment is never written into a group-shaped folder
ok - 3. the other participant (B) can download A's private attachment
ok - 4. a non-participant (C) cannot access the private attachment by manipulating :userId
ok - 5. even the real uploader cannot fetch it under the wrong conversation key
ok - 6. oversized file is rejected using the existing MAX_UPLOAD_MB rule
ok - 7. a request with no file is rejected
ok - 8. Message model still requires text-or-attachment for direct messages, and a file-only
        message is valid
8 checks passed.
```
This is a real Express app + real multer middleware + real controller code, hit with real HTTP
requests — not a re-implementation of the logic being tested.

**Known limitation (pre-existing, not introduced by this fix):** uploaded files (both group and
now private) are additionally served by the app's public `express.static("/uploads", ...)`
middleware with no auth check, so anyone who obtains the *exact* URL could fetch the file
directly, bypassing the authenticated download route. This is an existing architectural
characteristic of the group file system that this fix deliberately mirrors (per the instruction
to keep the current file-storage architecture unless a genuine new security bug is found) rather
than a new regression — but it's worth flagging for a future hardening pass (e.g. moving uploads
out of the statically-served tree, or adding per-file access tokens).

---

## 15–24. Issue 3 — Add Task role permission

**Root cause (confirmed):** both "New task" buttons in `Tasks.jsx` (main toolbar and the
empty-state) had no role/permission check at all — any authenticated group member could open the
create-task form and submit it. The backend (`taskController.create`) already independently
enforced `req.isGuide || String(req.group.leader) === String(req.user._id)`, correctly scoped to
`req.group` (the specific group from the URL, resolved by `requireGroupAccess`), so this was a
frontend-visibility gap, not an actual privilege-escalation vulnerability — but it still violates
the explicit requirement to hide/disable the control for unauthorized users.

**Fix:**
- Added `canCreateTask` in `Tasks.jsx`, using the exact same source of truth already used
  elsewhere in the same file (`canRequestAiAssignment`): `user.role === "guide"` OR
  `group.leaderId === user.id`, where `group` is the specific group currently being viewed
  (`groups.find(g => g.id === groupId)`) — never a hardcoded name, never just "any leader-like
  role."
- Both "New task" buttons and the create-task form panel itself are now only rendered when
  `canCreateTask` is true (hidden entirely, matching the app's existing UX pattern).
- `handleCreate` also short-circuits if `!canCreateTask`, as a second (belt-and-suspenders)
  frontend layer — the backend remains the actual authority.
- Backend authorization (`taskController.create`, `update`, `remove`, and the AI
  recommendation/expansion/plan endpoints) was **not modified** — it was already correct and is
  now covered by a new dedicated test (see below). AI/system task creation
  (`AIProjectPlanModal.jsx` → `projectPlanService.createTasksFromPlan`) is guide-only-surfaced
  already (only rendered in `GroupManagement.jsx`, a guide page) and was not touched.

**Test results (new, run against the real controller code):**
```
node backend/scripts/testAddTaskAuthorization.js
ok - 1. Guide can create a task
ok - 2. Team Leader can create a task in the group they lead
ok - 3. A plain student cannot create a task (backend 403, not just UI)
ok - 4. An unauthorized user cannot create a task
ok - 5. Team Leader of Group A cannot create a task in Group B
ok - 6. Guide of Group B can add a task to Group B
6 checks passed.
```
This exercises the real `taskController.create` authorization line (`Task`/`Group`/
`notificationService` are monkeypatched with in-memory fakes so no live MongoDB is required —
same convention already used by `testProjectMemoryAssistant.js`), confirming group isolation:
a team leader of Group A gets a real 403 when targeting Group B.

---

## 25–26. Step 33 / Step 34 preservation

```
node backend/scripts/testTaskReassignmentIsolation.js   → 15 test(s) passed.  (Step 33)
node frontend/scripts/testHighlightController.js        → 6/6 passed.        (Step 34)
node backend/scripts/testNotificationChatNavigation.js  → all passed.        (Step 34)
```
`taskSubmissionScope.js` and `highlightController.js` were not modified.

---

## 31–34. Full regression / build / lint / security

Every script under `backend/scripts/test*.js` was run (49 scripts). All pass except
`testEmail.js`, which is an SMTP *configuration* check (requires real Brevo credentials in
`.env`) — not a functional test, and unrelated to any change here; it fails identically on the
unmodified project in this sandbox (no `.env` present).

`testStep32ProductionVerification.js`: **67/67 passed** (was 66/67 before I ran
`npm run build` in `frontend/` — the one prior failure was simply that no `dist/` existed yet).

Frontend:
```
npm run build   → succeeded (vite build, no errors)
npm run lint    → 1 pre-existing error (react-hooks/exhaustive-deps rule config issue in
                  src/hooks/useGroups.js, a file this task did not touch) + pre-existing
                  shadcn/ui "fast refresh" warnings. Zero new errors/warnings from any file
                  changed in this task (verified by targeted eslint runs on each modified file).
```

**Security tests performed directly:**
- Direct API task creation by a student → rejected (403), independent of the UI (test #3/#4
  above).
- Non-participant private-chat-attachment access via manipulated `:userId` → rejected (404),
  including the "real uploader, wrong conversation" case (test #5 above).
- Group isolation for task creation (leader of A vs group B) → rejected (test #5 above).

**Browser/live-DB testing:** not performed — this sandbox has no running MongoDB instance and no
browser automation available. All tests above are real, running code (Express + real
middleware/controllers + real HTTP requests over a real socket), not static inspection, but they
substitute in-memory fakes for the database layer where a live Mongo connection would otherwise
be required. I'm stating this limitation explicitly rather than claiming live browser/DB
verification that didn't happen.

---

## Exact files changed

**Backend**
- `backend/src/controllers/chatController.js` — direct-message attachments + new
  `uploadDirectFile`/`downloadDirectFile` handlers.
- `backend/src/controllers/fileController.js` — exported existing `kindOf()` helper for reuse
  (no logic change).
- `backend/src/middleware/directUpload.js` — **new** (private chat file upload).
- `backend/src/routes/index.js` — two new routes for private chat file upload/download.

**Frontend**
- `frontend/src/components/ai/ProjectMemoryAssistant.jsx` — race-guard hardening (see Issue 1).
- `frontend/src/components/chat/ChatInput.jsx` — `peerUserId` support for private chat.
- `frontend/src/components/chat/SingleChat.jsx` — passes `peerUserId`/`currentUserId` through.
- `frontend/src/hooks/useFileUpload.js` — routes to direct upload when there's no `groupId`.
- `frontend/src/pages/student/PrivateChat.jsx` — forwards attachments to `sendMessage`.
- `frontend/src/pages/student/Tasks.jsx` — `canCreateTask` gating (Issue 3).
- `frontend/src/services/chatService.js` — stops dropping attachments for direct-scope sends.
- `frontend/src/services/fileService.js` — new `uploadDirectFile()`.

**Tests (new)**
- `backend/scripts/testPrivateChatFileSharing.js` — 8 checks.
- `backend/scripts/testAddTaskAuthorization.js` — 6 checks.

No other files were modified. No debug code, console logs of sensitive data, or temporary
test users/data were left in the source tree (verified by diffing against the original upload).

---

## Bugs fixed
1. Private/single chat had no working file sharing (three independent frontend causes + missing
   backend endpoint) — fixed.
2. "Add Task" was visible/clickable for plain students (frontend-only exposure; backend was
   already correctly enforcing the rule) — fixed, and now covered by an automated regression test.

## Known limitations
- Issue 1 (AI Memory Assistant "same answer" bug) could not be reproduced in this codebase;
  see the detailed analysis above.
- Live MongoDB / browser testing was not available in this environment; all new tests substitute
  faithful in-memory fakes for the database where required, following this project's existing
  test conventions.
- Pre-existing static-file-serving exposure (see Issue 2 section) noted but not changed, per the
  instruction to preserve existing architecture absent a newly-introduced security bug.

## Final release status
All requested fixes for Issues 2 and 3 are implemented and tested; Issue 1 is reported honestly
as not reproducible. All existing regression suites pass. Frontend builds cleanly. No unrelated
files were touched.
