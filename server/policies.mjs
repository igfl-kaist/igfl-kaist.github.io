import { isUnrefereed, matchDuration } from "../src/competition.mjs";
import { PRIVACY } from "../src/privacy-content.mjs";
// Shared policies and additional league workflows. No private contacts or secrets.
export const LeaguePolicies = (() => {
  const day = 86400000;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const check = (ok, code, message) => {
    if (!ok) {
      const e = new Error(message);
      e.code = e.igflCode = code;
      throw e;
    }
  };
  const text = (v, max = 500) => {
    check(
      typeof v === "string" && v.trim() && v.length <= max,
      "INVALID_INPUT",
      "내용과 글자 수를 확인해 주세요.",
    );
    return v.trim();
  };
  const team = (s, id) => {
    const t = s.teams.find((t) => t.id === id);
    check(t, "NOT_FOUND", "팀을 찾을 수 없어요.");
    return t;
  };
  const leader = (s, actor, id) => {
    const t = team(s, id);
    check(
      t.members.includes(actor.userId) &&
        [t.captainId, t.viceId].includes(actor.userId),
      "FORBIDDEN",
      "현재 팀의 주장·부주장만 처리할 수 있어요.",
    );
    return t;
  };
  const match = (s, id) => {
    const m = s.matches.find((m) => m.id === id);
    check(m, "NOT_FOUND", "경기를 찾을 수 없어요.");
    return m;
  };
  const participant = (s, a, m) =>
    a.admin ||
    m.refereeId === a.userId ||
    [m.teamA, m.teamB].some((id) => {
      const t = team(s, id);
      return (
        t.members.includes(a.userId) &&
        [t.captainId, t.viceId].includes(a.userId)
      );
    });
  const admin = (a) =>
    check(a.admin, "FORBIDDEN", "운영진만 처리할 수 있어요.");
  const terminal = (m) =>
    ["final", "cancelled", "abandoned", "forfeit"].includes(m.status);
  const closed = (m) =>
    ["cancelled", "abandoned", "forfeit"].includes(m.status);
  const settings = {
    publicConsentVersion: PRIVACY.publicVersion,
    publicConsentNotice: PRIVACY.publicNotice,
    privacyVersion: PRIVACY.collectionVersion,
    clockMode: "running",
    refereeCount: 1,
    competitionPhase: "regular",
    seasonEndsAt: null,
    privacyNotice: PRIVACY.collectionNotice,
  };
  function upgrade(s) {
    let changed = false;
    for (const key of ["invitations", "notifications", "sanctions", "seasons"])
      if (!s[key]) {
        s[key] = [];
        changed = true;
      }
    for (const [key, value] of Object.entries(settings))
      if (s.settings[key] === undefined) {
        s.settings[key] = value;
        changed = true;
      }
    for (const p of s.profiles)
      if ("birthday" in p) {
        delete p.birthday;
        changed = true;
      }
    return changed;
  }
  function notify(s, ctx, kind, teamId, entityId) {
    if (
      s.notifications.some(
        (n) =>
          n.kind === kind && n.teamId === teamId && n.entityId === entityId,
      )
    )
      return;
    s.notifications.push({
      id: ctx.id(),
      kind,
      teamId,
      entityId,
      createdAt: ctx.now,
      readBy: [],
    });
  }
  function scheduleStatus(m) {
    if (
      terminal(m) ||
      Object.keys(m.submissions).length ||
      m.status === "review"
    )
      return;
    const assigned = isUnrefereed(m) || m.refereeId || m.externalReferee?.accepted;
    const both = [m.teamA, m.teamB].every(
      (id) =>
        m.rosters[id]?.length >= (m.playersPerSide || 5) &&
        (!m.scheduleConfirmations ||
          m.scheduleConfirmations[id] === m.scheduleVersion),
    );
    m.status = !assigned
      ? "awaiting_referee"
      : both
        ? "scheduled"
        : "awaiting_opponent";
  }
  function scrub(value, id) {
    if (Array.isArray(value))
      return value
        .filter((x) => x !== id && !(x && typeof x === "object" && x.id === id))
        .map((x) => scrub(x, id));
    if (!value || typeof value !== "object") return value === id ? null : value;
    const out = {};
    for (const [key, v] of Object.entries(value))
      if (key !== id) out[key] = scrub(v, id);
    return out;
  }
  function erase(s, id) {
    s.players = s.players.filter((p) => p.id !== id);
    s.profiles = s.profiles.filter((p) => p.id !== id);
    s.memberships = s.memberships.filter((p) => p.playerId !== id);
    s.requests = s.requests.filter(
      (r) => ![r.playerId, r.requesterId, r.captainId, r.viceId].includes(id),
    );
    s.issues = s.issues.filter((i) => i.reporterId !== id);
    s.audit = s.audit.filter((a) => a.actorId !== id);
    s.outbox = s.outbox.filter(
      (j) =>
        j.entityId !== id &&
        (j.recipients === "admins" || !j.recipients.includes(id)),
    );
    s.sanctions = s.sanctions.filter((x) => x.playerId !== id);
    for (const t of s.teams) {
      t.members = t.members.filter((p) => p !== id);
      if (t.pendingMembers)
        t.pendingMembers = t.pendingMembers.filter((p) => p !== id);
      for (const key of ["captainId", "viceId", "requesterId"])
        if (t[key] === id) t[key] = null;
    }
    for (let i = 0; i < s.matches.length; i++) {
      const m = s.matches[i];
      if (
        !terminal(m) &&
        (m.refereeId === id ||
          Object.values(m.submissions).some((sub) =>
            sub.players.some((p) => p.id === id),
          ))
      ) {
        m.status = "review";
        m.privacyReviewRequired = true;
      }
      m.history = m.history.filter((h) => h.changedBy !== id);
      s.matches[i] = scrub(m, id);
    }
    const removed = s.invitations
      .filter((r) => r.requesterId === id)
      .map((r) => r.id);
    s.invitations = s.invitations
      .filter((r) => r.requesterId !== id)
      .map((r) => scrub(r, id));
    s.notifications = s.notifications
      .filter((r) => !removed.includes(r.entityId))
      .map((r) => scrub(r, id));
  }
  function isSuspended(s, id, m) {
    return (s.sanctions || []).some(
      (x) =>
        x.playerId === id &&
        x.matchId !== m.id &&
        x.startsAt < m.startsAt &&
        (x.remaining > 0 || (x.servedAt && m.startsAt <= x.servedAt)),
    );
  }
  function finalized(s, m, ctx) {
    s.sanctions = s.sanctions.filter((x) => !x.automatic);
    for (const x of s.sanctions) {
      x.remaining = x.total;
      delete x.servedBy;
      delete x.servedAt;
    }
    const finals = s.matches
      .filter((x) => x.status === "final" || x.officialRecord)
      .map((x) => (x.status === "final" ? x : x.officialRecord))
      .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
    for (const game of finals) {
      for (const x of s.sanctions) {
        const h = s.memberships.find(
          (h) =>
            h.playerId === x.playerId &&
            h.joinedAt <= game.startsAt &&
            (h.leftAt === null || h.leftAt >= game.startsAt),
        );
        if (
          x.remaining > 0 &&
          x.startsAt < game.startsAt &&
          h &&
          [game.teamA, game.teamB].includes(h.teamId)
        ) {
          x.remaining--;
          x.servedBy = game.id;
          x.servedAt = game.startsAt;
        }
      }
      for (const sub of Object.values(game.submissions))
        for (const id of sub.redCards || [])
          if (s.players.some((p) => p.id === id))
            s.sanctions.push({
              id: "red-" + game.id + "-" + id,
              playerId: id,
              matchId: game.id,
              startsAt: game.startsAt,
              remaining: 1,
              automatic: true,
            });
    }
  }
  function maintain(s, now) {
    let changed = upgrade(s);
    const cutoff = now - 90 * day;
    for (const key of ["audit", "notifications", "invitations", "outbox"]) {
      const next = s[key].filter((x) => (x.at || x.createdAt || now) >= cutoff);
      if (next.length !== s[key].length) {
        s[key] = next;
        changed = true;
      }
    }
    const ctx = {
      now,
      id: () => "notice-" + now + "-" + s.notifications.length,
    };
    const alert = (m, kind) => {
      if (!s.outbox.some((j) => j.kind === kind && j.entityId === m.id)) {
        s.outbox.push({
          id: "reminder-" + m.id + "-" + kind,
          kind,
          recipients: "admins",
          entityId: m.id,
          status: "pending",
          attempts: 0,
          createdAt: now,
        });
        changed = true;
      }
    };
    for (const m of s.matches)
      if (!terminal(m)) {
        if (
          m.startsAt <= now + day &&
          m.startsAt > now &&
          !isUnrefereed(m) && !m.refereeId &&
          !m.externalReferee?.accepted
        ) {
          const count = s.notifications.length;
          [m.teamA, m.teamB].forEach((id) =>
            notify(s, ctx, "refereeUnassigned", id, m.id),
          );
          if (count !== s.notifications.length) changed = true;
        }
        if (now >= m.startsAt + matchDuration(m) + 2 * day && m.status !== "ready")
          alert(m, "resultOverdue");
        if (m.status === "ready" && m.readyAt && now >= m.readyAt + day)
          alert(m, "approvalOverdue");
      }
    const ends = Number(s.settings.seasonEndsAt);
    if (
      ends > 0 &&
      !s.seasons.some((x) => x.id === s.settings.seasonId && x.endsAt === ends)
    ) {
      s.seasons = s.seasons.filter((x) => x.id !== s.settings.seasonId);
      s.seasons.push({ id: s.settings.seasonId, endsAt: ends });
      changed = true;
    }
    for (const m of s.matches)
      if (
        s.seasons.some(
          (x) => x.id === m.seasonId && now >= x.endsAt + 2 * 365 * day,
        ) &&
        !m.personalRecordsExpired
      ) {
        for (const key of [
          "rosters",
          "history",
          "submissions",
          "officialRecord",
        ]) {
          if (key === "submissions" || key === "officialRecord") continue;
          m[key] = key === "history" ? [] : {};
        }
        for (const record of [m, m.officialRecord].filter(Boolean)) {
          for (const sub of Object.values(record.submissions || {})) {
            sub.players = [];
            sub.goals = {};
            sub.ownGoals = {};
            sub.redCards = [];
            sub.submittedBy = null;
          }
          record.refereeId = null;
          record.finalizedBy = null;
        }
        m.refereeRequests = [];
        m.personalRecordsExpired = true;
        changed = true;
      }
    return changed;
  }
  function apply(s, actor, command, args, ctx, api) {
    const done = (entityId) => ({ handled: true, entityId });
    switch (command) {
      case "inviteMatch": {
        const t = leader(s, actor, args.teamId),
          other = team(s, args.opponentId);
        check(
          t.id !== other.id &&
            t.status === "active" &&
            other.status === "active",
          "INACTIVE_TEAM",
          "활동 중인 다른 팀에 제안해 주세요.",
        );
        check(
          !s.invitations.some(
            (i) =>
              [i.fromTeam, i.toTeam].includes(t.id) &&
              [i.fromTeam, i.toTeam].includes(other.id) &&
              i.status === "pending",
          ),
          "ALREADY_REQUESTED",
          "두 팀 사이에 이미 답변 대기 중인 경기 제안이 있어요.",
        );
        check(
          s.invitations.filter(
            (i) => i.fromTeam === t.id && i.createdAt > ctx.now - day,
          ).length < 10 &&
            !s.invitations.some(
              (i) =>
                i.fromTeam === t.id &&
                i.toTeam === other.id &&
                i.createdAt > ctx.now - day,
            ),
          "RATE_LIMITED",
          "같은 팀에는 하루 한 번, 전체 하루 10건까지 제안할 수 있어요.",
        );
        const i = {
          id: ctx.id(),
          fromTeam: t.id,
          toTeam: other.id,
          requesterId: actor.userId,
          message: text(args.message),
          status: "pending",
          createdAt: ctx.now,
        };
        s.invitations.push(i);
        notify(s, ctx, "matchInvitation", other.id, i.id);
        return done(i.id);
      }
      case "respondInvitation": {
        const i = s.invitations.find((i) => i.id === args.invitationId);
        check(i, "NOT_FOUND", "제안을 찾을 수 없어요.");
        check(
          i.status === "pending",
          "INVALID_STATE",
          "이미 처리한 제안이에요.",
        );
        check(
          ["accept", "decline", "cancel"].includes(args.response),
          "INVALID_INPUT",
          "응답을 선택해 주세요.",
        );
        leader(s, actor, args.response === "cancel" ? i.fromTeam : i.toTeam);
        i.status = {
          accept: "accepted",
          decline: "declined",
          cancel: "cancelled",
        }[args.response];
        i.respondedAt = ctx.now;
        i.respondedBy = actor.userId;
        notify(
          s,
          ctx,
          "invitationResponse",
          args.response === "cancel" ? i.toTeam : i.fromTeam,
          i.id,
        );
        return done(i.id);
      }
      case "readNotification": {
        const n = s.notifications.find((n) => n.id === args.notificationId);
        check(n, "NOT_FOUND", "알림을 찾을 수 없어요.");
        leader(s, actor, n.teamId);
        if (!n.readBy.includes(actor.userId)) n.readBy.push(actor.userId);
        return done(n.id);
      }
      case "withdrawAccount": {
        check(
          args.confirmed === true,
          "CONFIRMATION_REQUIRED",
          "회원 탈퇴를 다시 확인해 주세요.",
        );
        const p = s.players.find((p) => p.id === actor.userId);
        check(p, "NOT_REGISTERED", "등록된 선수가 아니에요.");
        const vacancies = s.teams
          .filter((t) => [t.captainId, t.viceId].includes(actor.userId))
          .map((t) => t.id);
        const refereeing = s.matches
          .filter((m) => m.refereeId === actor.userId && !terminal(m))
          .map((m) => m.id);
        erase(s, actor.userId);
        vacancies.forEach((id) =>
          api.enqueue(s, ctx, "teamVacancy", "admins", id),
        );
        refereeing.forEach((id) =>
          api.enqueue(s, ctx, "matchIncident", "admins", id),
        );
        return done(null);
      }
      case "recordSanction": {
        admin(actor);
        check(
          s.players.some((p) => p.id === args.playerId),
          "NOT_FOUND",
          "등록 선수를 선택해 주세요.",
        );
        check(
          Number.isInteger(args.games) && args.games >= 1 && args.games <= 20,
          "INVALID_INPUT",
          "출전 정지 횟수는 1~20회로 입력해 주세요.",
        );
        const x = {
          id: ctx.id(),
          playerId: args.playerId,
          total: args.games,
          remaining: args.games,
          startsAt: ctx.now,
          reason: text(args.reason, 1000),
          issuedBy: actor.userId,
          createdAt: ctx.now,
          automatic: false,
        };
        s.sanctions.push(x);
        return done(x.id);
      }
      case "proposeScheduleChange": {
        const m = match(s, args.matchId);
        const t = leader(s, actor, args.teamId);
        check(
          [m.teamA, m.teamB].includes(t.id),
          "FORBIDDEN",
          "우리 팀 경기만 변경할 수 있어요.",
        );
        check(
          !terminal(m) && m.startsAt > ctx.now && !m.scheduleChange,
          "INVALID_STATE",
          "변경 대기 중이 아닌 예정 경기만 변경할 수 있어요.",
        );
        check(
          Number.isFinite(args.startsAt) && args.startsAt > ctx.now,
          "INVALID_DATE",
          "미래 일시를 선택해 주세요.",
        );
        m.scheduleChange = {
          teamId: t.id,
          startsAt: args.startsAt,
          place: text(args.place, 120),
          createdAt: ctx.now,
        };
        notify(
          s,
          ctx,
          "scheduleChange",
          t.id === m.teamA ? m.teamB : m.teamA,
          m.id,
        );
        return done(m.id);
      }
      case "respondScheduleChange": {
        const m = match(s, args.matchId),
          change = m.scheduleChange,
          t = leader(s, actor, args.teamId);
        check(
          change &&
            t.id !== change.teamId &&
            [m.teamA, m.teamB].includes(t.id) &&
            !terminal(m) &&
            m.startsAt > ctx.now,
          "FORBIDDEN",
          "상대 팀의 예정 일정 변경만 응답할 수 있어요.",
        );
        if (args.accepted === true) {
          check(
            change.startsAt > ctx.now,
            "INVALID_DATE",
            "변경 일시가 지났어요.",
          );
          check(
            !s.matches.some(
              (x) =>
                x.id !== m.id &&
                !closed(x) &&
                x.startsAt === change.startsAt &&
                [x.teamA, x.teamB].includes(m.teamA) &&
                [x.teamA, x.teamB].includes(m.teamB),
            ),
            "DUPLICATE_MATCH",
            "같은 대진과 일시가 이미 있어요.",
          );
          m.history.push({
            version: m.version,
            note: "양 팀 일정 변경 합의",
            changedAt: ctx.now,
          });
          const deadlines = [
            m.seasonEndsAt,
            m.seasonId === s.settings.seasonId ? s.settings.seasonEndsAt : null,
            ...s.seasons.filter((season) => season.id === m.seasonId).map((season) => season.endsAt),
          ].map(Number).filter((end) => Number.isFinite(end) && end > 0);
          check(!deadlines.length || change.startsAt + matchDuration(m) <= Math.min(...deadlines), "SEASON_ENDED", "해당 시즌 종료 전 끝나는 경기만 등록할 수 있어요.");
          m.startsAt = change.startsAt;
          m.place = change.place;
          m.scheduleVersion++;
          m.version++;
          m.confirmations = {};
          m.submissions = {};
          m.scheduleConfirmations = {};
          m.refereeId = null;
          if (m.externalReferee) m.externalReferee.accepted = false;
          const candidates = [
            ...new Set(m.refereeRequests.map((r) => r.playerId)),
          ].filter((id) => api.neutral(s, id, m));
          m.refereeRequests = candidates.map((id) => ({
            playerId: id,
            status: "pending",
            scheduleVersion: m.scheduleVersion,
          }));
          candidates.forEach((id) =>
            api.enqueue(s, ctx, "refereeRequest", [id], m.id),
          );
          m.status = "awaiting_referee";
          scheduleStatus(m);
        }
        delete m.scheduleChange;
        return done(m.id);
      }
      case "requestCancellation": {
        const m = match(s, args.matchId),
          t = leader(s, actor, args.teamId);
        check(
          [m.teamA, m.teamB].includes(t.id) &&
            m.startsAt > ctx.now &&
            !terminal(m) &&
            !m.cancellation,
          "INVALID_STATE",
          "예정 경기의 취소를 요청해 주세요.",
        );
        m.cancellation = {
          teamId: t.id,
          reason: text(args.reason),
          createdAt: ctx.now,
        };
        notify(
          s,
          ctx,
          "cancellation",
          t.id === m.teamA ? m.teamB : m.teamA,
          m.id,
        );
        return done(m.id);
      }
      case "respondCancellation": {
        const m = match(s, args.matchId),
          t = leader(s, actor, args.teamId);
        check(
          m.cancellation &&
            [m.teamA, m.teamB].includes(t.id) &&
            m.cancellation.teamId !== t.id &&
            m.startsAt > ctx.now &&
            !terminal(m),
          "FORBIDDEN",
          "상대 팀 취소 요청만 확인할 수 있어요.",
        );
        if (args.accepted === true) {
          m.status = "cancelled";
          m.cancelledAt = ctx.now;
          m.confirmations = {};
          m.refereeRequests.forEach((r) => {
            if (r.status === "pending") r.status = "closed";
          });
        }
        delete m.cancellation;
        return done(m.id);
      }
      case "reportIncident": {
        const m = match(s, args.matchId);
        check(
          participant(s, actor, m),
          "FORBIDDEN",
          "경기 대표·담당 심판·운영진만 보고할 수 있어요.",
        );
        check(
          !terminal(m),
          "INVALID_STATE",
          "종료 처리 전 경기만 보고할 수 있어요.",
        );
        check(
          [
            "unsafe",
            "no_referee",
            "no_show",
            "insufficient",
            "abandoned",
          ].includes(args.kind),
          "INVALID_INPUT",
          "예외 유형을 선택해 주세요.",
        );
        if (args.kind === "no_show")
          check(
            ctx.now >= m.startsAt + 10 * 60000,
            "TOO_EARLY",
            "예정 시각부터 10분 대기 후 불참을 보고해 주세요.",
          );
        check(
          !m.incident,
          "ALREADY_REQUESTED",
          "운영진 검토 중인 예외가 있어요.",
        );
        m.incident = {
          kind: args.kind,
          reason: text(args.reason, 1000),
          reportedBy: actor.userId,
          reportedAt: ctx.now,
        };
        m.status = "review";
        m.confirmations = {};
        api.enqueue(s, ctx, "matchIncident", "admins", m.id);
        return done(m.id);
      }
      case "resolveIncident": {
        admin(actor);
        const m = match(s, args.matchId);
        check(
          m.incident && !terminal(m),
          "INVALID_STATE",
          "보고된 예외 경기를 확인해 주세요.",
        );
        check(
          ["cancelled", "abandoned", "forfeit", "resume"].includes(
            args.outcome,
          ),
          "INVALID_INPUT",
          "처리 결과를 선택해 주세요.",
        );
        const reason = text(args.reason, 1000);
        m.history.push({
          version: m.version,
          submissions: copy(m.submissions),
          note: reason,
          changedAt: ctx.now,
          changedBy: actor.userId,
        });
        m.version++;
        m.confirmations = {};
        m.incident.resolution = reason;
        m.incident.resolvedAt = ctx.now;
        if (args.outcome === "resume") {
          delete m.incident;
          delete m.privacyReviewRequired;
          api.updateMatchState(s, m, ctx);
        } else {
          m.status = args.outcome;
          m.administrativeScore = null;
          if (args.outcome === "forfeit") {
            check(
              [m.teamA, m.teamB].includes(args.winnerId),
              "INVALID_INPUT",
              "몰수 승리 팀을 선택해 주세요.",
            );
            m.administrativeScore = {
              a: args.winnerId === m.teamA ? 3 : 0,
              b: args.winnerId === m.teamB ? 3 : 0,
            };
          }
          m.submissions = {};
          m.allowReplay = args.outcome === "abandoned";
        }
        s.ratingLedger = api.ledger(s);
        return done(m.id);
      }
      case "requestFinalCorrection": {
        const m = match(s, args.matchId);
        check(
          participant(s, actor, m),
          "FORBIDDEN",
          "경기 대표·담당 심판·운영진만 요청할 수 있어요.",
        );
        check(
          m.status === "final" &&
            (ctx.now <= m.finalizedAt + 7 * day ||
              (actor.admin && args.serious === true)),
          "CORRECTION_CLOSED",
          "확정 후 7일 이내 정정을 요청해 주세요.",
        );
        check(
          !s.issues.some(
            (i) =>
              i.matchId === m.id &&
              i.type === "correction" &&
              i.status === "open",
          ),
          "ALREADY_REQUESTED",
          "이미 정정 검토 중이에요.",
        );
        const i = {
          id: ctx.id(),
          type: "correction",
          matchId: m.id,
          reporterId: actor.userId,
          message: text(args.reason, 1000),
          createdAt: ctx.now,
          status: "open",
        };
        s.issues.push(i);
        api.enqueue(s, ctx, "dispute", "admins", m.id);
        return done(i.id);
      }
      case "requestCorrection": {
        const m = match(s, args.matchId);
        if (m.status !== "final") return { handled: false };
        admin(actor);
        check(
          s.issues.some(
            (i) =>
              i.matchId === m.id &&
              i.type === "correction" &&
              i.status === "open",
          ),
          "CORRECTION_REQUIRED",
          "먼저 정정 요청과 증거를 검토해 주세요.",
        );
        m.officialRecord = copy(m);
        delete m.officialRecord.history;
        delete m.officialRecord.officialRecord;
        m.history.push({
          version: m.version,
          submissions: copy(m.submissions),
          note: text(args.reason, 1000),
          changedAt: ctx.now,
          changedBy: actor.userId,
        });
        s.issues
          .filter(
            (i) =>
              i.matchId === m.id &&
              i.type === "correction" &&
              i.status === "open",
          )
          .forEach((i) => {
            i.status = "resolved";
            i.resolvedAt = ctx.now;
          });
        m.status = "awaiting_results";
        m.version++;
        m.confirmations = {};
        m.correctionOpen = true;
        return done(m.id);
      }
      default:
        return { handled: false };
    }
  }
  return {
    settings,
    upgrade,
    maintain,
    apply,
    notify,
    scheduleStatus,
    terminal,
    closed,
    erase,
    isSuspended,
    finalized,
  };
})();
