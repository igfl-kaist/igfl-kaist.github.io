import { League } from "../server/league.mjs";
export function fixture(now = Date.now()) {
  const s = League.createState({
    registrationOpen: true,
    privacyVersion: "synthetic-v1",
    privacyNotice:
      "개발 검증용 합성 정보만 입력합니다. 실제 개인정보를 입력하지 마세요.",
    seasonOpen: true,
    seasonId: "test-2026",
    seasonName: "2026 테스트 시즌",
  });
  const labs = [
    "데이터시스템 연구실",
    "산업최적화 연구실",
    "의사결정 연구실",
    "인공지능 연구실",
  ];
  for (let i = 1; i <= 24; i++) {
    const id = `p${i}`;
    s.players.push({
      id,
      name: `테스트 선수 ${String(i).padStart(2, "0")}`,
      lab: labs[(i - 1) % 4],
      referee: [1, 13, 19, 20].includes(i),
    });
    s.profiles.push({
      id,
      email: `synthetic-${i}@example.invalid`,
      identifier: `TEST${i}`,
      eligibility: i === 23 ? "staff" : "graduate",
      department: "ISE",
      advisor: i === 23 ? "해당 없음" : "테스트 교수",
      consentVersion: "synthetic-v1",
      consentedAt: now - 86400000,
      publicConsentVersion: s.settings.publicConsentVersion,
      publicConsentedAt: now - 86400000,
    });
  }
  for (let n = 0; n < 3; n++) {
    const ids = Array.from({ length: 6 }, (_, i) => `p${n * 6 + i + 1}`);
    const t = {
      id: `t${n + 1}`,
      name: ["데이터킥", "옵티마이저스", "랩 유나이티드"][n],
      description: [
        "연구실 밖에서 공으로 연결되는 팀이에요. 함께할 팀원을 기다려요.",
        "최선의 패스를 찾아, 함께 뛰어요.",
        "서로 다른 연구실, 하나의 팀. 즐겁게 경기해요.",
      ][n],
      members: ids,
      captainId: ids[0],
      viceId: ids[1],
      status: "active",
      recruiting: n !== 1,
      createdAt: now - 10 * 86400000,
    };
    s.teams.push(t);
    ids.forEach((id) =>
      s.memberships.push({
        playerId: id,
        teamId: t.id,
        joinedAt: now - 10 * 86400000,
        leftAt: null,
      }),
    );
  }
  const past = {
    id: "m-past",
    seasonId: s.settings.seasonId,
    teamA: "t1",
    teamB: "t2",
    startsAt: now - 86400000,
    place: "KAIST 풋살장",
    version: 3,
    scheduleVersion: 1,
    rosters: {},
    refereeRequests: [],
    refereeId: "p19",
    externalReferee: null,
    submissions: {},
    confirmations: { t1: 3, t2: 3 },
    history: [],
    status: "final",
    finalizedAt: now - 80000000,
    finalizedBy: "p19",
    finalizedVersion: 3,
  };
  for (const [tid, goals] of [
    ["t1", { p1: 2, p2: 1 }],
    ["t2", { p7: 1 }],
  ]) {
    const players = s.teams
      .find((t) => t.id === tid)
      .members.map((id) => ({ ...s.players.find((p) => p.id === id) }));
    past.rosters[tid] = players;
    past.submissions[tid] = {
      score: { a: 3, b: 1, pkA: null, pkB: null },
      players,
      goals,
      submittedBy: players[0].id,
      submittedAt: now - 85000000,
    };
  }
  s.matches.push(past);
  s.ratingLedger = League.records(s).ledger;
  const scheduled = {
    id: "m-result",
    seasonId: s.settings.seasonId,
    teamA: "t1",
    teamB: "t2",
    startsAt: now - 3 * 3600000,
    place: "KAIST 풋살장",
    version: 1,
    scheduleVersion: 1,
    rosters: structuredClone(past.rosters),
    refereeRequests: [
      { playerId: "p19", status: "accepted", scheduleVersion: 1 },
    ],
    refereeId: "p19",
    externalReferee: null,
    submissions: {},
    confirmations: {},
    history: [],
    status: "scheduled",
    createdAt: now - 86400000,
  };
  s.matches.push(scheduled);
  s.matches.push({
    ...structuredClone(scheduled),
    id: "m-request",
    startsAt: now + 86400000,
    refereeId: null,
    refereeRequests: [
      { playerId: "p19", status: "pending", scheduleVersion: 1 },
      { playerId: "p20", status: "pending", scheduleVersion: 1 },
    ],
    status: "awaiting_referee",
  });
  return s;
}
