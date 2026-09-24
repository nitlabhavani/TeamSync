# TeamSync AI — Backend

Node.js + Express + MongoDB (Mongoose) REST API with Socket.IO realtime chat,
JWT auth and a rule-based AI layer (meeting smart notes, workload balancing,
badges, risk radar). It backs every feature in the TeamSync AI frontend.

## Quick start

```bash
cd backend
cp .env.example .env      # then edit MONGO_URI + JWT_SECRET
npm install
npm run seed              # optional demo data
npm run dev               # http://localhost:5000
```

Demo logins after seeding (password `Password123`):
`aisha.verma@teamsync.edu` (student), `meera.rao@teamsync.edu` (guide).

## Structure

```
backend/
  server.js                 # http + socket bootstrap
  src/
    app.js                  # express app, security, routes
    config/db.js
    models/                 # User, Group, Task, Meeting, Milestone,
                            # Message, FileAsset, ReviewRound, PeerReview,
                            # Badge, Notification, RiskSnapshot
    controllers/            # auth, user, group, task, meeting, review,
                            # chat, file, notification, analytics
    services/               # aiService, riskService, badgeService,
                            # notificationService
    middleware/             # auth (JWT + group access), validate, upload, error
    routes/index.js         # all REST routes
    sockets/index.js        # realtime chat, typing, presence
    seed/seed.js
```

## Auth

`Authorization: Bearer <token>` on every protected route.
Roles: `student`, `guide`, `admin`. Group routes additionally check that the
caller is a member or the assigned guide.

## Main endpoints

| Area | Endpoint |
|---|---|
| Auth | `POST /api/auth/signup` `/login` `/verify-otp` `/forgot-password` `/reset-password` `/refresh`, `GET /api/auth/me` |
| Users | `GET /api/users`, `PATCH /api/users/me`, `GET /api/users/:id/performance` |
| Groups | `GET/POST /api/groups`, `POST /api/groups/join`, `:groupId` CRUD, members, milestones |
| Tasks | `GET /api/groups/:groupId/tasks/board`, `POST /tasks`, `PATCH /tasks/:id/move`, `GET /tasks/workload`, `GET /tasks/stats` |
| Meetings | `CRUD /api/groups/:groupId/meetings`, `POST /:meetingId/summary` (AI smart notes), `POST /:meetingId/convert-actions` |
| Peer review | `review-rounds` CRUD, `POST /review-rounds/:roundId/reviews`, `GET /leaderboard`, `GET /badges` |
| Chat | `GET/POST /api/groups/:groupId/messages`, `GET /messages/summary` (AI), `/api/chat/direct/:userId` |
| Files | `POST /api/groups/:groupId/files` (multipart `file`), list / download / delete |
| Notifications | `GET /api/notifications`, `POST /:id/read`, `POST /read-all` |
| AI & risk | `GET /api/ai/risk-radar`, `GET /api/ai/timeline`, `GET /api/ai/guide-overview`, `GET /api/groups/:groupId/risk` |

## AI layer

Deterministic heuristics — no external key required:

- **Smart meeting notes** — splits raw notes into decisions, action items
  (with owner/due hints) and risks; action items convert into board tasks.
- **Workload balancing** — open estimate hours per member, load %, and
  concrete reassignment suggestions.
- **Recognition badges** — Reliable, Unblocker, Communicator, Finisher, Mentor,
  awarded from peer scores, on-time delivery and chat activity.
- **Risk radar** — 0–100 group risk score from overdue tasks, missed
  milestones, chat volume, meeting cadence and delivery pace, with drivers,
  recommendations and persisted history snapshots.

## Socket.IO

Connect with `io(url, { auth: { token } })`, then
`group:join`, `group:message`, `direct:message`, `typing`, `presence`.

## Connecting the frontend

Set `VITE_API_URL=http://localhost:5000/api` and swap the mock service
internals in `src/services/*.js` for `fetch` calls to the matching endpoints —
the response shapes were designed to match the existing mock data.
