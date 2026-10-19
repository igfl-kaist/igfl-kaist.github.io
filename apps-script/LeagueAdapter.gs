function leagueSettings_(config) {
  const p = storageProperties_(config);
  return {
    registrationOpen:
      p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true" &&
      p.getProperty("PRIVACY_STORAGE_APPROVED") === "true",
    privacyVersion:
      p.getProperty("PRIVACY_VERSION") ||
      League.policies.settings.privacyVersion,
    privacyNotice:
      p.getProperty("PRIVACY_NOTICE") || League.policies.settings.privacyNotice,
    publicConsentVersion: League.policies.settings.publicConsentVersion,
    publicConsentNotice: League.policies.settings.publicConsentNotice,
    operationsContact: p.getProperty("OPERATIONS_CONTACT") || "",
    competitionPhase: p.getProperty("LEAGUE_PHASE") || "regular",
    directoryExamplesEnabled: p.getProperty("LEAGUE_DIRECTORY_EXAMPLES") === "true",
    seasonEndsAt: Number(p.getProperty("LEAGUE_SEASON_ENDS_AT")) || null,
    seasonId: p.getProperty("LEAGUE_SEASON_ID") || "pilot",
    seasonName: p.getProperty("LEAGUE_SEASON_NAME") || "시즌 준비",
    seasonOpen: p.getProperty("LEAGUE_SEASON_OPEN") === "true",
    graceDays: Number(p.getProperty("TEAM_GRACE_DAYS") || 60),
  };
}
function loadLeague_(config) {
  const active = storageProperties_(config).getProperty(
    "LEAGUE_ACTIVE_SNAPSHOT",
  );
  if (!active) return League.createState(leagueSettings_(config));
  const pointer = JSON.parse(active),
    sheet = table_(config, "LeagueSnapshots");
  const rows = sheet.getRange(pointer.row, 1, pointer.count, 1).getValues();
  if (rows.some((r) => typeof r[0] !== "string" || !r[0].startsWith("IGFL:")))
    fail_("STORAGE_ERROR");
  const raw = Utilities.newBlob(
    Utilities.base64Decode(rows.map((r) => r[0].slice(5)).join("")),
  ).getDataAsString("UTF-8");
  if (raw.length !== pointer.length) fail_("STORAGE_ERROR");
  const state = JSON.parse(raw);
  state.settings = Object.assign(state.settings, leagueSettings_(config));
  return state;
}
function writeSnapshot_(sheet, state) {
  const raw = JSON.stringify(state),
    size = 32000,
    chunks = [];
  if (raw.length > 4000000) fail_("STORAGE_LIMIT");
  const encoded = Utilities.base64Encode(raw, Utilities.Charset.UTF_8);
  for (let i = 0; i < encoded.length; i += size)
    chunks.push(["IGFL:" + encoded.slice(i, i + size)]);
  const row = sheet.getLastRow() + 1;
  sheet
    .getRange(row, 1, chunks.length, 1)
    .setNumberFormat("@")
    .setValues(chunks);
  SpreadsheetApp.flush();
  return {
    row,
    count: chunks.length,
    length: raw.length,
    revision: state.revision,
  };
}
function saveLeague_(config, state) {
  const p = storageProperties_(config),
    old = JSON.parse(p.getProperty("LEAGUE_ACTIVE_SNAPSHOT") || "null");
  const pointer = writeSnapshot_(table_(config, "LeagueSnapshots"), state);
  // File ID and chunk pointer are committed together, including after a rotation.
  if (old?.sheetId) pointer.sheetId = old.sheetId;
  if (old?.cleanupId) pointer.cleanupId = old.cleanupId;
  p.setProperty("LEAGUE_ACTIVE_SNAPSHOT", JSON.stringify(pointer));
}
function leagueActor_(config, input) {
  if (!input.sessionToken) return null;
  const session = findSession_(config, input).value;
  const admins = (
    storageProperties_(config).getProperty("LEAGUE_ADMIN_USER_IDS") || ""
  ).split(",");
  return {
    userId: session.userId,
    email: session.email,
    admin: admins.indexOf(session.userId) >= 0,
  };
}
function leagueApi_(input) {
  const config = config_();
  return locked_(() => {
    resumeStorageRotation_(config);
    completeAccountErasure_(config);
    let state = loadLeague_(config);
    const actor = leagueActor_(config, input);
    if (League.maintain(state, Date.now())) {
      state.revision++;
      saveLeague_(config, state);
      rotateLeagueStorage_(config, "retention");
    }
    if (input.operation === "view") return League.privateView(state, actor);
    if (input.operation === "command") {
      const args = JSON.parse(input.payload || "{}");
      const out = League.execute(state, actor, input.command, args, {
        now: Date.now(),
        id: () => unique_(config, "league-id"),
        validateImage: (data) =>
          validateTeamImage(data, (base64) => Utilities.base64Decode(base64)),
      });
      if (out.result.withdrawn)
        storageProperties_(config).setProperty(
          "PENDING_ACCOUNT_ERASURE",
          JSON.stringify({ userId: actor.userId, email: actor.email }),
        );
      saveLeague_(config, out.state);
      if (out.result.withdrawn) completeAccountErasure_(config);
      return out.result;
    }
    fail_("BAD_REQUEST");
  });
}
function compactLeagueSnapshots_(config) {
  const raw = storageProperties_(config).getProperty("LEAGUE_ACTIVE_SNAPSHOT");
  if (!raw) return;
  const pointer = JSON.parse(raw);
  const sheet = table_(config, "LeagueSnapshots");
  if (pointer.row > 2) sheet.getRange(2, 1, pointer.row - 2, 1).clearContent();
  const tail = pointer.row + pointer.count,
    last = sheet.getLastRow();
  if (last >= tail) sheet.getRange(tail, 1, last - tail + 1, 1).clearContent();
  SpreadsheetApp.flush();
}
function completeAccountErasure_(config) {
  const p = storageProperties_(config),
    raw = p.getProperty("PENDING_ACCOUNT_ERASURE");
  if (!raw) return;
  const task = JSON.parse(raw);
  if (!task.cleanupId) {
    task.cleanupId = "erase-" + Date.now() + "-" + loadLeague_(config).revision;
    p.setProperty("PENDING_ACCOUNT_ERASURE", JSON.stringify(task));
  }
  resumeStorageRotation_(config);
  const pointer = JSON.parse(p.getProperty("LEAGUE_ACTIVE_SNAPSHOT") || "null");
  if (pointer?.cleanupId !== task.cleanupId) {
    const state = loadLeague_(config);
    League.policies.upgrade(state);
    League.policies.erase(state, task.userId);
    state.revision++;
    saveLeague_(config, state);
    eraseAuthAccount_(config, task.userId, task.email);
    compactLeagueSnapshots_(config);
    rotateLeagueStorage_(config, "withdrawal", task.cleanupId);
  }
  p.deleteProperty("PENDING_ACCOUNT_ERASURE");
}
// Owner attaches a time trigger in the editor. No mail, registration or season changes.
function runPrivacyMaintenance() {
  return locked_(() => privacyMaintenance_(config_(), Date.now()));
}
function privacyMaintenance_(config, now) {
  const p = storageProperties_(config);
  const previous = JSON.parse(
    p.getProperty("PRIVACY_MAINTENANCE_STATUS") || "{}",
  );
  const status = {
    status: "running",
    startedAt: now,
    lastSucceededAt: previous.lastSucceededAt || null,
    runs: (previous.runs || 0) + 1,
  };
  p.setProperty("PRIVACY_MAINTENANCE_STATUS", JSON.stringify(status));
  try {
    resumeStorageRotation_(config);
    completeAccountErasure_(config);
    const before = {};
    for (const name of ["Challenges", "Sessions", "Accounts"])
      before[name] = read_(config, name).length;
    prune_(config, now);
    const state = loadLeague_(config);
    if (League.maintain(state, now)) {
      state.revision++;
      saveLeague_(config, state);
      rotateLeagueStorage_(config, "retention");
    }
    const registered = new Set(state.profiles.map((p) => p.id));
    (p.getProperty("LEAGUE_ADMIN_USER_IDS") || "")
      .split(",")
      .filter(Boolean)
      .forEach((id) => registered.add(id));
    const rows = read_(config, "Accounts");
    for (let i = rows.length - 1; i >= 0; i--)
      if (
        !registered.has(rows[i].value.userId) &&
        rows[i].value.lastSeenAt <= now - 86400000
      )
        deleteRecord_(config, "Accounts", rows[i].row);
    compactLeagueSnapshots_(config);
    const removed = {};
    for (const name of ["Challenges", "Sessions", "Accounts"])
      removed[name] = before[name] - read_(config, name).length;
    Object.assign(status, {
      status: "succeeded",
      finishedAt: Date.now(),
      lastSucceededAt: now,
      removed,
    });
    p.setProperty("PRIVACY_MAINTENANCE_STATUS", JSON.stringify(status));
    return status;
  } catch (_) {
    // Provider messages can contain PII. Keep only a fixed failure code.
    Object.assign(status, {
      status: "failed",
      finishedAt: Date.now(),
      error: "PRIVACY_MAINTENANCE_FAILED",
    });
    p.setProperty("PRIVACY_MAINTENANCE_STATUS", JSON.stringify(status));
    throw new Error("PRIVACY_MAINTENANCE_FAILED");
  }
}
function initializeLeagueStorage() {
  locked_(() => {
    const config = config_(),
      db = SpreadsheetApp.openById(config.sheetId);
    if (!db.getSheetByName("LeagueSnapshots"))
      db.insertSheet("LeagueSnapshots").appendRow(["snapshot_chunks"]);
    if (
      !PropertiesService.getScriptProperties().getProperty(
        "LEAGUE_ACTIVE_SNAPSHOT",
      )
    )
      saveLeague_(config, League.createState(leagueSettings_()));
  });
}
// Owner installs a time trigger after configuring recipients. No mail is sent during pilot setup.
function leagueMailRecipients_(props, state, job) {
  return [
    ...new Set(
      (job.recipients === "admins"
        ? (props.getProperty("LEAGUE_ADMIN_EMAILS") || "").split(",")
        : job.recipients.map(
            (id) => state.profiles.find((p) => p.id === id)?.email,
          )
      )
        .map((email) => String(email || "").trim())
        .filter(Boolean),
    ),
  ];
}
function sendLeagueEmail_(props, job, manualTest) {
  MailApp.sendEmail({
    to: job.recipients.join(","),
    subject:
      "[IGFL] " +
      (manualTest ? "[테스트] " : "") +
      ({
        refereeRequest: "심판 배정 요청",
        teamApplication: "팀 등록 신청",
        eligibility: "선수 자격 확인 요청",
        dispute: "경기 이의 제기",
        scoreMismatch: "경기 스코어 불일치",
        externalApproval: "외부 심판 경기 승인 대기",
        matchIncident: "경기 예외 보고",
        resultOverdue: "경기 결과 제출·확인 지연",
        approvalOverdue: "경기 최종 승인 지연",
        teamVacancy: "회원 탈퇴로 인한 팀 대표 공석",
      }[job.kind] || "운영 알림"),
    body:
      (manualTest
        ? "운영자가 요청한 수동 발송 시험입니다. 실제 팀 신청이나 심판 배정 요청이 아니며, 수락·승인할 필요가 없습니다.\n선수 가입과 리그 메일 자동 발송은 닫혀 있습니다.\n\n"
        : "홈페이지에서 요청 내용을 확인해 주세요.\n") +
      (props.getProperty("LEAGUE_SITE_URL") || "") +
      "\n알림 ID: " +
      job.id,
  });
}
function processLeagueEmails() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("LEAGUE_EMAILS_ENABLED") !== "true") return;
  const config = config_();
  for (let n = 0; n < 10; n++) {
    const job = locked_(() => {
      resumeStorageRotation_(config);
      completeAccountErasure_(config);
      const s = loadLeague_(config),
        now = Date.now(),
        j = s.outbox.find(
          (j) =>
            ["pending", "failed"].includes(j.status) &&
            j.attempts < 3 &&
            (!j.nextAttemptAt || j.nextAttemptAt <= now),
        );
      if (!j) return null;
      const recipients = leagueMailRecipients_(props, s, j);
      if (
        !recipients.length ||
        MailApp.getRemainingDailyQuota() < recipients.length
      ) {
        j.lastError = "RECIPIENT_OR_QUOTA_NOT_CONFIGURED";
        saveLeague_(config, s);
        return null;
      }
      j.status = "sending";
      j.attempts++;
      j.claimedAt = now;
      saveLeague_(config, s);
      return { id: j.id, kind: j.kind, recipients };
    });
    if (!job) return;
    let success = true;
    try {
      sendLeagueEmail_(props, job, false);
    } catch (e) {
      success = false;
    }
    // MailApp has no idempotency key: an exception can follow delivery. Never blindly resend.
    locked_(() => {
      resumeStorageRotation_(config);
      completeAccountErasure_(config);
      const s = loadLeague_(config),
        j = s.outbox.find((j) => j.id === job.id);
      j.status = success ? "sent" : "uncertain";
      j.lastError = success ? null : "MAIL_DELIVERY_UNCERTAIN";
      saveLeague_(config, s);
    });
  }
}
