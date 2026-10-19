import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { harness } from "./helpers/gas.mjs";
import { PRIVACY } from "../src/privacy-content.mjs";
function prepared() {
  const h = harness();
  vm.runInContext(
    'append_(config_(), "Accounts", {email:PRIVACY.contact,userId:"verified-operator",createdAt:Date.now(),lastSeenAt:Date.now()})',
    h.c,
  );
  h.c.configureOperationsAdmin();
  h.c.configurePreseasonSettings();
  h.c.runPrivacyMaintenance();
  h.c.configureManualDeletionPolicy();
  return h;
}
test("manual policy preparation stays closed; owner opens only recruitment and can close without changing identity or data", () => {
  const h = prepared(),
    pointer = h.properties.LEAGUE_ACTIVE_SNAPSHOT,
    admins = h.properties.LEAGUE_ADMIN_USER_IDS;
  const before = h.c.inspectRecruitmentLaunch();
  assert.equal(before.ready, true);
  assert.equal(before.registrationOpen, false);
  assert.equal(before.privacyStorageApproved, false);
  assert.equal(before.authRequestBudgetPer24Hours, 300);
  const live = h.c.openPlayerRecruitment();
  assert.equal(live.registrationOpen, true);
  assert.equal(live.privacyStorageApproved, true);
  assert.equal(live.seasonOpen, false);
  assert.equal(live.leagueEmailsEnabled, false);
  assert.equal(live.manualPolicyVersion, PRIVACY.manualDeletionPolicyVersion);
  assert.equal(h.c.openPlayerRecruitment().registrationOpen, true);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  assert.equal(h.properties.LEAGUE_ADMIN_USER_IDS, admins);
  assert.ok(!JSON.stringify(live).includes("verified-operator"));
  const closed = h.c.closePlayerRecruitment();
  assert.equal(closed.registrationOpen, false);
  assert.equal(closed.privacyStorageApproved, false);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
});
test("recruitment refuses missing policy, stale notices, pending deletions, failed cleanup or an open match/mail service", () => {
  const mutations = [
    (h) => delete h.properties.PRIVACY_MANUAL_DELETION_POLICY,
    (h) => (h.properties.PRIVACY_VERSION = "old-version"),
    (h) =>
      (h.properties["IGFL_RETIRED:old-synthetic"] = JSON.stringify({
        deletionStatus: "pending-owner-deletion",
      })),
    (h) => (h.properties.SHEET_ROTATION_JOB = "{}"),
    (h) => (h.properties.PENDING_ACCOUNT_ERASURE = "{}"),
    (h) => h.advance(2 * 3600000 + 1),
    (h) =>
      (h.properties.PRIVACY_MAINTENANCE_STATUS = JSON.stringify({
        status: "failed",
      })),
    (h) => (h.properties.LEAGUE_ADMIN_USER_IDS = ""),
    (h) => (h.properties.LEAGUE_SEASON_OPEN = "true"),
    (h) => (h.properties.LEAGUE_EMAILS_ENABLED = "true"),
    (h) => (h.c.MailApp.getRemainingDailyQuota = () => 0),
  ];
  for (const change of mutations) {
    const h = prepared();
    change(h);
    assert.equal(h.c.inspectRecruitmentLaunch().ready, false);
    assert.throws(() => h.c.openPlayerRecruitment(), {
      igflCode: "RECRUITMENT_NOT_READY",
    });
    assert.notEqual(h.properties.LEAGUE_REGISTRATION_OPEN, "true");
    assert.notEqual(h.properties.PRIVACY_STORAGE_APPROVED, "true");
  }
});
test("registration and erasure probe runs only in memory, stores current consents and keeps production untouched", () => {
  const h = prepared(),
    before = JSON.stringify(h.properties),
    fileCount = h.files.size;
  const report = h.c.verifyRecruitmentRules();
  assert.equal(report.passed, true);
  assert.equal(report.inMemoryOnly, true);
  assert.equal(JSON.stringify(h.properties), before);
  assert.equal(h.files.size, fileCount);
  h.c.ContentService = {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
  };
  const response = h.c.doPost({
    postData: { type: "application/x-www-form-urlencoded", length: 10 },
    parameter: { action: "openPlayerRecruitment" },
  });
  assert.equal(response.error.code, "BAD_REQUEST");
  assert.equal(h.c.inspectRecruitmentLaunch().registrationOpen, false);
});
