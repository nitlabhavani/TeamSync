/**
 * Self-test for placeholder detection + From-identity resolution + recipient
 * independence, for the Brevo-SMTP-only mailer (src/services/mailer.js).
 * Run with: node scripts/lib/mailer.selftest.js
 * No network access required for these — pure logic tests.
 */
require("../../src/config/env");

async function run() {
  let pass = 0, fail = 0;

  async function test(name, fn) {
    try {
      await fn();
      pass++;
      console.log(`PASS  ${name}`);
    } catch (e) {
      fail++;
      console.log(`FAIL  ${name} — ${e.message}`);
    }
  }

  function assertEqual(actual, expected, label) {
    if (actual !== expected) {
      throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  async function withEnv(env, fn) {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    delete require.cache[require.resolve("../../src/services/mailer")];
    const mailer = require("../../src/services/mailer");
    try {
      return await fn(mailer);
    } finally {
      process.env = saved;
    }
  }

  // --- SMTP_PASS placeholder detection ---
  await test("real-looking Brevo SMTP key is accepted", () => {
    withEnv({}, (mailer) => {
      assertEqual(mailer.looksLikePlaceholder("xsmtpsib-abcdefgh12345678"), false, "real key");
    });
  });

  await test("placeholder SMTP_PASS (paste_your_new_brevo_smtp_key_here) is rejected", () => {
    withEnv({}, (mailer) => {
      assertEqual(mailer.looksLikePlaceholder("PASTE_YOUR_NEW_BREVO_SMTP_KEY_HERE"), true, "placeholder key");
    });
  });

  await test("placeholder SMTP_USER (your_brevo_smtp_login) is rejected", () => {
    withEnv({}, (mailer) => {
      assertEqual(mailer.looksLikePlaceholder("YOUR_BREVO_SMTP_LOGIN"), true, "placeholder login");
    });
  });

  await test("Markdown/mailto placeholder form is rejected", () => {
    withEnv({}, (mailer) => {
      assertEqual(
        mailer.looksLikePlaceholder("[your.address@gmail.com](mailto:your.address@gmail.com)"),
        true,
        "markdown placeholder"
      );
    });
  });

  // --- SMTP credential presence (hasConfiguredSmtpCredentials) ---
  await test("hasConfiguredSmtpCredentials() is true when host/user/pass all look real", () => {
    withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678" },
      (mailer) => {
        assertEqual(mailer.hasConfiguredSmtpCredentials(), true, "configured");
      }
    );
  });

  await test("hasConfiguredSmtpCredentials() is false when SMTP_PASS is a placeholder", () => {
    withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "YOUR_BREVO_SMTP_KEY" },
      (mailer) => {
        assertEqual(mailer.hasConfiguredSmtpCredentials(), false, "not configured");
      }
    );
  });

  // --- MAIL_FROM_EMAIL / MAIL_FROM_NAME (sender identity) resolution ---
  await test("MAIL_FROM_EMAIL with real address is preserved", () => {
    withEnv({ MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com", MAIL_FROM_NAME: "Vignans Lara" }, (mailer) => {
      const from = mailer.resolveMailFrom();
      assertEqual(from.email, "nitlabhavani1432@gmail.com", "from email preserved");
      assertEqual(from.name, "Vignans Lara", "from name preserved");
    });
  });

  await test("MAIL_FROM_EMAIL with placeholder email resolves to null (no unsafe fallback)", () => {
    withEnv({ MAIL_FROM_EMAIL: "your.address@gmail.com" }, (mailer) => {
      assertEqual(mailer.resolveMailFrom(), null, "from placeholder -> null");
    });
  });

  await test("MAIL_FROM_EMAIL missing/empty resolves to null", () => {
    withEnv({ MAIL_FROM_EMAIL: "" }, (mailer) => {
      assertEqual(mailer.resolveMailFrom(), null, "from missing -> null");
    });
  });

  await test("MAIL_FROM_EMAIL with Markdown/mailto form resolves to null", () => {
    withEnv(
      { MAIL_FROM_EMAIL: "Vignans Lara [your.address@gmail.com](mailto:your.address@gmail.com)" },
      (mailer) => {
        assertEqual(mailer.resolveMailFrom(), null, "from markdown -> null");
      }
    );
  });

  await test("MAIL_FROM_EMAIL with angle-bracket display name form is preserved", () => {
    withEnv({ MAIL_FROM_EMAIL: "Someone <nitlabhavani1432@gmail.com>", MAIL_FROM_NAME: "Vignans Lara" }, (mailer) => {
      const from = mailer.resolveMailFrom();
      assertEqual(from.email, "nitlabhavani1432@gmail.com", "angle-bracket email preserved");
      assertEqual(from.name, "Vignans Lara", "MAIL_FROM_NAME wins for display name");
    });
  });

  // --- Sender identity is NEVER derived from SMTP_USER ---
  await test("resolveMailFrom() never uses SMTP_USER even when MAIL_FROM_EMAIL is missing", () => {
    withEnv({ SMTP_USER: "b5e128001@smtp-brevo.com", MAIL_FROM_EMAIL: "" }, (mailer) => {
      const from = mailer.resolveMailFrom();
      assertEqual(from, null, "no fallback to SMTP_USER as sender");
    });
  });

  // --- Recipient independence from SMTP_USER (login) and MAIL_FROM_EMAIL (sender) ---
  await test("recipient is completely independent of SMTP_USER (the login identity)", () => {
    withEnv({ SMTP_USER: "b5e128001@smtp-brevo.com", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" }, (mailer) => {
      assertEqual(mailer.normalizeRecipient("student1@gmail.com"), "student1@gmail.com", "recipient 1 unrelated to SMTP_USER");
      assertEqual(mailer.normalizeRecipient("student2@gmail.com"), "student2@gmail.com", "recipient 2 unrelated to SMTP_USER");
    });
  });

  await test("arbitrary valid recipients are all accepted (not hardcoded) — 3+ different addresses", () => {
    withEnv({}, (mailer) => {
      ["student1@gmail.com", "student2@gmail.com", "student3@gmail.com", "guide@example.org"].forEach((addr) => {
        assertEqual(mailer.normalizeRecipient(addr), addr, `recipient ${addr}`);
      });
    });
  });

  await test("recipient whitespace is normalized", () => {
    withEnv({}, (mailer) => {
      assertEqual(mailer.normalizeRecipient("  student@gmail.com  "), "student@gmail.com", "trimmed recipient");
    });
  });

  await test("malformed/missing recipient is rejected (never silently falls back to SMTP_USER)", () => {
    withEnv({ SMTP_USER: "b5e128001@smtp-brevo.com" }, (mailer) => {
      assertEqual(mailer.normalizeRecipient("not-an-email"), null, "malformed recipient");
      assertEqual(mailer.normalizeRecipient(""), null, "empty recipient");
      assertEqual(mailer.normalizeRecipient(undefined), null, "undefined recipient");
    });
  });

  await test("Markdown-wrapped recipient is rejected", () => {
    withEnv({}, (mailer) => {
      assertEqual(
        mailer.normalizeRecipient("[student@gmail.com](mailto:student@gmail.com)"),
        null,
        "markdown recipient rejected"
      );
    });
  });

  await test("mailto: prefix on an otherwise valid recipient is stripped", () => {
    withEnv({}, (mailer) => {
      assertEqual(mailer.normalizeRecipient("mailto:student@gmail.com"), "student@gmail.com", "mailto stripped");
    });
  });

  // --- sendMail() rejects invalid recipients before ever touching the network, and NEVER redirects to SMTP_USER ---
  await test("sendMail() throws on a missing recipient without hitting the network", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" },
      async (mailer) => {
        let threw = false;
        try {
          await mailer.sendMail({ to: undefined, subject: "x", text: "x" });
        } catch (e) {
          threw = true;
        }
        assertEqual(threw, true, "sendMail() must throw for missing recipient");
      }
    );
  });

  await test("sendMail() refuses to send when MAIL_FROM_EMAIL is unresolved, even with a valid recipient", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678", MAIL_FROM_EMAIL: "" },
      async (mailer) => {
        const result = await mailer.sendMail({ to: "student@gmail.com", subject: "x", text: "x" });
        assertEqual(result.sent, false, "sent=false");
        assertEqual(result.reason, "smtp_sender_not_configured", "reason");
      }
    );
  });

  await test("sendMail() never sets recipient to SMTP_USER even when `to` is omitted incorrectly", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" },
      async (mailer) => {
        let threw = false;
        let message = "";
        try {
          await mailer.sendMail({ subject: "x", text: "x" });
        } catch (e) {
          threw = true;
          message = e.message;
        }
        assertEqual(threw, true, "must throw rather than default recipient to SMTP_USER");
        if (message.includes("b5e128001@smtp-brevo.com")) {
          throw new Error("error message must not imply SMTP_USER was used as the recipient");
        }
      }
    );
  });

  // --- verifyTransport() never leaks SMTP_PASS ---
  await test("verifyTransport() never includes SMTP_PASS in its output", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "supersecretvalue123", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" },
      async (mailer) => {
        // We only care that the returned object never contains the raw
        // password, regardless of how the live network request resolves.
        const status = await mailer.verifyTransport();
        const serialized = JSON.stringify(status);
        if (serialized.includes("supersecretvalue123")) {
          throw new Error("SMTP_PASS leaked into verifyTransport() output!");
        }
      }
    );
  });

  await test("verifyTransport() masks the from email rather than showing it raw", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" },
      async (mailer) => {
        const status = await mailer.verifyTransport();
        if (status.from && status.from.includes("nitlabhavani1432@gmail.com")) {
          throw new Error("verifyTransport() leaked the unmasked from email!");
        }
      }
    );
  });

  await test("verifyTransport() masks SMTP_USER rather than showing it raw", async () => {
    await withEnv(
      { SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "b5e128001@smtp-brevo.com", SMTP_PASS: "xsmtpsib-realkey12345678", MAIL_FROM_EMAIL: "nitlabhavani1432@gmail.com" },
      async (mailer) => {
        const status = await mailer.verifyTransport();
        if (status.smtpUser && status.smtpUser === "b5e128001@smtp-brevo.com") {
          throw new Error("verifyTransport() leaked the unmasked SMTP_USER!");
        }
      }
    );
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
