import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { harness } from "./helpers/gas.mjs";

test("scheduled entry uses the production cleanup on an isolated real-shaped fixture, once, without mail or opening collection", () => {
  const h = harness(),
    original = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  h.c.preparePrivacyProbe();
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, original);
  h.c.runScheduledPrivacyMaintenance();
  const probe = JSON.parse(h.properties.PRIVACY_PROBE);
  assert.equal(probe.status, "passed");
  assert.equal(Object.keys(probe.checks).length, 11);
  assert.ok(Object.values(probe.checks).every(Boolean));
  assert.equal(
    JSON.parse(h.properties.PRIVACY_MAINTENANCE_STATUS).status,
    "succeeded",
  );
  assert.equal(h.c.inspectRuntimeStatus().registrationOpen, false);
  assert.equal(h.c.inspectRuntimeStatus().seasonOpen, false);
  assert.equal(h.c.inspectRuntimeStatus().leagueEmailsEnabled, false);
  h.advance(3600000);
  h.c.runScheduledPrivacyMaintenance();
  assert.equal(
    JSON.parse(h.properties.PRIVACY_PROBE).completedAt,
    probe.completedAt,
  );
  assert.equal(JSON.parse(h.properties.PRIVACY_MAINTENANCE_STATUS).runs, 2);
  assert.throws(() => h.c.preparePrivacyProbe(), /PROBE_ALREADY_EXISTS/);
});

test("cleanup failure retains last success and erasure task, logs a fixed code, and succeeds on retry", () => {
  const h = harness();
  h.c.runPrivacyMaintenance();
  const succeeded = JSON.parse(
    h.properties.PRIVACY_MAINTENANCE_STATUS,
  ).lastSucceededAt;
  h.c.preparePrivacyProbe();
  const probe = JSON.parse(h.properties.PRIVACY_PROBE),
    config = h.c.probeConfig_(probe);
  config.properties.setProperty(
    "PRIVACY_MAINTENANCE_STATUS",
    JSON.stringify({ lastSucceededAt: succeeded, runs: 1 }),
  );
  h.advance(1000);
  h.failClear();
  assert.throws(
    () => h.c.privacyMaintenance_(config, 1800000001000),
    /^Error: PRIVACY_MAINTENANCE_FAILED$/,
  );
  const failed = JSON.parse(
    config.properties.getProperty("PRIVACY_MAINTENANCE_STATUS"),
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastSucceededAt, succeeded);
  assert.ok(config.properties.getProperty("PENDING_ACCOUNT_ERASURE"));
  assert.equal(JSON.stringify(failed).includes("@"), false);
  h.c.privacyMaintenance_(config, 1800000001000);
  assert.equal(config.properties.getProperty("PENDING_ACCOUNT_ERASURE"), null);
  assert.equal(
    JSON.parse(config.properties.getProperty("PRIVACY_MAINTENANCE_STATUS"))
      .status,
    "succeeded",
  );
  assert.equal(
    JSON.stringify(h.c.loadLeague_(config)).includes("probe-erase"),
    false,
  );
});

test("the registration switch alone cannot bypass unresolved storage review, including restored snapshot settings", () => {
  const h = harness();
  h.properties.LEAGUE_REGISTRATION_OPEN = "true";
  assert.equal(h.c.inspectRuntimeStatus().registrationOpen, false);
  vm.runInContext(
    "var s = loadLeague_(config_()); s.settings.registrationOpen = true; saveLeague_(config_(), s);",
    h.c,
  );
  assert.equal(
    h.c.loadLeague_({ sheetId: "production" }).settings.registrationOpen,
    false,
  );
  h.c.runPrivacyMaintenance();
  assert.equal(h.properties.PRIVACY_STORAGE_APPROVED, undefined);
  assert.equal(h.c.inspectRuntimeStatus().registrationOpen, false);
});
