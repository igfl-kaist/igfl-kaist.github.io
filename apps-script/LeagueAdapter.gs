function leagueSettings_() {
  const p = PropertiesService.getScriptProperties();
  return {
    registrationOpen: p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true",
    privacyVersion: p.getProperty("PRIVACY_VERSION") || "",
    privacyNotice: p.getProperty("PRIVACY_NOTICE") || "",
    seasonId: p.getProperty("LEAGUE_SEASON_ID") || "pilot",
    seasonName: p.getProperty("LEAGUE_SEASON_NAME") || "시즌 준비",
    seasonOpen: p.getProperty("LEAGUE_SEASON_OPEN") === "true",
    graceDays: Number(p.getProperty("TEAM_GRACE_DAYS") || 60),
  };
}
function loadLeague_(config) {
  const props = PropertiesService.getScriptProperties(),
    active = props.getProperty("LEAGUE_ACTIVE_SNAPSHOT");
  if (!active) return League.createState(leagueSettings_());
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
  state.settings = Object.assign(state.settings, leagueSettings_());
  return state;
}
function saveLeague_(config, state) {
  const sheet = table_(config, "LeagueSnapshots"),
    raw = JSON.stringify(state),
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
  // The only commit point. Incomplete snapshots never replace the active pointer.
  PropertiesService.getScriptProperties().setProperty(
    "LEAGUE_ACTIVE_SNAPSHOT",
    JSON.stringify({
      row,
      count: chunks.length,
      length: raw.length,
      revision: state.revision,
    }),
  );
}
function leagueActor_(config, input) {
  if (!input.sessionToken) return null;
  const session = findSession_(config, input).value;
  const admins = (
    PropertiesService.getScriptProperties().getProperty(
      "LEAGUE_ADMIN_USER_IDS",
    ) || ""
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
    let state = loadLeague_(config);
    const actor = leagueActor_(config, input);
    if (League.maintain(state, Date.now())) {
      state.revision++;
      saveLeague_(config, state);
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
      saveLeague_(config, out.state);
      return out.result;
    }
    fail_("BAD_REQUEST");
  });
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
function processLeagueEmails() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("LEAGUE_EMAILS_ENABLED") !== "true") return;
  const config = config_();
  for (let n = 0; n < 10; n++) {
    const job = locked_(() => {
      const s = loadLeague_(config),
        now = Date.now(),
        j = s.outbox.find(
          (j) =>
            ["pending", "failed"].includes(j.status) &&
            j.attempts < 3 &&
            (!j.nextAttemptAt || j.nextAttemptAt <= now),
        );
      if (!j) return null;
      const recipients =
        j.recipients === "admins"
          ? (props.getProperty("LEAGUE_ADMIN_EMAILS") || "")
              .split(",")
              .filter(Boolean)
          : j.recipients
              .map((id) => s.profiles.find((p) => p.id === id)?.email)
              .filter(Boolean);
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
      MailApp.sendEmail({
        to: job.recipients.join(","),
        subject:
          "[IGFL] " +
          ({
            refereeRequest: "심판 배정 요청",
            teamApplication: "팀 등록 신청",
            eligibility: "선수 자격 확인 요청",
            dispute: "경기 이의 제기",
            scoreMismatch: "경기 스코어 불일치",
            externalApproval: "외부 심판 경기 승인 대기",
          }[job.kind] || "운영 알림"),
        body:
          "홈페이지에서 요청 내용을 확인해 주세요.\n" +
          (props.getProperty("LEAGUE_SITE_URL") || "") +
          "\n알림 ID: " +
          job.id,
      });
    } catch (e) {
      success = false;
    }
    // MailApp has no idempotency key: an exception can follow delivery. Never blindly resend.
    locked_(() => {
      const s = loadLeague_(config),
        j = s.outbox.find((j) => j.id === job.id);
      j.status = success ? "sent" : "uncertain";
      j.lastError = success ? null : "MAIL_DELIVERY_UNCERTAIN";
      saveLeague_(config, s);
    });
  }
}
