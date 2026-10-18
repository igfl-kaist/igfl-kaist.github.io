import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { harness } from "./helpers/gas.mjs";

function config(h) {
  return h.c.config_();
}
function legacy(h, name, record) {
  h.files
    .get("production")
    .getSheetByName(name)
    .appendRow([JSON.stringify(record)]);
}
function setSeed(h) {
  vm.runInContext(
    `var seed = loadLeague_(config_());
    seed.players.push({id:'erased',name:'SECRET_PERSON',lab:'SECRET_LAB',teamId:null});
    seed.profiles.push({id:'erased',email:'private@example.invalid'});
    seed.teams.push({id:'t1',name:'keep',elo:1032,members:[]});
    saveLeague_(config_(),seed);`,
    h.c,
  );
  h.c.append_(config(h), "Accounts", {
    userId: "erased",
    email: "private@example.invalid",
  });
}

test("auth migration verifies retained records, preserves sessions and identity, and never writes Sheets afterward", () => {
  const h = harness(),
    now = 1800000000000;
  delete h.properties.AUTH_STORAGE_VERSION;
  legacy(h, "Challenges", {
    id: "expired",
    createdAt: now - 600000,
    expiresAt: now - 1,
    codeHash: "discard",
  });
  legacy(h, "Challenges", {
    id: "old",
    createdAt: now - 86400001,
    expiresAt: now - 1,
  });
  legacy(h, "Sessions", {
    tokenHash: "valid-hash",
    userId: "stable",
    expiresAt: now + 10000,
  });
  legacy(h, "Sessions", {
    tokenHash: "revoked",
    expiresAt: now + 10000,
    revokedAt: 1,
  });
  legacy(h, "Accounts", { userId: "stable", email: "member@example.invalid" });
  assert.throws(
    () => h.c.read_(config(h), "Accounts"),
    (e) => e.igflCode === "AUTH_MIGRATION_REQUIRED",
  );
  const original = JSON.stringify(
    [...h.files.get("production").getSheets()].map((s) => s.rows),
  );
  assert.equal(h.c.migrateAuthenticationStorage().status, "migrated");
  assert.equal(h.c.read_(config(h), "Sessions")[0].value.userId, "stable");
  assert.equal(h.c.read_(config(h), "Challenges").length, 1);
  assert.equal(h.c.read_(config(h), "Challenges")[0].value.codeHash, undefined);
  h.c.append_(config(h), "Accounts", { userId: "new" });
  assert.equal(h.c.migrateAuthenticationStorage().status, "already-migrated");
  assert.equal(
    JSON.stringify(
      [...h.files.get("production").getSheets()].map((s) => s.rows),
    ),
    original,
  );
});

test("migration write failure cannot expose an incomplete store; repeat migration verifies and commits", () => {
  const h = harness();
  delete h.properties.AUTH_STORAGE_VERSION;
  legacy(h, "Accounts", { userId: "stable" });
  const p = h.c.PropertiesService.getScriptProperties(),
    original = p.setProperty;
  p.setProperty = (key, v) => {
    if (key.startsWith("IGFL_AUTH:Accounts:")) throw Error("provider");
    return original(key, v);
  };
  assert.throws(() => h.c.migrateAuthenticationStorage(), /provider/);
  assert.equal(h.properties.AUTH_STORAGE_VERSION, undefined);
  p.setProperty = original;
  assert.equal(h.c.migrateAuthenticationStorage().status, "migrated");
});

test("withdrawal creates a blank verified file, switches atomically, preserves scores and queues the old file without deleting it", () => {
  const h = harness();
  setSeed(h);
  const old = JSON.stringify(
    h.files.get("production").getSheetByName("LeagueSnapshots").rows,
  );
  h.properties.PENDING_ACCOUNT_ERASURE = JSON.stringify({
    userId: "erased",
    email: "private@example.invalid",
  });
  h.c.completeAccountErasure_(config(h));
  const pointer = JSON.parse(h.properties.LEAGUE_ACTIVE_SNAPSHOT),
    current = h.files.get(pointer.sheetId);
  assert.notEqual(pointer.sheetId, "production");
  assert.equal(current.getSheets().length, 1);
  const state = h.c.loadLeague_(config(h));
  assert.equal(JSON.stringify(state).includes("SECRET"), false);
  assert.equal(state.teams[0].elo, 1032);
  assert.equal(h.c.read_(config(h), "Accounts").length, 0);
  assert.equal(
    JSON.parse(h.properties["IGFL_RETIRED:production"]).deletionStatus,
    "pending-owner-deletion",
  );
  assert.equal(h.files.has("production"), true);
  assert.ok(old.length > 0);
  assert.equal(h.properties.PENDING_ACCOUNT_ERASURE, undefined);
  const count = h.files.size;
  h.c.completeAccountErasure_(config(h));
  assert.equal(h.files.size, count);
  // A stale config created before cutover must write to the active replacement, never the retired file.
  const frozen = config(h),
    oldRows = JSON.stringify(
      h.files.get("production").getSheetByName("LeagueSnapshots").rows,
    );
  state.revision++;
  h.c.saveLeague_(frozen, state);
  assert.equal(
    JSON.stringify(
      h.files.get("production").getSheetByName("LeagueSnapshots").rows,
    ),
    oldRows,
  );
  assert.equal(
    JSON.parse(h.properties.LEAGUE_ACTIVE_SNAPSHOT).sheetId,
    pointer.sheetId,
  );
  assert.equal(h.c.inspectRuntimeStatus().registrationOpen, false);
  h.files.delete("production"); // simulate the owner deleting the retired original
  assert.equal(h.c.loadLeague_(config(h)).teams[0].elo, 1032);
});

test("read-back corruption cannot commit; retry resumes the same new file", () => {
  const h = harness(),
    original = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  const open = h.c.SpreadsheetApp.openById;
  let corrupt = true;
  h.c.SpreadsheetApp.openById = (id) => {
    const db = open(id);
    if (id !== "production" && corrupt) {
      return {
        ...db,
        getSheetByName: (n) => {
          const s = db.getSheetByName(n);
          if (!s) return s;
          return {
            ...s,
            getRange: (...args) => {
              const r = s.getRange(...args);
              return { ...r, getValues: () => [["IGFL:e30="]] };
            },
          };
        },
      };
    }
    return db;
  };
  // First target has no tab until initialized, so corrupt every read via its sheet object directly.
  const create = h.c.SpreadsheetApp.create;
  h.c.SpreadsheetApp.create = () => {
    const db = create();
    const s = db.getSheets()[0],
      range = s.getRange;
    s.getRange = (...args) => {
      const r = range(...args),
        get = r.getValues;
      r.getValues = () => (corrupt ? [["IGFL:e30="]] : get());
      return r;
    };
    return db;
  };
  assert.throws(
    () => h.c.rotateLeagueStorage_(config(h), "test"),
    (e) => e.igflCode === "ROTATION_VERIFY_FAILED",
  );
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, original);
  const count = h.files.size;
  corrupt = false;
  h.c.resumeStorageRotation_(config(h));
  assert.equal(h.files.size, count);
  assert.equal(h.properties.SHEET_ROTATION_JOB, undefined);
  assert.equal(JSON.parse(h.properties.LAST_SHEET_ROTATION).verified, true);
});

test("post-commit interruption completes retirement without restoring data or creating another file", () => {
  const h = harness(),
    p = h.c.PropertiesService.getScriptProperties(),
    set = p.setProperty;
  let fail = true;
  p.setProperty = (k, v) => {
    if (fail && k.startsWith("IGFL_RETIRED:")) throw Error("interrupted");
    return set(k, v);
  };
  assert.throws(
    () => h.c.rotateLeagueStorage_(config(h), "test"),
    /interrupted/,
  );
  const pointer = h.properties.LEAGUE_ACTIVE_SNAPSHOT,
    count = h.files.size;
  fail = false;
  h.c.rotateLeagueStorage_(config(h), "owner-retry");
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  assert.equal(h.files.size, count);
  assert.ok(h.properties["IGFL_RETIRED:production"]);
});

test("an uncertain create is held for owner inspection and never repeatedly creates files", () => {
  const h = harness();
  h.c.SpreadsheetApp.create = () => {
    throw Error("unknown result");
  };
  assert.throws(() => h.c.rotateLeagueStorage_(config(h), "test"), /unknown/);
  assert.throws(
    () => h.c.resumeStorageRotation_(config(h)),
    (e) => e.igflCode === "SHEET_CREATION_REVIEW_REQUIRED",
  );
  assert.ok(h.properties.SHEET_ROTATION_JOB);
  h.c.acknowledgeUncertainSheetCreation();
  assert.equal(h.properties.SHEET_ROTATION_JOB, undefined);
  assert.ok(
    Object.keys(h.properties).some((k) =>
      k.startsWith("SHEET_CREATION_INCIDENT:"),
    ),
  );
});

test("properties enforce per-value and overall budgets and a rejected write cannot consume the active record", () => {
  const h = harness(),
    p = h.c.PropertiesService.getScriptProperties();
  h.c.append_(config(h), "Accounts", { id: "keep" });
  const record = h.c.read_(config(h), "Accounts")[0];
  assert.throws(
    () =>
      h.c.write_(config(h), "Accounts", record.row, {
        text: "한".repeat(3000),
      }),
    (e) => e.igflCode === "AUTH_STORAGE_LIMIT",
  );
  assert.equal(h.c.read_(config(h), "Accounts")[0].value.id, "keep");
  for (let i = 0; i < 60; i++) p.setProperty("padding" + i, "x".repeat(7000));
  assert.throws(
    () => h.c.append_(config(h), "Sessions", { id: "over-budget" }),
    (e) => e.igflCode === "AUTH_STORAGE_LIMIT",
  );
});

test("actual-shaped owner verification keeps production isolated and records every synthetic file for manual disposal", () => {
  const h = harness(),
    active = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  const report = h.c.verifyStorageWorkflow();
  assert.equal(report.status, "passed");
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, active);
  assert.equal(report.files.length, 2);
  for (const id of report.files) {
    assert.ok(h.files.has(id));
    assert.ok(h.properties["IGFL_RETIRED:" + id]);
  }
  assert.equal(
    Object.keys(h.properties).some((k) => k.startsWith("IGFL_VERIFY:")),
    false,
  );
  assert.throws(() => h.c.verifyStorageWorkflow(), /ALREADY_EXISTS/);
});

test("the original snapshot remains active if pointer commit fails, and retry commits the verified target once", () => {
  const h = harness(),
    original = h.properties.LEAGUE_ACTIVE_SNAPSHOT,
    p = h.c.PropertiesService.getScriptProperties(),
    set = p.setProperty;
  let fail = true;
  p.setProperty = (k, v) => {
    if (fail && k === "LEAGUE_ACTIVE_SNAPSHOT") throw Error("commit failed");
    return set(k, v);
  };
  assert.throws(
    () => h.c.rotateLeagueStorage_(config(h), "test"),
    /commit failed/,
  );
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, original);
  const count = h.files.size;
  fail = false;
  h.c.resumeStorageRotation_(config(h));
  assert.equal(h.files.size, count);
  assert.notEqual(h.properties.LEAGUE_ACTIVE_SNAPSHOT, original);
});

test("the expected 100-player scale plus a full 50-request day fits the bounded property store", () => {
  const h = harness();
  for (let i = 0; i < 100; i++)
    h.c.append_(config(h), "Accounts", {
      userId: "a".repeat(60) + i,
      email: "p" + i + "@kaist.ac.kr",
      createdAt: 1800000000000,
      lastSeenAt: 1800000000000,
    });
  for (let i = 0; i < 50; i++) {
    h.c.append_(config(h), "Challenges", {
      id: "c".repeat(60) + i,
      email: "p" + i + "@kaist.ac.kr",
      purpose: "login",
      codeHash: "h".repeat(64),
      attempts: 0,
      createdAt: 1800000000000,
      expiresAt: 1800000300000,
      state: "sent",
    });
    h.c.append_(config(h), "Sessions", {
      tokenHash: "s".repeat(60) + i,
      userId: "a".repeat(60) + i,
      email: "p" + i + "@kaist.ac.kr",
      createdAt: 1800000000000,
      expiresAt: 1800043200000,
    });
  }
  const status = h.c.inspectStorageStatus();
  assert.equal(status.authRecordCounts.Accounts, 100);
  assert.ok(status.propertiesBytes < 150000);
});
