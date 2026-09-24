# TeamSync AI — Frontend ↔ Backend connection

The frontend is no longer running on mock data. Every service under
`frontend/src/services/` now talks to the Express/MongoDB backend through the
shared client in `frontend/src/lib/apiClient.js`.

## 1. Backend

```bash
cd backend
cp .env.example .env      # set MONGO_URI + JWT secrets
npm install
npm run dev               # http://localhost:5000
```

Make sure `CLIENT_ORIGIN` in `backend/.env` matches the frontend dev URL
(`http://localhost:8080` by default) so CORS allows the browser.

## 2. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL=http://localhost:5000/api
npm install
npm run dev
```

## 3. How the wiring works

| Concern | Where |
| --- | --- |
| Base URL, JWT header, refresh, `_id` → `id` normalisation | `src/lib/apiClient.js` |
| Auth (login/signup/me/logout) | `src/services/authService.js` → `/api/auth/*` |
| Groups, members, milestones | `src/services/groupService.js` → `/api/groups*` |
| Tasks board | `src/services/taskService.js` → `/api/groups/:id/tasks` |
| Group + direct chat | `src/services/chatService.js` → `/api/groups/:id/messages`, `/api/chat/direct/:userId` |
| Files (multipart upload) | `src/services/fileService.js` → `/api/groups/:id/files` |
| Meetings + AI notes | `src/services/meetingService.js` |
| Peer review, rounds, leaderboard | `src/services/reviewService.js` |
| Analytics / team stats | `src/services/analyticsService.js` |
| Risk radar + guide alerts | `src/services/riskService.js`, `src/services/alertService.js` |
| Notifications (polled) | `src/services/notificationService.js` |
| User id → name/colour lookups | `src/services/userDirectory.js` (primed after login) |

`src/services/mockData.js` is kept only as reference sample data — no screen
imports from it any more.

## 4. Notes

- Peer review UI scores (`reliability`, `communication`, `quality`) are mapped
  onto the backend model (`reliability`, `communication`, `contribution`,
  `helpfulness`) inside `reviewService.js`.
- Guide alerts are derived from the backend risk radar instead of a static list.
- Tokens are stored by `apiClient` and attached as `Authorization: Bearer …`;
  a 401 triggers one refresh attempt before the session is cleared.

## 5. MongoDB

The backend connects with Mongoose in `backend/src/config/db.js` using
`MONGO_URI` from `backend/.env`. There is no database bundled in this zip — you
point it at your own instance:

- Local: `MONGO_URI=mongodb://127.0.0.1:27017/teamsync_ai` (needs `mongod` running)
- Atlas: `MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/teamsync_ai`
  (allowlist your IP in Atlas → Network Access)

Verify after `npm run dev`:

```bash
curl http://localhost:5000/health
# {"ok":true,...,"database":{"status":"connected","name":"teamsync_ai"}}
```

Collections are created automatically on first write — no manual schema setup.
