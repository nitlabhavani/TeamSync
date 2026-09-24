# TeamSync AI — Final Production Audit Report

**Scope of this pass:** a genuine, code-level audit of the existing project (not a rebuild). Every claim below is backed by a file/line reference, a real test run, or an explicit "not verified" note. Nothing here is invented, and no test result is fabricated.

---

## 0. Important caveat on "auditing Antigravity's changes"

The uploaded ZIP contains **no `.git` directory and no other version history**. There is no diff to compute. Instead, this audit inspected the **current state** of every file explicitly named in the brief (`validateDirectPeer`, `audioMagicBytes`, `orphanFileCleanup`, `audioPlaybackManager`, incoming-call caller info, PrivateChat peer loading) plus their full call graphs, and verified each one is correct, complete, and actually wired in — which is a stronger check than a diff would have given anyway (a diff shows what changed; it doesn't show what's still broken).

---

## 1. Critical finding & fix — private files reachable via unauthenticated static route

**File:** `backend/src/app.js`

**Finding:** Private direct-chat file attachments are written to disk at `uploads/private/<conversationKey>/<filename>` (see `middleware/directUpload.js`), where `conversationKey = Message.conversationKey(userA, userB)` — just the two participants' Mongo `_id`s, sorted and joined with `_`. That is **not a secret**: it's computable by anyone who knows both user ids (e.g. any other member of a shared group).

The app already has a correct, authenticated download route for these files (`GET /chat/direct/:userId/files/:filename/download`, in `chatController.downloadDirectFile`) that checks the requester is genuinely part of that conversation. **But** `app.js` also mounted `express.static` at `/uploads`, pointed at the *same* upload root — with no authentication at all. Anyone who could guess or observe a `conversationKey` and filename could fetch a private attachment directly via `GET /uploads/private/<key>/<filename>`, completely bypassing the authenticated controller.

This is exactly the issue Part 15 of the brief called out by name ("Do not expose private files through `/uploads` static middleware") — it was present, unfixed, in the ZIP as received.

**Fix:** added a guard middleware in `app.js` that rejects `/uploads/private/*` with `403` before it ever reaches `express.static`. This requires no data migration (files stay exactly where they are on disk) and does not touch group-file or profile-picture static serving, which continue to work exactly as before. Private attachments must now go through the authenticated chat API — which is what the frontend already uses.

**Verified:** new test `backend/tests/uploadsStaticAuth.test.js` boots the real `app.js` on an ephemeral port and confirms (a) a private path is rejected `403` unauthenticated, (b) a nested/traversal-style private path is also rejected, and (c) non-private static paths (e.g. profile pictures) are unaffected. **Passing.**

**Known residual scope note:** group files and profile pictures are still served by the same unauthenticated `express.static` mount. That was not reported as broken in the brief (Part 15's explicit language is about *private* files specifically), and closing it would mean moving group-file serving behind an authenticated controller — a larger, higher-risk change than this audit's scope justified without being asked. Flagging it here as a **known limitation**, not something silently left broken.

---

## 2. Confirmed finding & fix — `orphanFileCleanup.js` was written but never invoked anywhere

**Files:** `backend/src/utils/orphanFileCleanup.js`, `backend/server.js`

**Finding:** `grep -rln "orphanFileCleanup"` across the entire backend returned **zero results outside the file's own definition**. This exactly matches Part 3's warning: "a cleanup utility that is never invoked is NOT considered complete." Both `uploadDirectVoice` and `uploadDirectFile` are two-phase endpoints (file written to disk first, only becomes "real" once a follow-up message-send call references it) — if a client abandons that second step, the file is orphaned. Nothing was reconciling that.

It also only ever covered the voice-file root (`uploads-voice/private`) — regular private file attachments (`uploads/private`) had no cleanup path at all.

**Fix:**
- Wired a new `startOrphanCleanupScheduler()` into `server.js`, following the exact pattern already used by `startDeadlineScheduler`/`startReportScheduler` (first pass shortly after boot, then a fixed interval; both timers `.unref()`'d so they never hold the process open).
- Generalized the module to also reconcile the regular private-file root, not just voice.
- Kept every existing safety guarantee (age gate before touching a file, explicit Mongo `Message.exists` check before deleting, never deletes outside the configured root, never throws into the caller).

**Bug caught by the new tests, then fixed:** while writing real tests for this (mocking only `Message.exists`, exercising the filesystem for real — same style as the existing test suite), the tests caught that the voice-cleanup path resolution **didn't handle an absolute `VOICE_UPLOAD_DIR`** the same way `chatController.streamDirectVoice` already does — meaning cleanup would have silently pointed at the wrong directory in some deployment configs (e.g. containerized setups using an absolute path). This was a genuine, pre-existing latent bug in the never-invoked module — now fixed to match the controller's own resolution logic exactly.

**Verified:** new test file `backend/tests/orphanFileCleanup.test.js`, 9 tests — removes truly-orphaned files, never removes a Mongo-referenced file, never touches a fresh (possibly in-flight) file, never escapes the configured root, covers both the voice and regular-file roots, and confirms the scheduler is idempotent. **All passing.**

---

## 3. Audit of every other explicitly-named file — no further changes needed

| File | Verdict | Basis |
|---|---|---|
| `validateDirectPeer.js` | ✅ Correct | ObjectId validation, self-chat rejection, existence + active-account check, attaches `req.peer` before Multer runs |
| `audioMagicBytes.js` | ✅ Correct, wired in | Real binary signature checks (WebM/OGG/MP4/MP3/WAV/AAC); confirmed called from `chatController.uploadDirectVoice`, file deleted on rejection |
| `audioPlaybackManager.js` (frontend) | ✅ Present, consistent with "one audio at a time" requirement | Reviewed in `frontend/src/utils/` |
| Incoming call / caller identity | ✅ Correct | `callSignaling.js` looks up caller `name/avatar/color` and emits it with the `private-call:incoming` event |
| Call participant authorization | ✅ Correct | `CallSessionManager.transition()` throws `forbidden` if `uid` isn't `callerId`/`calleeId`; `validateCallTarget` rejects self-calls and inactive/missing users; WebRTC relay (`offer`/`answer`/`ice-candidate`) checks participancy before relaying |
| Socket auth | ✅ Correct | `sockets/index.js` verifies JWT + re-checks `user.isActive` in the DB on every connection (not just at token-issue time) |
| Task creation authorization | ✅ Correct | Enforced server-side inside `taskController.create`/`.update` (`req.isGuide` or group leader), independent of frontend UI |
| Task/submission reassignment isolation (Part 10 / "STEP 33") | ✅ Correct, defense-in-depth | `taskSubmissionScope.js`: resets submission-workflow status on reassignment, **and separately** strips a student's response down to only their own submissions before it's ever serialized — so even if a status-reset code path were missed elsewhere, a new assignee still can't receive a previous assignee's submission content. Applied consistently across `list`, `board`, `create`, `update`, `submit`, `review` |
| Private message AI isolation (Part 8) | ✅ Correct | `sendDirectMessage` never calls any group-AI hook (task extraction, conflict detection, etc.) — confirmed by reading the full handler; only `sendGroupMessage` does |

---

## 4. Dependency / security audit

- `npm audit` on the backend found **3 known vulnerabilities**: `morgan` (log forging), `nodemailer` (4 advisories, one high), `adm-zip` (symlink-follow on extraction).
- **Fixed** `morgan` and `nodemailer` via `npm audit fix` (non-breaking patch-level bumps). Full test suite re-run and still green afterward.
- **Deliberately not touched:** `adm-zip`. `npm audit`'s suggested "fix" is actually a *downgrade* to `0.5.8` (older than the currently-pinned `0.6.0`). The repo's own prior work (`STEP31`/`STEP32` reports and their accompanying scripts in `backend/scripts/`) shows `adm-zip` was deliberately pinned to `0.6.0` specifically to resolve an *earlier* vulnerability, with explicit tests asserting it must not be silently downgraded. Given that conflict, downgrading now — on an advisory whose applicability to `0.6.0` I could not confirm — would risk reversing already-verified prior work. Flagging as a **known, unresolved moderate-severity item requiring a human security-engineering decision**, not silently fixed or silently ignored.
- No secrets, `.env` files, or credentials found in the ZIP. `.gitignore` already correctly excludes `.env`, `node_modules`, and build output.
- Dev-only OTP exposure (`devOtp` field) is correctly gated behind `NODE_ENV !== "production"` — verified in `invitationService.js`.

---

## 5. Frontend audit

- **Build:** `npm run build` → **PASS** (clean Vite/TanStack Start SSR build, no errors).
- **Lint:** initial `npm run lint` failed with 1 real error: an `eslint-disable-next-line react-hooks/exhaustive-deps` comment in `frontend/src/hooks/useGroups.js`, referencing a rule that isn't registered for `.js` files under this project's ESLint flat config (the `react-hooks` plugin block only matches `**/*.{ts,tsx}`).
  - I initially widened that glob to `**/*.{js,jsx,ts,tsx}` to give real hook-rule coverage to the ~165 plain `.js`/`.jsx` files in this project that currently get **zero** `react-hooks`/`react-refresh` linting at all. That is a real, larger gap worth knowing about — but re-running lint under the wider glob surfaced **~1,500 pre-existing Prettier formatting deltas** across files this audit was never asked to touch. Reformatting all of them would be exactly the kind of "unnecessary cosmetic refactor" the brief explicitly prohibited, so I **reverted the glob change** and instead removed the one stray, non-functional disable-comment causing the actual reported error.
  - `npm run lint` now exits **0** (9 pre-existing warnings only, all standard shadcn/ui "fast refresh" advisories, no errors).
  - **Recorded as a known limitation, not silently fixed:** the frontend's plain `.js`/`.jsx` files are not covered by `react-hooks`/`rules-of-hooks` linting. Fixing that properly requires a deliberate, separate Prettier-reformatting pass across ~165 files — out of scope for a "fix genuine issues, no unnecessary refactors" audit.
- **Build re-verified** after the `useGroups.js` fix: still PASS.

---

## 6. Testing

### Backend (Jest)
```
Test Suites: 4 passed, 4 total
Tests:       41 passed, 41 total
```
- `tests/callService.test.js` — pre-existing, unmodified, passing (call authorization: self-call rejection, target validation, etc.)
- `tests/callSignaling.integration.test.js` — pre-existing, unmodified, passing (real socket.io integration test of call signaling)
- `tests/orphanFileCleanup.test.js` — **new**, 9 tests, all passing (see §2)
- `tests/uploadsStaticAuth.test.js` — **new**, 3 tests, all passing (see §1)

### AI engine (pytest)
```
36 passed in 0.10s
```
All existing analyzer/report-generator tests pass unmodified. No AI engine logic was changed — confirmed via `python3 -m py_compile` across every `.py` file (clean) plus the full pytest run (clean). No trained models touched.

### Frontend
- `npm run build`: PASS
- `npm run lint`: PASS (0 errors, 9 pre-existing warnings)

---

## 7. Explicitly NOT run (infrastructure not available in this environment)

Per the brief's own instruction ("if infrastructure is unavailable, do NOT fake results — clearly mark PASS / NOT RUN / BLOCKED"):

| Item | Status | Why |
|---|---|---|
| Live MongoDB integration testing | **NOT RUN** | No MongoDB instance available in this sandbox |
| SMTP / real email delivery testing | **NOT RUN** | No SMTP credentials/server available |
| Browser automation (signup, chat, calls, notifications end-to-end) | **NOT RUN** | No browser-automation tool available in this environment |
| Full manual walkthrough of Parts 5/6/7/11/12/13/14/16/17/18 beyond the spot-checks in §3 | **PARTIALLY VERIFIED** | Time/scope-bounded; the highest-risk items (auth, private-data isolation, file/voice security, orphan cleanup) were prioritized and verified in depth; lower-risk items (UX polish, index tuning, memory-assistant intent routing) were spot-checked via code reading only, not exhaustively re-tested |

---

## 8. Files changed by this audit

- `backend/server.js` — wire in the orphan-cleanup scheduler
- `backend/src/utils/orphanFileCleanup.js` — generalize to cover both upload roots, fix absolute-path resolution bug, add scheduler + `runOrphanCleanupOnce`
- `backend/src/app.js` — close the private-file static-serving bypass
- `backend/tests/orphanFileCleanup.test.js` — **new**
- `backend/tests/uploadsStaticAuth.test.js` — **new**
- `backend/package.json` / `package-lock.json` — `npm audit fix` (morgan, nodemailer patch bumps only)
- `frontend/src/hooks/useGroups.js` — remove one stray, non-functional eslint-disable comment

No other files were modified. No existing features, routes, models, AI logic, or UI were rewritten or removed.

---

## Final Summary

- Antigravity changes verified: **6 explicitly-named items**, all inspected in depth (no `.git` history existed to diff against — see §0)
- Files changed by this audit: **7**
- Genuine issues found: **3** (unauthenticated private-file static exposure; never-invoked orphan cleanup + its latent path-resolution bug; frontend lint config error)
- Genuine issues fixed: **3**
- Tests passed: **41/41 backend, 36/36 AI-engine** (77/77 total)
- Frontend build: **PASS**
- Frontend lint: **PASS** (0 errors)
- Security audit: **PARTIAL** — critical private-file exposure found and fixed; 2 of 3 known dependency vulnerabilities patched; 1 (`adm-zip`) deliberately left for human review (see §4); no live penetration/browser testing performed
- Live browser testing: **NOT RUN** (no browser automation tool available)
- MongoDB runtime testing: **NOT RUN** (no MongoDB instance available)
- SMTP testing: **NOT RUN** (no SMTP server available)
- Final ZIP: `teamsync-ai-production-ready-final.zip`
- Remaining limitations:
  1. `adm-zip` moderate-severity advisory unresolved (needs a human security-engineering call — see §4)
  2. Group files / profile pictures still served via unauthenticated static route (only *private* files were in explicit scope per Part 15's wording — see §1)
  3. Plain `.js`/`.jsx` frontend files have no `react-hooks` lint coverage (fixing properly requires a full-repo Prettier pass, out of scope here — see §5)
  4. No live MongoDB/SMTP/browser testing was performed in this environment

I am **not** declaring this "production ready" outright — the fixes above are real and verified, but live database, email, and browser testing were never run, and the three residual items above are genuine open items, not resolved ones.
