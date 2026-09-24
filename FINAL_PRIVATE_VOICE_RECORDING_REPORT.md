# Private Voice Recording — Final Report

Real microphone voice messages, added to **private (1:1) chat only**. Text
messaging, private file sharing, private voice calls, and private video
calls are all unmodified in behavior; group chat gains nothing new.

---

## 1. Implementation summary

- Real browser recording via `navigator.mediaDevices.getUserMedia({ audio: true })`
  + `MediaRecorder`, with the MIME type picked at runtime from whatever the
  browser actually supports (`audio/webm;codecs=opus` → `audio/webm` →
  `audio/ogg;codecs=opus` → `audio/ogg` → `audio/mp4`) — never hard-coded.
- Recording lifecycle: idle → requesting (permission prompt) → recording
  (live timer, real elapsed time) → preview (listen before sending) → send
  (upload) or discard. Auto-stops at a configurable max duration (default
  120s) without discarding the take.
- Upload happens **only on Send** — never during/after Stop. The blob is
  only ever POSTed once the user explicitly presses Send.
- New authenticated streaming endpoint (Range-aware, `Content-Disposition:
  inline`) is used for playback instead of a static filesystem path, since
  this app's auth is Bearer-token-only (playback fetches the clip as an
  authenticated Blob, then plays it via an object URL — a plain `<audio
  src>` can't attach the auth header).
- Voice messages are **additive** to the existing `Message` model
  (`type: "text" | "voice"`, `attachments[].duration`) — every existing
  text and file message shape, and every existing group message, is
  completely unaffected.
- **No group-scoped voice endpoint exists anywhere in the router.** This is
  the actual security boundary — not just a hidden UI button.

## 2. Frontend files changed/added

| File | Change |
|---|---|
| `hooks/useVoiceRecorder.js` **(new)** | Real MediaRecorder lifecycle hook: permissions, recording, timer, max-duration auto-stop, preview blob, full cleanup (tracks stopped, recorder released, timers cleared, object URLs revoked) on discard/unmount/error. |
| `components/chat/VoiceRecorderBar.jsx` **(new)** | Recording-in-progress bar (`🔴 Recording 0:08` / Delete / Stop) and preview bar (Play/Pause preview, duration, Delete, Send). |
| `components/chat/AudioMessage.jsx` **(new)** | Playback bubble for a sent/received voice message: Play/Pause, progress bar, real duration, loading state, error state with retry. No autoplay. |
| `components/chat/ChatInput.jsx` | Added explicit `scope` prop (`"direct"` / `"group"`); mic button renders **only** when `scope === "direct"`; wires `useVoiceRecorder` + `VoiceRecorderBar`; uploads on Send via `fileService.uploadDirectVoice`. |
| `components/chat/MessageBubble.jsx` | Renders `AudioMessage` when `message.type === "voice"`, otherwise unchanged (text/file rendering untouched). |
| `components/chat/SingleChat.jsx` | Passes `scope="direct"` to `ChatInput`. |
| `components/chat/GroupChat.jsx` | Passes `scope="group"` to `ChatInput` (explicit, not inferred from a missing prop). |
| `services/fileService.js` | Added `uploadDirectVoice()`, calling the new `/chat/direct/:userId/voice` endpoint. |
| `services/chatService.js` | `toAttachment()` leaves an `audio`-type attachment's `url` untouched (API-relative, for `api.getBlob()`) instead of prefixing it with the static-asset origin like ordinary file attachments. |
| `lib/apiClient.js` | Added `api.getBlob(path)` — authenticated binary fetch (Bearer header attached) for the voice streaming endpoint. |
| `utils/constants.js` | Added `MAX_VOICE_RECORDING_SECONDS`, `MAX_VOICE_FILE_SIZE_MB`. |
| `utils/helperFunctions.js` | Added `formatDuration()` (real m:ss formatting, no fake values). |

## 3. Backend files changed/added

| File | Change |
|---|---|
| `middleware/directVoiceUpload.js` **(new)** | Multer config for voice uploads: audio-mime-only allowlist, server-generated filenames (zero path-traversal surface), stored under a **separate, non-statically-served** root (`uploads-voice/`, not `uploads/`), size-limited via `MAX_VOICE_MB`. |
| `controllers/chatController.js` | Added `uploadDirectVoice` and `streamDirectVoice` (Range-aware inline streaming); `sanitizeAttachments` now clamps a client-reported `duration` server-side; `sendDirectMessage` auto-derives `type: "voice"` only for a lone audio attachment with no caption text — `sendGroupMessage` is untouched. |
| `models/Message.js` | Additive: top-level `type` (`"text" | "voice"`, defaults `"text"`) and `attachments[].duration`. |
| `controllers/fileController.js` | `kindOf()` now classifies `audio/*` mimetypes as `"audio"`; every other classification is unchanged. |
| `routes/index.js` | Added `POST /chat/direct/:userId/voice` and `GET /chat/direct/:userId/voice/:filename`, both behind `protect`. **No group-scoped equivalent was added anywhere.** |
| `middleware/error.js` | `LIMIT_FILE_SIZE` message now reports whichever limit actually applied (`MAX_VOICE_MB` for the `audio` field vs `MAX_UPLOAD_MB` for `file`/`files`), and non-Multer upload errors (e.g. unsupported format) now report their real status code instead of falling through to 500. |
| `.env.example` | Added `VOICE_UPLOAD_DIR`, `MAX_VOICE_MB`, `MAX_VOICE_DURATION_SECONDS`. |
| `.gitignore` (repo root) | Added `backend/uploads-voice/`. |
| `scripts/testPrivateVoiceMessage.js` **(new)** | 15-check regression script (details in §11). |

## 4. Message model changes

Purely additive — no existing field removed or retyped:

```js
type: { type: String, enum: ["text", "voice"], default: "text" },
attachments: [{
  name: String, url: String, size: Number,
  type: { type: String }, mimeType: String,
  duration: Number, // new — only set for type "audio"
}]
```

Every existing text message and file-attachment message continues to
validate and behave exactly as before (verified in test #15).

## 5. Upload/storage design

- Voice files are stored at `<VOICE_UPLOAD_DIR>/private/<conversationKey>/<filename>`,
  where `conversationKey` is the same deterministic `sorted(userA,userB)` key
  the existing private-file-sharing feature already uses.
- `VOICE_UPLOAD_DIR` (default `uploads-voice`) is a **separate root from
  `UPLOAD_DIR`** (default `uploads`) — the latter is mounted unauthenticated
  via `express.static("/uploads")` in `app.js`; the former is never mounted
  as a static route at all, so a voice clip is unreachable except through
  `streamDirectVoice`.
- Filenames are always server-generated (`voice-<timestamp>-<random>.<ext>`)
  — the client's filename is never used for anything, eliminating
  path-traversal risk by construction rather than by sanitizing it.
- Voice notes never become a `FileAsset`, are never listed in a group's
  Shared Files, and never touch the group file-upload endpoint.

## 6. Authorization design

- Every voice route requires `protect` (JWT auth) before the upload/stream
  middleware ever runs.
- Both upload and stream derive `conversationKey` from
  `Message.conversationKey(req.user._id, req.params.userId)` — i.e. from the
  **authenticated** user plus the requested peer, never from any
  client-supplied conversation id.
- A non-participant guessing `:userId` only ever computes a different
  (nonexistent) folder — verified in tests #3 and #11.
- `req.body.duration` is trusted only as a display hint and is re-clamped
  server-side to `MAX_VOICE_DURATION_SECONDS` when the message is created,
  so a manipulated value can never inflate the stored duration.

## 7. Privacy / AI isolation

- Private voice messages are **never** transcribed, analyzed, or forwarded
  to any LLM/API. No new code path touches `chatTaskExtractionService`,
  `conflictDetectionService`, project knowledge/memory, meeting
  intelligence, actionable insights, team risk, project health/forecast,
  performance analytics, plagiarism, or code review.
- `sendGroupMessage` (the only place those AI hooks are invoked — see
  `processGroupMessageForTasks` call in `chatController.js`) was **not
  modified in any way**; `sendDirectMessage` (the only place voice messages
  are ever created) never calls any AI hook, before or after this change.
- Zero files under `ai-engine/` were touched by this feature.

## 8. GroupChat protection

- No group-scoped voice route exists anywhere in `routes/index.js` (test
  #13 asserts this against the real file, not a mock).
- `ChatInput`'s mic button requires the explicit `scope === "direct"` prop
  — `GroupChat.jsx` explicitly passes `scope="group"`, so there is no
  code path by which the group composer can render it.
- Even a malicious client calling `POST /chat/direct/:userId/voice`
  directly is still bound by the same private-chat-participant
  authorization as every other private endpoint; there is no group
  equivalent to call in the first place.

## 9. Recording lifecycle / cleanup

Handled in `useVoiceRecorder.js`:

- Double-click on the mic button is a no-op while already
  requesting/recording.
- Component unmount / chat closed mid-recording stops every `MediaStream`
  track, releases the `MediaRecorder`, clears the timer, and revokes any
  object URL (`useEffect` cleanup).
- Permission denial, no device, unsupported browser, and generic start
  failures each surface a distinct, specific message (see §10) rather than
  crashing.
- Hitting the max duration auto-stops and keeps the take for preview
  (never silently discarded).
- Send/upload failure keeps the recording in preview so the user can retry,
  rather than losing the clip.
- `AudioMessage.jsx` revokes its fetched-clip object URL on unmount.

## 10. Supported audio formats & limits

- Frontend records whichever of `audio/webm;codecs=opus`, `audio/webm`,
  `audio/ogg;codecs=opus`, `audio/ogg`, `audio/mp4` the browser reports
  supported via `MediaRecorder.isTypeSupported()`.
- Backend accepts `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`,
  `audio/mp3`, `audio/wav`, `audio/x-wav`, `audio/m4a`, `audio/aac`.
- Max recording duration: **120 seconds** (`MAX_VOICE_DURATION_SECONDS`,
  configurable).
- Max file size: **15MB** (`MAX_VOICE_MB`, configurable, separate from the
  25MB `MAX_UPLOAD_MB` used by ordinary file attachments).
- Error messages (exact text, never a crash):
  - Permission denied: *"Microphone permission is required to record a
    voice message."*
  - No device: *"Microphone is not available on this device."*
  - Unsupported browser: *"Voice recording is not supported in this
    browser."*
  - Generic start failure: *"Unable to start voice recording. Please try
    again."*

## 11. Tests executed — exact results

### New: `backend/scripts/testPrivateVoiceMessage.js`
```
ok - 1. authenticated participant can upload a voice message and gets back an authenticated streaming url
ok - 2. both voice routes require `protect` (authentication) ahead of the upload middleware in the real router
ok - 3. a non-participant (C) cannot access the private voice message by manipulating :userId
ok - 4. the other participant (B) can stream A's voice message inline
ok - 5. the sender (A) can also play back their own sent voice message
ok - 6. Range requests are honored for scrubbing/seeking
ok - 7. a non-audio MIME type is rejected
ok - 8. oversized audio is rejected using MAX_VOICE_MB
ok - 9. a request with no audio is rejected
ok - 10. uploaded filename is always server-generated, never derived from client input
ok - 11. path traversal via the :filename param is blocked
ok - 12. fileController.kindOf classifies real recorder audio mimetypes as "audio" without affecting existing kinds
ok - 13. the real router defines no group-scoped voice endpoint — group voice access is impossible at the API layer
ok - 14. voice-message type detection only fires for a lone audio attachment with no caption text
ok - 15. Message model: type/duration persist correctly; existing text and file message shapes are unaffected

15 checks passed.
```

### Regression: `backend/scripts/testPrivateChatFileSharing.js` (private file sharing, unmodified feature)
```
ok - 1. private attachment upload succeeds and returns {name,url,size,type,mimeType}
ok - 2. private attachment is never written into a group-shaped folder
ok - 3. the other participant (B) can download A's private attachment
ok - 4. a non-participant (C) cannot access the private attachment by manipulating :userId
ok - 5. even the real uploader cannot fetch it under the wrong conversation key
ok - 6. oversized file is rejected using the existing MAX_UPLOAD_MB rule
ok - 7. a request with no file is rejected
ok - 8. Message model still requires text-or-attachment for direct messages, and a file-only message is valid

8 checks passed.
```

### Regression: `backend/tests/*.test.js` (jest — includes private calling / Socket.IO signaling)
```
PASS tests/callSignaling.integration.test.js
PASS tests/callService.test.js

Test Suites: 2 passed, 2 total
Tests:       30 passed, 30 total
```

### Regression: notification/navigation (Step 34)
```
ok - direct-message notification has its own link and no group/message fields
ok - existing AI task-extraction and conflict-detection hooks are untouched by this change
ok - an old notification without group/message metadata degrades gracefully (no crash, no group nav)

All STEP 34 notification -> chat navigation tests passed.
```

### Regression: Step 30 audit / Step 31 hardening
```
Step 30: === RESULT: 66 passed, 0 failed (target: >= 30 checks) ===
Step 31: === RESULT: 81 passed, 0 failed (target: >= 40 checks) ===
```

### Regression: Step 32 production verification
```
=== RESULT: 65 passed, 2 failed (target: >= 50 checks) ===
Failures:
  - exactly 26 model files present   ← PRE-EXISTING (see note below)
  - frontend dist/ build output was produced by `vite build`  ← see note below
```
**Pre-existing note:** the "exactly 26 model files present" check was
verified to already fail against the **original, unmodified** uploaded
zip (27 model files present there too, before any of this feature's
changes) — this is not a regression introduced by this feature.

**dist/ note:** `npm run build` was run separately in this report (§12)
and succeeded cleanly (both client and SSR builds). `frontend/dist/` is
then deliberately removed as part of packaging cleanup (per the "exclude
frontend/dist" rule for the final zip in this task's instructions), which
is why this specific Step 32 sub-check — a proxy for "does dist/ currently
exist on disk" — shows failed when run after that cleanup rather than
right after the build.

### Regression: task authorization / isolation suite
```
testTaskReassignmentIsolation.js  → 15 test(s) passed.
testAddTaskAuthorization.js       → 6 checks passed.
testGroupAccessIsolation.js       → PASS: 5/5
testStudentIsolation.js           → PASS: 4/4
testSameNameGroupIsolation.js     → 5 test(s) passed.
testTasksPageGroupIsolation.js    → 5 test(s) passed.
```

### Regression: Project Memory Assistant
```
ok - 24. empty project state never fabricates an answer
ok - 25. empty question is handled gracefully, never throws
ok - 25b. a very long question is truncated safely, never throws

30 checks passed.
```

### Regression: group chat AI task extraction (proves group AI hooks untouched)
```
testChatTaskExtractionService.js   → 17 test(s) passed.
testChatTaskServiceIntegration.js  → 9 test(s) passed.
```

### `highlightController` tests
No `highlightController` file or test exists anywhere in this codebase
(searched the full repo) — nothing to run here. Noted honestly rather than
fabricated.

### AI engine (Python)
No `pytest`-discoverable suite exists; the `ai-engine` tests are
standalone scripts (same convention as the backend `scripts/`). Ran the
one most relevant to private chat/AI-isolation as a spot check (zero
`ai-engine` files were touched by this feature, so this is a baseline
sanity check, not a regression test of new code):
```
$ python3 analyzers/test_messageTaskAnalyzer.py
ok - full name assignment resolves to the real member
ok - reversed full name resolves to the same real member
ok - first-name-only mention resolves when unambiguous
ok - ambiguous first name (two members share it) is never guessed
ok - multiple full-name assignments each create a separate task
ok - discussion-style message is never a task
ok - non-member mention is reported, not silently reassigned

7 test(s) passed.
```

## 12. Frontend build result

```
$ npm run build
✓ 289 modules transformed. (client)
✓ built in 3.58s
✓ 289 modules transformed. (ssr)
✓ built in 1.24s
```
Succeeded, no errors.

## 13. Lint result

```
$ npm run lint
✖ 10 problems (1 error, 9 warnings)
```
All 10 are **pre-existing**, verified identical against a fresh extraction
of the original uploaded zip (same file, same line, same rule:
`react-hooks/exhaustive-deps` "rule not found" in `hooks/useGroups.js`,
plus 9 unrelated `react-refresh/only-export-components` warnings in
pre-existing `components/ui/*` files). **Zero new lint errors or warnings**
were introduced by any file this feature added or changed.

## 14. Browser testing status

**Browser-level microphone/WebRTC recording validation was not available
in this environment.** This sandbox has no browser runtime — the
`MediaRecorder`/`getUserMedia` code paths were reviewed carefully and
exercised for logical correctness (state machine, cleanup ordering, error
branches) but were **not** run against a real microphone in a real
browser. The backend upload/stream/authorization logic **was** exercised
end-to-end with real HTTP requests and a real (fake, but structurally
valid) audio blob, and the frontend build was verified to compile cleanly.

## 15. MongoDB status

No live MongoDB instance was available in this environment. All backend
tests (new and regression) that touch the `Message` model use
`new Message(...).validate()` (schema/validator-level checks, no DB
connection required) or plain in-memory Express apps — the same approach
the project's own pre-existing test scripts (`testPrivateChatFileSharing.js`,
`testStep32ProductionVerification.js`, etc.) already use for the same
reason. Genuine runtime behavior against a real database — actual
`Message.create()` persistence, real Socket.IO delivery end-to-end — is
**unverified** in this environment, exactly as already noted by the
pre-existing Step 32 report for this project's baseline features.

## 16. Known limitations

- Playback fetches the entire clip as a Blob before playing (rather than
  true progressive HTTP streaming into the `<audio>` element), because
  authentication requires a Bearer header that a bare `<audio src>` can't
  attach. This is a reasonable tradeoff given the capped recording
  duration/file size, but means very long clips (were the cap ever raised
  significantly) would have a longer initial load before playback starts.
  The streaming endpoint itself does support HTTP Range requests server-side
  for future use.
- No live-browser or live-MongoDB validation was possible in this sandbox
  (see §14–15).
- The pre-existing private file-sharing feature's attachment URLs are
  served unauthenticated via static file serving (`express.static`) —
  this is pre-existing behavior of the project, not something introduced
  or fixed by this feature. Voice messages deliberately do **not** follow
  that pattern and use full authenticated streaming instead.
