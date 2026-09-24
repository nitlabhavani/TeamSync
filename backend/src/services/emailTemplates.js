/**
 * Additional TeamSync email templates: OTP invitations, deadline reminders,
 * overdue warnings and guide alerts. All of them reuse the sendMail()
 * function in ./mailer.js, which sends via the Brevo SMTP relay
 * (smtp-relay.brevo.com) using Nodemailer.
 */
const { sendMail } = require("./mailer");

const APP_NAME = process.env.APP_NAME || "TeamSync AI";
const appUrl = () => (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "http://localhost:8080").split(",")[0];

const shell = (title, body) => `
<div style="background:#f5f6fa;padding:32px 0;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e6e8f0;">
    <p style="margin:0 0 24px;font-size:15px;font-weight:700;color:#5B5FEF;letter-spacing:.4px;">${APP_NAME}</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#1d2233;">${title}</h1>
    ${body}
    <p style="margin:28px 0 0;font-size:12px;color:#8b90a5;">
      Sent by ${APP_NAME}. If you weren't expecting this email you can safely ignore it.
    </p>
  </div>
</div>`;

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:#5B5FEF;color:#ffffff;text-decoration:none;
     font-size:14px;font-weight:600;padding:12px 22px;border-radius:9px;">${label}</a>`;

const otpBlock = (otp) =>
  `<p style="margin:0 0 20px;font-size:34px;letter-spacing:10px;font-weight:700;color:#1d2233;
      background:#eef0ff;border-radius:10px;padding:16px;text-align:center;">${otp}</p>`;

/** Group invitation carrying the join link + OTP. */
async function sendInvitationOtpEmail({ to, name, groupName, project, guideName, otp, token, ttlMinutes = 5, isLeader }) {
  const link = `${appUrl()}/invite/${token}`;
  const html = shell(
    `You're invited to join ${groupName}`,
    `<p style="margin:0 0 8px;font-size:14px;color:#4b5066;">Hi ${name || "there"},</p>
     <p style="margin:0 0 16px;font-size:14px;color:#4b5066;">
       <strong>${guideName || "Your guide"}</strong> invited you to the project team
       <strong>${groupName}</strong>${project ? ` — ${project}` : ""}${isLeader ? " as the <strong>Team Leader</strong>" : ""}.
     </p>
     <table style="width:100%;font-size:13px;color:#4b5066;border-collapse:collapse;margin:0 0 20px;">
       <tr><td style="padding:6px 0;color:#8b90a5;">Group</td><td style="padding:6px 0;font-weight:600;">${groupName}</td></tr>
       <tr><td style="padding:6px 0;color:#8b90a5;">Guide</td><td style="padding:6px 0;font-weight:600;">${guideName || "-"}</td></tr>
       ${project ? `<tr><td style="padding:6px 0;color:#8b90a5;">Project</td><td style="padding:6px 0;font-weight:600;">${project}</td></tr>` : ""}
     </table>
     <p style="margin:0 0 10px;font-size:14px;color:#4b5066;">Your one-time password (valid for ${ttlMinutes} minutes):</p>
     ${otpBlock(otp)}
     ${button(link, "Open invitation")}
     <p style="margin:18px 0 0;font-size:12px;color:#8b90a5;word-break:break-all;">Or paste this link: ${link}</p>`
  );
  return sendMail({
    to,
    subject: `${otp} — your invitation code for ${groupName} on ${APP_NAME}`,
    html,
    text: `You've been invited to ${groupName} by ${guideName}. OTP: ${otp} (valid ${ttlMinutes} minutes). Link: ${link}`,
  });
}

/** "X days remaining" reminder for an assigned task. */
async function sendDeadlineReminderEmail({ to, name, taskTitle, groupName, daysLeft, due }) {
  const when =
    daysLeft > 1 ? `${daysLeft} days remaining` : daysLeft === 1 ? "1 day remaining" : "Deadline is today";
  const html = shell(
    when,
    `<p style="margin:0 0 12px;font-size:14px;color:#4b5066;">Hi ${name || "there"},</p>
     <p style="margin:0 0 16px;font-size:14px;color:#4b5066;">
       Please complete your assigned task <strong>${taskTitle}</strong> in <strong>${groupName}</strong>.
     </p>
     <p style="margin:0 0 20px;font-size:14px;color:#4b5066;">Deadline: <strong>${new Date(due).toDateString()}</strong></p>
     ${button(`${appUrl()}/app/tasks`, "Open my tasks")}`
  );
  return sendMail({ to, subject: `${when} — ${taskTitle}`, html, text: `${when}. Please complete "${taskTitle}".` });
}

/** Overdue warning to the student. */
async function sendOverdueWarningEmail({ to, name, taskTitle, groupName, due }) {
  const html = shell(
    "Warning — your assigned task is overdue",
    `<p style="margin:0 0 12px;font-size:14px;color:#4b5066;">Hi ${name || "there"},</p>
     <p style="margin:0 0 16px;font-size:14px;color:#4b5066;">
       The deadline for <strong>${taskTitle}</strong> in <strong>${groupName}</strong> passed on
       <strong>${new Date(due).toDateString()}</strong>. Please submit your work as soon as possible.
     </p>
     ${button(`${appUrl()}/app/tasks`, "Submit now")}`
  );
  return sendMail({ to, subject: `Overdue: ${taskTitle}`, html, text: `Your assigned task "${taskTitle}" is overdue.` });
}

/** Escalation to the guide. */
async function sendGuideAlertEmail({ to, guideName, subject, lines = [] }) {
  const html = shell(
    subject,
    `<p style="margin:0 0 12px;font-size:14px;color:#4b5066;">Hi ${guideName || "there"},</p>
     <ul style="margin:0 0 20px;padding-left:18px;font-size:14px;color:#4b5066;">
       ${lines.map((l) => `<li style="margin:0 0 6px;">${l}</li>`).join("")}
     </ul>
     ${button(`${appUrl()}/guide/alerts`, "Open AI alerts")}`
  );
  return sendMail({ to, subject: `[${APP_NAME}] ${subject}`, html, text: lines.join("\n") });
}

module.exports = {
  sendInvitationOtpEmail,
  sendDeadlineReminderEmail,
  sendOverdueWarningEmail,
  sendGuideAlertEmail,
};
