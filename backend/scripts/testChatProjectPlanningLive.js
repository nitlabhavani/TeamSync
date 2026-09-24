const path = require("path");
const backendRoot = path.resolve(__dirname, "..");
require(path.join(backendRoot, "node_modules", "dotenv")).config({ path: path.join(backendRoot, ".env") });
const mongoose = require(path.join(backendRoot, "node_modules", "mongoose"));
const assert = require("assert");

const User = require(path.join(backendRoot, "src/models/User"));
const Group = require(path.join(backendRoot, "src/models/Group"));
const Task = require(path.join(backendRoot, "src/models/Task"));
const Message = require(path.join(backendRoot, "src/models/Message"));
const { processGroupMessageForTasks } = require(path.join(backendRoot, "src/services/chatTaskService"));

async function run() {
  console.log("==> Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/teamsync_ai");

  const group = await Group.findById("6aa40acce196bdbf62eefe70").populate("members", "name email role");
  if (!group) {
    console.error("Group 6aa40acce196bdbf62eefe70 not found");
    process.exit(1);
  }

  const leader = await User.findById("6aa39e39b921444b97ddf08a");
  if (!leader) {
    console.error("Leader 6aa39e39b921444b97ddf08a not found");
    process.exit(1);
  }

  console.log(`Processing project specification message for "${group.name}"...`);

  const userMessageText = `**Title:** Smart Health System\n\n**Description:**\nSmart Health System is an intelligent healthcare platform designed to help users monitor their health, manage medical records, track vital signs, and receive personalized health recommendations. It aims to improve healthcare accessibility through smart technology, early health-risk detection, appointment management, and communication between patients and healthcare professionals.`;

  // Create or load the message
  let msg = await Message.findOne({
    group: group._id,
    text: userMessageText,
  }).sort("-createdAt");

  if (!msg) {
    msg = await Message.create({
      group: group._id,
      sender: leader._id,
      text: userMessageText,
    });
  }

  // Remove any previously created tasks with this sourceMessageId so we can process cleanly
  await Task.deleteMany({ sourceMessageId: msg._id });

  // Process message for tasks
  await processGroupMessageForTasks({
    message: msg,
    group,
    sender: leader,
    isGuide: false,
  });

  // Verify created tasks
  const createdTasks = await Task.find({ group: group._id, sourceMessageId: msg._id }).populate("assignee", "name email");
  console.log(`\nSuccessfully created ${createdTasks.length} tasks for "${group.name}":`);

  assert.ok(createdTasks.length >= 4, `Expected at least 4 tasks, got ${createdTasks.length}`);

  for (const t of createdTasks) {
    console.log(` • [${t.module || "Task"}] ${t.title}`);
    console.log(`   Assignee: ${t.assignee?.name} (${t.assignee?.email})`);
    console.log(`   Due Date: ${t.due ? new Date(t.due).toDateString() : "NONE"}`);
    console.log(`   Output: ${t.expectedOutput || t.deliverableType}`);
    console.log(`   Priority: ${t.priority} | Estimate: ${t.estimate} hrs\n`);

    assert.ok(t.assignee, "Task must have an assignee");
    assert.ok(t.due, "Task must have a due date");
    assert.ok(t.whatToDo, "Task must have whatToDo");
  }

  // Verify AI response message in chat
  const aiMessage = await Message.findOne({
    group: group._id,
    text: { $regex: /TeamSync AI — Project Tasks/i },
  }).sort("-createdAt");

  assert.ok(aiMessage, "Expected an AI response message to be posted in the chat");
  console.log("==> AI Response Message in Group Chat:");
  console.log(aiMessage.text);

  await mongoose.disconnect();
  console.log("\n[SUCCESS] Chat project planning verified successfully!");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
