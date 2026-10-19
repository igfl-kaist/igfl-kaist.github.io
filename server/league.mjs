// Shared domain service: Node and Apps Script run this exact implementation.
import { COMPETITION, isUnrefereed, matchDuration } from "../src/competition.mjs";
import { LeaguePolicies } from "./policies.mjs";
export const League = (() => {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const error = (code, message) => {
    const e = new Error(message);
    e.code = code;
    e.igflCode = code;
    throw e;
  };
  const require = (condition, code, message) => {
    if (!condition) error(code, message);
  };
  const text = (value, max = 120) => {
    require(typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <=
        max, "INVALID_INPUT", "필수 정보와 글자 수를 확인해 주세요.");
    return value.trim();
  };
  const list = (value) => {
    require(Array.isArray(value) &&
      new Set(value).size ===
        value.length, "INVALID_INPUT", "중복 없는 명단을 선택해 주세요.");
    return value;
  };
  const number = (value) => {
    require(Number.isInteger(value) &&
      value >= 0 &&
      value <= 99, "INVALID_SCORE", "스코어는 0~99의 정수로 입력해 주세요.");
    return value;
  };
  const get = (rows, id) => {
    const item = rows.find((r) => r.id === id);
    require(item, "NOT_FOUND", "대상을 찾을 수 없어요.");
    return item;
  };
  const member = (s, id) => s.players.find((p) => p.id === id);
  const teamOf = (s, id) => s.teams.find((t) => t.members.includes(id));
  const lead = (s, actor, teamId) => {
    const t = get(s.teams, teamId);
    require(t.members.includes(actor.userId) &&
      [t.captainId, t.viceId].includes(
        actor.userId,
      ), "FORBIDDEN", "현재 팀의 주장·부주장만 처리할 수 있어요.");
    return t;
  };
  const admin = (actor) =>
    require(actor.admin === true, "FORBIDDEN", "운영진만 처리할 수 있어요.");
  const snapshot = (s, ids) =>
    ids.map((id) => {
      const p = get(s.players, id);
      return { id, name: p.name, lab: p.lab };
    });
  const neutral = (s, id, m) => {
    const p = member(s, id);
    return (
      p?.referee &&
      !get(s.teams, m.teamA).members.includes(id) &&
      !get(s.teams, m.teamB).members.includes(id)
    );
  };
  function createState(settings = {}) {
    return {
      schema: 1,
      revision: 0,
      settings: {
        ...LeaguePolicies.settings,
        registrationOpen: false,
        privacyVersion: "",
        privacyNotice: "",
        seasonId: "pilot",
        seasonName: "시즌 준비",
        seasonOpen: false,
        graceDays: 60,
        ...settings,
      },
      players: [],
      profiles: [],
      teams: [],
      requests: [],
      matches: [],
      memberships: [],
      issues: [],
      audit: [],
      outbox: [],
      ratingLedger: [],
      invitations: [],
      notifications: [],
      sanctions: [],
      seasons: [],
    };
  }
  function maintain(s, now) {
    let changed = LeaguePolicies.maintain(s, now);
    for (const t of s.teams) {
      if (t.status === "active" && t.members.length < 6) {
        t.status = "paused";
        t.graceEndsAt = now + s.settings.graceDays * 86400000;
        changed = true;
      } else if (t.status === "paused" && t.members.length >= 6) {
        t.status = "active";
        t.graceEndsAt = null;
        changed = true;
      } else if (t.status === "paused" && now >= t.graceEndsAt) {
        t.status = "excluded";
        changed = true;
      }
    }
    return changed;
  }
  function ranks(rows, value) {
    rows.sort(
      (a, b) =>
        value(b) - value(a) ||
        a.name.localeCompare(b.name, "ko") ||
        a.id.localeCompare(b.id),
    );
    let previous, rank;
    return rows.map((r, i) => {
      if (value(r) !== previous) rank = i + 1;
      previous = value(r);
      return { ...r, rank };
    });
  }
  function records(s, seasonId = s.settings.seasonId) {
    const teams = new Map(
      s.teams.map((t) => [
        t.id,
        {
          id: t.id,
          name: t.name,
          rating: 1000,
          played: 0,
          won: 0,
          lost: 0,
          change: 0,
        },
      ]),
    );
    const finals = s.matches
      .filter(
        (m) =>
          (m.status === "final" || m.officialRecord) &&
          m.seasonId === seasonId,
      )
      .map((m) => (m.status === "final" ? m : m.officialRecord))
      .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
    const appearances = new Map(),
      referees = new Map(),
      ledger = [];
    for (const m of finals) {
      const a = teams.get(m.teamA),
        b = teams.get(m.teamB),
        result = m.submissions[m.teamA];
      const wonA =
        result.score.a === result.score.b
          ? result.score.pkA > result.score.pkB
          : result.score.a > result.score.b;
      const beforeA = a.rating,
        beforeB = b.rating,
        delta =
          32 * ((wonA ? 1 : 0) - 1 / (1 + 10 ** ((beforeB - beforeA) / 400)));
      a.rating += delta;
      b.rating -= delta;
      a.change = delta;
      b.change = -delta;
      a.played++;
      b.played++;
      a.won += +wonA;
      b.won += +!wonA;
      a.lost += +!wonA;
      b.lost += +wonA;
      ledger.push({
        matchId: m.id,
        seasonId,
        rule: "elo-1000-k32-400-v1",
        beforeA,
        beforeB,
        afterA: a.rating,
        afterB: b.rating,
        delta,
      });
      for (const submission of Object.values(m.submissions))
        for (const p of submission.players) {
          const games = appearances.get(p.id) || [];
          games.push({ goals: submission.goals[p.id] || 0, matchId: m.id });
          appearances.set(p.id, games);
        }
      if (m.refereeId)
        referees.set(m.refereeId, (referees.get(m.refereeId) || 0) + 1);
    }
    const scorers = s.players
      .map((p) => {
        const games = (appearances.get(p.id) || []).slice(-5);
        return {
          ...p,
          goals: games.reduce((n, g) => n + g.goals, 0),
          appearances: games.length,
        };
      })
      .filter((p) => p.goals > 0);
    return {
      teams: ranks(
        [...teams.values()].filter(
          (t) => get(s.teams, t.id).status === "active",
        ),
        (t) => t.rating,
      ),
      scorers: ranks(scorers, (p) => p.goals).filter((p) => p.rank <= 3),
      referees: ranks(
        s.players
          .filter((p) => referees.has(p.id))
          .map((p) => ({ ...p, count: referees.get(p.id) })),
        (p) => p.count,
      ).filter((p) => p.rank <= 3),
      ledger,
    };
  }
  function ledger(s) {
    return [...new Set(s.matches.map((m) => m.seasonId))].flatMap((id) => records(s, id).ledger);
  }
  function seasonBoards(s) {
    const known = [
      { id: COMPETITION.preseasonId, name: COMPETITION.preseasonName, phase: "preseason" },
      { id: COMPETITION.regularId, name: COMPETITION.regularName, phase: "regular" },
      ...s.matches.map((m) => ({ id: m.seasonId, name: m.seasonName || m.seasonId, phase: m.phase || "regular" })),
      { id: s.settings.seasonId, name: s.settings.seasonName, phase: s.settings.competitionPhase || "regular" },
    ];
    return [...new Map(known.map((x) => [x.id, x])).values()].map((x) => ({ ...x, records: records(s, x.id) }));
  }
  function publicView(s) {
    const active = s.teams.filter((t) =>
      ["active", "paused", "excluded"].includes(t.status),
    );
    return {
      revision: s.revision,
      settings: copy(s.settings),
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        lab: p.lab,
        referee: p.referee,
        teamId: teamOf(s, p.id)?.id || null,
      })),
      teams: active.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        image: t.image || null,
        recruiting: t.recruiting,
        captainId: t.captainId,
        viceId: t.viceId,
        members: [...t.members],
        status: t.status,
        graceEndsAt: t.graceEndsAt || null,
      })),
      records: records(s),
      seasonBoards: seasonBoards(s),
    };
  }
  function privateView(s, actor) {
    const view = publicView(s);
    if (!actor) return view;
    const p = member(s, actor.userId),
      team = teamOf(s, actor.userId),
      isLeader = !!team && [team.captainId, team.viceId].includes(actor.userId);
    const officialMatches = s.matches
      .filter((m) => m.status === "final" || m.officialRecord)
      .map((m) => (m.status === "final" ? m : m.officialRecord));
    const visibleMatch = (m) =>
      actor.admin ||
      (team && [m.teamA, m.teamB].includes(team.id)) ||
      m.refereeId === actor.userId ||
      m.refereeRequests.some((r) => r.playerId === actor.userId) ||
      Object.values(m.submissions).some((sub) =>
        sub.players.some((p) => p.id === actor.userId),
      );
    // Explicit public projection above; private profiles are only returned to self/admin.
    const matches = s.matches.filter(visibleMatch).map((m) =>
      actor.admin ||
      m.refereeId === actor.userId ||
      (isLeader && [m.teamA, m.teamB].includes(team.id))
        ? copy(m)
        : {
            id: m.id,
            teamA: m.teamA,
            teamB: m.teamB,
            seasonId: m.seasonId,
            phase: m.phase || "regular",
            playersPerSide: m.playersPerSide || 5,
            halfMinutes: m.halfMinutes || 20,
            refereeMode: m.refereeMode,
            startsAt: m.startsAt,
            place: m.place,
            status: m.status,
            version: m.version,
            refereeId: m.refereeId,
            externalReferee: m.externalReferee,
            refereeRequests: m.refereeRequests.filter(
              (r) => r.playerId === actor.userId,
            ),
            submissions: {},
            confirmations: {},
            rosters: {},
            history: [],
          },
    );
    return {
      ...view,
      me: {
        id: actor.userId,
        email: actor.email,
        admin: !!actor.admin,
        player: p || null,
        profile: s.profiles.find((p) => p.id === actor.userId) || null,
        teamId: team?.id || null,
        isLeader,
        stats: {
          appearances: officialMatches.filter(
            (m) =>
              m.status === "final" &&
              m.seasonId === s.settings.seasonId &&
              Object.values(m.submissions).some((sub) =>
                sub.players.some((p) => p.id === actor.userId),
              ),
          ).length,
          goals: officialMatches
            .filter(
              (m) => m.status === "final" && m.seasonId === s.settings.seasonId,
            )
            .reduce(
              (sum, m) =>
                sum +
                Object.values(m.submissions).reduce(
                  (n, sub) => n + (sub.goals[actor.userId] || 0),
                  0,
                ),
              0,
            ),
          refereed: officialMatches.filter(
            (m) =>
              m.status === "final" &&
              m.seasonId === s.settings.seasonId &&
              m.refereeId === actor.userId,
          ).length,
        },
      },
      matches,
      invitations: copy(
        (s.invitations || []).filter(
          (i) => isLeader && [i.fromTeam, i.toTeam].includes(team.id),
        ),
      ),
      notifications: copy(
        (s.notifications || []).filter((n) => isLeader && n.teamId === team.id),
      ),
      sanctions: copy(
        (s.sanctions || []).filter(
          (x) =>
            actor.admin ||
            x.playerId === actor.userId ||
            (isLeader && team.members.includes(x.playerId)),
        ),
      ),
      requests: copy(
        s.requests.filter(
          (r) =>
            actor.admin ||
            r.playerId === actor.userId ||
            r.requesterId === actor.userId ||
            (isLeader && r.teamId === team.id),
        ),
      ),
      applications: copy(
        s.teams.filter(
          (t) =>
            ["pending", "needs_changes"].includes(t.status) &&
            (actor.admin || t.requesterId === actor.userId),
        ),
      ),
      issues: copy(
        s.issues.filter((i) => actor.admin || i.reporterId === actor.userId),
      ),
      adminData: actor.admin
        ? {
            profiles: copy(s.profiles),
            audit: copy(s.audit).reverse().slice(0, 200),
            outbox: s.outbox.map(
              ({ id, kind, status, attempts, lastError }) => ({
                id,
                kind,
                status,
                attempts,
                lastError,
              }),
            ),
            teams: copy(s.teams),
          }
        : null,
    };
  }
  function enqueue(s, ctx, kind, recipients, entityId) {
    const version = s.matches.find((m) => m.id === entityId)?.version || 1;
    if (
      s.outbox.some(
        (j) =>
          j.kind === kind &&
          j.entityId === entityId &&
          JSON.stringify(j.recipients) === JSON.stringify(recipients) &&
          (j.version === version ||
            ["pending", "sending", "uncertain"].includes(j.status)),
      )
    )
      return;
    s.outbox.push({
      id: ctx.id(),
      kind,
      version,
      recipients,
      entityId,
      status: "pending",
      attempts: 0,
      createdAt: ctx.now,
    });
  }
  function validRoster(s, t, ids, m) {
    list(ids);
    require(ids.length >= (m.playersPerSide || 5) &&
      ids.length <=
        20, "INVALID_ROSTER", `교체 선수를 포함해 ${m.playersPerSide || 5}~20명을 선택해 주세요.`);
    for (const id of ids) {
      require(t.members.includes(id) ||
        s.memberships.some(
          (h) =>
            h.playerId === id &&
            h.teamId === t.id &&
            h.joinedAt <= m.startsAt &&
            h.leftAt >= m.startsAt,
        ), "INVALID_ROSTER", "본인 팀 소속 또는 경기 당시 소속 선수만 선택할 수 있어요.");
      require(!LeaguePolicies.isSuspended(
        s,
        id,
        m,
      ), "PLAYER_SUSPENDED", "다음 공식 경기 출전 정지 선수가 포함돼 있어요.");
    }
    return snapshot(s, ids);
  }
  function finishMatch(s, m, ctx) {
    m.status = "final";
    m.finalizedAt = ctx.now;
    m.finalizedBy = isUnrefereed(m) ? null : ctx.actorId;
    m.finalizationMethod = isUnrefereed(m) ? "both-team-confirmations" : "referee-or-admin";
    m.finalizedVersion = m.version;
    delete m.officialRecord;
    delete m.correctionOpen;
    LeaguePolicies.finalized(s, m, ctx);
    s.ratingLedger = ledger(s);
  }
  function updateMatchState(s, m, ctx) {
    if (LeaguePolicies.terminal(m)) return;
    if (m.incident || m.privacyReviewRequired) {
      m.status = "review";
      return;
    }
    if (s.issues.some((i) => i.matchId === m.id && i.status === "open")) {
      m.status = "review";
      return;
    }
    const a = m.submissions[m.teamA],
      b = m.submissions[m.teamB];
    if (!a || !b) {
      m.status = "awaiting_results";
      return;
    }
    if (JSON.stringify(a.score) !== JSON.stringify(b.score)) {
      m.status = "mismatch";
      enqueue(s, ctx, "scoreMismatch", "admins", m.id);
      return;
    }
    const total = (values) =>
      Object.values(values || {}).reduce((sum, n) => sum + n, 0);
    if (
      total(a.goals) + total(b.ownGoals) !== a.score.a ||
      total(b.goals) + total(a.ownGoals) !== a.score.b
    ) {
      m.status = "mismatch";
      enqueue(s, ctx, "scoreMismatch", "admins", m.id);
      return;
    }
    m.status =
      m.confirmations[m.teamA] === m.version &&
      m.confirmations[m.teamB] === m.version
        ? "ready"
        : "awaiting_confirmations";
    if (m.status === "ready" && isUnrefereed(m)) {
      finishMatch(s, m, ctx);
      return;
    }
    if (m.status === "ready" && m.externalReferee)
      enqueue(s, ctx, "externalApproval", "admins", m.id);
    if (m.status === "ready" && m.readyVersion !== m.version) {
      m.readyAt = ctx.now;
      m.readyVersion = m.version;
    }
  }
  function apply(s, actor, command, args, ctx) {
    require(actor?.userId, "UNAUTHENTICATED", "로그인이 필요해요.");
    if (
      command === "finalize" &&
      s.matches.find((m) => m.id === args.matchId)?.status === "final"
    ) {
      const m = get(s.matches, args.matchId);
      require(isUnrefereed(m)
        ? actor.admin || [m.teamA, m.teamB].some((id) => { const t = get(s.teams, id); return t.members.includes(actor.userId) && [t.captainId, t.viceId].includes(actor.userId); })
        : m.externalReferee
        ? actor.admin
        : m.refereeId ===
            actor.userId, "FORBIDDEN", "최종 승인 권한이 없어요.");
      return { alreadyFinal: true };
    }
    require(args.expectedRevision ===
      s.revision, "STALE", "다른 변경이 먼저 반영됐어요. 최신 내용을 확인하고 다시 시도해 주세요.");
    const p = member(s, actor.userId);
    if (command !== "registerPlayer")
      require(p ||
        actor.admin, "NOT_REGISTERED", "선수 등록을 먼저 완료해 주세요.");
    let entityId = actor.userId;
    const extra = LeaguePolicies.apply(s, actor, command, args, ctx, {
      neutral,
      enqueue,
      updateMatchState,
      records,
      ledger,
    });
    if (extra.handled) entityId = extra.entityId;
    else
      switch (command) {
        case "registerPlayer": {
          require(s.settings.registrationOpen &&
            s.settings.privacyVersion &&
            s.settings
              .privacyNotice, "REGISTRATION_CLOSED", "현재 선수 등록이 닫혀 있어요. 운영 안내를 확인해 주세요.");
          require(!p, "ALREADY_REGISTERED", "이미 등록된 선수예요.");
          require(args.consent === true &&
            args.consentVersion ===
              s.settings
                .privacyVersion, "CONSENT_REQUIRED", "현재 개인정보 수집·이용 안내에 동의해 주세요.");
          require(args.publicConsent === true &&
            args.publicConsentVersion ===
              s.settings
                .publicConsentVersion, "PUBLIC_CONSENT_REQUIRED", "이름·연구실과 리그 기록의 필수 공개 안내에 동의해 주세요.");
          require(/^[^@\s]+@kaist\.ac\.kr$/.test(
            actor.email,
          ), "INVALID_EMAIL", "학교 이메일 인증이 필요해요.");
          const eligibility = text(args.eligibility),
            department = text(args.department),
            advisorDepartment = args.advisorDepartment;
          require(["graduate", "staff", "advisor"].includes(
            eligibility,
          ), "INELIGIBLE", "참가 자격을 선택해 주세요.");
          require((eligibility === "advisor" &&
            ["ISE", "GSDS"].includes(advisorDepartment)) ||
            (eligibility !== "advisor" &&
              ["ISE", "GSDS"].includes(
                department,
              )), "INELIGIBLE", "소속 학과 또는 지도교수 소속을 확인해 주세요.");
          const identifier = text(args.identifier, 30);
          require(!s.profiles.some(
            (r) => r.identifier === identifier,
          ), "DUPLICATE_IDENTIFIER", "이미 등록된 학번·사번이에요. 운영진에게 확인을 요청해 주세요.");
          const name = text(args.name, 40),
            lab = text(args.lab, 100),
            advisor =
              eligibility === "staff" ? "해당 없음" : text(args.advisor, 60);
          s.players.push({
            id: actor.userId,
            name,
            lab,
            referee: args.referee === true,
          });
          s.profiles.push({
            id: actor.userId,
            email: actor.email,
            eligibility,
            department,
            identifier,
            advisor,
            advisorDepartment:
              eligibility === "advisor" ? advisorDepartment : null,
            consentVersion: s.settings.privacyVersion,
            consentedAt: ctx.now,
            publicConsentVersion: s.settings.publicConsentVersion,
            publicConsentedAt: ctx.now,
          });
          if (args.teamId) {
            get(s.teams, args.teamId);
            s.requests.push({
              id: ctx.id(),
              type: "join",
              teamId: args.teamId,
              playerId: actor.userId,
              message: "선수 등록과 함께 가입을 요청했어요.",
              status: "pending",
              createdAt: ctx.now,
            });
          }
          break;
        }
        case "requestEligibility": {
          s.issues.push({
            id: ctx.id(),
            type: "eligibility",
            reporterId: actor.userId,
            message: text(args.message, 1000),
            status: "open",
            createdAt: ctx.now,
          });
          enqueue(s, ctx, "eligibility", "admins", actor.userId);
          break;
        }
        case "createTeam":
        case "resubmitTeam": {
          require(!teamOf(
            s,
            actor.userId,
          ), "ALREADY_MEMBER", "기존 팀에서 먼저 탈퇴해 주세요.");
          const draft =
            command === "resubmitTeam" ? get(s.teams, args.teamId) : null;
          if (draft)
            require(draft.requesterId === actor.userId &&
              draft.status ===
                "needs_changes", "FORBIDDEN", "본인의 보완 요청 신청만 수정할 수 있어요.");
          require(!s.teams.some(
            (t) =>
              t.id !== draft?.id &&
              t.requesterId === actor.userId &&
              ["pending", "needs_changes"].includes(t.status),
          ), "APPLICATION_EXISTS", "이미 신청한 팀을 확인하거나 보완해 주세요.");
          const ids = list(args.members);
          require(ids.length >= 6 &&
            ids.length <=
              20, "TEAM_SIZE", "등록 선수 6~20명으로 신청해 주세요.");
          require(ids.includes(actor.userId) &&
            ids.includes(args.captainId) &&
            ids.includes(args.viceId) &&
            args.captainId !== args.viceId &&
            [args.captainId, args.viceId].includes(
              actor.userId,
            ), "INVALID_LEADERS", "신청자는 대표여야 하며 주장·부주장은 서로 다른 팀원이어야 해요.");
          ids.forEach((id) => {
            get(s.players, id);
            require(!teamOf(
              s,
              id,
            ), "ALREADY_MEMBER", "이미 소속 팀이 있는 선수가 있어요.");
          });
          const name = text(args.name, 50);
          require(!s.teams.some(
            (t) => t.name === name && t.id !== draft?.id,
          ), "DUPLICATE_TEAM", "같은 이름의 팀이 있어요.");
          entityId = draft?.id || ctx.id();
          const application = {
            id: entityId,
            name,
            description: text(args.description, 500),
            members: [],
            pendingMembers: [...ids],
            captainId: args.captainId,
            viceId: args.viceId,
            recruiting: false,
            status: "pending",
            requesterId: actor.userId,
            createdAt: ctx.now,
          };
          if (draft) Object.assign(draft, application);
          else s.teams.push(application);
          enqueue(s, ctx, "teamApplication", "admins", entityId);
          break;
        }
        case "reviewTeam": {
          admin(actor);
          const t = get(s.teams, args.teamId);
          require(t.status ===
            "pending", "INVALID_STATE", "승인 대기 신청이 아니에요.");
          entityId = t.id;
          if (args.approve) {
            require(t.pendingMembers.length >= 6 &&
              t.pendingMembers.length <=
                20, "TEAM_SIZE", "팀 인원을 확인해 주세요.");
            t.pendingMembers.forEach((id) =>
              require(member(s, id) &&
                !teamOf(
                  s,
                  id,
                ), "ALREADY_MEMBER", "현재 소속이 변경된 선수가 있어요."),
            );
            t.members = [...t.pendingMembers];
            t.status = "active";
            for (const id of t.members)
              s.memberships.push({
                playerId: id,
                teamId: t.id,
                joinedAt: ctx.now,
                leftAt: null,
              });
          } else {
            t.status = "needs_changes";
            t.reviewNote = text(args.reason, 1000);
          }
          break;
        }
        case "updateTeam": {
          const t = lead(s, actor, args.teamId);
          entityId = t.id;
          t.description = text(args.description, 500);
          t.recruiting = args.recruiting === true;
          if (args.image !== undefined) {
            require(args.image === null ||
              ctx.validateImage(
                args.image,
              ), "INVALID_IMAGE", "JPG·PNG·WebP 이미지와 크기를 확인해 주세요.");
            t.image = args.image;
          }
          break;
        }
        case "joinRequest": {
          require(!teamOf(
            s,
            p.id,
          ), "ALREADY_MEMBER", "기존 팀에서 먼저 탈퇴해 주세요.");
          const t = get(s.teams, args.teamId);
          require(["active", "paused"].includes(
            t.status,
          ), "INVALID_STATE", "가입 문의를 받는 팀이 아니에요.");
          require(!s.requests.some(
            (r) =>
              r.type === "join" &&
              r.playerId === p.id &&
              r.teamId === t.id &&
              r.status === "pending",
          ), "ALREADY_REQUESTED", "이미 가입 요청을 보냈어요.");
          s.requests.push({
            id: ctx.id(),
            type: "join",
            teamId: t.id,
            playerId: p.id,
            message: text(args.message, 500),
            status: "pending",
            createdAt: ctx.now,
          });
          break;
        }
        case "recruit": {
          const t = lead(s, actor, args.teamId),
            id = text(args.playerId);
          get(s.players, id);
          require(["active", "paused"].includes(
            t.status,
          ), "INVALID_STATE", "충원이 가능한 팀이 아니에요.");
          require(!teamOf(
            s,
            id,
          ), "ALREADY_MEMBER", "이미 소속 팀이 있는 선수예요.");
          require(t.members.length < 20, "TEAM_FULL", "팀 정원은 20명이에요.");
          require(!s.matches.some(
            (m) =>
              m.refereeId === id &&
              m.startsAt > ctx.now &&
              m.status !== "final" &&
              [m.teamA, m.teamB].includes(t.id),
          ), "REFEREE_CONFLICT", "이 팀의 예정 경기 심판으로 배정된 선수예요.");
          t.members.push(id);
          s.memberships.push({
            playerId: id,
            teamId: t.id,
            joinedAt: ctx.now,
            leftAt: null,
          });
          s.requests
            .filter(
              (r) =>
                r.type === "join" &&
                r.playerId === id &&
                r.status === "pending",
            )
            .forEach(
              (r) => (r.status = r.teamId === t.id ? "accepted" : "closed"),
            );
          entityId = t.id;
          break;
        }
        case "release":
        case "leaveTeam": {
          const t =
            command === "release"
              ? lead(s, actor, args.teamId)
              : teamOf(s, actor.userId);
          require(t, "NOT_MEMBER", "현재 소속 팀이 없어요.");
          const id = command === "release" ? args.playerId : actor.userId;
          require(t.members.includes(
            id,
          ), "NOT_MEMBER", "이 팀 소속 선수가 아니에요.");
          t.members = t.members.filter((x) => x !== id);
          if (t.captainId === id) t.captainId = null;
          if (t.viceId === id) t.viceId = null;
          s.memberships
            .filter(
              (h) =>
                h.teamId === t.id && h.playerId === id && h.leftAt === null,
            )
            .forEach((h) => (h.leftAt = ctx.now));
          entityId = t.id;
          break;
        }
        case "requestLeaders": {
          const t = lead(s, actor, args.teamId);
          require(t.members.includes(args.captainId) &&
            t.members.includes(args.viceId) &&
            args.captainId !==
              args.viceId, "INVALID_LEADERS", "현재 팀원 중 서로 다른 두 사람을 선택해 주세요.");
          require(!s.requests.some(
            (r) =>
              r.type === "leaders" &&
              r.teamId === t.id &&
              r.status === "pending",
          ), "ALREADY_REQUESTED", "대표 교체 승인 대기 중이에요.");
          s.requests.push({
            id: ctx.id(),
            type: "leaders",
            teamId: t.id,
            requesterId: actor.userId,
            captainId: args.captainId,
            viceId: args.viceId,
            status: "pending",
            createdAt: ctx.now,
          });
          break;
        }
        case "reviewLeaders": {
          admin(actor);
          const r = get(s.requests, args.requestId),
            t = get(s.teams, r.teamId);
          require(r.type === "leaders" &&
            r.status ===
              "pending", "INVALID_STATE", "승인 대기 요청이 아니에요.");
          if (args.approve) {
            require(t.members.includes(r.captainId) &&
              t.members.includes(r.viceId) &&
              r.captainId !==
                r.viceId, "INVALID_LEADERS", "후보의 현재 소속을 다시 확인해 주세요.");
            t.captainId = r.captainId;
            t.viceId = r.viceId;
            r.status = "accepted";
          } else {
            r.status = "needs_changes";
            r.reason = text(args.reason, 1000);
          }
          entityId = t.id;
          break;
        }
        case "schedule": {
          const t = lead(s, actor, args.teamId),
            other = get(s.teams, args.opponentId);
          require(t.id !== other.id &&
            t.status === "active" &&
            other.status ===
              "active", "INACTIVE_TEAM", "활동 중인 서로 다른 팀을 선택해 주세요.");
          require(s.settings
            .seasonOpen, "SEASON_CLOSED", "시즌 일정이 아직 열리지 않았어요.");
          const startsAt = Number(args.startsAt);
          require(Number.isFinite(startsAt) &&
            startsAt >
              ctx.now, "INVALID_DATE", "미래의 경기 일시를 입력해 주세요.");
          const phase = s.settings.competitionPhase || "regular",
            playersPerSide = args.playersPerSide ?? 5,
            halfMinutes = args.halfMinutes ?? 20,
            refereeMode = args.refereeMode || (args.externalReferee ? "external" : "internal");
          require(["regular", "preseason"].includes(phase) &&
            (phase === "preseason" ? [5, 6].includes(playersPerSide) && [15, 20].includes(halfMinutes) : playersPerSide === 5 && halfMinutes === 20),
            "INVALID_FORMAT", "프리시즌은 5·6대6과 전후반 15·20분, 정규리그는 5대5·전후반 20분이에요.");
          require(["internal", "external", ...(phase === "preseason" ? ["none"] : [])].includes(refereeMode), "REFEREE_REQUIRED", "정규리그에는 심판이 필요해요.");
          require(refereeMode === "external" ? !!args.externalReferee : !args.externalReferee, "INVALID_FORMAT", "심판 구분과 입력 내용을 확인해 주세요.");
          require(refereeMode !== "none" || !(args.refereeIds || []).length, "INVALID_FORMAT", "심판 없는 경기에 심판 후보를 함께 요청할 수 없어요.");
          require(!(s.settings.seasonId === COMPETITION.preseasonId && phase !== "preseason") &&
            !(s.settings.seasonId === COMPETITION.regularId && phase !== "regular") &&
            !s.matches.some((x) => x.seasonId === s.settings.seasonId && (x.phase || "regular") !== phase),
            "SEASON_CONFIGURATION", "프리시즌과 정규리그는 서로 다른 시즌 ID로 운영해야 해요.");
          const seasonEndsAt = Number(s.settings.seasonEndsAt) || null;
          require(!seasonEndsAt || startsAt + (halfMinutes * 2 + 5) * 60000 <= seasonEndsAt, "SEASON_ENDED", "해당 시즌 종료 전 끝나는 경기만 등록할 수 있어요.");
          const m = {
            id: ctx.id(),
            seasonId: s.settings.seasonId,
            seasonName: s.settings.seasonName,
            phase, playersPerSide, halfMinutes, refereeMode, seasonEndsAt,
            teamA: t.id,
            teamB: other.id,
            startsAt,
            place: text(args.place, 120),
            version: 1,
            scheduleVersion: 1,
            scheduleConfirmations: { [t.id]: 1 },
            clockMode: "running",
            refereeCount: refereeMode === "none" ? 0 : 1,
            rosters: {},
            refereeRequests: [],
            refereeId: null,
            externalReferee: null,
            submissions: {},
            confirmations: {},
            history: [],
            status: "awaiting_referee",
            createdAt: ctx.now,
          };
          require(!s.matches.some(
            (x) =>
              !LeaguePolicies.closed(x) &&
              x.startsAt === startsAt &&
              [x.teamA, x.teamB].includes(t.id) &&
              [x.teamA, x.teamB].includes(other.id),
          ), "DUPLICATE_MATCH", "이미 같은 대진과 일시의 경기가 있어요.");
          m.rosters[t.id] = validRoster(s, t, args.roster, m);
          if (args.replayOf) {
            const previous = get(s.matches, args.replayOf);
            require(previous.seasonId === m.seasonId && previous.allowReplay &&
              [previous.teamA, previous.teamB].includes(t.id) &&
              [previous.teamA, previous.teamB].includes(other.id) &&
              !s.matches.some(
                (x) => x.replayOf === previous.id && !LeaguePolicies.closed(x),
              ), "INVALID_STATE", "재경기 대상과 기존 일정을 확인해 주세요.");
            m.replayOf = previous.id;
          }
          if (refereeMode === "none") {
            m.status = "awaiting_opponent";
          } else if (args.externalReferee) {
            m.externalReferee = {
              name: text(args.externalReferee.name, 60),
              accepted: args.externalReferee.accepted === true,
            };
            if (m.externalReferee.accepted) m.status = "scheduled";
          } else {
            list(args.refereeIds);
            require(args.refereeIds.length >
              0, "REFEREE_REQUIRED", "심판 후보를 한 명 이상 선택해 주세요.");
            for (const id of args.refereeIds) {
              require(neutral(
                s,
                id,
                m,
              ), "NON_NEUTRAL_REFEREE", "양 팀 소속이 아닌 심판을 선택해 주세요.");
              m.refereeRequests.push({
                playerId: id,
                status: "pending",
                scheduleVersion: 1,
              });
              enqueue(s, ctx, "refereeRequest", [id], m.id);
            }
          }
          LeaguePolicies.scheduleStatus(m);
          s.matches.push(m);
          entityId = m.id;
          break;
        }
        case "setRoster":
        case "confirmExternalReferee":
        case "requestReferees":
        case "acceptReferee":
        case "declineReferee":
        case "submitResult":
        case "confirmResult":
        case "dispute":
        case "finalize": {
          const m = get(s.matches, args.matchId);
          entityId = m.id;
          require(m.status !==
            "final", "FINAL_IMMUTABLE", "확정 기록의 정정은 운영진 정책 확정 후 처리해요.");
          require(!LeaguePolicies.closed(
            m,
          ), "INVALID_STATE", "취소·중단·몰수 처리된 경기예요.");
          require(args.matchVersion ===
            m.version, "STALE_MATCH", "경기 기록이 변경됐어요. 최신 기록을 확인해 주세요.");
          if (command === "acceptReferee" || command === "declineReferee") {
            const r = m.refereeRequests.find(
              (r) =>
                r.playerId === actor.userId &&
                r.status === "pending" &&
                r.scheduleVersion === m.scheduleVersion,
            );
            require(r &&
              !m.refereeId, "REFEREE_ASSIGNED", "이미 다른 심판이 배정됐거나 종료된 요청이에요.");
            if (command === "declineReferee") {
              r.status = "declined";
              break;
            }
            require(m.startsAt > ctx.now &&
              neutral(
                s,
                actor.userId,
                m,
              ), "NON_NEUTRAL_REFEREE", "현재 양 팀 소속이 아닌 심판만 수락할 수 있어요.");
            require(!s.matches.some(
              (x) =>
                x.id !== m.id &&
                !LeaguePolicies.closed(x) &&
                x.refereeId === actor.userId &&
                x.startsAt < m.startsAt + matchDuration(m) && m.startsAt < x.startsAt + matchDuration(x),
            ), "REFEREE_CONFLICT", "같은 시간대에 배정된 경기가 있어요.");
            m.refereeId = actor.userId;
            r.status = "accepted";
            m.refereeRequests
              .filter((x) => x !== r && x.status === "pending")
              .forEach((x) => (x.status = "closed"));
            m.status = "scheduled";
            LeaguePolicies.scheduleStatus(m);
            break;
          }
          if (command === "finalize") {
            require(m.status ===
              "ready", "RESULT_NOT_READY", "양 팀 확인·스코어 일치와 이의 해결이 필요해요.");
            if (m.externalReferee) {
              admin(actor);
              require(m.externalReferee.accepted &&
                args.externalConfirmed ===
                  true, "EXTERNAL_CONFIRMATION_REQUIRED", "외부 심판 진행 여부를 확인해 주세요.");
            } else
              require(m.refereeId === actor.userId &&
                neutral(
                  s,
                  actor.userId,
                  m,
                ), "FORBIDDEN", "배정된 중립 심판만 최종 승인할 수 있어요.");
            finishMatch(s, m, { ...ctx, actorId: actor.userId });
            break;
          }
          if (command === "dispute") {
            require(actor.admin ||
              actor.userId === m.refereeId ||
              [m.teamA, m.teamB].some((id) => {
                const t = get(s.teams, id);
                return (
                  t.members.includes(actor.userId) &&
                  [t.captainId, t.viceId].includes(actor.userId)
                );
              }), "FORBIDDEN", "경기 대표·담당 심판·운영진만 이의를 등록할 수 있어요.");
            s.issues.push({
              id: ctx.id(),
              type: "match",
              matchId: m.id,
              reporterId: actor.userId,
              message: text(args.message, 1000),
              status: "open",
              createdAt: ctx.now,
            });
            m.status = "review";
            m.confirmations = {};
            enqueue(s, ctx, "dispute", "admins", m.id);
            break;
          }
          const t = lead(s, actor, args.teamId);
          require([m.teamA, m.teamB].includes(
            t.id,
          ), "FORBIDDEN", "본인 팀의 경기 기록만 입력할 수 있어요.");
          if (command === "setRoster") {
            require(m.startsAt >
              ctx.now, "ROSTER_CLOSED", "경기 전 명단만 수정할 수 있어요.");
            m.rosters[t.id] = validRoster(s, t, args.roster, m);
            if (m.scheduleConfirmations)
              m.scheduleConfirmations[t.id] = m.scheduleVersion;
            LeaguePolicies.scheduleStatus(m);
            break;
          }
          if (command === "confirmExternalReferee") {
            require(m.externalReferee &&
              !m.externalReferee.accepted &&
              m.startsAt >
                ctx.now, "INVALID_STATE", "외부 심판 수락 대기 중인 예정 경기만 확인할 수 있어요.");
            require(args.accepted ===
              true, "EXTERNAL_CONFIRMATION_REQUIRED", "외부 심판의 일정 수락을 확인해 주세요.");
            m.externalReferee.accepted = true;
            m.status = "scheduled";
            LeaguePolicies.scheduleStatus(m);
            break;
          }
          if (command === "requestReferees") {
            require(!isUnrefereed(m) && !m.refereeId &&
              !m.externalReferee &&
              m.startsAt >
                ctx.now, "INVALID_STATE", "심판 배정 전 경기만 추가 요청할 수 있어요.");
            const candidates = list(args.refereeIds);
            require(candidates.length >
              0, "REFEREE_REQUIRED", "새 심판 후보를 선택해 주세요.");
            for (const id of candidates) {
              require(neutral(s, id, m) &&
                !m.refereeRequests.some(
                  (r) => r.playerId === id,
                ), "NON_NEUTRAL_REFEREE", "새로운 중립 심판을 선택해 주세요.");
              m.refereeRequests.push({
                playerId: id,
                status: "pending",
                scheduleVersion: m.scheduleVersion,
              });
              enqueue(s, ctx, "refereeRequest", [id], m.id);
            }
            break;
          }
          require(isUnrefereed(m) || m.refereeId ||
            m.externalReferee
              ?.accepted, "REFEREE_REQUIRED", "심판 배정 후 공식 경기 결과를 등록할 수 있어요.");
          require(m.startsAt + matchDuration(m) <=
            ctx.now, "MATCH_NOT_FINISHED", "경기 종료 후 결과를 입력해 주세요.");
          if (command === "confirmResult") {
            require(m.submissions[
              t.id
            ], "RESULT_MISSING", "본인 팀 결과를 먼저 제출해 주세요.");
            m.confirmations[t.id] = m.version;
            updateMatchState(s, m, ctx);
            break;
          }
          require(args.confirmed ===
            true, "CONFIRMATION_REQUIRED", "우리 팀 기록을 확인한 뒤 제출해 주세요.");
          const score = {
            a: number(args.score.a),
            b: number(args.score.b),
            pkA: null,
            pkB: null,
          };
          if (score.a === score.b) {
            score.pkA = number(args.score.pkA);
            score.pkB = number(args.score.pkB);
            require(score.pkA !==
              score.pkB, "INVALID_SCORE", "승부차기 승자를 기록해 주세요.");
          }
          require(m.rosters[m.teamA]?.length >= (m.playersPerSide || 5) &&
            m.rosters[m.teamB]?.length >= (m.playersPerSide || 5) &&
            (!m.scheduleConfirmations ||
              [m.teamA, m.teamB].every(
                (id) => m.scheduleConfirmations[id] === m.scheduleVersion,
              )), "ROSTER_MISSING", "양 팀의 일정 확인과 사전 명단을 먼저 등록해 주세요.");
          const players = validRoster(s, t, args.roster, m),
            goals = {};
          require(players.every((p) =>
            m.rosters[t.id].some((x) => x.id === p.id),
          ), "ROSTER_CLOSED", "실제 출전자는 킥오프 전 사전 명단 안에서 선택해 주세요.");
          let sum = 0;
          require(args.goals &&
            typeof args.goals === "object" &&
            !Array.isArray(
              args.goals,
            ), "INVALID_SCORE", "본인 팀 득점 기록을 입력해 주세요.");
          for (const [id, value] of Object.entries(args.goals)) {
            require(players.some(
              (p) => p.id === id,
            ), "INVALID_SCORER", "실제 출전 선수만 득점자로 기록할 수 있어요.");
            goals[id] = number(value);
            sum += value;
          }
          require(sum <=
            (t.id === m.teamA
              ? score.a
              : score.b), "GOAL_TOTAL", "개인 득점 합계가 팀 스코어를 초과할 수 없어요.");
          const ownGoals = {};
          require(!args.ownGoals ||
            (typeof args.ownGoals === "object" &&
              !Array.isArray(
                args.ownGoals,
              )), "INVALID_SCORE", "자책골 기록을 확인해 주세요.");
          for (const [id, value] of Object.entries(args.ownGoals || {})) {
            require(players.some(
              (p) => p.id === id,
            ), "INVALID_SCORER", "우리 팀 실제 출전자의 자책골만 기록해 주세요.");
            ownGoals[id] = number(value);
          }
          require(Object.values(ownGoals).reduce((n, v) => n + v, 0) <=
            (t.id === m.teamA
              ? score.b
              : score.a), "GOAL_TOTAL", "자책골 합계가 상대 스코어를 초과할 수 없어요.");
          const redCards = list(args.redCards || []);
          require(redCards.every((id) =>
            players.some((p) => p.id === id),
          ), "INVALID_SCORER", "우리 팀 실제 출전자의 퇴장만 기록해 주세요.");
          m.history.push({
            version: m.version,
            submissions: copy(m.submissions),
            confirmations: copy(m.confirmations),
            changedAt: ctx.now,
            changedBy: actor.userId,
          });
          m.version++;
          m.submissions[t.id] = {
            score,
            players,
            goals,
            ownGoals,
            redCards,
            submittedBy: actor.userId,
            submittedAt: ctx.now,
          };
          m.confirmations = { [t.id]: m.version };
          updateMatchState(s, m, ctx);
          break;
        }
        case "resolveIssue": {
          admin(actor);
          const i = get(s.issues, args.issueId);
          require(i.status ===
            "open", "INVALID_STATE", "이미 처리한 이의예요.");
          i.status = "resolved";
          i.resolution = text(args.reason, 1000);
          i.resolvedBy = actor.userId;
          i.resolvedAt = ctx.now;
          if (i.matchId && get(s.matches, i.matchId).status !== "final") {
            const m = get(s.matches, i.matchId);
            m.version++;
            m.confirmations = {};
            updateMatchState(s, m, ctx);
          }
          entityId = i.id;
          break;
        }
        case "requestCorrection": {
          admin(actor);
          const m = get(s.matches, args.matchId);
          require(m.status !==
            "final", "FINAL_IMMUTABLE", "확정 후 정정 세칙이 필요해요.");
          m.history.push({
            version: m.version,
            submissions: copy(m.submissions),
            confirmations: copy(m.confirmations),
            note: text(args.reason, 1000),
            changedAt: ctx.now,
            changedBy: actor.userId,
          });
          m.version++;
          m.confirmations = {};
          updateMatchState(s, m, ctx);
          entityId = m.id;
          break;
        }
        default:
          error("UNKNOWN_COMMAND", "지원하지 않는 요청이에요.");
      }
    maintain(s, ctx.now);
    s.revision++;
    s.audit.push({
      id: ctx.id(),
      actorId: command === "withdrawAccount" ? null : actor.userId,
      command,
      entityId,
      at: ctx.now,
      revision: s.revision,
    });
    return {
      entityId,
      revision: s.revision,
      ...(command === "withdrawAccount" ? { withdrawn: true } : {}),
    };
  }
  function execute(state, actor, command, args, ctx) {
    const next = copy(state);
    LeaguePolicies.upgrade(next);
    const result = apply(next, actor, command, args, ctx);
    return { state: next, result };
  }
  return {
    createState,
    publicView,
    privateView,
    execute,
    maintain,
    records,
    policies: LeaguePolicies,
  };
})();
