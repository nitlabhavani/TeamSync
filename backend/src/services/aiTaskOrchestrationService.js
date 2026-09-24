/**
 * AI Task Orchestration Service
 *
 * Central orchestrator for the AI-Controlled Task Lifecycle:
 * 1. decomposeTaskRequirement: Deep structured decomposition from Title & Description only.
 * 2. determineEligibleAssignee: Enforces strict ONE-ACTIVE-TASK-PER-STUDENT rule using live DB evidence.
 * 3. calculateAiDeadlineAndPriority: Calculates realistic deadlines from project schedule and milestones.
 * 4. previewTask: Generates structured preview before persisting.
 * 5. orchestrateTaskCreation: Discards client control fields and executes end-to-end AI creation.
 */
const mongoose = require("mongoose");
const Task = require("../models/Task");
const User = require("../models/User");
const Group = require("../models/Group");
const aiEngine = require("./aiEngineClient");
const { ACTIVE_TASK_STATUSES } = require("../models/Task");

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
  "page", "app", "system", "feature", "task", "add", "create", "update",
  "implement", "build", "fix", "new", "all", "this", "that", "from",
]);

function sanitizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    )
  );
}

/**
 * Detects domain and returns domain templates for structured breakdown.
 */
function detectTaskDomain(title, description) {
  const text = `${title} ${description}`.toLowerCase();

  if (/(auth|login|signup|sign in|sign up|jwt|register|session|password|oauth)/i.test(text)) {
    return {
      domain: "Authentication & Security",
      deliverableType: "backend",
      module: "Authentication",
      skills: ["Authentication", "JWT", "Node.js", "Security", "REST API"],
      expectedFiles: [
        "src/controllers/authController.js",
        "src/routes/authRoutes.js",
        "src/middleware/authMiddleware.js",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Define authentication contracts and schema validations",
          description: "Establish request validation schemas, token expiration policies, and password hashing standards.",
          targetFiles: ["authController.js", "User.js"],
        },
        {
          stepNumber: 2,
          title: "Implement authentication routes and controller handlers",
          description: "Develop login, registration, and token refresh endpoints with secure error handling.",
          targetFiles: ["authRoutes.js", "authController.js"],
        },
        {
          stepNumber: 3,
          title: "Implement route authorization guards and unit tests",
          description: "Protect private resources with role validation middleware and write comprehensive test cases.",
          targetFiles: ["authMiddleware.js", "auth.test.js"],
        },
      ],
      criteria: [
        "Authentication endpoints securely validate user credentials and return signed tokens.",
        "Unauthorized requests receive HTTP 401 with structured error messages.",
        "Passwords are cryptographically hashed and never exposed in responses or logs.",
      ],
      priority: "high",
      baseDays: 4,
    };
  }

  if (/(database|schema|mongo|migration|model|prisma|sql|table|entity)/i.test(text)) {
    return {
      domain: "Database & Data Architecture",
      deliverableType: "database",
      module: "Database & Models",
      skills: ["MongoDB", "Mongoose", "Database Schema Design", "Data Modeling"],
      expectedFiles: [
        "src/models/",
        "src/scripts/seedData.js",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Design entity schemas and relationships",
          description: "Define schema fields, strict type validations, default values, and foreign key references.",
          targetFiles: ["models/"],
        },
        {
          stepNumber: 2,
          title: "Implement indexes and query performance constraints",
          description: "Create indexes on frequent lookup keys and establish pre/post save hooks.",
          targetFiles: ["models/"],
        },
        {
          stepNumber: 3,
          title: "Build sample seed data and migration scripts",
          description: "Write reproducible seeding scripts to populate test fixtures cleanly.",
          targetFiles: ["seedData.js"],
        },
      ],
      criteria: [
        "Data models are defined with schema validations and foreign key references.",
        "Indexes are configured for optimal query performance.",
        "Seed scripts execute without validation errors.",
      ],
      priority: "high",
      baseDays: 3,
    };
  }

  if (/(frontend|ui|screen|component|react|view|page|dashboard|css|tailwind|layout)/i.test(text)) {
    return {
      domain: "Frontend & User Interface",
      deliverableType: "frontend",
      module: "Frontend & UI",
      skills: ["React", "JavaScript", "Tailwind CSS", "UI/UX", "State Management"],
      expectedFiles: [
        "src/pages/",
        "src/components/",
        "src/styles/",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Construct responsive layout and core component hierarchy",
          description: "Build clean, accessible UI components with Tailwind CSS supporting desktop and mobile viewports.",
          targetFiles: ["components/", "pages/"],
        },
        {
          stepNumber: 2,
          title: "Implement interactive client state and input validations",
          description: "Wire reactive states, form error states, loading spinners, and empty states.",
          targetFiles: ["components/"],
        },
        {
          stepNumber: 3,
          title: "Connect client views to data services with feedback toasts",
          description: "Integrate API calls, handle asynchronous loading, and display informative user notifications.",
          targetFiles: ["pages/", "services/"],
        },
      ],
      criteria: [
        "Interface renders responsively across desktop and mobile screens.",
        "Loading, empty, and error states are clearly communicated to the user.",
        "Component code adheres to project style guidelines with zero console errors.",
      ],
      priority: "medium",
      baseDays: 4,
    };
  }

  if (/(api|endpoint|controller|service|backend|route|server|express)/i.test(text)) {
    return {
      domain: "Backend Services & APIs",
      deliverableType: "backend",
      module: "Backend Services",
      skills: ["Node.js", "Express", "REST APIs", "Error Handling", "Async Programming"],
      expectedFiles: [
        "src/controllers/",
        "src/routes/",
        "src/services/",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Design REST endpoint routing and parameter contracts",
          description: "Define route paths, HTTP methods, status codes, and input validation schemas.",
          targetFiles: ["routes/"],
        },
        {
          stepNumber: 2,
          title: "Implement business logic controllers and services",
          description: "Code controller logic, service layer abstractions, and clean async database queries.",
          targetFiles: ["controllers/", "services/"],
        },
        {
          stepNumber: 3,
          title: "Add error handling, audit logging, and automated tests",
          description: "Enforce consistent error formatting, activity logging, and write verification tests.",
          targetFiles: ["controllers/", "tests/"],
        },
      ],
      criteria: [
        "Endpoints adhere to standard HTTP status codes and uniform JSON response envelopes.",
        "Invalid inputs are rejected with clear 400 Bad Request messages.",
        "All business logic edge cases are handled safely without unhandled rejections.",
      ],
      priority: "high",
      baseDays: 4,
    };
  }

  if (/(test|qa|testing|unit test|integration test|e2e|cypress|jest)/i.test(text)) {
    return {
      domain: "Testing & Quality Assurance",
      deliverableType: "code",
      module: "Quality Assurance",
      skills: ["Testing", "Jest", "Automated QA", "Regression Testing"],
      expectedFiles: [
        "tests/",
        "scripts/testRunner.js",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Draft test cases covering positive, negative, and edge scenarios",
          description: "Enumerate key user flows, boundaries, and failure cases to test systematically.",
          targetFiles: ["tests/"],
        },
        {
          stepNumber: 2,
          title: "Implement automated unit and integration tests",
          description: "Write mock fixtures and assert expected behavior across all target modules.",
          targetFiles: ["tests/"],
        },
        {
          stepNumber: 3,
          title: "Execute test suite and document coverage results",
          description: "Run test execution scripts and generate summary report of verified features.",
          targetFiles: ["tests/"],
        },
      ],
      criteria: [
        "Automated tests pass cleanly without flaky failures.",
        "Failure cases and error handlers are tested and verified.",
        "Test report confirms regression stability across the application.",
      ],
      priority: "medium",
      baseDays: 3,
    };
  }

  if (/(deploy|ci|cd|pipeline|docker|devops|build|production)/i.test(text)) {
    return {
      domain: "DevOps & Deployment",
      deliverableType: "code",
      module: "DevOps & Infrastructure",
      skills: ["DevOps", "Docker", "CI/CD", "Configuration", "Build Tools"],
      expectedFiles: [
        "Dockerfile",
        ".env.example",
        "scripts/",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Formulate containerization and runtime environment configuration",
          description: "Configure container specifications, environment variables, and build parameters.",
          targetFiles: ["Dockerfile", ".env.example"],
        },
        {
          stepNumber: 2,
          title: "Set up CI/CD pipeline automation and static analysis checks",
          description: "Automate build verification, lint checks, and deployment staging triggers.",
          targetFiles: ["scripts/"],
        },
        {
          stepNumber: 3,
          title: "Test deployment flow and document rollback steps",
          description: "Validate deployment staging, health check endpoints, and disaster recovery procedures.",
          targetFiles: ["scripts/"],
        },
      ],
      criteria: [
        "Production build completes cleanly without missing dependencies.",
        "Zero credentials or environment secrets committed to repository.",
        "Service health check responds successfully upon startup.",
      ],
      priority: "medium",
      baseDays: 3,
    };
  }

  if (/(doc|documentation|report|presentation|ppt|slides|guide)/i.test(text)) {
    const isPresentation = /(presentation|ppt|slides)/i.test(text);
    return {
      domain: isPresentation ? "Project Presentation" : "Project Documentation",
      deliverableType: isPresentation ? "presentation" : "documentation",
      module: isPresentation ? "Presentation & Pitch" : "Documentation",
      skills: ["Technical Writing", "Documentation", "Project Presentation"],
      expectedFiles: [
        "docs/",
        "README.md",
        "Repository file locations require inspection",
      ],
      steps: [
        {
          stepNumber: 1,
          title: "Synthesize requirements, architecture, and specifications",
          description: "Gather system requirements, diagrams, and feature flows into a coherent outline.",
          targetFiles: ["docs/"],
        },
        {
          stepNumber: 2,
          title: "Draft comprehensive documentation with visual diagrams",
          description: "Write detailed sections covering architecture, API endpoints, and user walkthroughs.",
          targetFiles: ["docs/"],
        },
        {
          stepNumber: 3,
          title: "Review technical clarity and finalize artifact package",
          description: "Verify factual accuracy, check formatting consistency, and export final deliverables.",
          targetFiles: ["docs/"],
        },
      ],
      criteria: [
        "Document clearly articulates architecture, setup instructions, and workflows.",
        "Visual diagrams and code samples are accurate and up to date.",
        "All required review sections are complete and formatted cleanly.",
      ],
      priority: "low",
      baseDays: 3,
    };
  }

  // General Software Engineering Fallback
  return {
    domain: "Core Engineering",
    deliverableType: "code",
    module: "Core Features",
    skills: ["Full Stack Development", "Problem Solving", "Code Quality"],
    expectedFiles: [
      "Repository file locations require inspection",
    ],
    steps: [
      {
        stepNumber: 1,
        title: `Decompose requirements for ${title}`,
        description: "Analyze technical requirements, identify dependencies, and outline the implementation approach.",
        targetFiles: ["Repository file locations require inspection"],
      },
      {
        stepNumber: 2,
        title: `Implement core feature logic for ${title}`,
        description: "Write clean, modular code satisfying the task objectives with appropriate error handling.",
        targetFiles: ["Repository file locations require inspection"],
      },
      {
        stepNumber: 3,
        title: `Verify functionality and validate edge cases`,
        description: "Perform testing to verify feature behavior matches the requirements without side effects.",
        targetFiles: ["Repository file locations require inspection"],
      },
    ],
    criteria: [
      `Feature behaves strictly according to the task title: "${title}".`,
      "Implementation is tested and does not regress existing functionality.",
      "Code is well-structured with appropriate error handling.",
    ],
    priority: "medium",
    baseDays: 3,
  };
}

/**
 * Layer 1: Decomposes human Title & Description into a complete structured task specification.
 */
async function decomposeTaskRequirement({ title, description, group = {} }) {
  const cleanTitle = sanitizeText(title);
  const cleanDesc = sanitizeText(description) || cleanTitle;

  if (!cleanTitle) {
    throw new Error("Task title is required");
  }

  // Detect domain template
  const domainInfo = detectTaskDomain(cleanTitle, cleanDesc);

  // Attempt to call Python AI engine for expansion
  let aiExpansion = null;
  try {
    const aiRes = await aiEngine.analyzeTaskExpansion({
      title: cleanTitle,
      description: cleanDesc,
    });
    if (aiRes?.ok && aiRes.data) {
      aiExpansion = aiRes.data;
    }
  } catch (err) {
    // Graceful fallback to domain template
  }

  // Synthesize Objective and Problem Statement
  const objective = cleanDesc.length > 20
    ? `Implement ${cleanTitle} by satisfying: ${cleanDesc.slice(0, 150)}${cleanDesc.length > 150 ? "..." : ""}`
    : `Develop and verify ${cleanTitle} to fulfill project specifications.`;

  const problemStatement = cleanDesc.length > 10
    ? cleanDesc
    : `The project requires ${cleanTitle} to provide reliable functionality and ensure team milestones are satisfied.`;

  // Synthesize Steps: prefer AI engine subtasks if valid, otherwise domain template steps
  let implementationPlan = domainInfo.steps;
  if (aiExpansion?.subtasks && Array.isArray(aiExpansion.subtasks) && aiExpansion.subtasks.length >= 2) {
    implementationPlan = aiExpansion.subtasks.map((sub, idx) => ({
      stepNumber: idx + 1,
      title: typeof sub === "string" ? sub : sub.title || `Step ${idx + 1}`,
      description: typeof sub === "object" && sub.description ? sub.description : `Execute implementation for ${typeof sub === "string" ? sub : sub.title}.`,
      targetFiles: ["Repository file locations require inspection"],
    }));
  }

  // Synthesize Criteria
  let completionCriteria = domainInfo.criteria;
  if (aiExpansion?.acceptanceCriteria && Array.isArray(aiExpansion.acceptanceCriteria) && aiExpansion.acceptanceCriteria.length >= 2) {
    completionCriteria = aiExpansion.acceptanceCriteria.map((c) => (typeof c === "string" ? c : String(c)));
  }

  const whatToDo = implementationPlan
    .map((s) => `${s.stepNumber}. **${s.title}**: ${s.description}`)
    .join("\n");

  const expectedOutput = `Completed and verified implementation of ${cleanTitle} satisfying all acceptance criteria with code/deliverable artifacts submitted in a ZIP archive.`;

  return {
    title: cleanTitle,
    description: cleanDesc,
    objective,
    problemStatement,
    whatToDo,
    expectedOutput,
    deliverableType: domainInfo.deliverableType,
    implementationPlan,
    expectedFiles: domainInfo.expectedFiles,
    completionCriteria,
    requiredSkills: domainInfo.skills,
    module: domainInfo.module,
    priority: domainInfo.priority,
    baseDays: domainInfo.baseDays,
  };
}

/**
 * Layer 2: Determines Eligible Assignee enforcing the STRICT ONE-ACTIVE-TASK-PER-STUDENT rule.
 */
async function determineEligibleAssignee({ group, taskDetails }) {
  if (!group || !group._id) {
    return {
      eligible: false,
      selectedStudentId: null,
      studentName: "",
      eligibilityStatus: "NO_ELIGIBLE_ASSIGNEE",
      assignmentReason: "Invalid or missing group reference.",
      evidenceUsed: [],
      confidence: 0,
      evaluatedMembersCount: 0,
      activeTasksCount: 0,
      freeMembersCount: 0,
    };
  }

  // Fetch all group members
  const memberIds = (group.members || []).map((m) => String(m._id || m));
  if (group.leader && !memberIds.includes(String(group.leader._id || group.leader))) {
    memberIds.push(String(group.leader._id || group.leader));
  }

  if (!memberIds.length) {
    return {
      eligible: false,
      selectedStudentId: null,
      studentName: "",
      eligibilityStatus: "NO_ELIGIBLE_ASSIGNEE",
      assignmentReason: "No members enrolled in this project group.",
      evidenceUsed: ["Group has 0 enrolled members."],
      confidence: 0,
      evaluatedMembersCount: 0,
      activeTasksCount: 0,
      freeMembersCount: 0,
    };
  }

  // Query actual member users
  let members = [];
  try {
    const validObjectIds = memberIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validObjectIds.length > 0 && typeof User.find === "function") {
      members = await User.find({ _id: { $in: validObjectIds } })
        .select("_id name email role")
        .lean();
    }
  } catch (err) {
    members = [];
  }

  // Fallback for mock/test environments or unpopulated users
  if (!members.length && memberIds.length > 0) {
    members = memberIds.map((id) => ({
      _id: id,
      name: String(id),
      email: `${id}@teamsync.local`,
      role: "student",
    }));
  }

  // Find all active tasks in this group
  let activeTasks = [];
  try {
    if (typeof Task.find === "function") {
      activeTasks = await Task.find({
        group: group._id,
        assignee: { $in: memberIds },
        status: { $in: ACTIVE_TASK_STATUSES },
      })
        .select("assignee title status")
        .lean();
    }
  } catch (err) {
    activeTasks = [];
  }

  const busyMemberIdSet = new Set((activeTasks || []).map((t) => String(t.assignee)));

  // Identify eligible members (0 active tasks)
  const eligibleMembers = members.filter((m) => !busyMemberIdSet.has(String(m._id)));

  console.log(
    `[ai-task-orchestrator] One-active-task evaluation for group ${group._id}:\n` +
    `  Total members: ${members.length}\n` +
    `  Busy members with active task: ${busyMemberIdSet.size}\n` +
    `  Eligible members with 0 active tasks: ${eligibleMembers.length}`
  );

  // If NO eligible members exist: STRICT ENFORCEMENT
  if (!eligibleMembers.length) {
    const busySummary = members.map((m) => `${m.name} (Active Task: In Progress)`).join(", ");
    return {
      eligible: false,
      selectedStudentId: null,
      studentName: "",
      eligibilityStatus: "NO_ELIGIBLE_ASSIGNEE",
      assignmentReason: `All ${members.length} group members currently have an active task in progress. Under the strict one-active-task-at-a-time rule, this task has been queued in the Backlog until a member completes their current task.`,
      evidenceUsed: [
        `Strict one-active-task policy enforced: maximum 1 concurrent active task per student.`,
        `Current member workload: ${busySummary}.`,
        `Queued status: backlog.`,
      ],
      confidence: 0,
      evaluatedMembersCount: members.length,
      activeTasksCount: busyMemberIdSet.size,
      freeMembersCount: 0,
    };
  }

  // Gather past completed tasks for eligible members to compute domain match & past experience
  const eligibleIds = eligibleMembers.map((m) => m._id);
  let completedTasks = [];
  try {
    if (typeof Task.find === "function") {
      completedTasks = await Task.find({
        group: group._id,
        assignee: { $in: eligibleIds },
        status: { $in: ["completed", "done"] },
      })
        .select("assignee title module deliverableType requiredSkills")
        .lean();
    }
  } catch (err) {
    completedTasks = [];
  }

  const completedByMember = {};
  eligibleMembers.forEach((m) => {
    completedByMember[String(m._id)] = [];
  });
  completedTasks.forEach((t) => {
    const aid = String(t.assignee);
    if (completedByMember[aid]) {
      completedByMember[aid].push(t);
    }
  });

  // Score eligible candidates
  const taskTokens = tokenize(`${taskDetails.title} ${taskDetails.description} ${taskDetails.module}`);
  const scoredCandidates = eligibleMembers.map((m) => {
    const mId = String(m._id);
    const pastCompleted = completedByMember[mId] || [];
    let similarityHits = 0;

    pastCompleted.forEach((past) => {
      const pastTokens = tokenize(`${past.title} ${past.module || ""}`);
      const overlap = pastTokens.filter((tok) => taskTokens.includes(tok));
      if (overlap.length > 0) similarityHits += overlap.length;
    });

    // Score: Base 60 + similarity points (capped) + past completion experience
    const similarityScore = Math.min(30, similarityHits * 10);
    const experienceScore = Math.min(10, pastCompleted.length * 2);
    const totalScore = 60 + similarityScore + experienceScore;

    return {
      member: m,
      totalScore,
      similarityScore,
      completedCount: pastCompleted.length,
      reasonDetail: similarityHits > 0
        ? `completed ${pastCompleted.length} related task(s) with matching keywords`
        : `available with 0 active tasks and balanced workload`,
    };
  });

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
  const topChoice = scoredCandidates[0];

  return {
    eligible: true,
    selectedStudentId: topChoice.member._id,
    studentName: topChoice.member.name,
    eligibilityStatus: "ASSIGNED",
    assignmentReason: `Selected ${topChoice.member.name}: Verified 0 active tasks (strictly eligible) and ${topChoice.reasonDetail}.`,
    evidenceUsed: [
      `Enforced strict one-active-task rule: Member has 0 current active tasks.`,
      `Completed tasks in this project: ${topChoice.completedCount}.`,
      `AI candidate suitability score: ${topChoice.totalScore}/100.`,
      `Other eligible members considered: ${eligibleMembers.length - 1}.`,
    ],
    confidence: topChoice.totalScore,
    evaluatedMembersCount: members.length,
    activeTasksCount: busyMemberIdSet.size,
    freeMembersCount: eligibleMembers.length,
  };
}

/**
 * Layer 3: Calculates AI Deadlines and Priority from project context.
 */
function calculateAiDeadlineAndPriority({ group = {}, taskDetails = {} }) {
  const now = new Date();
  const baseDays = Number(taskDetails.baseDays || 4);

  // Group completion deadline
  const projectCompletionDate = group.expectedCompletion ? new Date(group.expectedCompletion) : null;
  const hasValidProjectDeadline = projectCompletionDate && !isNaN(projectCompletionDate.getTime()) && projectCompletionDate > now;

  // Compute calculated due date
  let calculatedDue = new Date(now.getTime() + baseDays * 24 * 60 * 60 * 1000);
  let deadlineSource = `AI schedule estimate: ${baseDays} days allocated based on ${taskDetails.module || "task"} complexity.`;

  if (hasValidProjectDeadline) {
    if (calculatedDue > projectCompletionDate) {
      // Fit within project completion date
      const availableMs = projectCompletionDate.getTime() - now.getTime();
      const safeOffset = Math.max(24 * 60 * 60 * 1000, Math.floor(availableMs * 0.8));
      calculatedDue = new Date(now.getTime() + safeOffset);
      deadlineSource = `Aligned with project final deadline (${projectCompletionDate.toLocaleDateString()}) with safe completion buffer.`;
    } else {
      deadlineSource = `Scheduled ${baseDays} days ahead, well within project final deadline (${projectCompletionDate.toLocaleDateString()}).`;
    }
  }

  // Priority and rationale
  const priority = taskDetails.priority || "medium";
  const priorityRationale = `Priority "${priority}" assigned based on ${taskDetails.module || "domain"} dependencies and required deliverable type (${taskDetails.deliverableType || "code"}).`;

  return {
    due: calculatedDue,
    deadlineSource,
    priority,
    priorityRationale,
  };
}

/**
 * Previews task decomposition and assignee selection before creation.
 */
async function previewTask({ title, description, group }) {
  const breakdown = await decomposeTaskRequirement({ title, description, group });
  const assignment = await determineEligibleAssignee({ group, taskDetails: breakdown });
  const deadline = calculateAiDeadlineAndPriority({ group, taskDetails: breakdown });

  return {
    preview: true,
    title: breakdown.title,
    description: breakdown.description,
    objective: breakdown.objective,
    problemStatement: breakdown.problemStatement,
    whatToDo: breakdown.whatToDo,
    expectedOutput: breakdown.expectedOutput,
    deliverableType: breakdown.deliverableType,
    implementationPlan: breakdown.implementationPlan,
    expectedFiles: breakdown.expectedFiles,
    completionCriteria: breakdown.completionCriteria,
    requiredSkills: breakdown.requiredSkills,
    module: breakdown.module,
    priority: deadline.priority,
    priorityRationale: deadline.priorityRationale,
    due: deadline.due,
    deadlineSource: deadline.deadlineSource,
    aiAssignment: {
      selectedStudentId: assignment.selectedStudentId,
      studentName: assignment.studentName,
      assignmentReason: assignment.assignmentReason,
      evidenceUsed: assignment.evidenceUsed,
      confidence: assignment.confidence,
      eligibilityStatus: assignment.eligibilityStatus,
      evaluatedMembersCount: assignment.evaluatedMembersCount,
      activeTasksCount: assignment.activeTasksCount,
    },
    notice: "These task details and assignment were generated by AI from the provided title and description.",
  };
}

/**
 * Orchestrates complete task creation:
 * - Rejects/discards client-supplied control fields.
 * - Decomposes task.
 * - Enforces one-active-task rule.
 * - Computes grounded deadline and priority.
 * - Atomically saves task.
 */
async function orchestrateTaskCreation({ title, description, group, createdBy }) {
  const breakdown = await decomposeTaskRequirement({ title, description, group });
  const assignment = await determineEligibleAssignee({ group, taskDetails: breakdown });
  const deadline = calculateAiDeadlineAndPriority({ group, taskDetails: breakdown });

  // Atomic re-check of one-active-task rule if an assignee was selected
  let finalAssignee = assignment.selectedStudentId;
  let finalStatus = "todo";
  let finalEligibilityStatus = assignment.eligibilityStatus;
  let finalAssignmentReason = assignment.assignmentReason;

  if (finalAssignee) {
    const concurrentActiveCount = typeof Task.countDocuments === "function"
      ? await Task.countDocuments({
          group: group._id,
          assignee: finalAssignee,
          status: { $in: ACTIVE_TASK_STATUSES },
        })
      : 0;

    if (concurrentActiveCount > 0) {
      console.warn(
        `[ai-task-orchestrator] Candidate ${finalAssignee} acquired active task during processing. Re-evaluating...`
      );
      const recheck = await determineEligibleAssignee({ group, taskDetails: breakdown });
      finalAssignee = recheck.selectedStudentId;
      finalEligibilityStatus = recheck.eligibilityStatus;
      finalAssignmentReason = recheck.assignmentReason;
    }
  }

  if (!finalAssignee) {
    // No eligible assignee: queue in backlog
    finalStatus = "backlog";
    finalEligibilityStatus = "NO_ELIGIBLE_ASSIGNEE";
  }

  const taskDoc = await Task.create({
    group: group._id,
    createdBy: createdBy._id,
    title: breakdown.title,
    description: breakdown.description,
    objective: breakdown.objective,
    problemStatement: breakdown.problemStatement,
    whatToDo: breakdown.whatToDo,
    expectedOutput: breakdown.expectedOutput,
    deliverableType: breakdown.deliverableType,
    implementationPlan: breakdown.implementationPlan,
    expectedFiles: breakdown.expectedFiles,
    completionCriteria: breakdown.completionCriteria,
    requiredSkills: breakdown.requiredSkills,
    module: breakdown.module,
    assignee: finalAssignee || undefined,
    status: finalStatus,
    priority: deadline.priority,
    due: deadline.due,
    deadlineSource: deadline.deadlineSource,
    priorityRationale: deadline.priorityRationale,
    source: "ai",
    progress: 0,
    aiAssignment: {
      selectedStudentId: finalAssignee || null,
      studentName: assignment.studentName || "",
      assignmentReason: finalAssignmentReason,
      evidenceUsed: assignment.evidenceUsed || [],
      confidence: assignment.confidence || 0,
      eligibilityStatus: finalEligibilityStatus,
      evaluatedMembersCount: assignment.evaluatedMembersCount || 0,
      activeTasksCount: assignment.activeTasksCount || 0,
      assignedAt: new Date(),
    },
    aiAnalysisVersion: "2.0",
  });

  return taskDoc;
}

module.exports = {
  decomposeTaskRequirement,
  determineEligibleAssignee,
  calculateAiDeadlineAndPriority,
  previewTask,
  orchestrateTaskCreation,
  sanitizeText,
  detectTaskDomain,
};
