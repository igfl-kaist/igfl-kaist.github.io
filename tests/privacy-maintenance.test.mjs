import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function harness() {
  let now = 1800000000000,
    held = false,
    failClear = false;
  const files = new Map(),
    properties = {
      AUTH_SECRET: "a".repeat(64),
      AUTH_SHEET_ID: "production",
      AUTH_EMAIL_SCOPE: "kaist",
    },
    logs = [];
  const props = {
    getProperty: (k) => properties[k] || null,
    setProperty: (k, v) => {
      properties[k] = v;
    },
    deleteProperty: (k) => {
      delete properties[k];
    },
    getProperties: () => ({ ...properties }),
  };
  function file(id) {
    const sheets = new Map();
    function sheet(name) {
      const rows = [];
      const s = {
        rows,
        setName(n) {
          sheets.delete(name);
          name = n;
          sheets.set(n, s);
          return s;
        },
        getLastRow() {
          let n = rows.length;
          while (n && !rows[n - 1]?.[0]) n--;
          return n;
        },
        appendRow(row) {
          rows[s.getLastRow()] = row;
          return s;
        },
        deleteRow(row) {
          rows.splice(row - 1, 1);
        },
        getRange(row, col, count = 1) {
          return {
            getValues: () =>
              Array.from(
                { length: count },
                (_, i) => rows[row - 1 + i] || [""],
              ),
            setNumberFormat() {
              return this;
            },
            setValue(v) {
              rows[row - 1] = [v];
              return this;
            },
            setValues(vs) {
              vs.forEach((v, i) => {
                rows[row - 1 + i] = v;
              });
              return this;
            },
            clearContent() {
              if (failClear) {
                failClear = false;
                throw new Error("private@example.invalid provider error");
              }
              for (let i = 0; i < count; i++) rows[row - 1 + i] = [""];
            },
          };
        },
      };
      sheets.set(name, s);
      return s;
    }
    const f = {
      getId: () => id,
      getSheets: () => [...sheets.values()],
      getSheetByName: (n) => sheets.get(n),
      insertSheet: sheet,
    };
    files.set(id, f);
    sheet("Sheet1");
    return f;
  }
  const production = file("production");
  production.getSheets()[0].setName("Challenges").appendRow(["record_json"]);
  for (const name of ["Sessions", "Accounts", "LeagueSnapshots"])
    production.insertSheet(name).appendRow(["record_json"]);
  const c = vm.createContext({
    Date: { now: () => now },
    Logger: { log: (v) => logs.push(v) },
    PropertiesService: { getScriptProperties: () => props },
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
    SpreadsheetApp: {
      openById: (id) => {
        assert.ok(files.has(id));
        return files.get(id);
      },
      create: () => file("probe"),
      flush() {},
    },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      base64Encode: (s) => Buffer.from(s).toString("base64"),
      base64Decode: (s) => [...Buffer.from(s, "base64")],
      newBlob: (b) => ({
        getDataAsString: () => Buffer.from(b).toString("utf8"),
      }),
    },
    MailApp: {
      sendEmail: () => assert.fail("maintenance must never send mail"),
      getRemainingDailyQuota: () => 100,
    },
  });
  for (const path of [
    "apps-script/Code.gs",
    "server/policies.mjs",
    "server/league.mjs",
    "server/images.mjs",
    "apps-script/LeagueAdapter.gs",
    "apps-script/OwnerSetup.gs",
    "apps-script/PrivacyVerification.gs",
  ])
    vm.runInContext(
      readFileSync(new URL("../" + path, import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "")
        .replace(/^export /gm, ""),
      c,
    );
  vm.runInContext(
    "saveLeague_(config_(), League.createState(leagueSettings_()))",
    c,
  );
  return {
    c,
    files,
    properties,
    logs,
    advance: (n) => {
      now += n;
    },
    failClear: () => {
      failClear = true;
    },
  };
}

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
