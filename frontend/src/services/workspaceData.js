// Mock dataset for the newer TeamSync AI modules: tasks, meetings,
// peer reviews / badges and the deadline + risk radar.
// Swap the internals of the matching service files for real API calls later.

const now = Date.now();
const daysFromNow = (d) => new Date(now + d * 86400000).toISOString();
const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

export const TASK_STATUSES = [
  { id: "backlog", label: "Backlog", tone: "slate" },
  { id: "todo", label: "To do", tone: "brand" },
  { id: "in_progress", label: "In progress", tone: "amber" },
  { id: "review", label: "In review", tone: "mint" },
  { id: "done", label: "Done", tone: "mint" },
];

export const TASK_PRIORITIES = {
  high: { label: "High", classes: "bg-coral-soft text-coral" },
  medium: { label: "Medium", classes: "bg-amber-soft text-amber" },
  low: { label: "Low", classes: "bg-brand-soft text-brand" },
};

export const TASKS = {
  grp1: [
    {
      id: "t1",
      title: "Clean and augment the leaf dataset",
      assigneeId: "u4",
      status: "done",
      priority: "high",
      due: daysAgo(3),
      estimate: 6,
      tags: ["data"],
    },
    {
      id: "t2",
      title: "Baseline CNN training run",
      assigneeId: "u1",
      status: "in_progress",
      priority: "high",
      due: daysFromNow(2),
      estimate: 10,
      tags: ["model"],
    },
    {
      id: "t3",
      title: "Label leaf-blight samples",
      assigneeId: "u3",
      status: "in_progress",
      priority: "medium",
      due: daysFromNow(4),
      estimate: 8,
      tags: ["data"],
    },
    {
      id: "t4",
      title: "Write literature review section",
      assigneeId: "u1",
      status: "todo",
      priority: "medium",
      due: daysFromNow(6),
      estimate: 5,
      tags: ["report"],
    },
    {
      id: "t5",
      title: "Set up inference API",
      assigneeId: "u2",
      status: "todo",
      priority: "high",
      due: daysFromNow(5),
      estimate: 7,
      tags: ["backend"],
    },
    {
      id: "t6",
      title: "Design result dashboard mockups",
      assigneeId: "u3",
      status: "review",
      priority: "low",
      due: daysFromNow(1),
      estimate: 4,
      tags: ["design"],
    },
    {
      id: "t7",
      title: "Prepare mid-sprint demo script",
      assigneeId: "u1",
      status: "backlog",
      priority: "low",
      due: daysFromNow(9),
      estimate: 2,
      tags: ["demo"],
    },
    {
      id: "t8",
      title: "Confusion-matrix evaluation notebook",
      assigneeId: "u1",
      status: "todo",
      priority: "medium",
      due: daysFromNow(7),
      estimate: 6,
      tags: ["model"],
    },
  ],
  grp2: [
    {
      id: "t9",
      title: "Wire up the sensor REST API",
      assigneeId: "u6",
      status: "todo",
      priority: "high",
      due: daysAgo(4),
      estimate: 9,
      tags: ["hardware"],
    },
    {
      id: "t10",
      title: "Energy usage dashboard layout",
      assigneeId: "u5",
      status: "in_progress",
      priority: "medium",
      due: daysFromNow(3),
      estimate: 6,
      tags: ["design"],
    },
    {
      id: "t11",
      title: "Draft the problem statement",
      assigneeId: "u5",
      status: "done",
      priority: "medium",
      due: daysAgo(9),
      estimate: 3,
      tags: ["report"],
    },
    {
      id: "t12",
      title: "Order replacement hardware kit",
      assigneeId: "u2",
      status: "backlog",
      priority: "high",
      due: daysAgo(1),
      estimate: 1,
      tags: ["hardware"],
    },
    {
      id: "t13",
      title: "Weekly data-logging script",
      assigneeId: "u5",
      status: "todo",
      priority: "low",
      due: daysFromNow(8),
      estimate: 4,
      tags: ["backend"],
    },
  ],
};

export const MEETINGS = {
  grp1: [
    {
      id: "mt1",
      title: "Model training split & sprint sync",
      when: daysAgo(1),
      durationMins: 45,
      attendeeIds: ["u1", "u2", "u3", "u4"],
      status: "completed",
      agenda: [
        "Review preprocessing notebook",
        "Divide model training tasks",
        "Dataset labeling plan",
      ],
      notes:
        "Karthik confirmed the agri-dept dataset landed and is already cleaned. Aisha will own the baseline CNN run and share metrics by Thursday. Priya is labeling leaf-blight samples but flagged that ~400 images are blurry and may need re-capture. Rohan is blocked on the inference API until the model checkpoint format is decided. The team agreed to keep Thursday as demo day because activity peaks then.",
    },
    {
      id: "mt2",
      title: "Mid-sprint demo dry run",
      when: daysFromNow(2),
      durationMins: 30,
      attendeeIds: ["u1", "u2", "u3", "u4"],
      status: "scheduled",
      agenda: ["Walk through demo script", "Decide metrics to show", "Assign speaking parts"],
      notes: "",
    },
  ],
  grp2: [
    {
      id: "mt3",
      title: "Hardware blocker review",
      when: daysAgo(6),
      durationMins: 25,
      attendeeIds: ["u5", "u2"],
      status: "completed",
      agenda: ["Sensor kit status", "Fallback simulation plan"],
      notes:
        "Dev did not join. Sneha reported the sensor kit is still with the lab store and has been pending for three weeks. Rohan suggested simulating sensor readings so the dashboard work is not blocked. No owner was assigned for the escalation to the lab in-charge, and no follow-up date was set.",
    },
    {
      id: "mt4",
      title: "Weekly guide check-in",
      when: daysFromNow(4),
      durationMins: 30,
      attendeeIds: ["u5", "u6", "u2", "g1"],
      status: "scheduled",
      agenda: ["Progress since last check-in", "Hardware escalation", "Re-plan timeline"],
      notes: "",
    },
  ],
};

export const MILESTONES = {
  grp1: [
    { id: "ms1", title: "Dataset finalized", due: daysAgo(3), done: true },
    { id: "ms2", title: "Baseline model trained", due: daysFromNow(2), done: false },
    { id: "ms3", title: "Mid-review presentation", due: daysFromNow(12), done: false },
    { id: "ms4", title: "Final report submission", due: daysFromNow(40), done: false },
  ],
  grp2: [
    { id: "ms5", title: "Hardware kit received", due: daysAgo(11), done: false },
    { id: "ms6", title: "Sensor data pipeline", due: daysAgo(2), done: false },
    { id: "ms7", title: "Mid-review presentation", due: daysFromNow(12), done: false },
    { id: "ms8", title: "Final report submission", due: daysFromNow(40), done: false },
  ],
};

// Peer reviews are per review round; scores are 1-5.
export const REVIEW_ROUNDS = {
  grp1: [
    { id: "rr1", label: "Sprint 2 peer review", closesAt: daysFromNow(3), open: true },
    { id: "rr0", label: "Sprint 1 peer review", closesAt: daysAgo(14), open: false },
  ],
  grp2: [{ id: "rr2", label: "Sprint 2 peer review", closesAt: daysFromNow(3), open: true }],
};

export const PEER_REVIEWS = {
  rr0: [
    {
      id: "pr1",
      fromId: "u2",
      toId: "u1",
      scores: { reliability: 5, communication: 5, quality: 4 },
      comment: "Kept the whole team unblocked all sprint.",
    },
    {
      id: "pr2",
      fromId: "u3",
      toId: "u1",
      scores: { reliability: 5, communication: 4, quality: 5 },
      comment: "Reviews are fast and detailed.",
    },
    {
      id: "pr3",
      fromId: "u1",
      toId: "u2",
      scores: { reliability: 4, communication: 4, quality: 4 },
      comment: "Solid backend work.",
    },
    {
      id: "pr4",
      fromId: "u4",
      toId: "u3",
      scores: { reliability: 4, communication: 5, quality: 4 },
      comment: "Great at documenting decisions.",
    },
    {
      id: "pr5",
      fromId: "u1",
      toId: "u4",
      scores: { reliability: 3, communication: 3, quality: 4 },
      comment: "Dataset work was strong, updates were rare.",
    },
  ],
  rr1: [
    {
      id: "pr6",
      fromId: "u2",
      toId: "u1",
      scores: { reliability: 5, communication: 5, quality: 5 },
      comment: "Carried the training pipeline.",
    },
    {
      id: "pr7",
      fromId: "u4",
      toId: "u3",
      scores: { reliability: 4, communication: 4, quality: 5 },
      comment: "Labeling quality is excellent.",
    },
  ],
  rr2: [
    {
      id: "pr8",
      fromId: "u2",
      toId: "u5",
      scores: { reliability: 4, communication: 5, quality: 4 },
      comment: "Only person consistently pushing work forward.",
    },
  ],
};

export const BADGE_CATALOG = [
  {
    id: "b_reliable",
    label: "Always delivers",
    emoji: "🎯",
    hint: "Average reliability of 4.5+ across peer reviews",
  },
  {
    id: "b_communicator",
    label: "Team communicator",
    emoji: "💬",
    hint: "Top communication score in the group",
  },
  {
    id: "b_quality",
    label: "Quality bar",
    emoji: "✨",
    hint: "Highest work-quality score in the group",
  },
  {
    id: "b_unblocker",
    label: "Unblocker",
    emoji: "🔓",
    hint: "Closed the most high-priority tasks",
  },
  {
    id: "b_finisher",
    label: "Sprint finisher",
    emoji: "🏁",
    hint: "Completed every task assigned this sprint",
  },
];
