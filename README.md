# TeamSync — AI-Powered Collaborative Project & Learning Management Platform

TeamSync AI is an enterprise-grade, AI-assisted project management and student collaboration platform. It combines automated deliverable verification, smart task assignment, calendar scheduling, real-time messaging with WebRTC audio/video calling, automated peer reviews, and comprehensive analytics into a unified application.

---

## 🏗️ Architecture

```text
TeamSync/
├── frontend/     React 19 + TanStack Start + Vite + Tailwind CSS
├── backend/      Node.js + Express + MongoDB + Socket.IO + Mongoose
└── ai-engine/     Python + Flask + Scikit-Learn (Analytics, Predictions, Task Verification)
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** >= 18.x
- **Python** >= 3.10
- **MongoDB** running locally or a MongoDB Atlas URI

---

### 2. Backend Setup

```bash
cd backend
cp .env.example .env     # Configure MongoDB URI, JWT secrets, etc.
npm install
npm run seed             # Seeds demo users, groups, tasks, and data
npm run dev              # Starts API server on http://localhost:5000
```

### 3. AI Engine Setup (Python)

```bash
cd ai-engine
pip install -r requirements.txt
python app.py            # Starts AI Engine on http://127.0.0.1:8000
```

### 4. Frontend Setup

```bash
cd frontend
cp .env.example .env     # Points VITE_API_URL to http://localhost:5000/api
npm install
npm run dev              # Starts Web App on http://localhost:8080
```

---

## 🔑 Demo Login Credentials

All seeded demo accounts use the password: **`Password123`**

| Role | Name | Email |
| :--- | :--- | :--- |
| **Guide / Faculty** | Dr. Meera Rao | `meera.rao@teamsync.edu` |
| **Student (Leader)** | Aisha Verma | `aisha.verma@teamsync.edu` |
| **Student** | Rohan Mehta | `rohan.mehta@teamsync.edu` |
| **Student** | Priya Nair | `priya.nair@teamsync.edu` |
| **Student** | Sneha Reddy | `sneha.reddy@teamsync.edu` |

---

## 🌟 Core Features

- **AI Task Verification & Auto-Completion**: Deliverable-aware analysis that inspects submitted files, archives, and code before verifying task completion.
- **Kanban Task Board & Milestones**: Drag-and-drop workflow tracking with priority, deadline reminders, and acceptance checklists.
- **Calendar & Meeting Scheduler**: Integrated scheduling with attendee tracking and meeting agendas.
- **Real-Time Group & Direct Messaging**: Real-time Socket.IO chat with read receipts, voice memos, and attachments.
- **WebRTC Voice & Video Calls**: Peer-to-peer signaling for private audio and video calls.
- **360° Peer Review & Leaderboards**: Multi-factor peer assessment and automated contribution badges.
- **Guide Risk Radar & AI Insights**: Predictive analytics for team bottlenecks, deadline slippage, and collaboration quality.

---

## 🧪 Testing & Production Build

### Backend Tests
```bash
cd backend
npm test                 # Runs all 13 Jest test suites (155+ tests)
```

### Frontend Production Build
```bash
cd frontend
npm run build            # Builds client & SSR bundles with 0 errors
```

---

## 📄 License
MIT License
