import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "../dev/fixtures.mjs";
import { League } from "../server/league.mjs";
import { validateTeamImage } from "../server/images.mjs";
const now = Date.parse("2026-10-16T12:00:00+09:00");
const actor = (id, admin = false) => ({
  userId: id,
  email: id + "@kaist.ac.kr",
  admin,
});
function harness() {
  let state = fixture(now),
    time = now;
  return {
    get s() {
      return state;
    },
    time: (t) => (time = t),
    run(id, command, args = {}, isAdmin = false) {
      const m = state.matches.find((m) => m.id === args.matchId);
      const out = League.execute(
        state,
        actor(id, isAdmin),
        command,
        { expectedRevision: state.revision, matchVersion: m?.version, ...args },
        {
          now: time,
          id: randomUUID,
          validateImage: (data) =>
            validateTeamImage(data, (b) => [...Buffer.from(b, "base64")]),
        },
      );
      state = out.state;
      return out.result;
    },
  };
}
const result = (teamId = "t1", score = { a: 2, b: 1 }) => ({
  teamId,
  matchId: "m-result",
  score,
  roster: Array.from(
    { length: 6 },
    (_, i) => "p" + (teamId === "t1" ? i + 1 : i + 7),
  ),
  goals: teamId === "t1" ? { p1: score.a } : { p7: score.b },
  confirmed: true,
});
function ready(h, score = { a: 2, b: 1 }) {
  h.run("p1", "submitResult", result("t1", score));
  h.run("p8", "submitResult", result("t2", score));
  h.run("p2", "confirmResult", { teamId: "t1", matchId: "m-result" });
}
test("team amendments can be resubmitted only by the original applicant", () => {
  const h = harness(),
    args = {
      name: "보완팀",
      description: "합성 팀",
      members: ["p19", "p20", "p21", "p22", "p23", "p24"],
      captainId: "p19",
      viceId: "p20",
    };
  const id = h.run("p19", "createTeam", args).entityId;
  assert.throws(
    () => h.run("p19", "createTeam", { ...args, name: "중복 신청" }),
    (e) => e.code === "APPLICATION_EXISTS",
  );
  h.run(
    "admin",
    "reviewTeam",
    { teamId: id, approve: false, reason: "팀 소개를 보완해 주세요." },
    true,
  );
  assert.throws(
    () => h.run("p20", "resubmitTeam", { ...args, teamId: id }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p19", "resubmitTeam", {
    ...args,
    teamId: id,
    description: "보완한 팀 소개",
  });
  h.run("admin", "reviewTeam", { teamId: id, approve: true }, true);
  assert.equal(h.s.teams.find((t) => t.id === id).status, "active");
});
test("external acceptance can complete a held schedule; new neutral candidates can be requested", () => {
  const h = harness(),
    args = {
      teamId: "t1",
      opponentId: "t2",
      startsAt: now + 2 * 86400000,
      place: "테스트 경기장",
      roster: ["p1", "p2", "p3", "p4", "p5"],
      externalReferee: { name: "합성 외부 심판", accepted: false },
    };
  const id = h.run("p1", "schedule", args).entityId;
  assert.equal(h.s.matches.at(-1).status, "awaiting_referee");
  h.run("p2", "confirmExternalReferee", {
    teamId: "t1",
    matchId: id,
    accepted: true,
  });
  assert.equal(h.s.matches.at(-1).status, "awaiting_opponent");
  h.run("p7", "setRoster", {
    teamId: "t2",
    matchId: id,
    roster: ["p7", "p8", "p9", "p10", "p11"],
  });
  assert.equal(h.s.matches.at(-1).status, "scheduled");
  h.run("p1", "requestReferees", {
    teamId: "t1",
    matchId: "m-request",
    refereeIds: ["p13"],
  });
  assert.ok(
    h.s.matches
      .find((m) => m.id === "m-request")
      .refereeRequests.some((r) => r.playerId === "p13"),
  );
  assert.throws(
    () =>
      h.run("p1", "requestReferees", {
        teamId: "t1",
        matchId: "m-request",
        refereeIds: [],
      }),
    (e) => e.code === "REFEREE_REQUIRED",
  );
});
test("public/private projections exclude private profiles and role escalation", () => {
  const h = harness(),
    pub = JSON.stringify(League.publicView(h.s));
  assert.ok(!pub.includes("TEST7"));
  assert.ok(!pub.includes("birthday"));
  assert.ok(!pub.includes("synthetic-7@"));
  const mine = League.privateView(h.s, actor("p3"));
  assert.equal(mine.me.profile.identifier, "TEST3");
  assert.equal(mine.adminData, null);
  assert.ok(!JSON.stringify(mine).includes("TEST7"));
  assert.deepEqual(mine.matches[0].submissions, {});
  assert.throws(
    () =>
      h.run("p3", "updateTeam", {
        teamId: "t1",
        description: "변경",
        recruiting: true,
        admin: true,
      }),
    (e) => e.code === "FORBIDDEN",
  );
  assert.equal(
    League.privateView(h.s, actor("admin", true)).adminData.profiles.length,
    24,
  );
});
test("registration immediately accepts advisor eligibility and staff needs no advisor", () => {
  const h = harness(),
    base = {
      name: "합성 신규 선수",
      lab: "합성 연구실",
      identifier: "NEW001",
      eligibility: "advisor",
      department: "기계공학과",
      advisor: "합성 교수",
      advisorDepartment: "ISE",
      consent: true,
      consentVersion: "synthetic-v1",
      publicConsent: true,
      publicConsentVersion: h.s.settings.publicConsentVersion,
    };
  h.run("new1", "registerPlayer", base);
  assert.equal(h.s.players.at(-1).id, "new1");
  assert.equal(h.s.profiles.at(-1).department, "기계공학과");
  h.run("new2", "registerPlayer", {
    ...base,
    eligibility: "staff",
    identifier: "EMP001",
    department: "GSDS",
    advisor: "",
  });
  assert.equal(h.s.profiles.at(-1).advisor, "해당 없음");
  assert.throws(
    () =>
      h.run("new3", "registerPlayer", {
        ...base,
        identifier: "NEW003",
        advisorDepartment: "기계공학과",
      }),
    (e) => e.code === "INELIGIBLE",
  );
  assert.throws(
    () =>
      h.run("new4", "registerPlayer", {
        ...base,
        identifier: "NEW004",
        consent: false,
      }),
    (e) => e.code === "CONSENT_REQUIRED",
  );
  assert.throws(
    () => h.run("new5", "registerPlayer", { ...base, publicConsent: false }),
    (e) => e.code === "PUBLIC_CONSENT_REQUIRED",
  );
  assert.throws(
    () => h.run("new6", "registerPlayer", base),
    (e) => e.code === "DUPLICATE_IDENTIFIER",
  );
});
test("privacy gate blocks real collection even when API called directly", () => {
  const h = harness();
  h.s.settings.registrationOpen = false;
  assert.throws(
    () => h.run("new", "registerPlayer", {}),
    (e) => e.code === "REGISTRATION_CLOSED",
  );
  assert.equal(h.s.players.length, 24);
});
test("pending team memberships only apply on approval; competing approvals recheck affiliation", () => {
  const h = harness(),
    args = {
      name: "신규팀 A",
      description: "합성팀 소개",
      members: ["p19", "p20", "p21", "p22", "p23", "p24"],
      captainId: "p19",
      viceId: "p20",
    };
  const a = h.run("p19", "createTeam", args).entityId;
  const b = h.run("p20", "createTeam", { ...args, name: "신규팀 B" }).entityId;
  assert.equal(League.publicView(h.s).teams.length, 3);
  h.run("admin", "reviewTeam", { teamId: a, approve: true }, true);
  assert.throws(
    () => h.run("admin", "reviewTeam", { teamId: b, approve: true }, true),
    (e) => e.code === "ALREADY_MEMBER",
  );
  assert.equal(h.s.teams.find((t) => t.id === a).members.length, 6);
});
test("single membership, capacity and stale writes are enforced on the server", () => {
  const h = harness();
  h.run("p1", "recruit", { teamId: "t1", playerId: "p21" });
  assert.throws(
    () => h.run("p7", "recruit", { teamId: "t2", playerId: "p21" }),
    (e) => e.code === "ALREADY_MEMBER",
  );
  assert.throws(
    () =>
      h.run("p1", "recruit", {
        teamId: "t1",
        playerId: "p22",
        expectedRevision: 0,
      }),
    (e) => e.code === "STALE",
  );
  const t = h.s.teams[0];
  t.members = Array.from({ length: 20 }, (_, i) =>
    i < 6 ? "p" + (i + 1) : "capacity" + i,
  );
  assert.throws(
    () => h.run("p1", "recruit", { teamId: "t1", playerId: "p22" }),
    (e) => e.code === "TEAM_FULL",
  );
});
test("leaving is immediate, revokes leader rights and retains history; grace restores/expires", () => {
  const h = harness();
  h.run("p1", "leaveTeam");
  const t = h.s.teams[0];
  assert.equal(t.captainId, null);
  assert.equal(t.status, "paused");
  assert.equal(t.graceEndsAt, now + 60 * 86400000);
  assert.ok(!t.members.includes("p1"));
  assert.equal(h.s.matches[0].submissions.t1.goals.p1, 2);
  assert.throws(
    () => h.run("p1", "updateTeam", { teamId: "t1", description: "변경" }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p2", "recruit", { teamId: "t1", playerId: "p21" });
  assert.equal(h.s.teams[0].status, "active");
  h.run("p2", "release", { teamId: "t1", playerId: "p6" });
  League.maintain(h.s, now + 61 * 86400000);
  assert.equal(h.s.teams[0].status, "excluded");
  assert.equal(League.records(h.s).ledger.length, 1);
});
test("leaders retain rights until admin approval and departed candidates cannot be approved", () => {
  const h = harness();
  h.run("p1", "requestLeaders", {
    teamId: "t1",
    captainId: "p3",
    viceId: "p4",
  });
  const r = h.s.requests.at(-1);
  assert.equal(h.s.teams[0].captainId, "p1");
  h.run("p3", "leaveTeam");
  assert.throws(
    () =>
      h.run("admin", "reviewLeaders", { requestId: r.id, approve: true }, true),
    (e) => e.code === "INVALID_LEADERS",
  );
});
test("multiple neutral referee requests reserve one assignee; late accept cannot replace it", () => {
  const h = harness();
  h.run("p19", "acceptReferee", { matchId: "m-request" });
  assert.equal(h.s.matches[2].refereeId, "p19");
  assert.equal(h.s.matches[2].status, "scheduled");
  assert.throws(
    () => h.run("p20", "acceptReferee", { matchId: "m-request" }),
    (e) => e.code === "REFEREE_ASSIGNED",
  );
  assert.equal(
    h.s.matches[2].refereeRequests.find((r) => r.playerId === "p20").status,
    "closed",
  );
});
test("schedule rejects team referees, wrong rosters, duplicate games; holds unassigned games", () => {
  const h = harness(),
    args = {
      teamId: "t1",
      opponentId: "t2",
      startsAt: now + 2 * 86400000,
      place: "합성 풋살장",
      roster: ["p1", "p2", "p3", "p4", "p5", "p6"],
      refereeIds: ["p1"],
    };
  assert.throws(
    () => h.run("p1", "schedule", args),
    (e) => e.code === "NON_NEUTRAL_REFEREE",
  );
  assert.throws(
    () =>
      h.run("p1", "schedule", {
        ...args,
        roster: ["p7", "p2", "p3", "p4", "p5"],
        refereeIds: ["p19"],
      }),
    (e) => e.code === "INVALID_ROSTER",
  );
  const id = h.run("p1", "schedule", {
    ...args,
    refereeIds: ["p19", "p20"],
  }).entityId;
  assert.equal(h.s.matches.find((m) => m.id === id).status, "awaiting_referee");
  assert.equal(h.s.outbox.filter((j) => j.kind === "refereeRequest").length, 2);
  assert.throws(
    () => h.run("p1", "schedule", { ...args, refereeIds: ["p19"] }),
    (e) => e.code === "DUPLICATE_MATCH",
  );
});
test("only own teams/actual participants can submit records; score totals must match", () => {
  const h = harness();
  assert.throws(
    () => h.run("p13", "submitResult", result()),
    (e) => e.code === "FORBIDDEN",
  );
  assert.throws(
    () => h.run("p1", "submitResult", { ...result(), goals: { p7: 2 } }),
    (e) => e.code === "INVALID_SCORER",
  );
  assert.throws(
    () => h.run("p1", "submitResult", { ...result(), goals: { p1: 3 } }),
    (e) => e.code === "GOAL_TOTAL",
  );
  assert.throws(
    () => h.run("p1", "submitResult", { ...result(), confirmed: false }),
    (e) => e.code === "CONFIRMATION_REQUIRED",
  );
});
test("score mismatch is preserved, not finalized, and queues admin notification", () => {
  const h = harness();
  h.run("p1", "submitResult", result());
  h.run("p7", "submitResult", result("t2", { a: 2, b: 3 }));
  const m = h.s.matches[1];
  assert.equal(m.status, "mismatch");
  assert.equal(m.submissions.t1.score.b, 1);
  assert.equal(m.submissions.t2.score.b, 3);
  assert.ok(h.s.outbox.some((j) => j.kind === "scoreMismatch"));
  assert.throws(
    () => h.run("p19", "finalize", { matchId: m.id }),
    (e) => e.code === "RESULT_NOT_READY",
  );
  assert.equal(League.records(h.s).ledger.length, 1);
});
test("record edits invalidate both approvals; stale final approval and disputes cannot finalize", () => {
  const h = harness();
  ready(h);
  const old = h.s.matches[1].version;
  h.run("p2", "submitResult", result());
  assert.equal(h.s.matches[1].status, "awaiting_confirmations");
  assert.throws(
    () => h.run("p19", "finalize", { matchId: "m-result", matchVersion: old }),
    (e) => e.code === "STALE_MATCH",
  );
  h.run("p8", "confirmResult", { teamId: "t2", matchId: "m-result" });
  h.run("p19", "dispute", {
    matchId: "m-result",
    message: "득점 확인이 필요합니다.",
  });
  assert.throws(
    () => h.run("p19", "finalize", { matchId: "m-result" }),
    (e) => e.code === "RESULT_NOT_READY",
  );
  h.run(
    "admin",
    "resolveIssue",
    {
      issueId: h.s.issues.at(-1).id,
      reason: "양 팀이 최신 기록을 재확인해 주세요.",
    },
    true,
  );
  assert.deepEqual(h.s.matches[1].confirmations, {});
});
test("assigned internal referee finalizes once; no duplicate Elo, PK is final win only", () => {
  const h = harness();
  ready(h, { a: 2, b: 2, pkA: 4, pkB: 3 });
  assert.throws(
    () => h.run("p20", "finalize", { matchId: "m-result" }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p19", "finalize", { matchId: "m-result" });
  const records = League.records(h.s),
    rating = records.teams.find((t) => t.id === "t1").rating;
  assert.ok(rating > 1016);
  assert.equal(h.s.ratingLedger.length, 2);
  assert.equal(records.scorers.find((p) => p.id === "p1").goals, 4);
  h.run("p19", "finalize", { matchId: "m-result", expectedRevision: 0 });
  assert.equal(
    League.records(h.s).teams.find((t) => t.id === "t1").rating,
    rating,
  );
  assert.equal(h.s.ratingLedger.length, 2);
});
test("external referee results require admin and explicit external verification", () => {
  const h = harness();
  h.s.matches[1].refereeId = null;
  h.s.matches[1].externalReferee = { name: "합성 외부 심판", accepted: true };
  ready(h);
  assert.throws(
    () =>
      h.run("p19", "finalize", {
        matchId: "m-result",
        externalConfirmed: true,
      }),
    (e) => e.code === "FORBIDDEN",
  );
  assert.throws(
    () => h.run("admin", "finalize", { matchId: "m-result" }, true),
    (e) => e.code === "EXTERNAL_CONFIRMATION_REQUIRED",
  );
  h.run(
    "admin",
    "finalize",
    { matchId: "m-result", externalConfirmed: true },
    true,
  );
  assert.equal(h.s.matches[1].status, "final");
  assert.equal(League.records(h.s).referees[0].count, 1);
});
test("Elo is precise, score-margin independent and replay order is chronological", () => {
  const h = harness(),
    a = League.records(h.s);
  assert.equal(a.teams.find((t) => t.id === "t1").rating, 1016);
  assert.equal(a.teams.find((t) => t.id === "t2").rating, 984);
  const s = structuredClone(h.s);
  s.matches[0].submissions.t1.score.a = 90;
  assert.equal(League.records(s).teams.find((t) => t.id === "t1").rating, 1016);
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  const first = League.records(h.s);
  h.s.matches.reverse();
  assert.deepEqual(League.records(h.s), first);
  assert.ok(
    Math.abs(first.teams.reduce((n, t) => n + t.rating, 0) - 3000) < 1e-9,
  );
});
test("personal recent five games are per appearance and preserve tied third place", () => {
  const h = harness(),
    template = structuredClone(h.s.matches[0]);
  h.s.matches = [];
  for (let i = 0; i < 7; i++) {
    const m = structuredClone(template);
    m.id = "history" + i;
    m.startsAt = now - (8 - i) * 86400000;
    m.submissions.t1.players = template.submissions.t1.players.filter(
      (p) => (p.id !== "p3" || i < 2) && (p.id !== "p4" || i < 4),
    );
    m.submissions.t1.goals = {
      p1: 1,
      p2: 1,
      ...(i < 2 ? { p3: 2 } : {}),
      ...(i < 4 ? { p4: 1 } : {}),
      p5: 0,
    };
    m.submissions.t2.goals = {};
    const score = {
      a: Object.values(m.submissions.t1.goals).reduce((a, b) => a + b, 0),
      b: 0,
      pkA: null,
      pkB: null,
    };
    m.submissions.t1.score = score;
    m.submissions.t2.score = score;
    h.s.matches.push(m);
  }
  const r = League.records(h.s);
  assert.equal(r.scorers.find((p) => p.id === "p1").goals, 5);
  assert.equal(r.scorers.find((p) => p.id === "p3").appearances, 2);
  assert.equal(r.scorers.find((p) => p.id === "p3").goals, 4);
  assert.ok(r.scorers.every((p) => p.goals > 0));
});
test("team image validation rejects SVG/forged MIME/oversized and accepts real tiny PNG", () => {
  const decode = (b) => [...Buffer.from(b, "base64")];
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  assert.equal(validateTeamImage(png, decode), true);
  assert.equal(
    validateTeamImage(png.replace("image/png", "image/jpeg"), decode),
    false,
  );
  assert.equal(
    validateTeamImage("data:image/svg+xml;base64,PHN2Zz4=", decode),
    false,
  );
  assert.equal(
    validateTeamImage("data:image/png;base64," + "A".repeat(220000), decode),
    false,
  );
});
