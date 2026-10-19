/** Editor-only bootstrap entry. No HTML Service or public API routes expose it. */
function initializeAuth() {
  initializeAuth_();
}

/** Read-only owner diagnostic. Does not expose addresses, keys, OTPs or tokens. */
function inspectRuntimeStatus() {
  const config = config_(),
    p = PropertiesService.getScriptProperties();
  const status = {
    checkedAtUnixMs: Date.now(),
    authVersion: IGFL_.version,
    authEmailScope: config.emailScope,
    allowedDomain: "kaist.ac.kr",
    remainingMailRecipients: MailApp.getRemainingDailyQuota(),
    authRequestBudgetPer24Hours: IGFL_.dailyBudget,
    registrationOpen:
      p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true" &&
      p.getProperty("PRIVACY_STORAGE_APPROVED") === "true",
    registrationRequested: p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true",
    privacyStorageApproved:
      p.getProperty("PRIVACY_STORAGE_APPROVED") === "true",
    seasonOpen: p.getProperty("LEAGUE_SEASON_OPEN") === "true",
    leagueEmailsEnabled: p.getProperty("LEAGUE_EMAILS_ENABLED") === "true",
    privacyMaintenance: JSON.parse(
      p.getProperty("PRIVACY_MAINTENANCE_STATUS") || "null",
    ),
  };
  Logger.log(JSON.stringify(status));
  return status;
}

/** Explicit owner action, separate from opening player profile collection. */
function allowKaistEmailAuthentication() {
  locked_(() => {
    config_();
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true")
      throw new Error(
        "Close player registration before this launch-stage change.",
      );
    p.setProperty("AUTH_EMAIL_SCOPE", "kaist");
  });
  return inspectRuntimeStatus();
}

/** Owner-only publication setup. It never grants privacy approval or opens the league. */
function configurePrivacyNotices() {
  return locked_(() => {
    const p = PropertiesService.getScriptProperties();
    if (
      [
        "LEAGUE_REGISTRATION_OPEN",
        "PRIVACY_STORAGE_APPROVED",
        "LEAGUE_SEASON_OPEN",
        "LEAGUE_EMAILS_ENABLED",
      ].some((k) => p.getProperty(k) === "true")
    )
      fail_("CLOSE_LEAGUE_BEFORE_NOTICE_SETUP");
    p.setProperty("OPERATIONS_CONTACT", PRIVACY.contact);
    p.setProperty("PRIVACY_VERSION", PRIVACY.collectionVersion);
    p.setProperty("PRIVACY_NOTICE", PRIVACY.collectionNotice);
    const status = {
      operationsContact: p.getProperty("OPERATIONS_CONTACT"),
      privacyVersion: p.getProperty("PRIVACY_VERSION"),
      publicConsentVersion: League.policies.settings.publicConsentVersion,
      registrationOpen: leagueSettings_().registrationOpen,
      privacyStorageApproved:
        p.getProperty("PRIVACY_STORAGE_APPROVED") === "true",
      seasonOpen: leagueSettings_().seasonOpen,
      leagueEmailsEnabled: p.getProperty("LEAGUE_EMAILS_ENABLED") === "true",
    };
    Logger.log(JSON.stringify(status));
    return status;
  });
}

function requireClosedLaunch_(p) {
  if (
    [
      "LEAGUE_REGISTRATION_OPEN",
      "PRIVACY_STORAGE_APPROVED",
      "LEAGUE_SEASON_OPEN",
      "LEAGUE_EMAILS_ENABLED",
    ].some((key) => p.getProperty(key) === "true")
  )
    fail_("CLOSE_LEAGUE_BEFORE_OWNER_SETUP");
}
function operationsAccount_(config) {
  const p = storageProperties_(config),
    rows = read_(config, "Accounts"),
    matches = rows.filter((r) => r.value.email === PRIVACY.contact);
  if (matches.length !== 1 || !matches[0].value.userId)
    fail_("OPERATIONS_LOGIN_REQUIRED");
  const account = matches[0].value,
    pending = JSON.parse(p.getProperty("PENDING_ACCOUNT_ERASURE") || "null");
  if (
    rows.some(
      (r) =>
        r.value.userId === account.userId && r.value.email !== PRIVACY.contact,
    )
  )
    fail_("OPERATIONS_ACCOUNT_CONFLICT");
  if (
    pending &&
    (pending.email === account.email || pending.userId === account.userId)
  )
    fail_("ACCOUNT_ERASURE_PENDING");
  return account;
}
/** Editor-only, read-only preflight. Never prints IDs or authentication records. */
function inspectOperationsSetup() {
  return locked_(() => {
    const config = config_(),
      p = storageProperties_(config);
    let account = null,
      readiness = "ready";
    try {
      account = operationsAccount_(config);
    } catch (e) {
      readiness = e.igflCode || "OWNER_SETUP_ERROR";
    }
    const status = {
      operationsEmail: PRIVACY.contact,
      readiness,
      adminBound:
        !!account &&
        (p.getProperty("LEAGUE_ADMIN_USER_IDS") || "")
          .split(",")
          .includes(account.userId),
      adminMailConfigured:
        p.getProperty("LEAGUE_ADMIN_EMAILS") === PRIVACY.contact,
      siteConfigured:
        p.getProperty("LEAGUE_SITE_URL") === "https://igfl-kaist.github.io/",
      siteUrl: p.getProperty("LEAGUE_SITE_URL") || "",
      registrationRequested:
        p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true",
      privacyStorageApproved:
        p.getProperty("PRIVACY_STORAGE_APPROVED") === "true",
      seasonOpen: p.getProperty("LEAGUE_SEASON_OPEN") === "true",
      leagueEmailsEnabled: p.getProperty("LEAGUE_EMAILS_ENABLED") === "true",
      remainingMailRecipients: MailApp.getRemainingDailyQuota(),
      manualMailTest: JSON.parse(
        p.getProperty("LEAGUE_MANUAL_MAIL_TEST_V1") || "null",
      ),
    };
    Logger.log(JSON.stringify(status));
    return status;
  });
}
/** Explicit owner grant to the already email-verified account, not to a browser role claim. */
function configureOperationsAdmin() {
  locked_(() => {
    const config = config_(),
      p = storageProperties_(config);
    requireClosedLaunch_(p);
    const account = operationsAccount_(config),
      admins = (p.getProperty("LEAGUE_ADMIN_USER_IDS") || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    p.setProperty(
      "LEAGUE_ADMIN_USER_IDS",
      [...new Set([...admins, account.userId])].join(","),
    );
    p.setProperty("LEAGUE_ADMIN_EMAILS", PRIVACY.contact);
    p.setProperty("LEAGUE_SITE_URL", "https://igfl-kaist.github.io/");
  });
  return inspectOperationsSetup();
}
/** Owner-only URL migration. Does not grant roles, send mail or open launch gates. */
function configureLeagueSiteUrl() {
  locked_(() => {
    const p = storageProperties_(config_());
    requireClosedLaunch_(p);
    p.setProperty("LEAGUE_SITE_URL", "https://igfl-kaist.github.io/");
  });
  return inspectOperationsSetup();
}
/** Two isolated, one-time test jobs. Never drains or edits the production league outbox. */
function sendOperationsMailTests() {
  const p = PropertiesService.getScriptProperties(),
    key = "LEAGUE_MANUAL_MAIL_TEST_V1";
  for (let n = 0; n < 2; n++) {
    const job = locked_(() => {
      requireClosedLaunch_(p);
      if (p.getProperty("LEAGUE_ADMIN_EMAILS") !== PRIVACY.contact)
        fail_("OPERATIONS_MAIL_NOT_CONFIGURED");
      const journal = JSON.parse(
          p.getProperty(key) ||
            JSON.stringify({
              jobs: [
                {
                  id: "manual-admin-v1",
                  kind: "teamApplication",
                  recipients: "admins",
                  status: "pending",
                },
                {
                  id: "manual-referee-v1",
                  kind: "refereeRequest",
                  recipients: ["synthetic-referee"],
                  status: "pending",
                },
              ],
            }),
        ),
        j = journal.jobs.find((j) => j.status === "pending");
      if (!j) return null;
      const recipients = leagueMailRecipients_(
        p,
        { profiles: [{ id: "synthetic-referee", email: PRIVACY.contact }] },
        j,
      );
      if (recipients.length !== 1 || recipients[0] !== PRIVACY.contact)
        fail_("TEST_RECIPIENT_REJECTED");
      if (MailApp.getRemainingDailyQuota() < 1) return null;
      j.status = "sending";
      j.claimedAt = Date.now();
      checkedProperty_(p, key, JSON.stringify(journal));
      return { id: j.id, kind: j.kind, recipients };
    });
    if (!job) break;
    let success = true;
    try {
      sendLeagueEmail_(p, job, true);
    } catch (e) {
      success = false;
    }
    locked_(() => {
      const journal = JSON.parse(p.getProperty(key)),
        j = journal.jobs.find((j) => j.id === job.id);
      j.status = success ? "sent" : "uncertain";
      j.finishedAt = Date.now();
      checkedProperty_(p, key, JSON.stringify(journal));
    });
  }
  return inspectOperationsSetup();
}
