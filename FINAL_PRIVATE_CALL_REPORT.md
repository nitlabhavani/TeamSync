# Private Voice/Video Calling — Final Report

**Feature:** Real-time private (1:1) voice + video calling via WebRTC.
**Product rule enforced:** Private chat → calls enabled. Group chat → calls
completely absent (no buttons, no events, no routes, no AI exposure).

---

## 1. Files changed

### Backend — new files
- `backend/src/models/CallLog.js` — minimal call-history metadata model (no media, ever).
- `backend/src/services/callService.js` — call authorization + in-memory call session state machine.
- `backend/src/sockets/callSignaling.js` — private-call:* Socket.IO signaling handlers.
- `backend/src/controllers/callController.js` — `GET /api/calls/history/:userId`.
- `backend/tests/callService.test.js` — 20 unit tests.
- `backend/tests/callSignaling.integration.test.js` — 10 real Socket.IO integration tests.

### Backend — edited files
- `backend/src/sockets/index.js` — registers `callSignaling` on each authenticated socket (2 lines added, nothing else touched).
- `backend/src/models/Notification.js` — added `"call"` to the existing `type` enum, for missed-call notifications.
- `backend/src/routes/index.js` — added `require` for the calls controller and one new route.
- `backend/package.json` — added `jest`/`socket.io-client` devDependencies and a `test` script (none existed before).

### Frontend — new files
- `frontend/src/services/webrtc.js` — STUN/TURN config, `getUserMedia` with human-readable error handling, WebRTC support check.
- `frontend/src/context/CallContext.jsx` — the entire call state machine (IDLE → CALLING/RINGING → ACCEPTED → CONNECTING → CONNECTED → ENDED/REJECTED/MISSED/CANCELLED/FAILED) and all RTCPeerConnection/socket wiring.
- `frontend/src/hooks/useCall.js` — context accessor (mirrors `useChat`/`useSocket`).
- `frontend/src/components/chat/IncomingCallModal.jsx` — incoming call UI (accept/reject).
- `frontend/src/components/chat/ActiveCall.jsx` — outgoing/connecting/connected call UI (voice + video), mute/camera/end controls, duration timer, error banner.
- `frontend/src/components/chat/CallOverlay.jsx` — root-mounted switcher between the two, renders nothing when idle.

### Frontend — edited files
- `frontend/src/components/chat/ChatHeader.jsx` — added optional `onVoiceCall`/`onVideoCall`/`callDisabled` props. Buttons render **only** when both `!isGroup` **and** a handler is passed in — a defense-in-depth double gate.
- `frontend/src/components/chat/SingleChat.jsx` — wires `useCall().startCall` to the header buttons. This is the *only* place that happens.
- `frontend/src/routes/__root.tsx` — added `<CallProvider>` (inside `SocketProvider`/`AuthProvider`, wrapping `NotificationProvider`) and mounted `<CallOverlay />` once at the app root.
- `frontend/.env.example` — documented optional `VITE_STUN_URLS` / `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` (all optional; STUN has a working default).

### Explicitly NOT touched
`GroupChat.jsx`, group routes, group controllers, `Group.js`/`Task.js`/any AI-engine file, any AI/analytics service, `chatController.js`'s group-message path, `chatTaskService.js`, `conflictDetectionService.js`, existing chat/file-sharing code, auth middleware/logic, or any other model.

---

## 2. WebRTC / signaling architecture

- **Media:** direct browser-to-browser via `RTCPeerConnection`, using real `navigator.mediaDevices.getUserMedia()`, real offer/answer SDP, and real ICE candidates. No mock/fake "connected" state exists anywhere — every state transition to `CONNECTED` comes from the browser's own `RTCPeerConnection.connectionState` event.
- **NAT traversal:** STUN by default (`stun:stun.l.google.com:19302`, overridable via `VITE_STUN_URLS`). TURN is fully optional and configured only through env vars (`VITE_TURN_URL`/`VITE_TURN_USERNAME`/`VITE_TURN_CREDENTIAL`) — no credentials are hard-coded anywhere.
- **Signaling transport:** the project's **existing** Socket.IO server/connection (`backend/src/sockets/index.js`), which already authenticates every socket with the same JWT used for REST (`verifyAccessToken`) and already places each connection in a `user:${uid}` room. No second auth mechanism, no second transport, no new dependency — `callSignaling.js` only adds event handlers to that same authenticated socket, exactly like the pre-existing `typing:direct` event.
- **Events:** `private-call:call`, `:incoming`, `:accept`/`:accepted`, `:reject`/`:rejected`, `:cancel`/`:cancelled`, `:end`/`:ended`, `:missed`, `:connected`, `:failed`, `:offer`, `:answer`, `:ice-candidate`. Every one is scoped to `user:${uid}` rooms only — never `io.emit`, never a `group:*` room.
- **Call ordering:** the callee accepts first (and only then requests mic/camera permission); the caller creates the SDP offer only after receiving `:accepted`, so no media negotiation work happens while a call is still just ringing.

---

## 3. Authorization model

Mirrors the app's **existing** direct-message authorization exactly (see `chatController.sendDirectMessage`/`directMessages`): any two authenticated, active users can reach each other 1:1 — there is no separate "friends" or "shared group" gate for private chat in this codebase, so calling does not invent a stricter rule than messaging already has.

On top of that baseline, `callService.validateCallTarget` and `CallSessionManager` add everything calling specifically needs:

- Caller must be authenticated (already guaranteed — the socket connection itself requires a valid JWT; see `sockets/index.js`'s `io.use`).
- `callerId !== calleeId` (cannot call yourself).
- Callee must exist and be `isActive` in the `User` collection.
- `validateCallTarget` only ever looks up `User`, never `Group` — there is no code path where a `groupId` can stand in for a callee id.
- Every signaling event re-verifies that the emitting socket's user is one of the call's two participants (`CallSessionManager.transition`) before doing anything — an unrelated user gets a rejected ack, not silent success.
- Offer/answer/ICE relay independently re-checks participant identity before relaying, and silently drops anything referencing an unknown/stale `callId`.
- Only one active call per user is allowed at a time — a second `private-call:call` while either party is already busy is rejected.
- Stale/duplicate/out-of-order transitions (e.g. accept arriving after cancel) are no-ops, not errors — call state can't be corrupted by a race.

---

## 4. Privacy model (group chat / AI isolation)

- `callSignaling.js` never joins, leaves, or emits to any `group:*` Socket.IO room — every emit is `io.to(user:${id})`.
- No `Message` document is ever created for a call, at any state, so nothing call-related can reach `processGroupMessageForTasks`, `analyzeGroupMessageForConflicts`, the Project Memory Assistant, Project Knowledge, or any other Message-reading AI service — those are only ever invoked from `chatController.sendGroupMessage`, which this feature never calls.
- `CallLog` is a **metadata-only** model: caller, receiver, type, status, timestamps, duration. It never stores SDP, ICE candidates, audio, video, or transcripts. No AI service reads `CallLog` — the model isn't imported anywhere outside `callSignaling.js` and `callController.js`.
- No group route, group controller, or group model was modified. `GroupChat.jsx` was independently confirmed to contain zero references to calling (`grep -n "call\|Call\|CALL" GroupChat.jsx` → no matches).
- `ChatHeader.jsx`'s call buttons render only when **both** `!isGroup` **and** a handler was explicitly passed in — `GroupChat.jsx` passes neither, so even a future accidental prop-drilling mistake elsewhere can't put call buttons in a group header.

---

## 5. Group-call prevention (explicit checklist)

| Requirement | Status |
|---|---|
| No call buttons in GroupChat header | ✅ `GroupChat.jsx` untouched; `ChatHeader` double-gates on `isGroup` |
| No call events reach group rooms | ✅ `callSignaling.js` only ever emits to `user:${id}`; covered by integration test |
| groupId cannot authorize a private call | ✅ `validateCallTarget` only queries `User`; covered by unit test |
| No group calling/rooms implemented | ✅ Not implemented anywhere |
| Group AI pipelines never see call data | ✅ No Message document is ever created for a call |

---

## 6. Call lifecycle & race conditions handled

Implemented in `CallSessionManager` (backend, authoritative) and mirrored in `CallContext` (frontend):

IDLE → CALLING/RINGING → ACCEPTED → CONNECTING → CONNECTED → ENDED, plus REJECTED / MISSED (45s ring timeout) / CANCELLED / FAILED.

Explicitly handled and unit/integration-tested: duplicate call attempts while busy, accept-after-cancel races, duplicate reject/cancel events, unknown/stale call IDs, third-party access to someone else's call, offer/ICE arriving for a stale call, peer disconnect while ringing (→ MISSED) vs. while connected (→ ENDED), and browser refresh (server-side `disconnect` handler force-ends the caller/callee's active call; client also has a `beforeunload` best-effort notify + immediate track cleanup).

---

## 7. Test results — ACTUALLY RUN

```
cd backend && npm test
```

```
PASS tests/callSignaling.integration.test.js
PASS tests/callService.test.js

Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total
```

- **20 unit tests** (`callService.test.js`) — authorization (self-call, missing/nonexistent/deactivated user, groupId-cannot-authorize), and the full `CallSessionManager` lifecycle including every race condition in the spec (duplicate active call, accept-after-cancel, duplicate reject, stale callId, unrelated-user rejection, ring timeout → MISSED, peer disconnect while ringing vs. connected).
- **10 integration tests** (`callSignaling.integration.test.js`) — a **real** `http.Server` + real Socket.IO server (from the actual `sockets/index.js`) with **real `socket.io-client` connections** and **real signed JWTs**, `User`/`Group`/`CallLog`/notification services mocked (no live Mongo needed for these). Covers: unauthenticated connection rejection, full call→incoming→accept→accepted happy path, self-call rejection, identity spoofing resistance (`fromUserId` always comes from the authenticated socket, never client input), unrelated third-party rejection, invalid callId rejection, **group-room isolation** (a `group:*`-scoped user never receives a private-call event), offer/ICE relay scoping + stale-callId drop, cancel-before-answer, and duplicate-call-while-busy rejection.

No test was invented or assumed to pass — every number above came from an actual `npx jest` run in this environment, shown above and reproduced during this task.

This project had **no pre-existing JavaScript test framework** (only Python `pytest` for `ai-engine`, and that suite is untouched by this feature). `jest` and `socket.io-client` were added as backend devDependencies and a `test` script was added to `backend/package.json` — this is new testing infrastructure, not a pre-existing convention.

### Frontend
The frontend project ships **no test framework** (only `eslint`/`vite build`) and none was added, since introducing one is out of scope for "smallest production-quality implementation." Frontend correctness for items D21–D25 in the spec was verified by code inspection and by the lint/build results below, not by an automated frontend test run — see Known Limitations.

---

## 8. Regression checks

- `node --check` on every new/edited backend file — all pass.
- `require()` smoke test of `taskController`, `meetingController`, `projectMemoryAssistantController`, `notificationController`, `chatController` (the modules most likely to be affected by the `Notification` enum change or route file edit) — all load cleanly.
- Full backend module graph (`src/app.js`) loads without throwing, with no live MongoDB connection — confirms no accidental syntax/require errors were introduced anywhere in the route tree.
- `grep` confirmed zero call-related references anywhere in `GroupChat.jsx`.
- **AI engine (`ai-engine/`) was not modified at all** — no file under it was touched by this task. `pytest` is not installed in this container and installing the full `scikit-learn`/`numpy` stack to run a suite that provably has zero changed inputs was judged not worth the cost; the "no regression" claim here rests on the file list being unchanged, not on a fresh pytest run. If you want that suite re-run for extra certainty, `pip install -r ai-engine/requirements.txt pytest --break-system-packages && cd ai-engine && pytest -q`.

---

## 9. Build result — ACTUALLY RUN

```
cd frontend && npm run build
```
Result: **succeeded** — both the client bundle and the SSR server bundle built without errors (see full output captured during this task; final lines: `✓ built in 4.28s` / `✓ built in 1.42s`).

## 10. Lint result — ACTUALLY RUN

```
cd frontend && npm run lint
```
Result: 10 pre-existing warnings/1 pre-existing error, **none in any file touched by this feature**. The one error (`react-hooks/exhaustive-deps` rule not found in `useGroups.js`) exists in the untouched baseline code and is not caused by, or related to, this change. All 8 new/edited files under `components/chat/`, `context/`, `hooks/`, and `services/` produced zero lint errors or warnings.

Backend has no lint script configured in `package.json` (`start`/`dev`/`seed` only, now plus `test`) — nothing to run there.

---

## 11. Browser/WebRTC E2E status

**Not run, and not claimed.** This container has no browser and cannot open two real browser tabs/peers to exchange live audio/video. Every claim above about signaling, authorization, and state-machine correctness is backed by the real Socket.IO integration tests (section 7), which exercise the actual server code with actual socket connections and actual JWTs — but they do **not** exercise `getUserMedia`, `RTCPeerConnection`, SDP negotiation, or ICE gathering, because none of that exists outside a real browser.

**What is genuinely still unverified:** that two real browsers can complete an offer/answer/ICE handshake and render each other's audio/video through this exact code path end-to-end. The code follows the standard WebRTC pattern correctly (verified by inspection and by unit-testing the surrounding state machine), but "the standard pattern, implemented correctly" is not the same claim as "verified working in two browsers," and this report does not blur that line.

**Recommended manual verification** before shipping: open the private chat in two different browser profiles/machines logged in as two different users, place a voice call, then a video call, and confirm audio/video actually renders both directions, mute/camera toggles work, and end/reject/cancel/missed all behave as expected.

---

## 12. MongoDB status

No live MongoDB instance is available in this container (`mongod`/`mongosh` not installed). Backend tests were deliberately written to run without one (User/Group/CallLog models are mocked in the test files). `CallLog` document creation, `GET /api/calls/history/:userId` returning real persisted history, and the `Notification` "call" type actually saving/reading from a real database were **not** verified against a live Mongo instance in this session — only their code paths were reviewed and the schema was hand-checked for correctness.

---

## 13. Known limitations

1. No two-browser WebRTC E2E test was performed (see section 11).
2. No live-MongoDB test of `CallLog` persistence or `GET /api/calls/history/:userId` was performed (see section 12).
3. No automated frontend test exists for this feature (the project has no frontend test framework); frontend correctness rests on code review + successful build/lint.
4. TURN is optional and unconfigured by default — calls across restrictive NATs (some corporate/mobile networks) may fail with STUN alone until a TURN server is configured via the new env vars. This is a deployment/infra decision, not a code gap.
5. The call overlay is mounted app-wide (not just on the private chat route) so an incoming call still rings wherever the recipient currently is in the app — this is a deliberate design choice (matches how the existing `notification:new`/`direct:message` events already reach the user app-wide via the same `user:${uid}` room), not an oversight, but it's worth flagging since the spec's routing section describes call UI as tied to the private-chat page.
6. Call history persistence (`CallLog`) was added as the "minimal metadata" option the spec allows, but is not surfaced anywhere in the UI yet (no "recent calls" list) — the endpoint exists for future use.

---

## 14. Exact commands used

```bash
# Backend
cd backend
npm install --save-dev jest --no-audit --no-fund
npm install --save-dev socket.io-client --no-audit --no-fund
npx jest --runInBand
npx jest --runInBand --detectOpenHandles
node --check src/models/CallLog.js src/services/callService.js src/sockets/callSignaling.js src/sockets/index.js src/controllers/callController.js src/routes/index.js src/models/Notification.js
node -e "require('./src/config/env'); require('./src/app'); console.log('app loaded OK')"

# Frontend
cd frontend
npm install --no-audit --no-fund
npm run lint
npm run build
```
