import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAuthClient, validateEndpoint } from "../src/auth-client.mjs";

function server() {
  let now = 1800000000000,
    remaining = 100,
    sendFails = false,
    duplicateUuid = false,
    createdSheets = 0;
  const properties = {
    AUTH_SECRET: "a".repeat(64),
    AUTH_SHEET_ID: "test-sheet",
    PILOT_EMAILS: "player@kaist.ac.kr",
    AUTH_STORAGE_VERSION: "properties-v1",
  };
  const tables = {
      Challenges: [["record_json"]],
      Sessions: [["record_json"]],
      Accounts: [["record_json"]],
    },
    mail = [],
    logs = [];
  function sheet(name) {
    return {
      getLastRow: () => tables[name].length,
      appendRow: (row) => tables[name].push(row),
      deleteRow: (row) => tables[name].splice(row - 1, 1),
      getRange: (row, col, count = 1) => ({
        getValues: () => tables[name].slice(row - 1, row - 1 + count),
        setValue: (value) => {
          tables[name][row - 1] = [value];
        },
      }),
    };
  }
  let held = false;
  const context = vm.createContext({
    Logger: { log: (value) => logs.push(value) },
    Date: { now: () => now },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...properties }),
        getProperty: (key) => properties[key],
        setProperty: (key, value) => {
          properties[key] = value;
        },
        deleteProperty: (key) => {
          delete properties[key];
        },
      }),
    },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: sheet }),
      flush: () => {},
      create: () => {
        createdSheets++;
        tables.Challenges = [];
        tables.Sessions = [];
        return {
          getSheets: () => [{ setName: () => sheet("Challenges") }],
          insertSheet: sheet,
          getId: () => "test-sheet",
        };
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          assert.equal(held, false);
          held = true;
          return true;
        },
        releaseLock: () => {
          held = false;
        },
      }),
    },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, text) => [
        ...createHash("sha256").update(text).digest(),
      ],
      getUuid: () =>
        duplicateUuid ? "12345678-1234-4234-8234-123456789012" : randomUUID(),
      computeHmacSha256Signature: (text, key) => [
        ...createHmac("sha256", key).update(text).digest(),
      ],
    },
    MailApp: {
      getRemainingDailyQuota: () => remaining,
      sendEmail: (value) => {
        assert.equal(held, false, "network mail must run outside lock");
        if (sendFails) throw new Error("private provider message");
        mail.push(value);
        remaining--;
      },
    },
  });
  vm.runInContext(
    readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    context,
  );
  vm.runInContext(
    readFileSync(
      new URL("../apps-script/AuthProperties.gs", import.meta.url),
      "utf8",
    ),
    context,
  );
  vm.runInContext(
    readFileSync(
      new URL("../apps-script/OwnerSetup.gs", import.meta.url),
      "utf8",
    ),
    context,
  );
  function call(action, data = {}) {
    const params = { action, ...data };
    return context.doPost({
      postData: {
        type: "application/x-www-form-urlencoded;charset=UTF-8",
        length: 100,
      },
      parameter: params,
      parameters: Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, [value]]),
      ),
    });
  }
  const request = (purpose = "login") =>
    call("requestCode", { email: "player@kaist.ac.kr", purpose });
  function verification(challenge, overrides = {}) {
    return call("verifyCode", {
      email: "player@kaist.ac.kr",
      purpose: "login",
      challengeId: challenge.data.challengeId,
      code: mail.at(-1).body.match(/\d{6}/)[0],
      ...overrides,
    });
  }
  return {
    erase: (id, email) =>
      context.eraseAuthAccount_({ sheetId: "test-sheet" }, id, email),
    prune: () => context.prune_({ sheetId: "test-sheet" }, now),
    call,
    request,
    verification,
    mail,
    tables,
    records: (name) => context.read_({}, name).map((r) => r.value),
    properties,
    logs,
    inspect: () => context.inspectRuntimeStatus(),
    allowKaist: () => context.allowKaistEmailAuthentication(),
    advance: (ms) => {
      now += ms;
    },
    failMail: () => {
      sendFails = true;
    },
    noQuota: () => {
      remaining = 0;
    },
    initialize: () => context.initializeAuth_(),
    duplicateUuid: () => {
      duplicateUuid = true;
    },
    createdSheets: () => createdSheets,
  };
}

test("explicit KAIST mode accepts other school mailboxes while rejecting subdomains and lookalikes", () => {
  const s = server();
  s.allowKaist();
  assert.equal(s.call("health").data.emailScope, "kaist");
  assert.equal(s.call("health").data.pilot, false);
  delete s.properties.PILOT_EMAILS;
  assert.equal(
    s.call("requestCode", { email: " OTHER@KAIST.AC.KR ", purpose: "login" })
      .ok,
    true,
  );
  assert.equal(s.mail[0].to, "other@kaist.ac.kr");
  for (const email of [
    "p@kaist.ac.kr.evil.test",
    "p@comet.kaist.ac.kr",
    "p@gmail.com",
  ])
    assert.equal(
      s.call("requestCode", { email, purpose: "login" }).error.code,
      "INVALID_EMAIL",
    );
  assert.equal(s.mail.length, 1);
  assert.equal(s.inspect().registrationOpen, false);
});
test("unknown or empty allow-list mode fails closed and owner diagnostics send no mail", () => {
  const s = server(),
    status = s.inspect();
  assert.equal(status.remainingMailRecipients, 100);
  assert.equal(status.authRequestBudgetPer24Hours, 50);
  assert.equal(s.mail.length, 0);
  assert.equal(
    JSON.stringify(s.logs).includes(s.properties.AUTH_SECRET),
    false,
  );
  assert.equal(JSON.stringify(s.logs).includes("player@kaist.ac.kr"), false);
  delete s.properties.PILOT_EMAILS;
  assert.equal(s.call("health").error.code, "NOT_CONFIGURED");
  s.properties.AUTH_EMAIL_SCOPE = "kaits";
  assert.equal(s.call("health").error.code, "NOT_CONFIGURED");
});
test("owner authentication scope change cannot silently open player registration", () => {
  const s = server();
  s.properties.LEAGUE_REGISTRATION_OPEN = "true";
  assert.throws(() => s.allowKaist(), /Close player registration/);
  assert.equal(s.properties.AUTH_EMAIL_SCOPE, undefined);
  assert.equal(s.properties.LEAGUE_REGISTRATION_OPEN, "true");
  assert.equal(s.mail.length, 0);
});

test("owner setup creates a server secret once and refuses reinitialization", () => {
  const s = server();
  delete s.properties.AUTH_SECRET;
  delete s.properties.AUTH_SHEET_ID;
  s.initialize();
  assert.match(s.properties.AUTH_SECRET, /^[a-f0-9]{64}$/);
  assert.equal(s.createdSheets(), 1);
  const secret = s.properties.AUTH_SECRET;
  assert.throws(() => s.initialize(), /Already initialized/);
  assert.equal(s.properties.AUTH_SECRET, secret);
  assert.equal(s.createdSheets(), 1);
});
test("owner setup rejects a broken entropy source and preserves existing secrets", () => {
  const s = server();
  delete s.properties.AUTH_SECRET;
  delete s.properties.AUTH_SHEET_ID;
  s.duplicateUuid();
  assert.throws(() => s.initialize(), /entropy source/);
  assert.equal(s.properties.AUTH_SECRET, undefined);
  assert.equal(s.createdSheets(), 0);
  const other = server();
  delete other.properties.AUTH_SHEET_ID;
  const old = other.properties.AUTH_SECRET;
  other.initialize();
  assert.equal(other.properties.AUTH_SECRET, old);
});

test("email/domain/pilot restrictions run on the server", () => {
  const s = server();
  for (const email of [
    "p@kaist.ac.kr.evil.test",
    "p@lab.kaist.ac.kr",
    "p@gmail.com",
  ])
    assert.equal(
      s.call("requestCode", { email, purpose: "login" }).error.code,
      "INVALID_EMAIL",
    );
  assert.equal(
    s.call("requestCode", { email: "other@kaist.ac.kr", purpose: "login" })
      .error.code,
    "PILOT_ONLY",
  );
  assert.equal(s.mail.length, 0);
});
test("real server session, consumed OTP, logout revocation and no raw secrets in storage", () => {
  const s = server(),
    challenge = s.request();
  assert.equal(challenge.ok, true);
  const verified = s.verification(challenge);
  assert.equal(verified.ok, true);
  const token = verified.data.sessionToken;
  assert.equal(
    s.call("session", { sessionToken: token }).data.email,
    "player@kaist.ac.kr",
  );
  assert.equal(s.verification(challenge).error.code, "INVALID_CODE");
  const persisted = JSON.stringify(s.properties).replace(
    s.properties.AUTH_SECRET,
    "",
  );
  assert.equal(s.tables.Challenges.length, 1);
  assert.equal(s.tables.Sessions.length, 1);
  assert.equal(persisted.includes(token), false);
  assert.equal(Object.hasOwn(s.records("Challenges")[0], "code"), false);
  assert.equal(
    s.call("session", { sessionToken: "b".repeat(64) }).error.code,
    "SESSION_EXPIRED",
  );
  assert.equal(s.call("logout", { sessionToken: token }).ok, true);
  assert.equal(
    s.call("session", { sessionToken: token }).error.code,
    "SESSION_EXPIRED",
  );
  assert.equal(s.call("logout", { sessionToken: token }).ok, true);
});
test("OTP expires after five minutes and is bound to email/purpose", () => {
  const s = server(),
    challenge = s.request();
  assert.equal(
    s.verification(challenge, { purpose: "register" }).error.code,
    "INVALID_CODE",
  );
  assert.equal(
    s.verification(challenge, { email: "someone@kaist.ac.kr" }).error.code,
    "INVALID_CODE",
  );
  s.advance(300000);
  assert.equal(s.verification(challenge).error.code, "INVALID_CODE");
});
test("five failed guesses lock the challenge", () => {
  const s = server(),
    challenge = s.request(),
    real = s.mail[0].body.match(/\d{6}/)[0];
  const wrong = real === "000000" ? "000001" : "000000";
  for (let i = 0; i < 4; i++)
    assert.equal(
      s.verification(challenge, { code: wrong }).error.code,
      "INVALID_CODE",
    );
  assert.equal(
    s.verification(challenge, { code: wrong }).error.code,
    "TOO_MANY_ATTEMPTS",
  );
  assert.equal(s.verification(challenge).error.code, "TOO_MANY_ATTEMPTS");
});
test("cooldown and reissue invalidate the previous code", () => {
  const s = server(),
    old = s.request(),
    oldCode = s.mail[0].body.match(/\d{6}/)[0];
  assert.equal(s.request().error.code, "RATE_LIMITED");
  s.advance(60000);
  const next = s.request();
  assert.equal(next.ok, true);
  assert.equal(
    s.verification(old, { code: oldCode }).error.code,
    "INVALID_CODE",
  );
  assert.equal(s.verification(next).ok, true);
});
test("mail failure cannot produce a usable challenge; quota prevents sends", () => {
  const s = server();
  s.failMail();
  assert.equal(s.request().error.code, "MAIL_FAILED");
  assert.equal(s.records("Challenges")[0].state, "failed");
  const other = server();
  other.noQuota();
  assert.equal(other.request().error.code, "QUOTA_EXCEEDED");
  assert.equal(other.mail.length, 0);
});
test("session expires after twelve hours; pilot configuration fails closed", () => {
  const s = server(),
    challenge = s.request(),
    verified = s.verification(challenge);
  s.advance(43200000);
  assert.equal(
    s.call("session", { sessionToken: verified.data.sessionToken }).error.code,
    "SESSION_EXPIRED",
  );
  delete s.properties.AUTH_SECRET;
  assert.equal(s.call("health").error.code, "NOT_CONFIGURED");
});
test("hourly limit and global rolling daily budget", () => {
  const s = server();
  for (let i = 0; i < 5; i++) {
    assert.equal(s.request().ok, true);
    s.advance(60000);
  }
  assert.equal(s.request().error.code, "RATE_LIMITED");
  const other = server();
  for (let i = 0; i < 50; i++) {
    assert.equal(other.request().ok, true);
    other.advance(1200000);
  }
  assert.equal(other.request().error.code, "QUOTA_EXCEEDED");
});
test("client uses a readable simple POST, keeps OTP/token out of URL", async () => {
  const endpoint = "https://script.google.com/macros/s/example/exec";
  assert.equal(validateEndpoint(endpoint), true);
  for (const invalid of [
    "http://script.google.com/macros/s/a/exec",
    "https://evil.test/exec",
    endpoint + "?token=x",
  ])
    assert.equal(validateEndpoint(invalid), false);
  const client = createAuthClient(endpoint, async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.method, "POST");
    assert.equal(options.mode, "cors");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    assert.equal(options.body.get("code"), "123456");
    return {
      ok: true,
      type: "cors",
      json: async () => ({
        protocol: "igfl-auth-v1",
        ok: true,
        data: { accepted: true },
      }),
    };
  });
  assert.deepEqual(await client("verifyCode", { code: "123456" }), {
    accepted: true,
  });
});
test("client rejects opaque/non-JSON/protocol failures", async () => {
  const endpoint = "https://script.google.com/macros/s/example/exec";
  await assert.rejects(
    createAuthClient(endpoint, async () => ({ ok: true, type: "opaque" }))(
      "health",
    ),
    (e) => e.code === "CONNECTION_FAILED",
  );
  await assert.rejects(
    createAuthClient(endpoint, async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))("health"),
    (e) => e.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    createAuthClient(endpoint, async () => {
      throw new Error("fetch failed");
    })("health"),
    (e) => e.code === "CONNECTION_FAILED",
  );
});

test("account identity persists across logins but erasure revokes every session and rejoining gets a new identity", () => {
  const s = server(),
    first = s.verification(s.request()),
    token = first.data.sessionToken;
  const id = s.call("session", { sessionToken: token }).data.userId;
  s.advance(60000);
  const second = s.verification(s.request());
  assert.equal(
    s.call("session", { sessionToken: second.data.sessionToken }).data.userId,
    id,
  );
  s.erase(id, "player@kaist.ac.kr");
  assert.equal(
    s.call("session", { sessionToken: token }).error.code,
    "SESSION_EXPIRED",
  );
  assert.equal(
    s.call("session", { sessionToken: second.data.sessionToken }).error.code,
    "SESSION_EXPIRED",
  );
  assert.equal(
    JSON.stringify(
      ["Accounts", "Sessions", "Challenges"].map(s.records),
    ).includes("player@kaist.ac.kr"),
    false,
  );
  const rejoin = s.verification(s.request());
  assert.notEqual(
    s.call("session", { sessionToken: rejoin.data.sessionToken }).data.userId,
    id,
  );
});
test("privacy pruning removes terminal OTP hashes and expired sessions; pending erasure blocks new sessions", () => {
  const s = server(),
    first = s.verification(s.request());
  s.prune();
  assert.equal("codeHash" in s.records("Challenges")[0], false);
  s.advance(43200000);
  s.prune();
  assert.equal(s.records("Sessions").length, 0);
  const challenge = s.request();
  s.properties.PENDING_ACCOUNT_ERASURE = JSON.stringify({
    email: "player@kaist.ac.kr",
    userId: "old",
  });
  assert.equal(s.verification(challenge).error.code, "ACCOUNT_ERASURE_PENDING");
  assert.equal(s.records("Sessions").length, 0);
});
