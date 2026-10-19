import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fixture } from "../dev/fixtures.mjs";
import { League } from "../server/league.mjs";
import { COMPETITION } from "../src/competition.mjs";
import { harness as gas } from "./helpers/gas.mjs";
const now = Date.parse("2026-11-01T12:00:00+09:00");
const rosterA = ["p1", "p2", "p3", "p4", "p5", "p6"];
const rosterB = ["p7", "p8", "p9", "p10", "p11", "p12"];
function scenario() {
  let s = fixture(now),
    time = now,
    counter = 0;
  s.matches = [];
  s.issues = [];
  s.outbox = [];
  s.notifications = [];
  Object.assign(s.settings, {
    competitionPhase: "preseason",
    seasonId: COMPETITION.preseasonId,
    seasonName: COMPETITION.preseasonName,
  });
  const h = {
    get s() {
      return s;
    },
    time(t) {
      time = t;
    },
    run(userId, command, args = {}) {
      const m = s.matches.find((m) => m.id === args.matchId);
      const out = League.execute(
        s,
        {
          userId,
          email: userId + "@example.invalid",
          admin: userId === "admin",
        },
        command,
        { expectedRevision: s.revision, matchVersion: m?.version, ...args },
        { now: time, id: () => "pre-" + ++counter },
      );
      s = out.state;
      return out.result;
    },
    schedule(extra = {}) {
      return h.run("p1", "schedule", {
        teamId: "t1",
        opponentId: "t2",
        startsAt: now + 3600000,
        place: "합성 경기장",
        roster: rosterA,
        playersPerSide: 6,
        halfMinutes: 15,
        refereeMode: "none",
        refereeIds: [],
        ...extra,
      }).entityId;
    },
    result(id, teamId, score = { a: 2, b: 1 }) {
      return h.run(teamId === "t1" ? "p1" : "p7", "submitResult", {
        matchId: id,
        teamId,
        roster: teamId === "t1" ? rosterA : rosterB,
        score,
        goals: teamId === "t1" ? { p1: score.a } : { p7: score.b },
        confirmed: true,
      });
    },
    confirm(id, teamId) {
      return h.run(teamId === "t1" ? "p2" : "p8", "confirmResult", {
        matchId: id,
        teamId,
      });
    },
  };
  return h;
}
function prepared(h, extra) {
  const id = h.schedule(extra);
  h.run("p8", "setRoster", { matchId: id, teamId: "t2", roster: rosterB });
  return id;
}
function submitted(h, id) {
  h.time(now + 3600000 + 35 * 60000);
  h.result(id, "t1");
  h.result(id, "t2");
}
test("unrefereed 6v6 15/5/15 waits for both rosters and version-bound confirmations then finalizes once", () => {
  const h = scenario(),
    id = h.schedule();
  assert.equal(h.s.matches[0].status, "awaiting_opponent");
  assert.equal(h.s.matches[0].refereeCount, 0);
  assert.equal(h.s.outbox.length, 0);
  h.run("p8", "setRoster", { matchId: id, teamId: "t2", roster: rosterB });
  assert.equal(h.s.matches[0].status, "scheduled");
  h.time(now + 3600000 + 34 * 60000);
  assert.throws(() => h.result(id, "t1"), { code: "MATCH_NOT_FINISHED" });
  submitted(h, id);
  assert.equal(h.s.matches[0].status, "awaiting_confirmations");
  assert.throws(
    () =>
      h.run("p2", "confirmResult", {
        matchId: id,
        teamId: "t1",
        matchVersion: 1,
      }),
    { code: "STALE_MATCH" },
  );
  h.confirm(id, "t1");
  const m = h.s.matches[0];
  assert.equal(m.status, "final");
  assert.equal(m.finalizationMethod, "both-team-confirmations");
  assert.equal(
    League.records(h.s).teams.find((t) => t.id === "t1").rating,
    1016,
  );
  assert.equal(League.records(h.s).referees.length, 0);
  assert.equal(h.run("p1", "finalize", { matchId: id }).alreadyFinal, true);
  assert.equal(h.s.ratingLedger.length, 1);
});
test("regular rules cannot be bypassed with preseason fields; six-a-side needs six actual players", () => {
  const h = scenario();
  assert.throws(() => h.schedule({ roster: rosterA.slice(0, 5) }), {
    code: "INVALID_ROSTER",
  });
  assert.throws(() => h.schedule({ halfMinutes: 10 }), {
    code: "INVALID_FORMAT",
  });
  assert.throws(() => h.schedule({ refereeIds: ["p19"] }), {
    code: "INVALID_FORMAT",
  });
  h.s.settings.competitionPhase = "regular";
  assert.throws(() => h.schedule({ phase: "preseason" }), {
    code: "INVALID_FORMAT",
  });
  assert.throws(
    () =>
      h.schedule({ playersPerSide: 5, halfMinutes: 20, phase: "preseason" }),
    { code: "REFEREE_REQUIRED" },
  );
  h.s.settings.competitionPhase = "preseason";
  h.s.settings.seasonEndsAt = now + 3600000 + 34 * 60000;
  assert.throws(() => h.schedule(), { code: "SEASON_ENDED" });
});
test("score disagreement and disputes block unrefereed auto-finalization until corrected and reconfirmed", () => {
  const h = scenario(),
    id = prepared(h);
  h.time(now + 7200000);
  h.result(id, "t1");
  h.result(id, "t2", { a: 3, b: 1 });
  h.confirm(id, "t1");
  assert.equal(h.s.matches[0].status, "mismatch");
  h.run("p1", "dispute", { matchId: id, message: "합성 점수 확인 요청" });
  h.result(id, "t2");
  h.confirm(id, "t1");
  assert.equal(h.s.matches[0].status, "review");
  h.run("admin", "resolveIssue", {
    issueId: h.s.issues[0].id,
    reason: "양 팀과 수정 결과 확인",
  });
  assert.notEqual(h.s.matches[0].status, "final");
  h.confirm(id, "t1");
  h.confirm(id, "t2");
  assert.equal(h.s.matches[0].status, "final");
  assert.equal(h.s.ratingLedger.length, 1);
});
test("preseason and regular Elo, goals, referee credits and delayed corrections remain isolated", () => {
  const h = scenario(),
    id = prepared(h);
  submitted(h, id);
  h.s.settings.seasonId = COMPETITION.regularId;
  h.s.settings.seasonName = COMPETITION.regularName;
  h.s.settings.competitionPhase = "regular";
  h.confirm(id, "t1");
  assert.equal(League.records(h.s).ledger.length, 0);
  assert.ok(League.records(h.s).teams.every((t) => t.rating === 1000));
  assert.equal(League.records(h.s).scorers.length, 0);
  assert.equal(
    League.records(h.s, COMPETITION.preseasonId).scorers[0].goals,
    2,
  );
  const boards = League.publicView(h.s).seasonBoards;
  assert.equal(
    boards.find((b) => b.id === COMPETITION.preseasonId).records.ledger.length,
    1,
  );
  assert.equal(
    boards.find((b) => b.id === COMPETITION.regularId).records.ledger.length,
    0,
  );
  h.run("p1", "requestFinalCorrection", {
    matchId: id,
    reason: "합성 득점 정정",
  });
  h.run("admin", "requestCorrection", { matchId: id, reason: "양 팀 재확인" });
  assert.equal(League.records(h.s, COMPETITION.preseasonId).ledger.length, 1);
  h.result(id, "t1", { a: 1, b: 2 });
  h.result(id, "t2", { a: 1, b: 2 });
  h.confirm(id, "t1");
  assert.equal(h.s.matches[0].phase, "preseason");
  assert.equal(League.records(h.s).ledger.length, 0);
  assert.equal(
    League.records(h.s, COMPETITION.preseasonId).teams.find(
      (t) => t.id === "t1",
    ).rating,
    984,
  );
  assert.equal(h.s.ratingLedger.length, 1);
});
test("refereed preseason matches retain internal and external final approval; no-ref schedules avoid referee reminders", () => {
  for (const external of [false, true]) {
    const h = scenario(),
      id = prepared(
        h,
        external
          ? {
              refereeMode: "external",
              externalReferee: { name: "합성 외부 심판", accepted: true },
            }
          : { refereeMode: "internal", refereeIds: ["p19"] },
      );
    if (!external) h.run("p19", "acceptReferee", { matchId: id });
    submitted(h, id);
    h.confirm(id, "t1");
    assert.equal(h.s.matches[0].status, "ready");
    assert.throws(() =>
      h.run("p1", "finalize", { matchId: id, externalConfirmed: true }),
    );
    h.run(external ? "admin" : "p19", "finalize", {
      matchId: id,
      externalConfirmed: true,
    });
    assert.equal(h.s.matches[0].status, "final");
    assert.equal(League.records(h.s).referees.length, external ? 0 : 1);
  }
  const h = scenario(),
    id = prepared(h);
  League.maintain(h.s, now + 60000);
  assert.equal(
    h.s.notifications.filter((n) => n.kind === "refereeUnassigned").length,
    0,
  );
  assert.throws(
    () =>
      h.run("p1", "requestReferees", {
        matchId: id,
        teamId: "t1",
        refereeIds: ["p19"],
      }),
    { code: "INVALID_STATE" },
  );
  h.run("p1", "proposeScheduleChange", {
    matchId: id,
    teamId: "t1",
    startsAt: now + 7200000,
    place: "다른 합성 경기장",
  });
  h.run("p8", "respondScheduleChange", {
    matchId: id,
    teamId: "t2",
    accepted: true,
  });
  assert.equal(h.s.matches[0].status, "awaiting_opponent");
  assert.equal(h.s.matches[0].refereeMode, "none");
  h.s.settings.seasonEndsAt = now + 86400000;
  h.run("p1", "proposeScheduleChange", {
    matchId: id,
    teamId: "t1",
    startsAt: now + 86400000,
    place: "시즌 경계 합성 경기장",
  });
  assert.throws(
    () =>
      h.run("p8", "respondScheduleChange", {
        matchId: id,
        teamId: "t2",
        accepted: true,
      }),
    { code: "SEASON_ENDED" },
  );
});
test("both seasons retain their own ledger and regular games start from 1000", () => {
  const h = scenario(),
    pre = prepared(h);
  submitted(h, pre);
  h.confirm(pre, "t1");
  Object.assign(h.s.settings, {
    seasonId: COMPETITION.regularId,
    seasonName: COMPETITION.regularName,
    competitionPhase: "regular",
  });
  const regular = prepared(h, {
    refereeMode: "internal",
    refereeIds: ["p19"],
    playersPerSide: 5,
    halfMinutes: 20,
    startsAt: now + 86400000,
  });
  h.run("p19", "acceptReferee", { matchId: regular });
  h.time(now + 86400000 + 45 * 60000);
  h.result(regular, "t1", { a: 0, b: 3 });
  h.result(regular, "t2", { a: 0, b: 3 });
  h.confirm(regular, "t1");
  h.run("p19", "finalize", { matchId: regular });
  assert.equal(h.s.ratingLedger.length, 2);
  assert.ok(
    h.s.ratingLedger.every(
      (entry) => entry.beforeA === 1000 && entry.beforeB === 1000,
    ),
  );
  assert.equal(
    League.records(h.s, COMPETITION.preseasonId).teams.find(
      (t) => t.id === "t1",
    ).rating,
    1016,
  );
  assert.equal(
    League.records(h.s).teams.find((t) => t.id === "t1").rating,
    984,
  );
  assert.equal(League.records(h.s).scorers[0].goals, 3);
  assert.equal(
    League.records(h.s, COMPETITION.preseasonId).scorers[0].goals,
    2,
  );
  assert.equal(League.records(h.s).referees[0].count, 1);
  assert.equal(League.records(h.s, COMPETITION.preseasonId).referees.length, 0);
});
test("owner preparation changes only season selection and preserves all launch gates, auth and real data", () => {
  const h = gas(),
    pointer = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  h.properties.LEAGUE_ADMIN_USER_IDS = "existing-operator";
  const status = h.c.configurePreseasonSettings();
  assert.equal(status.competitionPhase, "preseason");
  assert.equal(status.seasonOpen, false);
  assert.equal(status.registrationOpen, false);
  assert.equal(status.leagueEmailsEnabled, false);
  assert.equal(status.privacyStorageApproved, false);
  assert.equal(status.seasonEndsAt, null);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  assert.equal(h.properties.LEAGUE_ADMIN_USER_IDS, "existing-operator");
  vm.runInContext(
    'var existingState = loadLeague_(config_()); existingState.matches.push({seasonId:"legacy",phase:"regular"}); saveLeague_(config_(),existingState)',
    h.c,
  );
  assert.throws(() => h.c.configurePreseasonSettings(), {
    igflCode: "EXISTING_SEASON_REVIEW_REQUIRED",
  });
});
