import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { League } from "../server/league.mjs";
function storage({ send = () => {}, quota = () => 100 } = {}) {
  const rows = [["snapshot_chunks"]],
    properties = {},
    settings = {};
  let fail = false,
    failClear = false;
  const erased = [];
  const sheet = {
    getLastRow: () => rows.length,
    getRange: (row, col, count) => ({
      getValues: () => rows.slice(row - 1, row - 1 + count),
      clearContent() {
        if (failClear) {
          failClear = false;
          throw new Error("clear interrupted");
        }
        for (let i = 0; i < count; i++) rows[row - 1 + i] = [""];
        return this;
      },
      setNumberFormat() {
        return this;
      },
      setValues(values) {
        values.forEach((v, i) => {
          rows[row - 1 + i] = v;
          if (fail) throw new Error("interrupted write");
        });
        return this;
      },
    }),
  };
  const c = vm.createContext({
    League,
    Date,
    config_: () => ({}),
    locked_: (fn) => fn(),
    MailApp: { sendEmail: send, getRemainingDailyQuota: quota },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => properties[k],
        setProperty: (k, v) => (properties[k] = v),
        deleteProperty: (k) => delete properties[k],
      }),
    },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      base64Encode: (s) => Buffer.from(s).toString("base64"),
      base64Decode: (s) => [...Buffer.from(s, "base64")],
      newBlob: (b) => ({
        getDataAsString: () => Buffer.from(b).toString("utf8"),
      }),
    },
    table_: () => sheet,
    eraseAuthAccount_: (_, id, email) => erased.push({ id, email }),
    SpreadsheetApp: { flush: () => {} },
    fail_: (code) => {
      throw new Error(code);
    },
  });
  vm.runInContext(
    readFileSync(
      new URL("../apps-script/LeagueAdapter.gs", import.meta.url),
      "utf8",
    ),
    c,
  );
  return {
    save: (s) => c.saveLeague_({}, s),
    load: () => c.loadLeague_({}),
    processEmails: () => c.processLeagueEmails(),
    properties,
    rows,
    erased,
    compact: () => c.compactLeagueSnapshots_({}),
    completeErase: () => c.completeAccountErasure_({}),
    failClear: () => {
      failClear = true;
    },
    fail: () => (fail = true),
    recover: () => (fail = false),
  };
}
test("snapshot commit pointer protects the last complete state through partial writes", () => {
  const db = storage(),
    s = League.createState();
  s.revision = 1;
  db.save(s);
  const pointer = db.properties.LEAGUE_ACTIVE_SNAPSHOT;
  const next = structuredClone(s);
  next.revision = 2;
  next.settings.privacyNotice = "합성".repeat(30000);
  db.fail();
  assert.throws(() => db.save(next), /interrupted/);
  assert.equal(db.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  assert.equal(db.load().revision, 1);
  db.recover();
  db.save(next);
  assert.equal(db.load().revision, 2);
});
test("notification jobs stay queued until configured, then send only once", () => {
  const deliveries = [],
    db = storage({ send: (m) => deliveries.push(m) });
  const state = League.createState();
  state.outbox.push({
    id: "mail-1",
    kind: "teamApplication",
    recipients: "admins",
    status: "pending",
    attempts: 0,
  });
  db.save(state);
  db.processEmails();
  assert.equal(deliveries.length, 0);
  db.properties.LEAGUE_EMAILS_ENABLED = "true";
  db.processEmails();
  assert.equal(db.load().outbox[0].status, "pending");
  db.properties.LEAGUE_ADMIN_EMAILS = "admin@example.invalid";
  db.processEmails();
  db.processEmails();
  assert.equal(deliveries.length, 1);
  assert.equal(db.load().outbox[0].status, "sent");
});
test("ambiguous email delivery is held for review instead of duplicate automatic delivery", () => {
  let attempts = 0;
  const db = storage({
    send: () => {
      attempts++;
      throw new Error("provider timeout after possible delivery");
    },
  });
  const state = League.createState();
  state.outbox.push({
    id: "mail-2",
    kind: "refereeRequest",
    recipients: ["ref-1"],
    status: "pending",
    attempts: 0,
  });
  state.profiles.push({ id: "ref-1", email: "referee@example.invalid" });
  db.save(state);
  db.properties.LEAGUE_EMAILS_ENABLED = "true";
  db.processEmails();
  db.processEmails();
  assert.equal(attempts, 1);
  assert.equal(db.load().outbox[0].status, "uncertain");
  assert.equal(db.load().outbox[0].lastError, "MAIL_DELIVERY_UNCERTAIN");
});
test("encoded chunks preserve unicode boundaries and cannot become spreadsheet formulas", () => {
  const db = storage(),
    s = League.createState();
  s.settings.privacyNotice = '=IMPORTXML("https://example.invalid") 😀'.repeat(
    2000,
  );
  db.save(s);
  assert.ok(db.rows.slice(1).every(([value]) => value.startsWith("IGFL:")));
  const pointer = JSON.parse(db.properties.LEAGUE_ACTIVE_SNAPSHOT);
  const encoded = db.rows
    .slice(pointer.row - 1, pointer.row - 1 + pointer.count)
    .map(([v]) => v.slice(5))
    .join("");
  assert.equal(
    JSON.parse(Buffer.from(encoded, "base64").toString("utf8")).settings
      .privacyNotice,
    s.settings.privacyNotice,
  );
});

test("erasure retries after a failed cleanup and clears superseded snapshots after the redacted state is committed", () => {
  const db = storage(),
    s = League.createState();
  s.players.push({ id: "delete-me", name: "비공개 이름", lab: "합성 연구실" });
  s.profiles.push({ id: "delete-me", email: "delete@example.invalid" });
  db.save(s);
  db.properties.PENDING_ACCOUNT_ERASURE = JSON.stringify({
    userId: "delete-me",
    email: "delete@example.invalid",
  });
  db.failClear();
  assert.throws(() => db.completeErase(), /clear interrupted/);
  assert.ok(db.properties.PENDING_ACCOUNT_ERASURE);
  assert.equal(db.load().players.length, 0);
  db.completeErase();
  assert.equal(db.properties.PENDING_ACCOUNT_ERASURE, undefined);
  assert.equal(db.load().profiles.length, 0);
  const pointer = JSON.parse(db.properties.LEAGUE_ACTIVE_SNAPSHOT);
  assert.ok(db.rows.slice(1, pointer.row - 1).every(([value]) => value === ""));
  assert.ok(db.erased.every((x) => x.id === "delete-me"));
  assert.equal(JSON.stringify(db.load()).includes("delete-me"), false);
});
