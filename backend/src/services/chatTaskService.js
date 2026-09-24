/**
 * Group Chat -> AI Task Detection -> Task Creation.
 *
 * Handles both:
 * 1. Project Title & Description planning messages:
 *    When a Guide or Team Leader sends project specifications in chat
 *    (e.g. "**Title:** ... **Description:** ..."), TeamSync AI analyzes the project,
 *    creates modular tasks with realistic deadlines, assigns them to team members,
 *    and responds in the chat with a structured confirmation.
 * 2. Individual task directives:
 *    "Name, please complete payment gateway integration by tomorrow"
 */
const Task = require("../models/Task");
const { ACTIVE_TASK_STATUSES } = require("../models/Task");
const User = require("../models/User");
const Group = require("../models/Group");
const Message = require("../models/Message");
const aiEngine = require("./aiEngineClient");
const aiService = require("./aiService");
const { notifyUsers } = require("./notificationService");
const { emitToGroup } = require("./socketService");
const { recalcGroupProgress } = require("../controllers/groupController");
const { resolveAssignee, buildTaskInput } = require("./chatTaskExtractionService");
const { autoPlanAndAssignTasks } = require("./autoProjectPlanningService");

/**
 * Extracts project title and description from a chat message.
 */
function extractProjectSpec(text) {
  const raw = String(text || "").trim();
  if (!raw) return { title: null, description: null };

  const titleRegex = /(?:^|\n)\s*(?:\*\*)?(?:Project\s+Title|Project\s+Name|Project|Title)(?:\*\*)?\s*:\s*(?:\*\*)?([^\n*]+)(?:\*\*)?/i;
  const descRegex = /(?:^|\n)\s*(?:\*\*)?(?:Project\s+Description|Task\s+Description|Description|Overview|Scope|About)(?:\*\*)?\s*:\s*(?:\*\*)?([\s\S]+)/i;

  const titleMatch = raw.match(titleRegex);
  const descMatch = raw.match(descRegex);

  let title = titleMatch ? titleMatch[1].replace(/^\*+|\*+$/g, "").trim() : null;
  let description = descMatch ? descMatch[1].replace(/^\*+|\*+$/g, "").trim() : null;

  if (!title && !description) {
    const lower = raw.toLowerCase();
    const isProjectPitch =
      raw.length >= 80 &&
      (lower.includes("system") ||
        lower.includes("platform") ||
        lower.includes("application") ||
        lower.includes("app") ||
        lower.includes("website") ||
        lower.includes("project") ||
        lower.includes("software") ||
        lower.includes("tool")) &&
      !lower.startsWith("please") &&
      !lower.includes("by tomorrow") &&
      !lower.includes("by next week");

    if (isProjectPitch) {
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2 && lines[0].length < 60) {
        title = lines[0].replace(/^#+\s*|\*+/g, "").trim();
        description = lines.slice(1).join("\n").trim();
      } else {
        description = raw;
      }
    }
  }

  return { title, description };
}

/**
 * Entry point called (fire-and-forget) from chatController.sendGroupMessage.
 *
 * @param {{message: object, group: object, sender: object, isGuide: boolean}} args
 */
async function processGroupMessageForTasks({ message, group, sender, isGuide }) {
  const text = String(message.text || "").trim();
  if (!text) return;

  // Authorization: ONLY Guide or Team Leader can trigger task creation
  const senderId = String(sender._id);
  const leaderId = String(group.leader?._id || group.leader || "");
  const senderIsLeader = Boolean(
    (leaderId && leaderId === senderId) ||
      (group.leaderEmail && sender.email && String(sender.email).toLowerCase() === String(group.leaderEmail).toLowerCase())
  );
  const senderIsMember = (group.members || []).some((m) => String(m?._id || m) === senderId);
  const authorized = Boolean(isGuide || senderIsLeader);

  console.log(
    `[chat-task] authorization check:\n` +
      `[chat-task] senderId: ${sender._id}\n` +
      `[chat-task] isGuide: ${Boolean(isGuide)}\n` +
      `[chat-task] isLeader: ${senderIsLeader}\n` +
      `[chat-task] isGroupMember: ${senderIsMember}\n` +
      `[chat-task] authorized: ${authorized}`
  );
  if (!authorized) return;

  // Self-heal group leader if missing but sender is verified leader
  if (senderIsLeader && !group.leader) {
    await Group.findByIdAndUpdate(group._id, { leader: sender._id }).catch(() => {});
    group.leader = sender._id;
  }

  // Duplicate protection check
  const alreadyProcessed = await Task.exists({ sourceMessageId: message._id });
  if (alreadyProcessed) return;

  const members = await User.find({ _id: { $in: group.members } })
    .select("name email")
    .lean();
  if (!members.length) return;

  const membersById = new Map(members.map((m) => [String(m._id), m]));

  // =========================================================================
  // PATH 1: Check if the message is a Project Specification (Title & Description)
  // =========================================================================
  const projSpec = extractProjectSpec(text);
  if (projSpec.title || (projSpec.description && projSpec.description.length >= 15)) {
    const finalTitle = projSpec.title || group.project || "Project";
    const finalDesc = projSpec.description || group.description || "";

    console.log(`[chat-task] Detected Project Specification in chat: "${finalTitle}"`);

    // Update group model with the latest project details
    await Group.findByIdAndUpdate(group._id, {
      project: finalTitle,
      description: finalDesc,
    }).catch(() => {});
    group.project = finalTitle;
    group.description = finalDesc;

    // Trigger automated modular task planning and assignment with deadlines
    const planResult = await autoPlanAndAssignTasks({
      group,
      reqUser: sender,
      projectTitle: finalTitle,
      projectDescription: finalDesc,
      deadline: group.expectedCompletion,
      force: true, // Explicitly requested in chat
    });

    if (planResult && planResult.tasks && planResult.tasks.length > 0) {
      // Associate created tasks with this message for audit & dedup
      const taskIds = planResult.tasks.map((t) => t._id);
      await Task.updateMany(
        { _id: { $in: taskIds }, sourceMessageId: null },
        { $set: { sourceMessageId: message._id } }
      ).catch(() => {});

      // Build structured, clear chat confirmation
      const taskLines = planResult.tasks
        .map((t, idx) => {
          const assignedUser = t.assignee?.name
            ? t.assignee
            : membersById.get(String(t.assignee?.id || t.assignee?._id || t.assignee));
          const dueStr = t.due
            ? new Date(t.due).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "Scheduled";
          const deliverable = t.expectedOutput || t.deliverableType || "Task deliverable";
          return `${idx + 1}. **${t.title}** (${t.module || "Module"})\n   ↳ Assigned to: **${assignedUser ? assignedUser.name : "Team Member"}**\n   ↳ 📅 Deadline: **${dueStr}**\n   ↳ 📦 Deliverable: *${deliverable}*`;
        })
        .join("\n\n");

      const confirmationText = `🤖 **TeamSync AI — Project Tasks Planned & Assigned**\n\nBased on project **${finalTitle}**, I have analyzed the requirements and assigned **${planResult.tasks.length} actionable tasks with deadlines** across the team:\n\n${taskLines}\n\n✅ All tasks have been saved in MongoDB and scheduled on your **Tasks board** and **Calendar**!`;

      try {
        const aiMsg = await Message.create({
          group: group._id,
          sender: sender._id,
          text: confirmationText,
        });
        const populatedAiMsg = await aiMsg.populate("sender", "name color avatar");
        emitToGroup(group._id, "group:message", populatedAiMsg);
        emitToGroup(group._id, "tasks:updated", { groupId: group._id });
      } catch (postErr) {
        console.warn(`[chat-task] Error posting AI chat response: ${postErr.message}`);
      }

      await recalcGroupProgress(group._id);
      return;
    } else {
      // Fallback: If no new tasks created, retrieve current tasks for this project
      const existingTasks = await Task.find({ group: group._id, source: { $in: ["ai", "ai_chat"] } })
        .populate("assignee", "name email color avatar")
        .sort({ order: 1, createdAt: 1 });

      if (existingTasks.length > 0) {
        const taskLines = existingTasks
          .map((t, idx) => {
            const userName = t.assignee?.name || membersById.get(String(t.assignee))?.name || "Team Member";
            const dueStr = t.due
              ? new Date(t.due).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "Scheduled";
            return `${idx + 1}. **${t.title}** (${t.module || "Module"})\n   ↳ Assigned to: **${userName}**\n   ↳ 📅 Deadline: **${dueStr}**`;
          })
          .join("\n\n");

        const fallbackText = `🤖 **TeamSync AI — Project Tasks for ${finalTitle}**\n\n${existingTasks.length} tasks are currently scheduled for this project:\n\n${taskLines}\n\n✅ All tasks are active on your **Tasks board** and **Calendar**!`;

        try {
          const aiMsg = await Message.create({
            group: group._id,
            sender: sender._id,
            text: fallbackText,
          });
          const populatedAiMsg = await aiMsg.populate("sender", "name color avatar");
          emitToGroup(group._id, "group:message", populatedAiMsg);
          emitToGroup(group._id, "tasks:updated", { groupId: group._id });
        } catch (postErr) {
          console.warn(`[chat-task] Error posting fallback AI response: ${postErr.message}`);
        }
        return;
      }
    }
  }

  // =========================================================================
  // PATH 2: Single directive task assignment ("Name, complete X by Y")
  // =========================================================================
  const memberPayload = members.map((m) => ({ id: String(m._id), name: m.name, email: m.email }));
  const enginePayload = {
    text,
    members: memberPayload,
    currentDate: new Date().toISOString(),
  };

  let result;
  const engineResponse = await aiEngine.analyzeMessageTask(enginePayload);
  if (engineResponse.ok) {
    result = engineResponse.data;
  } else {
    console.error(
      `[chat-task-ai] AI engine unavailable (${engineResponse.reason}) — using Node fallback for message ${message._id}`
    );
    result = aiService.detectMessageTasks(text, memberPayload, new Date());
  }

  console.log(`[chat-task] AI result: ${JSON.stringify(result)}`);

  if (!result || !result.isTask || !Array.isArray(result.tasks) || !result.tasks.length) {
    if (result?.unmatchedMentions?.length) {
      const unmatchedNames = result.unmatchedMentions.map((u) => u.name).join(", ");
      const groupStudentNames = members.map((m) => m.name).join(", ");
      console.warn(
        `[chat-task-ai] group ${group._id} message ${message._id}: not creating a task for "${unmatchedNames}" — not in group members`
      );
      try {
        const aiMsg = await Message.create({
          group: group._id,
          sender: sender._id,
          text: `🤖 **TeamSync AI Notice**: Could not assign task — **${unmatchedNames}** is not an enrolled member of this team. Current members: **${groupStudentNames || "None"}**.`,
        });
        const populatedAiMsg = await aiMsg.populate("sender", "name color avatar");
        emitToGroup(group._id, "group:message", populatedAiMsg);
      } catch (e) {}
    }
    return;
  }

  const createdDocs = [];
  let taskIndex = 0;
  for (const candidate of result.tasks) {
    let { member } = resolveAssignee(candidate, members);
    if (!member) {
      member = members[taskIndex % members.length];
      console.log(`[chat-task] auto-assigning unmentioned task to group member: ${member._id} (${member.name})`);
    }
    taskIndex++;

    if (!member || !membersById.has(String(member._id))) continue;

    const dup = await Task.exists({ sourceMessageId: message._id, title: candidate.title });
    if (dup) continue;

    // Strictly enforce one-active-task rule
    const memberActiveTasks = typeof Task.countDocuments === "function"
      ? await Task.countDocuments({
          group: group._id,
          assignee: member._id,
          status: { $in: ACTIVE_TASK_STATUSES },
        })
      : 0;

    let assignedMember = member;
    let taskStatus = "todo";
    let eligibilityStatus = "ASSIGNED";
    let assignmentReason = `Assigned to ${member.name} based on chat directive.`;

    if (memberActiveTasks > 0) {
      // Find an alternative member with 0 active tasks
      const allActive = await Task.find({
        group: group._id,
        assignee: { $in: members.map((m) => m._id) },
        status: { $in: ACTIVE_TASK_STATUSES },
      }).select("assignee").lean();
      const busySet = new Set((allActive || []).map((t) => String(t.assignee)));
      const freeMember = members.find((m) => !busySet.has(String(m._id)));

      if (freeMember) {
        assignedMember = freeMember;
        assignmentReason = `Re-routed to ${freeMember.name}: original candidate ${member.name} has an active task in progress.`;
      } else {
        assignedMember = null;
        taskStatus = "backlog";
        eligibilityStatus = "NO_ELIGIBLE_ASSIGNEE";
        assignmentReason = "All team members currently have active tasks in progress. Queued in backlog under strict one-active-task rule.";
      }
    }

    const input = buildTaskInput(candidate, {
      groupId: group._id,
      senderId: sender._id,
      memberId: assignedMember ? assignedMember._id : null,
      sourceMessageId: message._id,
    });
    input.status = taskStatus;
    input.assignee = assignedMember ? assignedMember._id : undefined;
    input.aiAssignment = {
      selectedStudentId: assignedMember ? assignedMember._id : null,
      studentName: assignedMember ? assignedMember.name : "",
      assignmentReason,
      eligibilityStatus,
      confidence: assignedMember ? 80 : 0,
      assignedAt: new Date(),
    };

    const doc = await Task.create(input);
    createdDocs.push(doc);
  }

  if (!createdDocs.length) return;

  await Promise.all(
    createdDocs.map((doc) =>
      notifyUsers(
        [doc.assignee],
        {
          title: "New task assigned",
          body: doc.title,
          type: "task",
          link: "/app/tasks",
          group: group._id,
          task: doc._id,
        },
        { exclude: sender._id }
      )
    )
  );

  try {
    const taskLines = createdDocs
      .map((doc) => {
        const assignedUser = membersById.get(String(doc.assignee));
        const dueStr = doc.due
          ? new Date(doc.due).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        return `• **${doc.title}** → **${assignedUser ? assignedUser.name : "Team Member"}**${dueStr ? ` | 📅 Due: **${dueStr}**` : ""}`;
      })
      .join("\n");

    const confirmationText = `🤖 **TeamSync AI — Task Assigned**\n\nI have assigned **${createdDocs.length} task(s)** to team members:\n\n${taskLines}`;

    const aiMsg = await Message.create({
      group: group._id,
      sender: sender._id,
      text: confirmationText,
    });
    const populatedAiMsg = await aiMsg.populate("sender", "name color avatar");
    emitToGroup(group._id, "group:message", populatedAiMsg);
    emitToGroup(group._id, "tasks:updated", { groupId: group._id });
  } catch (err) {
    console.warn(`[chat-task] could not post chat confirmation: ${err.message}`);
  }

  await recalcGroupProgress(group._id);
}

module.exports = {
  processGroupMessageForTasks,
  extractProjectSpec,
};
