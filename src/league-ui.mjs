import { isUnrefereed, matchDuration, formatLabel } from "./competition.mjs";
import { PRIVACY } from "./privacy-content.mjs";
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (t) =>
  new Date(t).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const statusNames = {
  active: "리그 참가 중",
  paused: "참가 유예",
  excluded: "리그 제외",
  pending: "승인 대기",
  invitation_pending: "답변 대기",
  needs_changes: "보완 요청",
  awaiting_referee: "심판 배정 대기 · 공식 등록 보류",
  awaiting_opponent: "상대 팀 일정·명단 확인 대기",
  scheduled: "공식 일정 등록",
  awaiting_results: "양 팀 결과 대기",
  awaiting_confirmations: "양 팀 재확인 대기",
  mismatch: "스코어 불일치 · 확정 보류",
  review: "이의 검토 중",
  ready: "최종 승인 대기",
  final: "공식 확정",
  accepted: "수락",
  declined: "거절",
  closed: "요청 종료",
  sent: "발송 완료",
  failed: "발송 실패",
  sending: "발송 확인 중",
  uncertain: "발송 결과 확인 필요",
  cancelled: "취소",
  abandoned: "중단 · 재경기",
  forfeit: "행정 몰수 · Elo 제외",
};
const badge = (s) =>
  `<span class="badge ${["mismatch", "review", "paused", "awaiting_referee"].includes(s) ? "orange" : ""}">${e(statusNames[s] || s)}</span>`;
const empty = (message) => `<div class="empty"><p>${e(message)}</p></div>`;
const input = (name, label, type = "text", value = "", attrs = "") =>
  `<label class="form-field">${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${attrs}></label>`;
const select = (name, label, options, value = "") =>
  `<label class="form-field">${e(label)}<select name="${name}">${options.map(([id, text]) => `<option value="${e(id)}" ${id === value ? "selected" : ""}>${e(text)}</option>`).join("")}</select></label>`;
function shuffled(rows) {
  const result = [...rows];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
async function dialog(
  title,
  message,
  {
    reason = false,
    external = false,
    confirmLabel = "확인하기",
    reasonLabel = "사유",
    maxLength = 1000,
  } = {},
) {
  const d = document.createElement("dialog");
  d.className = "confirm-dialog";
  d.innerHTML = `<form method="dialog"><h2>${e(title)}</h2><p>${e(message)}</p>${reason ? `<label class="form-field">${e(reasonLabel)}<textarea name="reason" required maxlength="${maxLength}" rows="4"></textarea></label>` : ""}${external ? '<label class="check-line"><input type="checkbox" required>외부 심판 하에 경기가 진행된 것을 확인했어요.</label>' : ""}<div class="actions"><button class="button secondary" value="cancel" type="button">취소</button><button class="button" value="ok">${e(confirmLabel)}</button></div></form>`;
  document.body.append(d);
  d.showModal();
  return new Promise((resolve) => {
    d.querySelector("[value=cancel]").onclick = () => d.close("cancel");
    d.addEventListener(
      "close",
      () => {
        const result =
          d.returnValue === "ok"
            ? reason
              ? d.querySelector("textarea").value
              : true
            : false;
        d.remove();
        resolve(result);
      },
      { once: true },
    );
  });
}
export function createLeagueUI({
  content,
  transport,
  onLogout = async () => {},
  isAuthenticated = () => false,
  development = false,
}) {
  let view = null,
    route = "",
    filter = "all",
    boardSeason = "",
    order = [],
    previousPath = "",
    timer,
    busy = false,
    dirty = false,
    ticket = 0;
  const player = (id) =>
      view?.players.find((p) => p.id === id) ||
      view?.examples?.players.find((p) => p.id === id),
    team = (id) =>
      view?.teams.find((t) => t.id === id) ||
      view?.applications?.find((t) => t.id === id) ||
      view?.adminData?.teams.find((t) => t.id === id) ||
      view?.examples?.teams.find((t) => t.id === id);
  const name = (id) => player(id)?.name || "공석",
    teamName = (id) => team(id)?.name || "팀",
    myTeam = () => team(view?.me?.teamId);
  const heading = (eyebrow, title, description = "") =>
    `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${e(title)}</h1>${description ? `<p class="muted">${e(description)}</p>` : ""}</div></div>`;
  function tabs() {
    const m = view.me;
    if (!m) return "";
    const unread = (view.notifications || []).filter(
      (n) => !n.readBy.includes(m.id),
    ).length;
    const items = [
      ["activity", "내 선수 활동" + (unread ? ` · 새 알림 ${unread}` : "")],
    ];
    if (m.player) {
      if (m.isLeader)
        items.push(
          ["manage", "팀 관리"],
          ["schedule", "경기 일정 등록"],
          ["results", "경기 결과 등록"],
        );
      if (m.player.referee) items.push(["referee", "심판 활동"]);
    }
    if (m.admin) items.push(["admin", "운영 관리"]);
    return `<nav class="activity-tabs" aria-label="내 활동 메뉴">${items.map(([id, label]) => `<a href="#${id}" ${route === id ? 'aria-current="page"' : ""}>${label}</a>`).join("")}<button class="text-button" id="logout">로그아웃</button></nav>`;
  }
  const form = (id, body, button) =>
    `<form id="${id}" data-revision="${view.revision}" class="panel form-panel">${body}<button class="button" type="submit">${button}</button></form>`;
  const options = (ids) => ids.map((id) => [id, name(id)]);
  function roster(
    ids,
    checked = [],
    goals = null,
    ownGoals = {},
    redCards = [],
  ) {
    return `<fieldset class="roster"><legend>${goals ? "우리 팀 실제 출전·득점" : "우리 팀 출전 예정 명단"}</legend><p class="muted caption">교체 선수를 포함해 경기 인원 이상, 최대 20명을 선택해 주세요. 6대6은 최소 6명이 필요해요.${goals ? " 자책골·퇴장은 우리 팀 선수만 기록해요." : ""}</p>${ids.map((id) => `<div class="roster-row"><label><input type="checkbox" name="roster" value="${e(id)}" ${checked.includes(id) ? "checked" : ""}><span>${e(name(id))}<small>${e(player(id)?.lab)}</small></span></label>${goals ? `<div class="roster-scores"><label class="goal-field">득점<input type="number" min="0" max="99" name="goal-${e(id)}" value="${goals[id] || 0}"></label><label class="goal-field">자책골<input type="number" min="0" max="99" name="own-${e(id)}" value="${ownGoals[id] || 0}"></label><label class="check-line"><input type="checkbox" name="redCards" value="${e(id)}" ${redCards.includes(id) ? "checked" : ""}>퇴장</label></div>` : ""}</div>`).join("")}</fieldset>`;
  }
  function feedback(message, error = false) {
    let node = content.querySelector("#feedback");
    if (!node) {
      node = document.createElement("p");
      node.id = "feedback";
      content.prepend(node);
    }
    node.className = `notice ${error ? "error" : ""}`;
    node.setAttribute("role", error ? "alert" : "status");
    node.textContent = message;
  }
  async function mutate(command, args, source) {
    if (busy) return;
    busy = true;
    const buttons = source?.querySelectorAll("button") || [];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const result = await transport("command", {
        command,
        args: {
          ...args,
          expectedRevision: Number(source?.dataset.revision ?? view.revision),
        },
      });
      if (result?.withdrawn) {
        await onLogout({ alreadyRevoked: true });
        location.hash = "#home";
        return;
      }
      dirty = false;
      await show(route, true);
      feedback("변경 사항을 저장했어요.");
    } catch (err) {
      feedback(err.message || "요청을 처리하지 못했어요.", true);
      if (["STALE_MATCH", "STALE"].includes(err.code)) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "button secondary";
        retry.textContent = "입력 내용을 버리고 최신 기록 불러오기";
        retry.onclick = () => void show(route, true);
        content
          .querySelector("#feedback")
          .append(document.createElement("br"), retry);
      }
    } finally {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  function bindForm(id, fn) {
    const node = content.querySelector("#" + id);
    if (node)
      node.onsubmit = async (ev) => {
        ev.preventDefault();
        if (node.reportValidity())
          try {
            await fn(new FormData(node), node);
          } catch (err) {
            feedback(err.message, true);
          }
      };
  }
  function click(id, fn) {
    const b = content.querySelector("#" + id);
    if (b) b.onclick = () => void fn(b);
  }
  function directory(kind) {
    const isTeam = kind === "teams";
    const actual = isTeam ? view.teams : view.players,
      examples = (isTeam ? view.examples?.teams : view.examples?.players) || [],
      entries = [...actual, ...examples];
    if (previousPath !== route) {
      order = shuffled(entries.map((p) => p.id));
      filter = "all";
      previousPath = route;
    }
    const known = new Set(order);
    order.push(
      ...shuffled(entries.filter((p) => !known.has(p.id)).map((p) => p.id)),
    );
    const byId = new Map(entries.map((p) => [p.id, p]));
    const rows = order.map((id) => byId.get(id)).filter(Boolean);
    content.innerHTML =
      heading(
        isTeam ? "OUR TEAMS" : "OUR PLAYERS",
        isTeam ? "우리 리그의 팀들" : "함께 뛰는 사람들",
        isTeam
          ? "서로 다른 연구실의 우리가, 하나의 팀으로."
          : "이름과 연구실 너머, 경기장에서 만나는 우리.",
      ) +
      (examples.length
        ? '<p class="notice">샘플 카드가 포함되어 있어요. 가상의 팀·선수이며 실제 등록 인원이나 랭킹에 포함되지 않아요. 샘플에는 가입·영입·경기 요청을 보낼 수 없어요.</p>'
        : "") +
      (isTeam
        ? `<div class="list-toolbar"><p class="muted">등록 ${actual.length}개 팀${examples.length ? ` · 샘플 ${examples.length}개 팀` : ""} · 방문할 때마다 다른 순서로 만나요</p><a href="#team-new" class="button secondary small">우리 팀 등록하기</a></div>`
        : `<div class="tabs" role="group" aria-label="선수 필터">${[
            ["all", "전체"],
            ["member", "팀 소속"],
            ["free", "무소속"],
            ["referee", "심판"],
          ]
            .map(
              ([id, label]) =>
                `<button class="tab" data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`,
            )
            .join("")}</div><p class="muted caption" id="result-count"></p>`) +
      `<div class="${isTeam ? "team-grid" : "player-grid"}" id="directory-cards"></div>`;
    function cards() {
      const filtered = rows.filter(
        (p) =>
          isTeam ||
          filter === "all" ||
          (filter === "member" && p.teamId) ||
          (filter === "free" && !p.teamId) ||
          (filter === "referee" && p.referee),
      );
      content.querySelector("#directory-cards").innerHTML = filtered.length
        ? filtered.map((p) => (isTeam ? teamCard(p) : playerCard(p))).join("")
        : empty("아직 해당하는 등록 정보가 없어요.");
      const count = content.querySelector("#result-count");
      if (count)
        count.textContent = `등록 선수 ${filtered.filter((p) => !p.example).length}명${examples.length ? ` · 샘플 ${filtered.filter((p) => p.example).length}명` : ""}`;
    }
    content.querySelectorAll("[data-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          filter = b.dataset.filter;
          content
            .querySelectorAll("[data-filter]")
            .forEach((t) => t.setAttribute("aria-pressed", String(t === b)));
          cards();
        }),
    );
    cards();
    bindInvitations();
  }
  function image(t) {
    return t.image
      ? `<img src="${e(t.image)}" alt="${e(t.name)} 대표 이미지" class="team-image">`
      : `<div class="team-emblem" aria-hidden="true"><div class="emblem-shield">IG<br>FL</div><span>OUR LAB. OUR TEAM.</span></div>`;
  }
  function teamCard(t) {
    const labs = [
      ...new Set(t.members.map((id) => player(id)?.lab).filter(Boolean)),
    ];
    return `<article class="team-card"><a href="#team/${e(t.id)}"><div class="team-cover">${image(t)}${t.recruiting ? `<span class="recruitment">선수 모집 중${t.example ? " · 예시" : ""}</span>` : ""}</div><div class="team-card-body">${t.example ? '<span class="badge">샘플 팀</span>' : ""}<h2>${e(t.name)}</h2><p>${e(t.description)}</p><dl><div><dt>주장</dt><dd>${e(name(t.captainId))}</dd><dt>부주장</dt><dd>${e(name(t.viceId))}</dd></div></dl><div class="lab-tags">${labs.map((l) => `<span>${e(l)}</span>`).join("")}</div><div class="card-foot"><span>${t.members.length}명</span>${t.status !== "active" ? badge(t.status) : "<span>팀 만나보기 ↗</span>"}</div></div></a>${invitationButton(t)}</article>`;
  }
  function invitationButton(t) {
    if (
      t.example ||
      !view.me?.isLeader ||
      t.id === view.me.teamId ||
      t.status !== "active" ||
      myTeam()?.status !== "active"
    )
      return "";
    const pending = (view.invitations || []).some(
      (i) =>
        [i.fromTeam, i.toTeam].includes(t.id) &&
        (i.status === "pending" ||
          (i.fromTeam === view.me.teamId &&
            i.createdAt > Date.now() - 86400000)),
    );
    return `<div class="team-card-action">${pending ? '<a href="#activity" class="button secondary small">경기 제안 확인하기</a>' : `<button class="button secondary small" data-invite="${e(t.id)}">경기 제안하기 ↗</button>`}</div>`;
  }
  function bindInvitations() {
    content.querySelectorAll("[data-invite]").forEach(
      (b) =>
        (b.onclick = async () => {
          const t = team(b.dataset.invite),
            message = await dialog(
              `${t.name}에 경기를 제안할까요?`,
              `${myTeam().name}의 이름으로 상대 주장·부주장에게 홈페이지 알림을 보내요. 수락 후 일정을 협의하며, 공식 경기 등록은 별도로 진행해요.`,
              {
                reason: true,
                reasonLabel: "경기 제안 메시지",
                maxLength: 500,
                confirmLabel: "경기 제안 보내기",
              },
            );
          if (message)
            await mutate("inviteMatch", {
              teamId: view.me.teamId,
              opponentId: t.id,
              message,
            });
        }),
    );
  }
  function invitationInbox() {
    if (!view.me.isLeader) return "";
    const t = myTeam(),
      invitations = [...(view.invitations || [])].sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    return `<section class="panel spaced"><div class="section-heading"><h2>경기 제안·알림</h2><a class="text-button" href="#teams">상대 팀 찾아보기 ↗</a></div><p class="muted caption">주장·부주장이 함께 확인해요. 제안 수락은 공식 일정 확정이 아니에요.</p>${
      invitations
        .map((i) => {
          const received = i.toTeam === t.id,
            other = received ? i.fromTeam : i.toTeam;
          return `<article class="invitation-item"><div><span class="badge">${received ? "받은 제안" : "보낸 제안"}</span> ${badge(i.status === "pending" ? "invitation_pending" : i.status)}<h3>${e(teamName(other))}${received ? "에서 함께 경기하고 싶어해요." : "에 보낸 경기 제안"}</h3><p class="invitation-message">${e(i.message)}</p><small class="muted">${date(i.createdAt)}</small></div><div class="actions">${i.status === "pending" ? (received ? `<button class="button small" data-invitation="${e(i.id)}" data-response="accept">일정 협의 수락</button><button class="button secondary small" data-invitation="${e(i.id)}" data-response="decline">거절</button>` : `<button class="text-button" data-invitation="${e(i.id)}" data-response="cancel">제안 취소</button>`) : i.status === "accepted" ? `<a class="button secondary small" href="#schedule/${e(other)}">이 팀과 경기 일정 등록</a>` : ""}</div></article>`;
        })
        .join("") || '<p class="muted">아직 주고받은 경기 제안이 없어요.</p>'
    }${(view.notifications || [])
      .filter((n) => !n.readBy.includes(view.me.id))
      .map(
        (n) =>
          `<div class="notification-row"><span>${e({ matchInvitation: "새 경기 제안이 도착했어요.", invitationResponse: "경기 제안에 답변이 도착했어요.", refereeUnassigned: "24시간 이내 경기의 심판 배정이 필요해요.", scheduleChange: "상대 팀의 일정 변경 요청이 있어요.", cancellation: "상대 팀의 경기 취소 요청이 있어요." }[n.kind] || "팀 경기 알림이 있어요.")}</span><button class="text-button" data-read-notification="${e(n.id)}">읽음</button></div>`,
      )
      .join("")}</section>`;
  }
  function bindInbox() {
    content.querySelectorAll("[data-invitation]").forEach(
      (b) =>
        (b.onclick = () =>
          mutate("respondInvitation", {
            invitationId: b.dataset.invitation,
            response: b.dataset.response,
          })),
    );
    content.querySelectorAll("[data-read-notification]").forEach(
      (b) =>
        (b.onclick = () =>
          mutate("readNotification", {
            notificationId: b.dataset.readNotification,
          })),
    );
  }
  function playerCard(p) {
    return `<article class="player-card"><div class="avatar" aria-hidden="true">${e(p.name.slice(-2))}</div><p class="caption">${p.example ? "샘플 선수" : "IGFL 등록 선수"}${p.referee ? " / 심판" : ""}</p><h2>${e(p.name)}</h2><p>${e(p.lab)}</p><span class="${p.teamId ? "team-label" : "free-label"}">${p.teamId ? e(teamName(p.teamId)) : "무소속"}</span></article>`;
  }
  function teamDetail(id) {
    const t = team(id);
    if (!t) {
      content.innerHTML = empty("팀을 찾을 수 없어요.");
      return;
    }
    content.innerHTML = `<a class="back-link" href="#teams">← 팀 목록</a><section class="team-detail-hero"><div class="team-cover">${image(t)}</div><div><div class="eyebrow">OUR TEAM</div><h1>${e(t.name)}</h1>${t.recruiting ? '<span class="recruitment inline">선수 모집 중</span>' : ""}<p class="muted">${e(t.description)}</p>${t.example ? '<span class="badge">샘플 팀</span>' : badge(t.status)}${invitationButton(t)}<p>주장 ${e(name(t.captainId))} · 부주장 ${e(name(t.viceId))}</p>${t.graceEndsAt ? `<p class="notice">${date(t.graceEndsAt)}까지 6명을 충원하면 복귀해요.</p>` : ""}</div></section><h2>함께 뛰는 팀원 <span class="muted">${t.members.length}</span></h2><div class="player-grid">${t.members.map((id) => playerCard(player(id))).join("")}</div>${t.example ? '<section class="join-panel"><h2>화면을 소개하는 샘플 팀이에요</h2><p class="muted">가상의 선수와 연구실로 구성한 예시예요. 실제 가입·영입·경기 요청이나 랭킹 집계의 대상이 아니에요.</p></section>' : `<section class="join-panel"><h2>이 팀과 함께하고 싶다면</h2><p class="muted">홈페이지에서 주장·부주장에게 가입 문의를 남겨요. 개인 연락처는 공개하지 않아요.</p>${view.me?.player && !view.me.teamId ? form("join-form", '<label class="form-field">간단한 소개<textarea name="message" required rows="3" maxlength="500" placeholder="함께 뛰고 싶어요. 반가워요!"></textarea></label>', "가입 요청 보내기") : view.me?.teamId ? "<p>현재 소속 팀에서 탈퇴해 무소속이 된 후 가입을 요청할 수 있어요.</p>" : '<a class="button" href="#register">선수 등록하고 함께하기</a>'}</section>`}`;
    bindInvitations();
    bindForm("join-form", (fd, f) =>
      mutate("joinRequest", { teamId: id, message: fd.get("message") }, f),
    );
  }
  function ranking() {
    const boards = view.seasonBoards || [
      {
        id: view.settings.seasonId,
        name: view.settings.seasonName,
        records: view.records,
      },
    ];
    const board =
        boards.find((b) => b.id === (boardSeason || view.settings.seasonId)) ||
        boards[0],
      r = board.records;
    boardSeason = board.id;
    content.innerHTML =
      heading(
        "LEAGUE RECORDS",
        "랭킹보드",
        "한 경기씩, 함께 쌓아가는 우리 리그의 기록.",
      ) +
      `<nav class="season-select" aria-label="시즌 기록 선택">${boards.map((b) => `<button class="tab" data-season="${e(b.id)}" aria-pressed="${b.id === boardSeason}">${e(b.name)}</button>`).join("")}</nav><p class="caption muted">프리시즌과 정규리그는 별도로 집계하며, 각 시즌의 Elo는 1000에서 시작해요.</p><div class="season-strip"><span>${e(board.name)}</span><span>확정 경기 기준 · 30초마다 자동 갱신</span></div><section class="panel ranking-panel"><div class="section-heading"><h2>팀 파워랭킹</h2><span class="badge">ELO RATING</span></div>${r.teams.length ? `<div class="table-scroll"><table><thead><tr><th>순위</th><th>팀</th><th>Elo</th><th>경기</th><th>승 / 패</th><th>최근 변화</th></tr></thead><tbody>${r.teams.map((t) => `<tr><td>${t.rank}</td><td><a href="#team/${e(t.id)}">${e(t.name)}</a></td><td class="rating">${Math.round(t.rating)}</td><td>${t.played}</td><td>${t.won} / ${t.lost}</td><td class="delta">${t.change > 0 ? "+" : ""}${Math.round(t.change)}</td></tr>`).join("")}</tbody></table></div>` : empty("활동 중인 팀이 등록되면 파워랭킹이 시작돼요.")}<p class="caption muted">초기 1000 · K=32 · 상대 전력 반영 · 점수 차 제외 · 승부차기도 최종 승패로 계산해요.</p></section><div class="honors-grid"><section class="panel"><div class="eyebrow">GOAL SCORERS</div><h2>최근 득점 TOP 3</h2><p class="muted caption">선수별 이번 시즌 최근 출전 5경기 · 승부차기 제외</p>${r.scorers.length ? r.scorers.map((p) => `<div class="honor-row"><strong class="honor-rank">${p.rank}</strong><div><strong>${e(p.name)}</strong><small>${e(p.lab)} · 최근 ${p.appearances}경기</small></div><b>${p.goals}<small>골</small></b></div>`).join("") : empty("첫 득점 기록을 기다리고 있어요.")}</section><section class="panel"><div class="eyebrow">THANK YOU, REFEREES</div><h2>리그를 함께 만든 심판</h2><p class="muted caption">이번 시즌 공식 확정 경기의 내부 심판 활동 TOP 3</p>${r.referees.length ? r.referees.map((p) => `<div class="honor-row"><strong class="honor-rank">${p.rank}</strong><div><strong>${e(p.name)}</strong><small>${e(p.lab)}</small></div><b>${p.count}<small>경기</small></b></div>`).join("") : empty("심판의 첫 공식 활동을 기다리고 있어요.")}</section></div><p class="caption muted">동률은 공동순위로 표시하며, 3위 경계의 동률 선수를 모두 함께 보여줘요.</p>`;
    content.querySelectorAll("[data-season]").forEach((button) => {
      button.onclick = () => {
        boardSeason = button.dataset.season;
        ranking();
      };
    });
  }
  function registration() {
    const open = view.settings.registrationOpen;
    const privacyContact = view.settings.operationsContact || PRIVACY.contact;
    content.innerHTML =
      heading(
        "JOIN THE LEAGUE",
        "선수 등록",
        "선수 등록에 필요한 정보와 동의 안내를 확인해 주세요.",
      ) +
      tabs() +
      (!open
        ? '<p class="notice">선수 모집 개통을 준비 중이에요. 지금은 실제 선수 정보를 입력받지 않아요.</p>'
        : "") +
      `<p class="registration-notices"><a class="link" href="#privacy">개인정보 처리방침</a> · <a class="link" href="#consent">가입 동의 안내</a><br>운영 문의: <a class="link" href="mailto:${e(privacyContact)}">${e(privacyContact)}</a></p>` +
      form(
        "profile-form",
        `<div class="step-strip"><span>01 이메일 인증 완료</span><strong>02 선수 정보</strong><span>03 등록 완료</span></div><fieldset ${open ? "" : "disabled"}><div class="form-grid">${input("email", "인증한 이메일", "email", view.me.email, "readonly")}${input("name", "이름", "text", "", 'required maxlength="40"')}${select(
          "eligibility",
          "참가 자격",
          [
            ["graduate", "ISE·GSDS 대학원생"],
            ["staff", "ISE·GSDS 교직원"],
            ["advisor", "타 학과 대학원생 · 지도교수 ISE·GSDS"],
          ],
        )}<div id="department-field">${select("department", "소속 학과·부서", [
          ["ISE", "ISE"],
          ["GSDS", "GSDS"],
        ])}</div>${input("identifier", "학번", "text", "", 'required maxlength="30"')}${input("lab", "소속 연구실 (공개)", "text", "", 'required maxlength="100"')}<div id="advisor-field">${input("advisor", "지도교수", "text", "", 'required maxlength="60"')}</div><div id="advisor-department" hidden>${select(
          "advisorDepartment",
          "지도교수 소속",
          [
            ["ISE", "ISE"],
            ["GSDS", "GSDS"],
          ],
        )}</div>${select("teamId", "가입 문의할 팀 (선택)", [["", "무소속으로 시작하기"], ...view.teams.filter((t) => ["active", "paused"].includes(t.status)).map((t) => [t.id, t.name])])}</div><label class="check-line"><input type="checkbox" name="referee">심판으로도 함께할 수 있어요.</label><p class="notice">심판 수당은 경기당 20,000원이에요. 양 팀이 10,000원씩 심판에게 직접 지급해요.</p><div class="consent-box"><h3>개인정보 수집 및 이용 동의</h3><p class="caption muted">수집 목적·항목·보유 기간·거부 시 제한을 확인해 주세요. <a class="link" href="#consent">동의 안내 전문</a></p><p>${e(view.settings.privacyNotice || "선수 자격 확인·리그 운영을 위한 개인정보 안내와 보관·삭제 기준을 확정 중이에요.")}</p><p class="caption muted">이름·연구실·소속 팀·심판 가능 표시는 공개하며 이메일·학번/사번·지도교수는 본인과 운영진만 열람해요.</p><label class="check-line"><input type="checkbox" name="consent" required>안내를 읽고 개인정보 수집·이용에 동의해요. (필수)</label></div><div class="consent-box"><h3>이름·연구실 및 리그 기록 공개 동의</h3><p class="caption muted">모든 홈페이지 방문자에게 공개되는 범위예요. <a class="link" href="#privacy">처리방침 전문</a></p><p>${e(view.settings.publicConsentNotice)}</p><label class="check-line"><input type="checkbox" name="publicConsent" required>이름·연구실과 리그 기록 공개에 동의해요. (필수)</label></div></fieldset>`,
        "선수 등록 완료하기",
      );
    const f = content.querySelector("#profile-form");
    f.querySelector("button[type=submit]").disabled = !open;
    const eligibility = f.querySelector("[name=eligibility]");
    eligibility.onchange = () => {
      const staff = eligibility.value === "staff",
        other = eligibility.value === "advisor";
      f.querySelector("#department-field").innerHTML = other
        ? input(
            "department",
            "실제 소속 학과",
            "text",
            "",
            'required maxlength="120" placeholder="예: 기계공학과"',
          )
        : select("department", "소속 학과·부서", [
            ["ISE", "ISE"],
            ["GSDS", "GSDS"],
          ]);
      f.querySelector(
        "[name=identifier]",
      ).parentElement.firstChild.textContent = staff ? "사번" : "학번";
      f.querySelector("#advisor-field").hidden = staff;
      f.querySelector("[name=advisor]").required = !staff;
      f.querySelector("[name=advisor]").disabled = staff;
      f.querySelector("#advisor-department").hidden = !other;
    };
    bindForm("profile-form", (fd, f) =>
      mutate(
        "registerPlayer",
        {
          ...Object.fromEntries(fd),
          referee: fd.has("referee"),
          consent: fd.has("consent"),
          publicConsent: fd.has("publicConsent"),
          publicConsentVersion: view.settings.publicConsentVersion,
          consentVersion: view.settings.privacyVersion,
        },
        f,
      ),
    );
  }
  function activity() {
    const m = view.me;
    if (!m.player) {
      if (m.admin) {
        adminPage();
        return;
      }
      registration();
      return;
    }
    const t = myTeam(),
      matches = (view.matches || []).filter((m) => m.startsAt > Date.now());
    content.innerHTML =
      heading("MY IGFL", `${m.player.name}님의 선수 활동`) +
      tabs() +
      (m.stats
        ? `<div class="my-stats"><div><strong>${m.stats.appearances}</strong><span>시즌 출전</span></div><div><strong>${m.stats.goals}</strong><span>시즌 득점</span></div><div><strong>${m.stats.refereed}</strong><span>심판 활동</span></div></div>`
        : "") +
      ((view.sanctions || []).some(
        (x) => x.playerId === m.id && x.remaining > 0,
      )
        ? '<p class="notice">다음 공식 경기 1회 출전 정지 상태예요. 담당 팀 대표·운영진에게 확인해 주세요.</p>'
        : "") +
      invitationInbox() +
      `<div class="account-grid"><section class="panel"><span class="badge">IGFL 등록 선수${m.player.referee ? " / 심판" : ""}</span><h2>${e(m.player.name)}</h2><p class="muted">${e(m.player.lab)}</p><dl class="profile-list"><div><dt>소속 팀</dt><dd>${t ? e(t.name) : "무소속"}</dd></div><div><dt>내 이메일</dt><dd>${e(m.email)}</dd></div><div><dt>${m.profile.eligibility === "staff" ? "사번" : "학번"}</dt><dd>${e(m.profile.identifier)}</dd></div><div><dt>지도교수</dt><dd>${e(m.profile.advisor)}</dd></div></dl><p class="caption muted">개인 정보는 본인과 운영진만 확인할 수 있어요.</p>${t ? '<button class="text-button danger" id="leave-team">팀 탈퇴하기</button>' : '<a class="button secondary" href="#teams">모집 중인 팀 찾아보기</a>'}</section><section class="panel"><h2>나의 예정 경기</h2>${matches.length ? matches.map(matchCard).join("") : empty("아직 예정된 경기가 없어요.")}<h3>내 요청</h3>${
        (view.requests || [])
          .filter((r) => r.playerId === m.id)
          .map(
            (r) =>
              `<p>${e(teamName(r.teamId))} · ${e(statusNames[r.status] || r.status)}</p>`,
          )
          .join("") || '<p class="muted">아직 보낸 가입 요청이 없어요.</p>'
      }</section></div><section class="panel spaced"><h2>회원 탈퇴</h2><p class="muted">회원 탈퇴 시 계정·개인 식별 정보를 삭제하고 개인 기록의 공개를 중단해요. 팀 경기 결과와 Elo는 유지해요. 팀 탈퇴와는 다른 작업이에요.</p><button class="text-button danger" id="withdraw-account">IGFL 회원 탈퇴하기</button></section><section class="panel spaced"><h2>선수 자격 확인 요청</h2>${form("eligibility-form", '<label class="form-field">확인이 필요한 내용<textarea name="message" required maxlength="1000" rows="2"></textarea></label>', "운영진에게 확인 요청")}</section>`;
    bindInbox();
    click("withdraw-account", async () => {
      if (
        await dialog(
          "IGFL 회원에서 탈퇴할까요?",
          "계정과 개인 식별 정보를 삭제하고 모든 로그인 세션을 종료해요. 공개 선수 명단·개인 순위에서 제외되며, 팀 경기 결과와 Elo는 유지돼요. 이전 파일·사본은 운영자가 별도로 파기해요. 삭제한 개인 기록은 복원할 수 없어요.",
          { confirmLabel: "회원 탈퇴하기" },
        )
      )
        await mutate("withdrawAccount", { confirmed: true });
    });
    click("leave-team", async () => {
      if (
        await dialog(
          "팀에서 탈퇴할까요?",
          `${t.name}에서 탈퇴하면 즉시 무소속이 되며 대표 권한도 해제돼요. 지난 경기 기록은 유지돼요.`,
          { confirmLabel: "탈퇴하기" },
        )
      )
        await mutate("leaveTeam", {}, null);
    });
    bindForm("eligibility-form", (fd, f) =>
      mutate("requestEligibility", { message: fd.get("message") }, f),
    );
  }
  function newTeam() {
    const free = view.players.filter((p) => !p.teamId),
      draft = view.applications?.find((t) => t.status === "needs_changes");
    content.innerHTML =
      heading(
        "BUILD OUR TEAM",
        "팀 등록 신청",
        "등록 선수 6~20명으로 팀을 꾸려요. 운영진 승인 후 리그에 참가할 수 있어요.",
      ) +
      tabs() +
      (view.applications?.length
        ? view.applications
            .map(
              (t) =>
                `<div class="notice">${e(t.name)} · ${e(statusNames[t.status] || t.status)}${t.reviewNote ? " · " + e(t.reviewNote) : ""}</div>`,
            )
            .join("")
        : "") +
      (view.me.teamId
        ? empty(
            "이미 소속 팀이 있어요. 기존 팀에서 탈퇴한 뒤 신청할 수 있어요.",
          )
        : view.applications?.some((t) => t.status === "pending")
          ? empty("운영진이 팀 신청을 검토하고 있어요.")
          : form(
              "new-team-form",
              `${input("name", "팀 이름", "text", draft?.name || "", 'required maxlength="50"')}<label class="form-field">팀 소개<textarea name="description" rows="3" required maxlength="500">${e(draft?.description || "")}</textarea></label><fieldset class="roster"><legend>함께할 무소속 선수</legend>${free.map((p) => `<label class="check-line"><input type="checkbox" name="members" value="${e(p.id)}" ${(draft ? draft.pendingMembers.includes(p.id) : p.id === view.me.id) ? "checked" : ""}>${e(p.name)} · ${e(p.lab)}</label>`).join("")}</fieldset><div class="form-grid">${select("captainId", "주장", options(free.map((p) => p.id)), draft?.captainId || view.me.id)}${select("viceId", "부주장", options(free.map((p) => p.id)), draft?.viceId || "")}</div><p class="caption muted">영입 동의는 팀 안에서 먼저 협의해 주세요. 두 대표의 운영 권한은 같아요.</p>`,
              draft ? "보완 후 다시 신청" : "팀 등록 신청",
            ));
    bindForm("new-team-form", (fd, f) =>
      mutate(
        draft ? "resubmitTeam" : "createTeam",
        {
          teamId: draft?.id,
          name: fd.get("name"),
          description: fd.get("description"),
          members: fd.getAll("members"),
          captainId: fd.get("captainId"),
          viceId: fd.get("viceId"),
        },
        f,
      ),
    );
  }
  async function prepareImage(file) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    )
      throw new Error("JPG·PNG·WebP / 3MB 이하 이미지를 선택해 주세요.");
    const bitmap = await createImageBitmap(file);
    try {
      const ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.78);
      if (data.length > 200000)
        throw new Error("이미지가 복잡해요. 더 작은 이미지로 선택해 주세요.");
      return data;
    } finally {
      bitmap.close();
    }
  }
  function manage() {
    const t = myTeam();
    content.innerHTML =
      heading(
        "TEAM MANAGEMENT",
        t.name,
        "프로필부터 명단까지, 우리 팀의 이야기를 함께 관리해요.",
      ) +
      tabs() +
      `<div class="notice">${e(statusNames[t.status])} · ${t.members.length}/20명${t.graceEndsAt ? " · 충원 기한 " + date(t.graceEndsAt) : ""}</div><div class="manage-grid"><section><h2>팀 프로필</h2>${form("team-profile", `<div class="team-cover upload-preview" id="image-preview">${image(t)}</div><label class="form-field">대표 이미지<input type="file" id="team-image" accept="image/jpeg,image/png,image/webp"></label><p class="caption muted">JPG·PNG·WebP / 원본 3MB 이하. 저장할 때 대표 이미지로 최적화해요.</p><button class="text-button" type="button" id="clear-image">기본 이미지 사용</button><label class="form-field">팀 소개<textarea name="description" required maxlength="500" rows="3">${e(t.description)}</textarea></label><label class="check-line"><input name="recruiting" type="checkbox" ${t.recruiting ? "checked" : ""}>선수 모집 중으로 표시</label>`, "팀 프로필 저장")}<h2 class="spaced">대표 교체 요청</h2>${form("leaders-form", `<div class="form-grid">${select("captainId", "새 주장", options(t.members), t.captainId)}${select("viceId", "새 부주장", options(t.members), t.viceId)}</div><p class="caption muted">운영진이 승인하면 새 권한이 적용돼요. 그 전에는 기존 대표가 유지돼요.</p>`, "대표 교체 요청")}<div class="caption muted">${(
        view.requests || []
      )
        .filter((r) => r.type === "leaders" && r.teamId === t.id)
        .map((r) => `대표 교체 · ${e(statusNames[r.status] || r.status)}`)
        .join(
          "<br>",
        )}</div></section><section class="panel"><h2>팀 명단 <span class="muted">${t.members.length}</span></h2>${t.members.map((id) => `<div class="member-row"><div><strong>${e(name(id))}</strong>${id === t.captainId ? '<span class="badge">주장</span>' : id === t.viceId ? '<span class="badge">부주장</span>' : ""}<small>${e(player(id)?.lab)}</small></div><button class="text-button danger" data-release="${e(id)}">방출</button></div>`).join("")}<h3 class="spaced">새 선수 영입</h3>${form("recruit-form", select("playerId", "무소속 선수", [["", "선수를 선택해 주세요"], ...view.players.filter((p) => !p.teamId).map((p) => [p.id, `${p.name} · ${p.lab}`])]) + '<p class="caption muted">선수와 먼저 협의한 뒤 영입을 등록해 주세요.</p>', "영입 등록")}<h3 class="spaced">가입 문의</h3>${
        (view.requests || [])
          .filter(
            (r) =>
              r.type === "join" && r.teamId === t.id && r.status === "pending",
          )
          .map(
            (r) =>
              `<article class="request-card"><strong>${e(name(r.playerId))}</strong><p>${e(r.message)}</p><button class="button secondary small" data-recruit="${e(r.playerId)}">영입 등록</button></article>`,
          )
          .join("") || '<p class="muted">아직 가입 문의가 없어요.</p>'
      }</section></div>`;
    let chosenImage;
    content.querySelector("#team-image").onchange = async (ev) => {
      if (!ev.target.files[0]) return;
      try {
        chosenImage = await prepareImage(ev.target.files[0]);
        content.querySelector("#image-preview").innerHTML =
          `<img class="team-image" alt="대표 이미지 미리보기" src="${chosenImage}">`;
      } catch (err) {
        chosenImage = undefined;
        ev.target.value = "";
        feedback(err.message, true);
      }
    };
    click("clear-image", () => {
      chosenImage = null;
      content.querySelector("#image-preview").innerHTML = image({
        ...t,
        image: null,
      });
    });
    bindForm("team-profile", (fd, f) =>
      mutate(
        "updateTeam",
        {
          teamId: t.id,
          description: fd.get("description"),
          recruiting: fd.has("recruiting"),
          ...(chosenImage !== undefined ? { image: chosenImage } : {}),
        },
        f,
      ),
    );
    bindForm("leaders-form", (fd, f) =>
      mutate(
        "requestLeaders",
        {
          teamId: t.id,
          captainId: fd.get("captainId"),
          viceId: fd.get("viceId"),
        },
        f,
      ),
    );
    bindForm("recruit-form", (fd, f) =>
      mutate("recruit", { teamId: t.id, playerId: fd.get("playerId") }, f),
    );
    content.querySelectorAll("[data-release]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            await dialog(
              `${name(b.dataset.release)} 선수를 방출할까요?`,
              "확인하면 즉시 무소속이 돼요. 이전 경기 기록은 유지돼요.",
              { confirmLabel: "방출하기" },
            )
          )
            await mutate("release", {
              teamId: t.id,
              playerId: b.dataset.release,
            });
        }),
    );
    content
      .querySelectorAll("[data-recruit]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            mutate("recruit", { teamId: t.id, playerId: b.dataset.recruit })),
      );
  }
  function matchCard(m) {
    return `<article class="match-card"><div>${badge(m.status)}<span class="caption">${date(m.startsAt)} · ${e(m.place)}</span></div><h3>${e(teamName(m.teamA))} <span class="muted">vs</span> ${e(teamName(m.teamB))}</h3><p class="caption muted">${isUnrefereed(m) ? "심판 없는 경기 · 양 팀 확인으로 확정" : m.refereeId ? "심판 " + e(name(m.refereeId)) : m.externalReferee ? "외부 심판 " + e(m.externalReferee.name) : "심판 배정 대기"} · 흐르는 시계 · ${e(formatLabel(m))}</p></article>`;
  }
  function refereeFollowup(m, t) {
    if (
      isUnrefereed(m) ||
      m.startsAt <= Date.now() ||
      m.refereeId ||
      ["cancelled", "abandoned", "forfeit"].includes(m.status)
    )
      return "";
    if (m.externalReferee)
      return m.externalReferee.accepted
        ? ""
        : `<button class="button secondary" data-external-accept="${e(m.id)}">외부 심판의 일정 수락 확인</button>`;
    const candidates = view.players.filter(
      (p) =>
        p.referee &&
        ![m.teamA, m.teamB].includes(p.teamId) &&
        !m.refereeRequests.some((r) => r.playerId === p.id),
    );
    if (!candidates.length)
      return '<p class="caption muted">추가로 요청할 중립 심판이 없어요. 기존 요청의 수락을 기다리고 있어요.</p>';
    return form(
      "more-referees-" + m.id,
      `<fieldset class="roster"><legend>새 심판 후보에게 추가 요청</legend>${candidates.map((p) => `<label class="check-line"><input name="refereeIds" type="checkbox" value="${e(p.id)}">${e(p.name)} · ${e(p.lab)}</label>`).join("")}</fieldset>`,
      "선택한 심판에게 요청",
    );
  }
  function schedule() {
    const pre = view.settings.competitionPhase === "preseason";
    const t = myTeam(),
      refs = view.players.filter((p) => p.referee && p.teamId !== t.id);
    if (!view.settings.seasonOpen) {
      content.innerHTML =
        heading("MATCH SCHEDULE", "경기 등록은 준비 중이에요") +
        tabs() +
        '<p class="notice">현재는 선수 등록과 팀 모집 기간이에요. 경기 일정·결과 등록 개통은 운영 안내에서 별도로 공지할게요.</p><a class="link" href="#operations">운영 안내 보기 ↗</a>';
      return;
    }
    content.innerHTML =
      heading(
        "MATCH SCHEDULE",
        "우리의 경기를 만들어요",
        pre
          ? "프리시즌 · 5·6대6, 전후반 15·20분을 선택해요. 심판 없는 경기도 양 팀 합의로 등록할 수 있어요."
          : "정규리그 · 5대5 · 전후반 20분 / 휴식 5분 · 중립 심판 1명이 필요해요.",
      ) +
      tabs() +
      `<div class="manage-grid"><section>${form(
        "schedule-form",
        `${
          pre
            ? `<div class="form-grid">${select("playersPerSide", "경기 인원", [
                ["5", "5대5"],
                ["6", "6대6"],
              ])}${select("halfMinutes", "전후반 경기 시간", [
                ["15", "각 15분 · 휴식 5분"],
                ["20", "각 20분 · 휴식 5분"],
              ])}</div>`
            : ""
        }${select("opponentId", "상대 팀", [["", "상대 팀을 선택해 주세요"], ...view.teams.filter((x) => x.id !== t.id && x.status === "active").map((x) => [x.id, x.name])])}<div class="form-grid">${input("startsAt", "경기 일시 (한국 시간)", "datetime-local", "", "required")}${input("place", "장소", "text", "", 'required maxlength="120"')}</div>${roster(t.members, [])}${select(
          "refereeType",
          "심판 구분",
          [
            ["internal", "리그 내부 심판"],
            ["external", "외부 심판"],
            ...(pre ? [["none", "심판 없음 · 프리시즌 전용"]] : []),
          ],
        )}<fieldset id="internal-referees" class="roster"><legend>심판 후보 복수 선택</legend><p class="caption muted">양 팀 소속을 제외해요. 가장 먼저 수락한 한 명으로 확정돼요.</p><div id="referee-list"></div></fieldset><div id="external-referee" hidden>${input("refereeName", "외부 심판 이름", "text", "", 'maxlength="60"')}<label class="check-line"><input name="refereeAccepted" type="checkbox">외부 심판이 이 일정을 수락한 것을 확인했어요.</label></div><p class="notice">${pre ? "심판 없는 경기는 양 팀의 일정·명단 확인 후 등록되고, 결과는 양 팀 대표 확인으로 확정돼요. " : ""}심판이 있는 경기는 배정 전 공식 등록을 보류해요. 심판비는 양 팀이 10,000원씩 직접 지급해요.</p>`,
        "경기 일정 등록",
      )}</section><section><h2>우리 팀 경기</h2>${
        (view.matches || [])
          .filter((m) => [m.teamA, m.teamB].includes(t.id))
          .sort((a, b) => b.startsAt - a.startsAt)
          .map(
            (m) =>
              `${matchCard(m)}${
                m.startsAt > Date.now() &&
                !["cancelled", "abandoned", "forfeit"].includes(m.status)
                  ? form(
                      "roster-" + m.id,
                      `<h3>우리 팀 사전 명단 · ${e(teamName(m.teamA))} vs ${e(teamName(m.teamB))}</h3>${roster(
                        t.members,
                        (m.rosters[t.id] || []).map((p) => p.id),
                      )}`,
                      "사전 명단 저장",
                    )
                  : ""
              }${m.refereeRequests.length ? `<div class="request-status">${m.refereeRequests.map((r) => `${e(name(r.playerId))} · ${e(statusNames[r.status] || "수락 대기")}`).join("<br>")}</div>` : ""}${refereeFollowup(m, t)}${matchOperations(m)}`,
          )
          .join("") || empty("등록된 경기가 없어요.")
      }</section></div>`;
    const f = content.querySelector("#schedule-form");
    if (route.startsWith("schedule/"))
      f.querySelector("[name=opponentId]").value = route.split("/")[1];
    const drawRefs = () => {
      const opponent = f.querySelector("[name=opponentId]").value;
      content.querySelector("#referee-list").innerHTML =
        refs
          .filter((p) => p.teamId !== opponent)
          .map(
            (p) =>
              `<label class="check-line"><input type="checkbox" name="refereeIds" value="${e(p.id)}">${e(p.name)} · ${e(p.lab)}</label>`,
          )
          .join("") ||
        '<p class="muted">요청할 수 있는 중립 심판이 없어요.</p>';
    };
    f.querySelector("[name=opponentId]").onchange = drawRefs;
    drawRefs();
    f.querySelector("[name=refereeType]").onchange = (ev) => {
      const external = ev.target.value === "external";
      content.querySelector("#external-referee").hidden = !external;
      content.querySelector("#internal-referees").hidden =
        ev.target.value !== "internal";
    };
    bindForm("schedule-form", (fd, f) =>
      mutate(
        "schedule",
        {
          teamId: t.id,
          opponentId: fd.get("opponentId"),
          startsAt: Date.parse(fd.get("startsAt") + "+09:00"),
          place: fd.get("place"),
          roster: fd.getAll("roster"),
          refereeMode: fd.get("refereeType"),
          playersPerSide: pre ? Number(fd.get("playersPerSide")) : 5,
          halfMinutes: pre ? Number(fd.get("halfMinutes")) : 20,
          refereeIds:
            fd.get("refereeType") === "internal" ? fd.getAll("refereeIds") : [],
          replayOf: route.split("/")[2] || undefined,
          externalReferee:
            fd.get("refereeType") === "external"
              ? {
                  name: fd.get("refereeName"),
                  accepted: fd.has("refereeAccepted"),
                }
              : null,
        },
        f,
      ),
    );
    for (const m of view.matches || []) {
      bindForm("roster-" + m.id, (fd, f) =>
        mutate(
          "setRoster",
          {
            teamId: t.id,
            matchId: m.id,
            matchVersion: m.version,
            roster: fd.getAll("roster"),
          },
          f,
        ),
      );
      bindForm("more-referees-" + m.id, (fd, f) =>
        mutate(
          "requestReferees",
          {
            teamId: t.id,
            matchId: m.id,
            matchVersion: m.version,
            refereeIds: fd.getAll("refereeIds"),
          },
          f,
        ),
      );
    }
    bindMatchOperations(view.matches || []);
    content.querySelectorAll("[data-external-accept]").forEach(
      (b) =>
        (b.onclick = async () => {
          const m = view.matches.find((m) => m.id === b.dataset.externalAccept);
          if (
            await dialog(
              "외부 심판의 수락을 확인할까요?",
              `${m.externalReferee.name} 심판이 일시·장소를 확인하고 수락했어요.`,
            )
          )
            await mutate("confirmExternalReferee", {
              teamId: t.id,
              matchId: m.id,
              matchVersion: m.version,
              accepted: true,
            });
        }),
    );
  }
  function scoreText(s) {
    return s
      ? `${s.a} : ${s.b}${s.a === s.b ? ` (PK ${s.pkA} : ${s.pkB})` : ""}`
      : "미제출";
  }
  function matchComparison(m) {
    return `<div class="comparison">${[m.teamA, m.teamB]
      .map((tid) => {
        const sub = m.submissions[tid];
        return `<div><strong>${e(teamName(tid))} 제출</strong><p class="score-value">${scoreText(sub?.score)}</p><span class="caption">${m.confirmations[tid] === m.version ? "현재 버전 확인 완료" : "현재 버전 확인 대기"}</span>${sub ? `<details><summary>출전·득점 기록</summary>${sub.players.map((p) => `<p>${e(p.name)} · ${e(p.lab)} <b>${sub.goals[p.id] || 0}골</b>${sub.ownGoals?.[p.id] ? ` · 자책골 ${sub.ownGoals[p.id]}` : ""}${sub.redCards?.includes(p.id) ? " · 퇴장" : ""}</p>`).join("")}</details>` : ""}</div>`;
      })
      .join("")}</div>`;
  }
  function results() {
    const t = myTeam(),
      matches = (view.matches || []).filter((m) =>
        [m.teamA, m.teamB].includes(t.id),
      );
    content.innerHTML =
      heading(
        "MATCH RESULTS",
        "우리 팀의 경기 기록",
        "전체 스코어와 우리 팀의 실제 출전·득점 기록을 함께 확인해요.",
      ) +
      tabs() +
      `<div id="match-results">${
        matches.length
          ? matches
              .sort((a, b) => b.startsAt - a.startsAt)
              .map((m) => {
                const sub = m.submissions[t.id],
                  eligible = (m.rosters[t.id] || []).map((p) => p.id);
                const score = sub?.score || { a: 0, b: 0 };
                return `<section class="panel spaced">${matchCard(m)}<p class="caption muted">기록 버전 ${m.version} · ${e(teamName(m.teamA))} : ${e(teamName(m.teamB))} 순서로 스코어를 기록해요.</p>${matchComparison(m)}${m.status === "final" ? `<p class="notice">${m.phase === "preseason" ? "프리시즌" : "정규리그"} Elo와 개인 기록에 반영됐어요.${isUnrefereed(m) ? " 양 팀 대표 확인으로 확정한 경기예요." : ""}</p>` : ["cancelled", "abandoned", "forfeit"].includes(m.status) ? '<p class="notice">정상 경기 기록과 Elo 집계에서 제외돼요.</p>' : m.startsAt + matchDuration(m) > Date.now() ? '<p class="notice">경기 종료 후 결과를 입력할 수 있어요.</p>' : form("result-" + m.id, `<div class="score-inputs">${input("scoreA", teamName(m.teamA), "number", score.a, 'min="0" max="99" required')}${input("scoreB", teamName(m.teamB), "number", score.b, 'min="0" max="99" required')}</div><div class="score-inputs pk-fields" ${score.a !== score.b ? "hidden" : ""}>${input("pkA", "승부차기 · " + teamName(m.teamA), "number", score.pkA ?? 0, 'min="0" max="99"')}${input("pkB", "승부차기 · " + teamName(m.teamB), "number", score.pkB ?? 0, 'min="0" max="99"')}</div>${roster(eligible, sub?.players.map((p) => p.id) || (m.rosters[t.id] || []).map((p) => p.id), sub?.goals || {}, sub?.ownGoals || {}, sub?.redCards || [])}<p class="caption muted">우리 팀 일반 득점 + 상대 팀이 기록한 자책골을 전체 스코어와 대조해요. 승부차기는 개인 득점에서 제외해요.</p><label class="check-line"><input name="confirmed" type="checkbox" required>우리 팀의 경기 스코어·실제 출전·득점 기록을 확인했어요.</label>`, "우리 팀 결과 제출")}${!["final", "cancelled", "abandoned", "forfeit"].includes(m.status) && sub && m.confirmations[t.id] !== m.version ? `<button class="button secondary" data-confirm="${e(m.id)}">현재 기록 버전 확인하기</button>` : ""}${!["final", "cancelled", "abandoned", "forfeit"].includes(m.status) ? `<button class="text-button danger" data-dispute="${e(m.id)}">이의 제기</button>` : ""}${matchOperations(m)}</section>`;
              })
              .join("")
          : empty("등록된 경기가 없어요.")
      }</div>`;
    for (const m of matches) {
      const node = content.querySelector("#result-" + m.id);
      if (node) {
        node.querySelectorAll("[name=scoreA],[name=scoreB]").forEach(
          (input) =>
            (input.oninput = () => {
              node.querySelector(".pk-fields").hidden =
                node.querySelector("[name=scoreA]").value !==
                node.querySelector("[name=scoreB]").value;
            }),
        );
        bindForm("result-" + m.id, (fd, f) => {
          const ids = fd.getAll("roster");
          return mutate(
            "submitResult",
            {
              teamId: t.id,
              matchId: m.id,
              matchVersion: m.version,
              score: {
                a: Number(fd.get("scoreA")),
                b: Number(fd.get("scoreB")),
                pkA: Number(fd.get("pkA")),
                pkB: Number(fd.get("pkB")),
              },
              roster: ids,
              ownGoals: Object.fromEntries(
                ids.map((id) => [id, Number(fd.get("own-" + id))]),
              ),
              redCards: fd.getAll("redCards"),
              goals: Object.fromEntries(
                ids.map((id) => [id, Number(fd.get("goal-" + id))]),
              ),
              confirmed: fd.has("confirmed"),
            },
            f,
          );
        });
      }
    }
    content.querySelectorAll("[data-confirm]").forEach(
      (b) =>
        (b.onclick = () => {
          const m = matches.find((m) => m.id === b.dataset.confirm);
          return mutate("confirmResult", {
            teamId: t.id,
            matchId: m.id,
            matchVersion: m.version,
          });
        }),
    );
    bindDisputes(matches);
    bindMatchOperations(matches);
  }
  function bindDisputes(matches) {
    content.querySelectorAll("[data-dispute]").forEach(
      (b) =>
        (b.onclick = async () => {
          const message = await dialog(
            "운영진에게 이의를 전달할까요?",
            "검토 중에는 최종 확정과 Elo 반영을 보류해요.",
            { reason: true },
          );
          if (message) {
            const m = matches.find((m) => m.id === b.dataset.dispute);
            await mutate("dispute", {
              matchId: m.id,
              matchVersion: m.version,
              message,
            });
          }
        }),
    );
  }
  function matchOperations(m) {
    const own =
        view.me?.isLeader && [m.teamA, m.teamB].includes(view.me.teamId),
      t = myTeam();
    if (m.status === "final")
      return view.me.admin || Date.now() <= m.finalizedAt + 7 * 86400000
        ? `<button class="text-button" data-final-correction="${e(m.id)}">확정 기록 정정 요청</button>`
        : "";
    if (["cancelled", "abandoned", "forfeit"].includes(m.status))
      return m.allowReplay && own
        ? `<a class="button secondary small" href="#schedule/${e(t.id === m.teamA ? m.teamB : m.teamA)}/${e(m.id)}">재경기 일정 등록</a>`
        : "";
    let html = "";
    if (own && m.startsAt > Date.now()) {
      html += `<details class="panel spaced"><summary>일정 변경·취소 협의</summary><p class="muted caption">상대 팀 동의 후 변경하며, 일정이 바뀌면 양 팀 명단과 심판의 수락을 다시 받아요.</p>`;
      if (m.scheduleChange)
        html += `<p>${e(teamName(m.scheduleChange.teamId))}의 변경 요청: ${date(m.scheduleChange.startsAt)} · ${e(m.scheduleChange.place)}</p>${m.scheduleChange.teamId !== t.id ? `<button class="button small" data-match-action="respondScheduleChange" data-id="${e(m.id)}" data-accept="true">변경 수락</button> <button class="button secondary small" data-match-action="respondScheduleChange" data-id="${e(m.id)}" data-accept="false">거절</button>` : ""}`;
      else
        html += form(
          "change-" + m.id,
          `${input("startsAt", "변경할 일시 (한국 시간)", "datetime-local", "", "required")}${input("place", "변경할 장소", "text", m.place, 'required maxlength="120"')}`,
          "일정 변경 제안",
        );
      if (m.cancellation)
        html += `<p>취소 요청: ${e(m.cancellation.reason)}</p>${m.cancellation.teamId !== t.id ? `<button class="button small" data-match-action="respondCancellation" data-id="${e(m.id)}" data-accept="true">취소 동의</button> <button class="button secondary small" data-match-action="respondCancellation" data-id="${e(m.id)}" data-accept="false">거절</button>` : ""}`;
      else
        html += form(
          "cancel-" + m.id,
          input(
            "reason",
            "취소 요청 사유",
            "text",
            "",
            'required maxlength="500"',
          ),
          "상대 팀에 취소 요청",
        );
      html += "</details>";
    }
    if (m.incident) {
      html += `<div class="notice">경기 예외 검토: ${e(m.incident.reason)}</div>`;
      if (view.me.admin)
        html += form(
          "incident-review-" + m.id,
          `${select("outcome", "처리 결과", [
            ["abandoned", "중단 · 전체 재경기"],
            ["cancelled", "취소 · 기록 제외"],
            ["forfeit", "행정 몰수 0:3 · Elo 제외"],
            ["resume", "보완 후 정상 기록 재확인"],
          ])}${select("winnerId", "몰수 승리 팀 (몰수 시에만)", [
            [m.teamA, teamName(m.teamA)],
            [m.teamB, teamName(m.teamB)],
          ])}${input("reason", "처리 근거와 사유", "text", "", 'required maxlength="1000"')}`,
          "예외 처리 결과 기록",
        );
    } else if (own || view.me.admin || m.refereeId === view.me.id) {
      html += `<details class="panel spaced"><summary>경기 중단·불참 등 예외 보고</summary>${form(
        "incident-" + m.id,
        `${select("kind", "예외 유형", [
          ["unsafe", "기상·구장·안전 문제"],
          ["no_referee", "심판 부재"],
          ["no_show", "일방 불참 (10분 대기 후)"],
          ["insufficient", "출전 인원 부족"],
          ["abandoned", "재개 불가능한 중단"],
        ])}${input("reason", "확인한 내용", "text", "", 'required maxlength="1000"')}`,
        "운영진 검토 요청",
      )}</details>`;
    }
    return html;
  }
  function bindMatchOperations(matches) {
    for (const m of matches) {
      bindForm("change-" + m.id, (fd, f) =>
        mutate(
          "proposeScheduleChange",
          {
            teamId: view.me.teamId,
            matchId: m.id,
            startsAt: Date.parse(fd.get("startsAt") + "+09:00"),
            place: fd.get("place"),
          },
          f,
        ),
      );
      bindForm("cancel-" + m.id, (fd, f) =>
        mutate(
          "requestCancellation",
          { teamId: view.me.teamId, matchId: m.id, reason: fd.get("reason") },
          f,
        ),
      );
      bindForm("incident-" + m.id, (fd, f) =>
        mutate(
          "reportIncident",
          { matchId: m.id, kind: fd.get("kind"), reason: fd.get("reason") },
          f,
        ),
      );
      bindForm("incident-review-" + m.id, (fd, f) =>
        mutate(
          "resolveIncident",
          {
            matchId: m.id,
            outcome: fd.get("outcome"),
            winnerId: fd.get("winnerId"),
            reason: fd.get("reason"),
          },
          f,
        ),
      );
    }
    content.querySelectorAll("[data-match-action]").forEach(
      (b) =>
        (b.onclick = () =>
          mutate(b.dataset.matchAction, {
            teamId: view.me.teamId,
            matchId: b.dataset.id,
            accepted: b.dataset.accept === "true",
          })),
    );
    content.querySelectorAll("[data-final-correction]").forEach(
      (b) =>
        (b.onclick = async () => {
          const reason = await dialog(
            "확정 기록 정정을 요청할까요?",
            "확정 후 7일 이내 오기·기록 오류를 운영진에게 알려 주세요. 정정이 최종 승인되기 전에는 기존 공식 결과와 Elo를 유지해요.",
            { reason: true, confirmLabel: "정정 요청" },
          );
          if (reason)
            await mutate("requestFinalCorrection", {
              matchId: b.dataset.finalCorrection,
              serious:
                view.me.admin &&
                Date.now() >
                  (matches.find((m) => m.id === b.dataset.finalCorrection)
                    ?.finalizedAt || 0) +
                    7 * 86400000,
              reason,
            });
        }),
    );
  }
  function referee() {
    const matches = view.matches || [];
    content.innerHTML =
      heading(
        "REFEREE ACTIVITIES",
        "리그를 함께 만드는 심판",
        "한 경기당 20,000원 · 양 팀이 10,000원씩 직접 지급해요.",
      ) +
      tabs() +
      `<h2>받은 배정 요청</h2>${
        matches
          .filter((m) =>
            m.refereeRequests.some((r) => r.playerId === view.me.id),
          )
          .map((m) => {
            const r = m.refereeRequests.find((r) => r.playerId === view.me.id);
            return `<section class="panel spaced">${matchCard(m)}<p>내 요청 · ${e(statusNames[r.status] || "수락 대기")}</p>${r.status === "pending" && !m.refereeId ? `<div class="actions"><button class="button" data-ref-accept="${e(m.id)}">배정 수락</button><button class="button secondary" data-ref-decline="${e(m.id)}">거절</button></div>` : ""}</section>`;
          })
          .join("") || empty("아직 받은 배정 요청이 없어요.")
      }<h2 class="spaced">담당 경기 결과 확인</h2>${
        matches
          .filter((m) => m.refereeId === view.me.id)
          .map(
            (m) =>
              `<section class="panel spaced">${matchCard(m)}${matchComparison(m)}${m.status === "ready" ? `<button class="button" data-finalize="${e(m.id)}">양 팀 기록 최종 승인</button>` : '<p class="caption muted">양 팀의 일치하는 기록과 현재 버전 확인이 모두 필요해요.</p>'}${!["final", "cancelled", "abandoned", "forfeit"].includes(m.status) ? `<button class="text-button danger" data-dispute="${e(m.id)}">이의 전달</button>` : ""}${matchOperations(m)}</section>`,
          )
          .join("") || empty("담당 경기가 없어요.")
      }`;
    for (const [attribute, command] of [
      ["data-ref-accept", "acceptReferee"],
      ["data-ref-decline", "declineReferee"],
    ])
      content.querySelectorAll("[" + attribute + "]").forEach(
        (b) =>
          (b.onclick = () => {
            const m = matches.find((m) => m.id === b.getAttribute(attribute));
            return mutate(command, { matchId: m.id, matchVersion: m.version });
          }),
      );
    bindFinals(matches);
    bindDisputes(matches);
    bindMatchOperations(matches);
  }
  function bindFinals(matches) {
    content.querySelectorAll("[data-finalize]").forEach(
      (b) =>
        (b.onclick = async () => {
          const m = matches.find((m) => m.id === b.dataset.finalize);
          if (
            await dialog(
              "이 결과를 최종 승인할까요?",
              "양 팀의 기록과 확인 상태를 검토했어요. 승인 후 공식 기록과 Elo에 반영해요.",
              { external: !!m.externalReferee },
            )
          )
            await mutate("finalize", {
              matchId: m.id,
              matchVersion: m.version,
              externalConfirmed: !!m.externalReferee,
            });
        }),
    );
  }
  function adminPage() {
    const matches = view.matches || [],
      requests = view.requests || [];
    content.innerHTML =
      heading(
        "LEAGUE OPERATIONS",
        "운영 관리",
        "필요한 요청을 검토하고, 판단과 사유를 기록해요.",
      ) +
      tabs() +
      `<nav class="queue-nav"><a href="#admin">전체 검토함</a><a href="#admin/teams">팀 신청</a><a href="#admin/leaders">대표 교체</a><a href="#admin/matches">경기 승인·이의</a><a href="#admin/profiles">자격 확인</a></nav><div id="admin-sections">` +
      (!route.includes("/") || route === "admin/teams"
        ? `<h2>팀 등록 신청</h2>${
            (view.applications || [])
              .filter((t) => t.status === "pending")
              .map(
                (t) =>
                  `<section class="panel spaced"><h3>${e(t.name)} · ${t.pendingMembers.length}명</h3><p>${e(t.description)}</p><p>주장 ${e(name(t.captainId))} · 부주장 ${e(name(t.viceId))}</p><p class="muted">${t.pendingMembers.map((id) => e(name(id))).join(" · ")}</p><div class="actions"><button class="button" data-team-approve="${e(t.id)}">팀 승인</button><button class="button secondary" data-team-reject="${e(t.id)}">보완 요청</button></div></section>`,
              )
              .join("") || empty("대기 중인 팀 신청이 없어요.")
          }`
        : "") +
      (!route.includes("/") || route === "admin/leaders"
        ? `<h2 class="spaced">대표 교체 요청</h2>${
            requests
              .filter((r) => r.type === "leaders" && r.status === "pending")
              .map(
                (r) =>
                  `<section class="panel spaced"><h3>${e(teamName(r.teamId))}</h3><p>새 주장 ${e(name(r.captainId))} · 새 부주장 ${e(name(r.viceId))}</p><div class="actions"><button class="button" data-leader-approve="${e(r.id)}">교체 승인</button><button class="button secondary" data-leader-reject="${e(r.id)}">보완 요청</button></div></section>`,
              )
              .join("") || empty("대표 교체 요청이 없어요.")
          }`
        : "") +
      (!route.includes("/") || route === "admin/matches"
        ? `<h2 class="spaced">외부 심판 경기 승인 · 스코어 불일치</h2>${
            matches
              .filter(
                (m) =>
                  m.externalReferee ||
                  ["mismatch", "review"].includes(m.status) ||
                  (view.issues || []).some(
                    (i) =>
                      i.matchId === m.id &&
                      i.type === "correction" &&
                      i.status === "open",
                  ),
              )
              .map(
                (m) =>
                  `<section class="panel spaced">${matchCard(m)}${matchComparison(m)}${m.externalReferee ? `<p>외부 심판: ${e(m.externalReferee.name)}</p>` : ""}${m.status === "ready" && m.externalReferee ? `<button class="button" data-finalize="${e(m.id)}">외부 심판 확인·최종 승인</button>` : ""}${m.status !== "final" || (view.issues || []).some((i) => i.matchId === m.id && i.type === "correction" && i.status === "open") ? `<button class="button secondary" data-correction="${e(m.id)}">사유와 함께 재제출 요청</button>` : ""}<details><summary>기록 수정 이력 (${m.history.length})</summary>${m.history.map((h) => `<p>버전 ${h.version} · ${date(h.changedAt)} · ${e(h.note || "팀 기록 수정")}</p>`).join("")}</details>${matchOperations(m)}</section>`,
              )
              .join("") || empty("승인 또는 검토를 기다리는 경기가 없어요.")
          }<h2 class="spaced">이의 제기</h2>${
            (view.issues || [])
              .filter((i) => i.status === "open")
              .map(
                (i) =>
                  `<section class="panel spaced"><strong>${e(i.type === "eligibility" ? "선수 자격 확인" : teamName(matches.find((m) => m.id === i.matchId)?.teamA))}</strong><p>${e(i.message)}</p><button class="button secondary" data-resolve="${e(i.id)}">검토 사유 기록·재확인 요청</button></section>`,
              )
              .join("") || empty("미처리 이의가 없어요.")
          }`
        : "") +
      (route === "admin/profiles"
        ? `${form(
            "sanction-form",
            `${select(
              "playerId",
              "출전 정지 대상",
              view.players.map((p) => [p.id, p.name]),
            )}${input("games", "출전 정지 경기 수", "number", 1, 'min="1" max="20" required')}${input("reason", "징계 근거·사유", "text", "", 'required maxlength="1000"')}`,
            "운영진 추가 징계 등록",
          )}<h2>등록 자격·개인정보 확인</h2><p class="notice">운영진 전용 정보예요. 팀 대표·심판에게는 제공되지 않아요.</p>${view.adminData.profiles.map((p) => `<details class="panel spaced"><summary>${e(name(p.id))} · ${e(p.department)}</summary><dl class="profile-list"><div><dt>이메일</dt><dd>${e(p.email)}</dd></div><div><dt>학번/사번</dt><dd>${e(p.identifier)}</dd></div><div><dt>지도교수</dt><dd>${e(p.advisor)}</dd></div></dl></details>`).join("")}`
        : "") +
      `</div><details class="panel spaced"><summary>유예 상태 · 처리 이력 · 메일 발송 상태</summary>${view.adminData.teams
        .filter((t) => ["paused", "excluded"].includes(t.status))
        .map(
          (t) =>
            `<p>${e(t.name)} · ${badge(t.status)} · ${t.members.length}명</p>`,
        )
        .join(
          "",
        )}<h3>이메일 알림</h3>${view.adminData.outbox.map((j) => `<p>${e(j.kind)} · ${e(statusNames[j.status] || "발송 대기")}${j.lastError ? " · " + e(j.lastError) : ""}</p>`).join("") || '<p class="muted">발송 요청이 없어요.</p>'}<h3>처리 이력</h3>${view.adminData.audit.map((a) => `<p class="caption">${date(a.at)} · ${e(name(a.actorId))} · ${e(a.command)}</p>`).join("") || '<p class="muted">아직 처리 이력이 없어요.</p>'}</details>`;
    bindForm("sanction-form", (fd, f) =>
      mutate(
        "recordSanction",
        {
          playerId: fd.get("playerId"),
          games: Number(fd.get("games")),
          reason: fd.get("reason"),
        },
        f,
      ),
    );
    for (const [attr, command, key, approve] of [
      ["data-team-approve", "reviewTeam", "teamId", true],
      ["data-team-reject", "reviewTeam", "teamId", false],
      ["data-leader-approve", "reviewLeaders", "requestId", true],
      ["data-leader-reject", "reviewLeaders", "requestId", false],
    ])
      content.querySelectorAll("[" + attr + "]").forEach(
        (b) =>
          (b.onclick = async () => {
            const reason = approve
              ? true
              : await dialog(
                  "보완 사유를 남겨 주세요.",
                  "신청자가 수정해야 할 내용을 구체적으로 알려 주세요.",
                  { reason: true },
                );
            if (reason)
              await mutate(command, {
                [key]: b.getAttribute(attr),
                approve,
                reason: approve ? undefined : reason,
              });
          }),
      );
    content.querySelectorAll("[data-correction]").forEach(
      (b) =>
        (b.onclick = async () => {
          const reason = await dialog(
            "양 팀에 재제출을 요청할까요?",
            "이전 기록은 이력으로 보존하고 현재 버전 확인을 초기화해요.",
            { reason: true },
          );
          if (reason)
            await mutate("requestCorrection", {
              matchId: b.dataset.correction,
              reason,
            });
        }),
    );
    content.querySelectorAll("[data-resolve]").forEach(
      (b) =>
        (b.onclick = async () => {
          const reason = await dialog(
            "검토 결과를 기록해 주세요.",
            "경기 이의는 해결 후 양 팀이 최신 기록을 다시 확인해야 해요.",
            { reason: true },
          );
          if (reason)
            await mutate("resolveIssue", {
              issueId: b.dataset.resolve,
              reason,
            });
        }),
    );
    bindFinals(matches);
    bindMatchOperations(matches);
  }
  function render() {
    const publicRoute =
      ["ranking", "teams", "players"].includes(route) ||
      route.startsWith("team/");
    if (!publicRoute && !view.me) {
      content.innerHTML =
        heading("MY IGFL", "로그인이 필요해요") +
        '<a class="button" href="#login">이메일로 로그인</a>';
      return;
    }
    if (!publicRoute && !view.me.player && !view.me.admin) {
      registration();
      return;
    }
    const leader =
      ["manage", "schedule", "results"].includes(route) ||
      route.startsWith("schedule/");
    if (leader && !view.me.isLeader) {
      content.innerHTML =
        tabs() + empty("현재 팀의 주장·부주장만 이용할 수 있어요.");
      return;
    }
    if (route.startsWith("admin") && !view.me.admin) {
      content.innerHTML = empty("운영진만 이용할 수 있어요.");
      return;
    }
    if (route === "referee" && !view.me.player?.referee) {
      content.innerHTML = tabs() + empty("심판 가능 선수의 활동 화면이에요.");
      return;
    }
    if (route === "ranking") ranking();
    else if (["teams", "players"].includes(route)) directory(route);
    else if (route.startsWith("team/")) teamDetail(route.slice(5));
    else if (route.startsWith("admin")) adminPage();
    else if (route.startsWith("schedule/")) schedule();
    else
      (
        ({
          activity,
          register: registration,
          "team-new": newTeam,
          manage,
          schedule,
          results,
          referee,
        })[route] || activity
      )();
    click("logout", async () => {
      await onLogout();
      location.hash = "#home";
    });
    content.querySelectorAll("form").forEach((f) =>
      f.addEventListener("input", () => {
        dirty = true;
      }),
    );
  }
  async function show(nextRoute, force = false) {
    const requestTicket = ++ticket;
    if (route !== nextRoute) {
      dirty = false;
      clearInterval(timer);
    }
    route = nextRoute;
    content.setAttribute("aria-busy", "true");
    if (!view)
      content.innerHTML =
        '<p class="muted" role="status">리그 정보를 불러오고 있어요…</p>';
    try {
      const result = await transport("view", {});
      if (requestTicket !== ticket) return;
      view = result;
      render();
      if (force) dirty = false;
      clearInterval(timer);
      timer = setInterval(() => void refresh(), 30000);
    } catch (err) {
      if (requestTicket !== ticket) return;
      content.innerHTML =
        heading("IGFL", "연결을 확인해 주세요") +
        `<p class="notice error">${e(err.message || "리그 서버 연결을 준비 중이에요.")}</p><button class="button" id="reload-league">다시 불러오기</button>`;
      click("reload-league", () => show(route));
    } finally {
      if (requestTicket === ticket) content.removeAttribute("aria-busy");
    }
  }
  async function refresh() {
    if (busy || document.hidden) return;
    const requestTicket = ticket;
    try {
      const next = await transport("view", {});
      if (requestTicket !== ticket) return;
      if (
        next.revision !== view.revision ||
        next.settings.directoryExamplesEnabled !==
          view.settings.directoryExamplesEnabled
      ) {
        if (dirty) {
          feedback(
            "새로운 변경이 있어요. 입력을 마친 뒤 다시 불러와 최신 상태를 확인해 주세요.",
          );
          return;
        }
        view = next;
        render();
      }
    } catch {
      /* Keep the existing snapshot; explicit actions still surface errors. */
    }
  }
  function stop() {
    ticket++;
    clearInterval(timer);
    content.removeAttribute("aria-busy");
    route = "";
    previousPath = "";
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && route) void refresh();
  });
  window.addEventListener("online", () => {
    if (route) void refresh();
  });
  return { show, stop };
}
