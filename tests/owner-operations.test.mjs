import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { harness } from "./helpers/gas.mjs";

function setup() {
  const h = harness();
  vm.runInContext(
    'append_(config_(), "Accounts", {email:PRIVACY.contact,userId:"verified-operator",createdAt:Date.now(),lastSeenAt:Date.now()})',
    h.c,
  );
  return h;
}
test("owner binds verified account ID, preserves other admins and keeps every launch gate closed", () => {
  const h = setup();
  h.properties.LEAGUE_ADMIN_USER_IDS = "existing-admin";
  const before = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  h.c.configureOperationsAdmin();
  const status = h.c.configureOperationsAdmin();
  assert.equal(status.adminBound, true);
  assert.equal(status.adminMailConfigured, true);
  assert.equal(status.siteConfigured, true);
  assert.equal(
    h.properties.LEAGUE_ADMIN_USER_IDS,
    "existing-admin,verified-operator",
  );
  for (const flag of [
    "registrationRequested",
    "privacyStorageApproved",
    "seasonOpen",
    "leagueEmailsEnabled",
  ])
    assert.equal(status[flag], false);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, before);
  assert.ok(!JSON.stringify(status).includes("verified-operator"));
  const adminsBeforeUrlChange = h.properties.LEAGUE_ADMIN_USER_IDS;
  h.properties.LEAGUE_SITE_URL = "https://old.example.invalid/";
  const migration = h.c.configureLeagueSiteUrl();
  assert.equal(migration.siteUrl, "https://igfl-kaist.github.io/");
  assert.equal(migration.leagueEmailsEnabled, false);
  assert.equal(h.properties.LEAGUE_ADMIN_USER_IDS, adminsBeforeUrlChange);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, before);
  h.c.findSession_ = () => ({
    value: { userId: "verified-operator", email: "sy.choi@kaist.ac.kr" },
  });
  assert.equal(
    h.c.leagueActor_(h.c.config_(), { sessionToken: "test-session" }).admin,
    true,
  );
  h.c.findSession_ = () => ({
    value: { userId: "unprivileged", email: "sy.choi@kaist.ac.kr" },
  });
  assert.equal(
    h.c.leagueActor_(h.c.config_(), {
      sessionToken: "other-session",
      admin: true,
    }).admin,
    false,
  );
  h.c.eraseAuthAccount_(
    h.c.config_(),
    "verified-operator",
    "sy.choi@kaist.ac.kr",
  );
  assert.equal(h.properties.LEAGUE_ADMIN_USER_IDS, "existing-admin");
});
test("admin bootstrap refuses missing, duplicate, conflicting and erasing account mappings", () => {
  assert.throws(() => harness().c.configureOperationsAdmin(), {
    igflCode: "OPERATIONS_LOGIN_REQUIRED",
  });
  const duplicate = setup();
  vm.runInContext(
    'append_(config_(), "Accounts", {email:PRIVACY.contact,userId:"second"})',
    duplicate.c,
  );
  assert.throws(() => duplicate.c.configureOperationsAdmin(), {
    igflCode: "OPERATIONS_LOGIN_REQUIRED",
  });
  const conflict = setup();
  vm.runInContext(
    'append_(config_(), "Accounts", {email:"other@example.invalid",userId:"verified-operator"})',
    conflict.c,
  );
  assert.throws(() => conflict.c.configureOperationsAdmin(), {
    igflCode: "OPERATIONS_ACCOUNT_CONFLICT",
  });
  const erasing = setup();
  erasing.properties.PENDING_ACCOUNT_ERASURE = JSON.stringify({
    userId: "verified-operator",
  });
  assert.throws(() => erasing.c.configureOperationsAdmin(), {
    igflCode: "ACCOUNT_ERASURE_PENDING",
  });
});
test("manual tests send exactly two isolated messages to operator using real recipient resolution without flushing outbox", () => {
  const h = setup(),
    sent = [];
  h.c.configureOperationsAdmin();
  const before = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  h.c.MailApp.sendEmail = (message) => {
    const journal = JSON.parse(h.properties.LEAGUE_MANUAL_MAIL_TEST_V1);
    assert.ok(journal.jobs.some((j) => j.status === "sending"));
    // A nested lock can be taken: MailApp runs outside the claim lock.
    h.c.locked_(() => {});
    sent.push(message);
  };
  h.c.processLeagueEmails();
  const status = h.c.sendOperationsMailTests();
  h.c.sendOperationsMailTests();
  h.c.processLeagueEmails();
  assert.equal(sent.length, 2);
  assert.ok(
    sent.every(
      (m) =>
        m.to === "sy.choi@kaist.ac.kr" &&
        !m.cc &&
        !m.bcc &&
        m.subject.includes("[테스트]") &&
        m.body.includes("실제 팀 신청이나 심판 배정 요청이 아니며"),
    ),
  );
  assert.match(sent[0].subject, /팀 등록 신청/);
  assert.match(sent[1].subject, /심판 배정 요청/);
  assert.ok(status.manualMailTest.jobs.every((j) => j.status === "sent"));
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, before);
  assert.equal(status.leagueEmailsEnabled, false);
});
test("ambiguous or interrupted manual delivery is not resent and quota exhaustion does not consume pending jobs", () => {
  const h = setup();
  h.c.configureOperationsAdmin();
  let sends = 0;
  h.c.MailApp.sendEmail = () => {
    sends++;
    throw new Error("possible delivery");
  };
  h.c.sendOperationsMailTests();
  h.c.sendOperationsMailTests();
  assert.equal(sends, 2);
  assert.ok(
    JSON.parse(h.properties.LEAGUE_MANUAL_MAIL_TEST_V1).jobs.every(
      (j) => j.status === "uncertain",
    ),
  );
  const paused = setup();
  paused.c.configureOperationsAdmin();
  paused.c.MailApp.getRemainingDailyQuota = () => 0;
  paused.c.sendOperationsMailTests();
  assert.equal(paused.properties.LEAGUE_MANUAL_MAIL_TEST_V1, undefined);
  paused.properties.LEAGUE_MANUAL_MAIL_TEST_V1 = JSON.stringify({
    jobs: [
      {
        id: "interrupted",
        kind: "refereeRequest",
        recipients: ["synthetic-referee"],
        status: "sending",
      },
    ],
  });
  paused.c.MailApp.getRemainingDailyQuota = () => 100;
  paused.c.sendOperationsMailTests();
  assert.equal(
    JSON.parse(paused.properties.LEAGUE_MANUAL_MAIL_TEST_V1).jobs[0].status,
    "sending",
  );
});
test("owner mail tests refuse any open launch gate and any extra recipient", () => {
  for (const gate of [
    "LEAGUE_REGISTRATION_OPEN",
    "PRIVACY_STORAGE_APPROVED",
    "LEAGUE_SEASON_OPEN",
    "LEAGUE_EMAILS_ENABLED",
  ]) {
    const h = setup();
    h.c.configureOperationsAdmin();
    h.properties[gate] = "true";
    assert.throws(() => h.c.sendOperationsMailTests(), {
      igflCode: "CLOSE_LEAGUE_BEFORE_OWNER_SETUP",
    });
    assert.throws(() => h.c.configureOperationsAdmin(), {
      igflCode: "CLOSE_LEAGUE_BEFORE_OWNER_SETUP",
    });
    assert.throws(() => h.c.configureLeagueSiteUrl(), {
      igflCode: "CLOSE_LEAGUE_BEFORE_OWNER_SETUP",
    });
  }
  const h = setup();
  h.c.configureOperationsAdmin();
  h.properties.LEAGUE_ADMIN_EMAILS += ",other@example.invalid";
  assert.throws(() => h.c.sendOperationsMailTests(), {
    igflCode: "OPERATIONS_MAIL_NOT_CONFIGURED",
  });
});
