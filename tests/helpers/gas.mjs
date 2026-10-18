import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
export function harness() {
  let now = 1800000000000,
    held = false,
    failClear = false,
    fileCounter = 0;
  const files = new Map(),
    properties = {
      AUTH_SECRET: "a".repeat(64),
      AUTH_SHEET_ID: "production",
      AUTH_EMAIL_SCOPE: "kaist",
      AUTH_STORAGE_VERSION: "properties-v1",
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
      create: () => file("probe-" + ++fileCounter),
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
    "apps-script/AuthProperties.gs",
    "apps-script/StorageRotation.gs",
    "src/privacy-content.mjs",
    "server/policies.mjs",
    "server/league.mjs",
    "server/images.mjs",
    "apps-script/LeagueAdapter.gs",
    "apps-script/OwnerSetup.gs",
    "apps-script/PrivacyVerification.gs",
  ])
    vm.runInContext(
      readFileSync(new URL("../../" + path, import.meta.url), "utf8")
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
