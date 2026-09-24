// Central mock dataset for the frontend-only build of TeamSync AI.
// Replace these functions' internals with real API calls once the backend is ready —
// the function signatures are designed to stay stable.

export const USERS = [
  {
    id: "u1",
    name: "Aisha Verma",
    email: "aisha.verma@teamsync.edu",
    role: "student",
    dept: "CSE",
    color: "#5B5FEF",
  },
  {
    id: "u2",
    name: "Rohan Mehta",
    email: "rohan.mehta@teamsync.edu",
    role: "student",
    dept: "CSE",
    color: "#23C486",
  },
  {
    id: "u3",
    name: "Priya Nair",
    email: "priya.nair@teamsync.edu",
    role: "student",
    dept: "IT",
    color: "#F2A93B",
  },
  {
    id: "u4",
    name: "Karthik Iyer",
    email: "karthik.iyer@teamsync.edu",
    role: "student",
    dept: "CSE",
    color: "#EF5B5B",
  },
  {
    id: "u5",
    name: "Sneha Reddy",
    email: "sneha.reddy@teamsync.edu",
    role: "student",
    dept: "ECE",
    color: "#8B5CF6",
  },
  {
    id: "u6",
    name: "Dev Kulkarni",
    email: "dev.kulkarni@teamsync.edu",
    role: "student",
    dept: "IT",
    color: "#0EA5E9",
  },
  {
    id: "g1",
    name: "Dr. Meera Rao",
    email: "meera.rao@teamsync.edu",
    role: "guide",
    dept: "CSE",
    color: "#4347C4",
  },
];

export const GROUPS = [
  {
    id: "grp1",
    name: "Team Nimbus",
    project: "AI-Based Crop Disease Detection",
    guideId: "g1",
    memberIds: ["u1", "u2", "u3", "u4"],
    collaborationScore: 82,
    progress: 64,
    createdAt: "2026-02-10",
  },
  {
    id: "grp2",
    name: "Team Vortex",
    project: "Smart Campus Energy Monitor",
    guideId: "g1",
    memberIds: ["u5", "u6", "u2"],
    collaborationScore: 41,
    progress: 28,
    createdAt: "2026-02-14",
  },
];

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60000).toISOString();

export const GROUP_MESSAGES = {
  grp1: [
    {
      id: "m1",
      senderId: "u1",
      text: "Pushed the preprocessing notebook, can someone review?",
      time: minsAgo(240),
    },
    {
      id: "m2",
      senderId: "u2",
      text: "On it — checking the augmentation pipeline now.",
      time: minsAgo(232),
    },
    {
      id: "m3",
      senderId: "u4",
      text: "Dataset from the agri-dept finally came through 🎉",
      time: minsAgo(210),
    },
    {
      id: "m4",
      senderId: "u3",
      text: "Nice! I'll start labeling the leaf-blight samples tonight.",
      time: minsAgo(205),
    },
    {
      id: "m5",
      senderId: "u1",
      text: "Let's sync at 6pm to divide the model training tasks.",
      time: minsAgo(60),
    },
    { id: "m6", senderId: "u2", text: "Works for me 👍", time: minsAgo(58) },
  ],
  grp2: [
    {
      id: "m7",
      senderId: "u5",
      text: "Has anyone wired up the sensor API yet?",
      time: minsAgo(600),
    },
    {
      id: "m8",
      senderId: "u6",
      text: "Not yet, still waiting on the hardware kit.",
      time: minsAgo(590),
    },
    {
      id: "m9",
      senderId: "u5",
      text: "This is the third week we've said that...",
      time: minsAgo(120),
    },
  ],
};

export const PRIVATE_MESSAGES = {
  u2: [
    {
      id: "p1",
      senderId: "u2",
      text: "Hey, did you get the dataset link I sent?",
      time: minsAgo(300),
    },
    { id: "p2", senderId: "me", text: "Yes! Downloading it now, thanks.", time: minsAgo(295) },
  ],
  u5: [
    {
      id: "p3",
      senderId: "u5",
      text: "Can you share the Figma file for the dashboard?",
      time: minsAgo(45),
    },
  ],
};

export const GROUP_FILES = {
  grp1: [
    {
      id: "f1",
      name: "leaf_dataset_v2.zip",
      size: 18_400_000,
      type: "zip",
      uploadedBy: "u4",
      uploadedAt: minsAgo(210),
    },
    {
      id: "f2",
      name: "preprocessing_notebook.ipynb",
      size: 220_000,
      type: "file",
      uploadedBy: "u1",
      uploadedAt: minsAgo(240),
    },
    {
      id: "f3",
      name: "project_proposal.pdf",
      size: 1_240_000,
      type: "pdf",
      uploadedBy: "u1",
      uploadedAt: "2026-02-11",
    },
    {
      id: "f4",
      name: "architecture_diagram.png",
      size: 860_000,
      type: "image",
      uploadedBy: "u3",
      uploadedAt: "2026-02-20",
    },
  ],
  grp2: [
    {
      id: "f5",
      name: "sensor_spec_sheet.pdf",
      size: 640_000,
      type: "pdf",
      uploadedBy: "u6",
      uploadedAt: minsAgo(590),
    },
  ],
};

export const NOTIFICATIONS = [
  {
    id: "n1",
    title: "New message in Team Nimbus",
    body: "Rohan Mehta sent a message",
    time: minsAgo(58),
    read: false,
    type: "chat",
  },
  {
    id: "n2",
    title: "AI weekly report ready",
    body: "Your collaboration report for this week is ready",
    time: minsAgo(180),
    read: false,
    type: "ai",
  },
  {
    id: "n3",
    title: "File shared",
    body: "Karthik Iyer uploaded leaf_dataset_v2.zip",
    time: minsAgo(210),
    read: true,
    type: "file",
  },
];

export const GUIDE_ALERTS = [
  {
    id: "al1",
    groupId: "grp2",
    memberId: "u6",
    severity: "high",
    message: "Dev Kulkarni has sent 0 messages in the last 7 days.",
    time: minsAgo(120),
  },
  {
    id: "al2",
    groupId: "grp2",
    memberId: null,
    severity: "medium",
    message: "Team Vortex progress has stalled — no file uploads in 9 days.",
    time: minsAgo(300),
  },
  {
    id: "al3",
    groupId: "grp1",
    memberId: null,
    severity: "low",
    message: "Team Nimbus is trending ahead of schedule.",
    time: minsAgo(600),
  },
];

export const ACTIVITY_SERIES = {
  grp1: [
    { day: "Mon", messages: 18, filesShared: 2 },
    { day: "Tue", messages: 26, filesShared: 1 },
    { day: "Wed", messages: 14, filesShared: 0 },
    { day: "Thu", messages: 32, filesShared: 3 },
    { day: "Fri", messages: 21, filesShared: 1 },
    { day: "Sat", messages: 9, filesShared: 0 },
    { day: "Sun", messages: 12, filesShared: 1 },
  ],
  grp2: [
    { day: "Mon", messages: 4, filesShared: 0 },
    { day: "Tue", messages: 2, filesShared: 0 },
    { day: "Wed", messages: 6, filesShared: 1 },
    { day: "Thu", messages: 1, filesShared: 0 },
    { day: "Fri", messages: 3, filesShared: 0 },
    { day: "Sat", messages: 0, filesShared: 0 },
    { day: "Sun", messages: 2, filesShared: 0 },
  ],
};

export const CONTRIBUTION_DATA = {
  grp1: [
    { member: "Aisha", value: 34 },
    { member: "Rohan", value: 28 },
    { member: "Priya", value: 22 },
    { member: "Karthik", value: 16 },
  ],
  grp2: [
    { member: "Sneha", value: 52 },
    { member: "Dev", value: 12 },
    { member: "Rohan", value: 36 },
  ],
};

export const PROGRESS_PREDICTION = {
  grp1: { weeksRemaining: 6, onTrack: true, predictedCompletion: "2026-05-02", confidence: 87 },
  grp2: { weeksRemaining: 11, onTrack: false, predictedCompletion: "2026-06-20", confidence: 54 },
};

export const RECOMMENDATIONS = {
  grp1: [
    "Rotate the code-review task so Priya and Karthik get more visibility into the model code.",
    "Schedule the mid-sprint demo before Thursday — activity peaks that day.",
  ],
  grp2: [
    "Check in with Dev Kulkarni directly — participation has dropped sharply this week.",
    "Break the sensor integration task into smaller sub-tasks to unblock progress.",
    "Consider a short stand-up call; chat-only coordination seems to be stalling.",
  ],
};

export const AI_CHAT_SUMMARY = {
  grp1: "The team has been highly collaborative this week, with steady discussion around dataset preparation and model architecture. Aisha and Rohan are driving most decisions; Priya and Karthik are contributing well on data labeling.",
  grp2: "Communication has slowed considerably. Most recent messages show frustration over delayed hardware, and one member has gone quiet. Recommend guide check-in.",
};

export const getUserById = (id) => USERS.find((u) => u.id === id);
