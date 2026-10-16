import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("persistent local API serializes simultaneous acceptances, rejects forged roles and cross-origin writes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "igfl-test-")),
    file = join(dir, "db.json");
  let child;
  t.after(async () => {
    child?.kill();
    await rm(dir, { recursive: true, force: true });
  });
  async function start() {
    child = spawn(process.execPath, ["scripts/dev.mjs"], {
      env: { ...process.env, IGFL_DEV_PORT: "0", IGFL_DEV_DATA_PATH: file },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("API startup timed out")),
        10000,
      );
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
  }
  let origin = await start();
  const call = async (body) => {
    const r = await fetch(origin + "/dev-api", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  };
  const one = (await call({ operation: "select", id: "p19" })).data.token,
    two = (await call({ operation: "select", id: "p20" })).data.token;
  const responses = await Promise.all(
    [one, two].map((token) =>
      call({
        operation: "command",
        token,
        command: "acceptReferee",
        args: { matchId: "m-request", matchVersion: 1, expectedRevision: 0 },
      }),
    ),
  );
  assert.equal(responses.filter((r) => r.ok).length, 1);
  assert.equal(responses.find((r) => !r.ok).error.code, "STALE");
  const saved = JSON.parse(await readFile(file, "utf8")),
    winner = saved.matches.find((m) => m.id === "m-request").refereeId;
  assert.ok(["p19", "p20"].includes(winner));
  const forged = await call({
    operation: "command",
    token: "not-a-session",
    admin: true,
    command: "reviewTeam",
    args: { teamId: "t1", approve: true, expectedRevision: 1 },
  });
  assert.equal(forged.error.code, "UNAUTHENTICATED");
  const publicView = await call({ operation: "view" });
  assert.ok(!JSON.stringify(publicView).includes("TEST1"));
  assert.ok(!publicView.data.me);
  const csrf = await fetch(origin + "/dev-api", {
    method: "POST",
    headers: {
      Origin: "https://example.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(csrf.status, 400);
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  origin = await start();
  const token = (await call({ operation: "select", id: winner })).data.token;
  const view = (await call({ operation: "view", token })).data;
  assert.equal(
    view.matches.find((m) => m.id === "m-request").refereeId,
    winner,
  );
});
