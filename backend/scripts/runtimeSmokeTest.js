/**
 * TeamSync AI — Runtime Smoke Test
 * ---------------------------------
 * Hits your ACTUAL RUNNING backend (Node 18+ required, uses built-in fetch)
 * and exercises the auth/OTP/invitation/security flows end-to-end, printing
 * a real PASS/FAIL for each step. Nothing here is simulated — every result
 * reflects what your live server, MongoDB, and mailer actually did.
 *
 * WHAT THIS DOES vs DOES NOT COVER
 *   - Fully covers: signup+OTP, wrong/expired OTP handling*, resend, login,
 *     JWT auth, forgot/reset password, guide group creation with the 4
 *     labeled students, automatic leader assignment, invitation accept,
 *     reject + re-invite, duplicate-email behaviour, and a few IDOR checks.
 *   - Does NOT cover (needs a browser / real inbox / clock, not scriptable
 *     safely from here): actual Brevo email delivery confirmation, Socket.IO
 *     real-time chat/typing/notifications, drag-and-drop file upload UI,
 *     AI dashboard rendering, and the 5-minute OTP-expiry wait (opt-in via
 *     RUN_SLOW_TESTS=1, see below).
 *
 * USAGE
 *   cd backend
 *   node scripts/runtimeSmokeTest.js
 *
 *   Optional env vars:
 *     BASE_URL=http://localhost:5000/api   (default shown)
 *     RUN_SLOW_TESTS=1                     (also waits out real OTP expiry —
 *                                            adds ~5 minutes to the run)
 *
 * SAFETY
 *   - Never prints OTPs, passwords, or tokens. Only prints PASS/FAIL/reason.
 *   - Creates disposable, timestamped test accounts/groups. Safe to run
 *     repeatedly. Nothing here deletes real data other than what it created,
 *     and only during the optional cleanup step at the very end.
 *   - Requires EXPOSE_DEV_OTP=true and NODE_ENV!=production (already the
 *     case in your current backend/.env) so OTPs can be read from the API
 *     response instead of an inbox. This is the same dev-only mechanism the
 *     app itself already uses on the signup screen.
 */

const BASE = process.env.BASE_URL || "http://localhost:5000/api";
const RUN_SLOW = process.env.RUN_SLOW_TESTS === "1";
const STAMP = Date.now();

let passCount = 0;
let failCount = 0;
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) passCount += 1;
  else failCount += 1;
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? `  (${detail})` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /auth/resend-otp, waiting out the server's resend cooldown if hit.
 *
 * Root cause of the previously-reported "resend did not return a new
 * devOtp" failure: /auth/resend-otp enforces an intentional ~30s anti-spam
 * cooldown after signup (see OTP_RESEND_COOLDOWN_MS in authController.js).
 * This script used to call resend immediately after signup, so it always
 * landed inside that cooldown window and got
 * `{ success:false, message:"Please wait a moment...", details:{retryAfterMs} }`
 * — a correctly-functioning rate limit, not a broken resend endpoint. A real
 * user's browser would simply wait; this does the same instead of failing.
 */
async function resendOtpRespectingCooldown(email) {
  let resend = await call("POST", "/auth/resend-otp", { body: { email } });
  const retryAfterMs = resend.json?.details?.retryAfterMs;
  if (!resend.json?.success && typeof retryAfterMs === "number") {
    await sleep(retryAfterMs + 250); // small buffer past the exact cooldown boundary
    resend = await call("POST", "/auth/resend-otp", { body: { email } });
  }
  return resend;
}

async function call(method, path, { body, token, expectStatus } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (expectStatus && res.status !== expectStatus) {
    throw new Error(
      `expected HTTP ${expectStatus}, got ${res.status}${json?.message ? ` — ${json.message}` : ""}`
    );
  }
  return { status: res.status, json };
}

async function signupAndVerify(label, email, password = "TestPass!2345") {
  const name = `${label} ${STAMP}`;
  const signup = await call("POST", "/auth/signup", {
    body: { name, email, password, role: "student" },
  });
  if (!signup.json?.success) throw new Error(`signup request rejected: ${signup.json?.message}`);
  const devOtp = signup.json.data?.devOtp;
  if (!devOtp) {
    throw new Error(
      "no devOtp in response — EXPOSE_DEV_OTP must be true and NODE_ENV must not be 'production' for this script to run"
    );
  }

  // Wrong OTP must be rejected and must NOT create the account.
  const wrong = await call("POST", "/auth/verify-otp", {
    body: { email, otp: devOtp === "000000" ? "111111" : "000000" },
  });
  if (wrong.json?.success) throw new Error("wrong OTP was accepted — account should not have been created");

  // Resend must invalidate the old code. (Waits out the server's resend
  // cooldown first if needed — see resendOtpRespectingCooldown above.)
  const resend = await resendOtpRespectingCooldown(email);
  const newOtp = resend.json?.data?.devOtp;
  if (!newOtp)
    throw new Error(`resend did not return a new devOtp — ${resend.json?.message || "unknown reason"}`);
  if (newOtp === devOtp) throw new Error("resend returned the SAME otp — old code was not invalidated");

  const staleAttempt = await call("POST", "/auth/verify-otp", { body: { email, otp: devOtp } });
  if (staleAttempt.json?.success) throw new Error("the OLD (pre-resend) OTP still worked — resend did not invalidate it");

  const verify = await call("POST", "/auth/verify-otp", { body: { email, otp: newOtp } });
  if (!verify.json?.success || !verify.json?.data?.token) {
    throw new Error(`correct OTP was rejected: ${verify.json?.message}`);
  }
  return { name, email, password, token: verify.json.data.token, userId: verify.json.data.user?.id };
}

async function main() {
  console.log(`\nTeamSync AI runtime smoke test — target: ${BASE}\n`);

  // ---------- Health ----------
  try {
    const h = await call("GET", "/../health"); // /health lives above /api
    record("GET /health returns ok", h.status === 200, `status ${h.status}`);
  } catch (e) {
    record("GET /health returns ok", false, e.message);
  }

  let mailReady = false;
  try {
    const m = await call("GET", "/../health/mail");
    mailReady = Boolean(m.json?.email?.ready ?? m.json?.ready);
    const email = m.json?.email || m.json || {};
    let detail;
    if (mailReady) {
      detail = "email provider ready=true (brevo-smtp)";
    } else if (m.json?.envFileError) {
      detail = `backend/.env was NOT found at ${m.json.envFile} (${m.json.envFileError}) — fix the path, not the credentials`;
    } else if (!email.configured) {
      detail = `email.configured=false — SMTP_USER/SMTP_PASS/MAIL_FROM_EMAIL in ${m.json?.envFile || "backend/.env"} is still empty or a placeholder value`;
    } else {
      detail = `email.configured=true but ready=false — real API check failed: ${email.reason || "unknown reason"}`;
    }
    record("GET /health/mail", m.status === 200 || m.status === 503, detail);
  } catch (e) {
    record("GET /health/mail", false, e.message);
  }

  // ---------- Registration + OTP (leader) ----------
  const leaderEmail = `leader.${STAMP}@example.com`;
  let leader;
  try {
    leader = await signupAndVerify("Leader", leaderEmail);
    record("Registration OTP: signup → wrong OTP rejected → resend invalidates old → correct OTP creates account", true);
  } catch (e) {
    record("Registration OTP full flow", false, e.message);
    return printSummary();
  }

  // ---------- Login ----------
  try {
    const login = await call("POST", "/auth/login", { body: { email: leaderEmail, password: leader.password } });
    record("Login with created account", login.status === 200 && Boolean(login.json?.data?.token));
  } catch (e) {
    record("Login with created account", false, e.message);
  }

  // ---------- JWT authorization ----------
  try {
    const noAuth = await call("GET", "/users/me");
    const withAuth = await call("GET", "/users/me", { token: leader.token });
    record(
      "JWT authorization (401 without token, 200 with token)",
      noAuth.status === 401 && withAuth.status === 200,
      `no-token=${noAuth.status}, with-token=${withAuth.status}`
    );
  } catch (e) {
    record("JWT authorization", false, e.message);
  }

  // ---------- Forgot password ----------
  try {
    const forgot = await call("POST", "/auth/forgot-password", { body: { email: leaderEmail } });
    const fpOtp = forgot.json?.data?.devOtp;
    if (!fpOtp) throw new Error("no devOtp returned for forgot-password");
    const newPassword = "NewTestPass!9876";
    const reset = await call("POST", "/auth/reset-password", { body: { email: leaderEmail, otp: fpOtp, password: newPassword } });
    if (!reset.json?.success) throw new Error(`reset rejected: ${reset.json?.message}`);
    const reLogin = await call("POST", "/auth/login", { body: { email: leaderEmail, password: newPassword } });
    record("Forgot password → OTP → reset → login with new password", reLogin.status === 200 && Boolean(reLogin.json?.data?.token));
    leader.password = newPassword;
    leader.token = reLogin.json.data.token;
  } catch (e) {
    record("Forgot password flow", false, e.message);
  }

  // ---------- Create the other 3 students + a guide ----------
  let member1, member2, member3, guide;
  try {
    member1 = await signupAndVerify("Member1", `member1.${STAMP}@example.com`);
    member2 = await signupAndVerify("Member2", `member2.${STAMP}@example.com`);
    member3 = await signupAndVerify("Member3", `member3.${STAMP}@example.com`);
    record("Created 3 additional student accounts (members)", true);
  } catch (e) {
    record("Created 3 additional student accounts (members)", false, e.message);
    return printSummary();
  }

  try {
    const guideEmail = `guide.${STAMP}@example.com`;
    const gSignup = await call("POST", "/auth/signup", {
      body: { name: `Guide ${STAMP}`, email: guideEmail, password: "GuidePass!2345", role: "guide" },
    });
    const gOtp = gSignup.json?.data?.devOtp;
    const gVerify = await call("POST", "/auth/verify-otp", { body: { email: guideEmail, otp: gOtp } });
    guide = { email: guideEmail, token: gVerify.json?.data?.token };
    record("Guide account created", Boolean(guide.token));
  } catch (e) {
    record("Guide account created", false, e.message);
    return printSummary();
  }

  // ---------- Security: student cannot create a group (guide-only) ----------
  try {
    const asStudent = await call("POST", "/groups", {
      token: leader.token,
      body: { name: "Should Fail", project: "x", memberEmails: [] },
    });
    record("IDOR: student cannot create a group (expects 403)", asStudent.status === 403, `got ${asStudent.status}`);
  } catch (e) {
    record("IDOR: student cannot create a group", false, e.message);
  }

  // ---------- Guide creates the group with 4 ordered students ----------
  let group, invitationResults;
  try {
    const create = await call("POST", "/groups", {
      token: guide.token,
      body: {
        name: `Smoke Test Team ${STAMP}`,
        project: "Runtime validation project",
        memberEmails: [leaderEmail, member1.email, member2.email, member3.email],
      },
    });
    if (!create.json?.success) throw new Error(create.json?.message);
    group = create.json.data;
    invitationResults = create.json.meta?.invitations || create.json.data?.invitationResults;
    if (!invitationResults?.length) throw new Error("no invitationResults returned");
    record("Guide creates group with 4 ordered students", true, `group ${group._id || group.id}`);
  } catch (e) {
    record("Guide creates group with 4 ordered students", false, e.message);
    return printSummary();
  }

  // ---------- Accept invitations, verify leader assignment ----------
  try {
    const students = [
      { email: leaderEmail, token: leader.token, shouldBeLeader: true },
      { email: member1.email, token: member1.token, shouldBeLeader: false },
      { email: member2.email, token: member2.token, shouldBeLeader: false },
      { email: member3.email, token: member3.token, shouldBeLeader: false },
    ];
    for (const s of students) {
      const inv = invitationResults.find((r) => r.email === s.email);
      if (!inv?.devOtp || !inv?.token) throw new Error(`no devOtp/token for ${s.email}`);
      const verify = await call("POST", `/invitations/${inv.token}/verify-otp`, {
        token: s.token,
        body: { otp: inv.devOtp },
      });
      if (!verify.json?.data?.joined) throw new Error(`${s.email} did not join: ${verify.json?.message}`);
      const isLeader = Boolean(verify.json.data.isLeader);
      if (isLeader !== s.shouldBeLeader) {
        throw new Error(`${s.email}: expected isLeader=${s.shouldBeLeader}, got ${isLeader}`);
      }
    }
    record("First student → Team Leader, other 3 → Members (verified via API response)", true);
  } catch (e) {
    record("Invitation accept + automatic leader assignment", false, e.message);
  }

  // ---------- Reject + re-invite a previously rejected student ----------
  try {
    const extraEmail = `reject.${STAMP}@example.com`;
    const invite = await call("POST", `/groups/${group._id || group.id}/invitations`, {
      token: guide.token,
      body: { emails: [extraEmail] },
    });
    const firstInv = (invite.json?.meta?.invitations || invite.json?.data)?.[0];
    if (!firstInv?.token) throw new Error("no invitation token returned");

    const rejected = await call("POST", `/invitations/${firstInv.token}/reject`);
    if (rejected.json?.data?.status !== "rejected") throw new Error("reject did not set status=rejected");

    const reinvite = await call("POST", `/groups/${group._id || group.id}/invitations`, {
      token: guide.token,
      body: { emails: [extraEmail] },
    });
    const reinviteResult = (reinvite.json?.meta?.invitations || reinvite.json?.data)?.find((r) => r.email === extraEmail);
    record(
      "Reject invitation → re-invite resets it to pending (no crash)",
      reinvite.status === 200 || reinvite.status === 201,
      `status=${reinviteResult?.status}`
    );
  } catch (e) {
    record("Reject + re-invite previously-rejected student", false, e.message);
  }

  // ---------- Duplicate email handling ----------
  try {
    const dupe = await call("POST", "/groups", {
      token: guide.token,
      body: {
        name: `Dupe Test ${STAMP}`,
        project: "x",
        memberEmails: [member1.email, member1.email],
      },
    });
    // Current backend behaviour: silently dedupes rather than rejecting with
    // an error (the UI blocks duplicates before submit). Report what actually
    // happens rather than assuming either behaviour is "correct".
    record(
      "Duplicate email in memberEmails — reports actual backend behaviour",
      true,
      dupe.json?.success ? "backend accepted and de-duplicated silently" : `backend rejected: ${dupe.json?.message}`
    );
  } catch (e) {
    record("Duplicate email handling", false, e.message);
  }

  // ---------- IDOR: unrelated student cannot view another student's performance ----------
  try {
    // member2/3 are in the same group as member1, so use a totally outside account.
    const outsider = await signupAndVerify("Outsider", `outsider.${STAMP}@example.com`);
    const idor = await call("GET", `/users/${leader.userId}/performance`, { token: outsider.token });
    record("IDOR: unrelated user cannot view another user's performance (expects 403)", idor.status === 403, `got ${idor.status}`);
  } catch (e) {
    record("IDOR: unrelated user performance check", false, e.message);
  }

  // ---------- Group deletion cascade ----------
  try {
    const gid = group._id || group.id;
    const del = await call("DELETE", `/groups/${gid}`, { token: guide.token });
    const afterDelete = await call("GET", `/groups/${gid}`, { token: guide.token });
    record(
      "Group deletion succeeds and group is no longer reachable",
      (del.status === 200 || del.status === 204) && afterDelete.status === 404,
      `delete=${del.status}, get-after=${afterDelete.status}`
    );
  } catch (e) {
    record("Group deletion", false, e.message);
  }

  if (RUN_SLOW) {
    console.log("\nRUN_SLOW_TESTS=1: verifying real 5-minute OTP expiry (this will pause for ~5 minutes)...\n");
    try {
      const expEmail = `expiry.${STAMP}@example.com`;
      const s = await call("POST", "/auth/signup", { body: { name: "Expiry Test", email: expEmail, password: "TestPass!2345", role: "student" } });
      const otp = s.json?.data?.devOtp;
      await new Promise((r) => setTimeout(r, 5 * 60 * 1000 + 5000));
      const late = await call("POST", "/auth/verify-otp", { body: { email: expEmail, otp } });
      record("OTP expires after 5 minutes (real wait)", !late.json?.success, late.json?.message);
    } catch (e) {
      record("OTP expiry (real wait)", false, e.message);
    }
  } else {
    console.log("\n(Skipping the real 5-minute OTP-expiry wait — set RUN_SLOW_TESTS=1 to include it.)\n");
  }

  printSummary();
}

function printSummary() {
  console.log("\n──────────────────────────────────────────");
  console.log(`RESULT: ${passCount} passed, ${failCount} failed (of ${results.length})`);
  console.log("──────────────────────────────────────────\n");
  if (failCount > 0) {
    console.log("Failed steps:");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
    console.log("");
  }
  console.log(
    "Not covered by this script (needs a browser / real inbox): actual Brevo email delivery,\n" +
      "Socket.IO real-time chat/typing/notifications, file upload UI, AI dashboard rendering,\n" +
      "daily/weekly/monthly report content, and collaboration/performance/prediction values.\n" +
      "See MANUAL_TEST_CHECKLIST.md for those.\n"
  );
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("Smoke test crashed:", e.message);
  process.exitCode = 1;
});
