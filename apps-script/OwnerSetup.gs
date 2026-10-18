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
