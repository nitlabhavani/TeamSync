# TeamSync AI — Manual Runtime Checklist

Run `backend/scripts/runtimeSmokeTest.js` first — it automates everything that
can be safely automated (auth/OTP/invitations/leader-assignment/security).
This checklist covers everything that genuinely needs a browser, a real
inbox, or your own eyes, so you can confirm the same requirements the
smoke test can't reach.

## Setup
1. Fill in a real `BREVO_API_KEY` and a verified `BREVO_FROM_EMAIL` in `backend/.env` (sign up and verify a sender at https://www.brevo.com).
2. `mongod --dbpath="C:\data\db"`
3. `cd backend && npm install && npm start`
4. `cd ai-engine && pip install -r requirements.txt && python app.py`
5. `cd frontend && npm install && npm run dev`
6. `node backend/scripts/runtimeSmokeTest.js` — confirm it prints `0 failed`
   before moving on to this checklist.

## 1. Real email delivery
- [ ] Sign up with a real email address you control → OTP email actually arrives (note: `BREVO_FROM_EMAIL` must be a sender you've verified in the Brevo dashboard, but the recipient can be any address once your account is out of trial/sandbox limits)
- [ ] Guide creates a group inviting that same real address → invitation email arrives
- [ ] Both emails render correctly (not broken HTML, correct OTP, correct link)

## 2. Chat (Socket.IO)
- [ ] Open the same group in two browser windows (two different logged-in users)
- [ ] Send a message in window A → appears instantly in window B (no refresh)
- [ ] Start typing in window A → "typing…" indicator appears in window B
- [ ] Refresh window B → the message is still there (confirms MongoDB persistence)
- [ ] Open a private/direct chat between two users → message delivers instantly
- [ ] As guide, open Reports/Insights for that group → confirm nothing from the
      private chat you just sent shows up in any AI summary/collaboration text

## 3. Files
- [ ] Upload one file (e.g. a PDF) → appears in the file list with AI analysis
- [ ] Upload multiple files at once → all appear, each gets its own analysis
- [ ] Upload a `.zip` → handled without crashing
- [ ] Upload a file larger than `MAX_UPLOAD_MB` → clear error, not a raw 500
- [ ] Upload an unsupported/unusual file type → doesn't crash the page
- [ ] Temporarily stop the AI engine, upload a file → file still saves, shows
      a "analysis unavailable" state rather than disappearing

## 4. Tasks
- [ ] Guide creates a task, assigns to a student → student sees it on their board
- [ ] Student submits a file → AI review result appears (score/summary)
- [ ] Guide approves → task moves to Completed
- [ ] Try to resubmit that same completed task → blocked with a clear message
- [ ] Guide rejects a different submission → student can resubmit → gets a
      fresh AI review (not the old cached one)

## 5. AI dashboards
- [ ] Guide dashboard shows a live Collaboration Score (not stuck at a fixed number)
- [ ] Student Performance page shows real numbers tied to their actual activity
- [ ] Project Completion % moves after you complete a task (confirms the
      auto-recalculation wired up in a previous session actually fires)
- [ ] AI Recommendations text references real recent activity, not generic filler
- [ ] Trigger a high-risk condition (e.g. an overdue task) → an AI Alert appears
      in `/guide/alerts` and a notification is created

## 6. Reports
- [ ] Wait for (or manually trigger, if there's a dev endpoint) a daily report
      → appears under group reports, dated correctly
- [ ] Same for weekly/monthly
- [ ] Refresh the page → report history still shows older reports (MongoDB persistence)

## 7. Data integrity — group deletion
The smoke test confirms the group becomes unreachable via API. To confirm no
orphan documents remain, open `mongosh` and run (replace `<groupId>` with the
one printed by the smoke test, or any group id you just deleted):

```js
use teamsync_ai
db.tasks.find({ group: ObjectId("<groupId>") }).count()
db.messages.find({ group: ObjectId("<groupId>") }).count()
db.fileassets.find({ group: ObjectId("<groupId>") }).count()
db.meetings.find({ group: ObjectId("<groupId>") }).count()
db.reviewrounds.find({ group: ObjectId("<groupId>") }).count()
db.peerreviews.find({ group: ObjectId("<groupId>") }).count()
db.risksnapshots.find({ group: ObjectId("<groupId>") }).count()
db.aireports.find({ group: ObjectId("<groupId>") }).count()
db.badges.find({ group: ObjectId("<groupId>") }).count()
db.invitations.find({ group: ObjectId("<groupId>") }).count()
```
All of these should return `0`.

## 8. Real-time / reconnect
- [ ] Open the app, disconnect your Wi-Fi for 10 seconds, reconnect → chat and
      notifications resume without a full page reload
- [ ] Trigger a notification (e.g. someone comments) while the tab is open →
      it appears without refreshing

## 9. Security spot-checks (beyond what the smoke test covers)
- [ ] As Student A, try opening a group you're not a member of via its URL
      (`/app/groups/<someone-else's-groupId>`) → blocked, not just hidden in nav
- [ ] Deactivate a test user (via an admin/guide action if available), then try
      using their still-valid browser session → protected actions should fail
