import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { League } from "../server/league.mjs";
import { fixture } from "../dev/fixtures.mjs";
const now = Date.parse("2026-10-16T12:00:00+09:00"),
  day = 86400000;
const actor = (id, admin = false) => ({
  userId: id,
  email: id + "@kaist.ac.kr",
  admin,
});
function harness() {
  let s = fixture(now),
    time = now;
  return {
    get s() {
      return s;
    },
    time: (t) => (time = t),
    run(id, command, args = {}, admin = false) {
      const out = League.execute(
        s,
        actor(id, admin),
        command,
        {
          expectedRevision: s.revision,
          matchVersion: s.matches.find((m) => m.id === args.matchId)?.version,
          ...args,
        },
        { now: time, id: randomUUID, validateImage: () => true },
      );
      s = out.state;
      return out.result;
    },
  };
}
const ids = (t) =>
  t === "t1"
    ? ["p1", "p2", "p3", "p4", "p5", "p6"]
    : ["p7", "p8", "p9", "p10", "p11", "p12"];
const submit = (t, score = { a: 2, b: 1 }) => ({
  teamId: t,
  matchId: "m-result",
  score,
  roster: ids(t),
  goals: { [t === "t1" ? "p1" : "p7"]: t === "t1" ? score.a : score.b },
  confirmed: true,
});
function ready(h, score) {
  h.run("p1", "submitResult", submit("t1", score));
  h.run("p7", "submitResult", submit("t2", score));
  h.run("p2", "confirmResult", { teamId: "t1", matchId: "m-result" });
}
test("only current representatives can invite and see team-private invitations and independent unread state", () => {
  const h = harness();
  assert.throws(
    () =>
      h.run("p3", "inviteMatch", {
        teamId: "t1",
        opponentId: "t2",
        message: "비공개 제안 본문 4821",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  const id = h.run("p2", "inviteMatch", {
    teamId: "t1",
    opponentId: "t2",
    message: "비공개 제안 본문 4821",
  }).entityId;
  assert.equal(League.privateView(h.s, actor("p7")).invitations[0].id, id);
  assert.equal(League.privateView(h.s, actor("p8")).invitations.length, 1);
  assert.deepEqual(League.privateView(h.s, actor("p9")).invitations, []);
  assert.deepEqual(League.privateView(h.s, actor("p13")).invitations, []);
  assert.equal(
    JSON.stringify(League.publicView(h.s)).includes("비공개 제안 본문 4821"),
    false,
  );
  const n = h.s.notifications[0];
  h.run("p8", "readNotification", { notificationId: n.id });
  assert.deepEqual(h.s.notifications[0].readBy, ["p8"]);
  assert.throws(
    () => h.run("p1", "readNotification", { notificationId: n.id }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p1", "leaveTeam");
  assert.deepEqual(League.privateView(h.s, actor("p1")).invitations, []);
});
test("duplicate invitations, wrong-side responses and rapid repeat requests are blocked; acceptance creates no match or email", () => {
  const h = harness(),
    initial = h.s.matches.length,
    ledger = League.records(h.s).ledger;
  const id = h.run("p1", "inviteMatch", {
    teamId: "t1",
    opponentId: "t2",
    message: "일정을 협의해요.",
  }).entityId;
  assert.throws(
    () =>
      h.run("p7", "inviteMatch", {
        teamId: "t2",
        opponentId: "t1",
        message: "반대 방향",
      }),
    (e) => e.code === "ALREADY_REQUESTED",
  );
  assert.throws(
    () =>
      h.run("p1", "respondInvitation", {
        invitationId: id,
        response: "accept",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p8", "respondInvitation", { invitationId: id, response: "accept" });
  assert.equal(h.s.invitations[0].status, "accepted");
  assert.equal(h.s.matches.length, initial);
  assert.equal(h.s.outbox.length, 0);
  assert.deepEqual(League.records(h.s).ledger, ledger);
  assert.throws(
    () =>
      h.run("p2", "respondInvitation", {
        invitationId: id,
        response: "cancel",
      }),
    (e) => e.code === "INVALID_STATE",
  );
  assert.throws(
    () =>
      h.run("p2", "inviteMatch", {
        teamId: "t1",
        opponentId: "t2",
        message: "재요청",
      }),
    (e) => e.code === "RATE_LIMITED",
  );
});
test("required public consent is enforced independently and birthday input is never stored", () => {
  const h = harness(),
    base = {
      name: "새 선수",
      lab: "합성 연구실",
      identifier: "NEW",
      eligibility: "graduate",
      department: "ISE",
      advisor: "교수",
      consent: true,
      consentVersion: h.s.settings.privacyVersion,
      publicConsentVersion: h.s.settings.publicConsentVersion,
      birthday: "1990-01-01",
    };
  assert.throws(
    () => h.run("new", "registerPlayer", base),
    (e) => e.code === "PUBLIC_CONSENT_REQUIRED",
  );
  h.run("new", "registerPlayer", { ...base, publicConsent: true });
  const p = h.s.profiles.at(-1);
  assert.equal("birthday" in p, false);
  assert.ok(p.publicConsentedAt);
  assert.equal(p.publicConsentVersion, h.s.settings.publicConsentVersion);
  h.s.settings.registrationOpen = false;
  assert.throws(
    () => h.run("new2", "registerPlayer", { ...base, publicConsent: true }),
    (e) => e.code === "REGISTRATION_CLOSED",
  );
});
test("own goals require matching cross-team accounting and never increase personal scoring", () => {
  const h = harness();
  h.run("p1", "submitResult", {
    ...submit("t1", { a: 2, b: 1 }),
    goals: { p1: 1 },
  });
  h.run("p7", "submitResult", submit("t2", { a: 2, b: 1 }));
  assert.equal(h.s.matches[1].status, "mismatch");
  h.run("p8", "submitResult", {
    ...submit("t2", { a: 2, b: 1 }),
    ownGoals: { p8: 1 },
  });
  h.run("p2", "confirmResult", { teamId: "t1", matchId: "m-result" });
  h.run("p19", "finalize", { matchId: "m-result" });
  assert.equal(League.records(h.s).scorers.find((p) => p.id === "p1").goals, 3);
  assert.equal(
    League.records(h.s).scorers.some((p) => p.id === "p8"),
    false,
  );
  assert.throws(
    () => h.run("p1", "submitResult", { ...submit("t1"), ownGoals: { p7: 1 } }),
    (e) => e.code === "FINAL_IMMUTABLE",
  );
});
test("new schedules require both own rosters and a referee, and an agreement resets referee acceptance on changes", () => {
  const h = harness(),
    m = h.run("p1", "schedule", {
      teamId: "t1",
      opponentId: "t2",
      startsAt: now + 3 * day,
      place: "구장",
      roster: ids("t1"),
      refereeIds: ["p19", "p20"],
    }).entityId;
  h.run("p19", "acceptReferee", { matchId: m });
  assert.equal(h.s.matches.at(-1).status, "awaiting_opponent");
  h.run("p8", "setRoster", { teamId: "t2", matchId: m, roster: ids("t2") });
  assert.equal(h.s.matches.at(-1).status, "scheduled");
  h.run("p2", "proposeScheduleChange", {
    teamId: "t1",
    matchId: m,
    startsAt: now + 4 * day,
    place: "새 구장",
  });
  assert.equal(h.s.matches.at(-1).startsAt, now + 3 * day);
  assert.throws(
    () =>
      h.run("p1", "respondScheduleChange", {
        teamId: "t1",
        matchId: m,
        accepted: true,
      }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p7", "respondScheduleChange", {
    teamId: "t2",
    matchId: m,
    accepted: true,
  });
  assert.equal(h.s.matches.at(-1).startsAt, now + 4 * day);
  assert.equal(h.s.matches.at(-1).refereeId, null);
  assert.deepEqual(h.s.matches.at(-1).scheduleConfirmations, {});
  assert.equal(h.s.matches.at(-1).refereeRequests[0].status, "pending");
});
test("late roster edits and result participants not on the pre-match roster are rejected", () => {
  const h = harness();
  assert.throws(
    () =>
      h.run("p1", "setRoster", {
        teamId: "t1",
        matchId: "m-result",
        roster: ids("t1"),
      }),
    (e) => e.code === "ROSTER_CLOSED",
  );
  h.run("p1", "recruit", { teamId: "t1", playerId: "p21" });
  assert.throws(
    () =>
      h.run("p1", "submitResult", {
        ...submit("t1"),
        roster: ["p1", "p2", "p3", "p4", "p21"],
      }),
    (e) => e.code === "ROSTER_CLOSED",
  );
});
test("cancellation requires the other representative and excludes all match statistics", () => {
  const h = harness(),
    m = "m-request";
  h.run("p1", "requestCancellation", {
    teamId: "t1",
    matchId: m,
    reason: "구장 사정",
  });
  assert.equal(h.s.matches[2].status, "awaiting_referee");
  assert.throws(
    () =>
      h.run("p2", "respondCancellation", {
        teamId: "t1",
        matchId: m,
        accepted: true,
      }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run("p8", "respondCancellation", {
    teamId: "t2",
    matchId: m,
    accepted: true,
  });
  assert.equal(h.s.matches[2].status, "cancelled");
  assert.equal(League.records(h.s).ledger.length, 1);
  assert.throws(
    () => h.run("p19", "acceptReferee", { matchId: m }),
    (e) => e.code === "INVALID_STATE",
  );
});
test("incident reports require participants, lateness does not auto-forfeit, and only admins decide exceptions", () => {
  const h = harness();
  assert.throws(
    () =>
      h.run("p3", "reportIncident", {
        matchId: "m-result",
        kind: "abandoned",
        reason: "중단",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  assert.throws(
    () =>
      h.run("p1", "reportIncident", {
        matchId: "m-request",
        kind: "no_show",
        reason: "불참",
      }),
    (e) => e.code === "TOO_EARLY",
  );
  h.run("p19", "reportIncident", {
    matchId: "m-result",
    kind: "abandoned",
    reason: "경기장 폐쇄",
  });
  assert.equal(h.s.matches[1].status, "review");
  assert.throws(
    () =>
      h.run("p1", "resolveIncident", {
        matchId: "m-result",
        outcome: "forfeit",
        winnerId: "t1",
        reason: "확인",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run(
    "admin",
    "resolveIncident",
    {
      matchId: "m-result",
      outcome: "forfeit",
      winnerId: "t1",
      reason: "심판과 양 팀 자료 확인",
    },
    true,
  );
  assert.deepEqual(h.s.matches[1].administrativeScore, { a: 3, b: 0 });
  assert.equal(League.records(h.s).ledger.length, 1);
});
test("corrections keep the old official result until both teams and assigned referee approve the new version", () => {
  const h = harness();
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  const before = League.records(h.s);
  h.run("p2", "requestFinalCorrection", {
    matchId: "m-result",
    reason: "스코어 오기",
  });
  assert.equal(h.s.matches[1].status, "final");
  assert.deepEqual(League.records(h.s), before);
  h.run(
    "admin",
    "requestCorrection",
    { matchId: "m-result", reason: "양 팀 자료 확인 후 정정" },
    true,
  );
  assert.deepEqual(League.records(h.s), before);
  h.run("p1", "submitResult", submit("t1", { a: 0, b: 1 }));
  h.run("p7", "submitResult", submit("t2", { a: 0, b: 1 }));
  assert.throws(
    () => h.run("p19", "finalize", { matchId: "m-result" }),
    (e) => e.code === "RESULT_NOT_READY",
  );
  h.run("p2", "confirmResult", { teamId: "t1", matchId: "m-result" });
  h.run("p19", "finalize", { matchId: "m-result" });
  assert.equal(League.records(h.s).ledger.length, 2);
  assert.ok(
    League.records(h.s).teams.find((t) => t.id === "t1").rating <
      before.teams.find((t) => t.id === "t1").rating,
  );
  const ledger = League.records(h.s).ledger;
  h.run("p19", "finalize", { matchId: "m-result" });
  assert.deepEqual(League.records(h.s).ledger, ledger);
});
test("late correction requests are refused and deadline reminders never auto-approve", () => {
  const h = harness();
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  h.time(now + 8 * day);
  assert.throws(
    () =>
      h.run("p1", "requestFinalCorrection", {
        matchId: "m-result",
        reason: "늦은 정정",
      }),
    (e) => e.code === "CORRECTION_CLOSED",
  );
  const pending = h.s.matches[2];
  League.maintain(h.s, now + 8 * day);
  assert.notEqual(pending.status, "final");
  assert.ok(h.s.outbox.some((j) => j.kind === "resultOverdue"));
  const count = h.s.outbox.length;
  League.maintain(h.s, now + 8 * day + 1000);
  assert.equal(h.s.outbox.length, count);
});
test("account withdrawal removes identity across history and rosters while preserving team scores and Elo", () => {
  const h = harness();
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  h.run("p1", "inviteMatch", {
    teamId: "t1",
    opponentId: "t2",
    message: "선수 01의 제안",
  });
  const scores = League.records(h.s).ledger;
  const out = h.run("p1", "withdrawAccount", { confirmed: true });
  assert.equal(out.withdrawn, true);
  const raw = JSON.stringify(h.s);
  assert.equal(raw.includes('"p1"'), false);
  assert.equal(raw.includes("테스트 선수 01"), false);
  assert.equal(raw.includes('TEST1"'), false);
  assert.equal(raw.includes("synthetic-1@"), false);
  assert.equal(h.s.teams[0].captainId, null);
  assert.equal(League.records(h.s).ledger.length, scores.length);
  assert.deepEqual(League.records(h.s).ledger, scores);
  assert.equal(
    League.records(h.s).scorers.some((p) => p.id === "p1"),
    false,
  );
  assert.equal(h.s.invitations.length, 0);
});
test("red cards impose one subsequent official game ban and a correction can remove it", () => {
  const h = harness();
  h.run("p1", "submitResult", { ...submit("t1"), redCards: ["p3"] });
  h.run("p7", "submitResult", submit("t2"));
  h.run("p2", "confirmResult", { teamId: "t1", matchId: "m-result" });
  h.run("p19", "finalize", { matchId: "m-result" });
  assert.throws(
    () =>
      h.run("p1", "setRoster", {
        teamId: "t1",
        matchId: "m-request",
        roster: ids("t1"),
      }),
    (e) => e.code === "PLAYER_SUSPENDED",
  );
  h.run("p1", "setRoster", {
    teamId: "t1",
    matchId: "m-request",
    roster: ["p1", "p2", "p4", "p5", "p6"],
  });
  h.run("p2", "requestFinalCorrection", {
    matchId: "m-result",
    reason: "퇴장 기록 오기",
  });
  h.run(
    "admin",
    "requestCorrection",
    { matchId: "m-result", reason: "심판 확인" },
    true,
  );
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  assert.equal(h.s.sanctions.length, 0);
});
test("retention removes old operational data and personal season records without altering team Elo", () => {
  const h = harness(),
    before = League.records(h.s).ledger;
  h.s.audit.push({ at: now - 91 * day, actorId: "p1" });
  h.s.settings.seasonEndsAt = now - 3 * 365 * day;
  League.maintain(h.s, now);
  assert.equal(h.s.audit.length, 0);
  assert.deepEqual(h.s.matches[0].submissions.t1.players, []);
  assert.equal(League.records(h.s).scorers.length, 0);
  assert.deepEqual(League.records(h.s).ledger, before);
});

test("only operators can admit serious late corrections and record additional sanctions", () => {
  const h = harness();
  ready(h);
  h.run("p19", "finalize", { matchId: "m-result" });
  h.time(now + 8 * day);
  assert.throws(
    () =>
      h.run("p1", "requestFinalCorrection", {
        matchId: "m-result",
        serious: true,
        reason: "기한 후 요청",
      }),
    (e) => e.code === "CORRECTION_CLOSED",
  );
  h.run(
    "admin",
    "requestFinalCorrection",
    {
      matchId: "m-result",
      serious: true,
      reason: "중대한 부정 출전 증거를 확인",
    },
    true,
  );
  assert.equal(h.s.issues.at(-1).type, "correction");
  assert.throws(
    () =>
      h.run("p2", "recordSanction", {
        playerId: "p4",
        games: 2,
        reason: "추가 징계",
      }),
    (e) => e.code === "FORBIDDEN",
  );
  h.run(
    "admin",
    "recordSanction",
    { playerId: "p4", games: 2, reason: "위원 검토 사유 기록" },
    true,
  );
  assert.equal(h.s.sanctions.at(-1).remaining, 2);
});
test("season expiry remains enforceable after rolling to a new season", () => {
  const h = harness();
  h.s.settings.seasonEndsAt = now - day;
  League.maintain(h.s, now);
  h.s.settings.seasonId = "next";
  h.s.settings.seasonEndsAt = null;
  League.maintain(h.s, now + 3 * 365 * day);
  assert.equal(h.s.matches[0].personalRecordsExpired, true);
  assert.equal(h.s.matches[0].submissions.t1.players.length, 0);
});
