/** Editor-only bootstrap entry. No HTML Service or public API routes expose it. */
function initializeAuth() {
  initializeAuth_();
}

/** Read-only owner diagnostic. Does not expose addresses, keys, OTPs or tokens. */
function inspectRuntimeStatus() {
  const config = config_(), p = PropertiesService.getScriptProperties();
  const status = {
    checkedAtUnixMs: Date.now(),
    authVersion: IGFL_.version,
    authEmailScope: config.emailScope,
    allowedDomain: 'kaist.ac.kr',
    remainingMailRecipients: MailApp.getRemainingDailyQuota(),
    authRequestBudgetPer24Hours: IGFL_.dailyBudget,
    registrationOpen: p.getProperty('LEAGUE_REGISTRATION_OPEN') === 'true',
    seasonOpen: p.getProperty('LEAGUE_SEASON_OPEN') === 'true'
  };
  Logger.log(JSON.stringify(status));
  return status;
}

/** Explicit owner action, separate from opening player profile collection. */
function allowKaistEmailAuthentication() {
  locked_(() => {
    config_();
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty('LEAGUE_REGISTRATION_OPEN') === 'true')
      throw new Error('Close player registration before this launch-stage change.');
    p.setProperty('AUTH_EMAIL_SCOPE', 'kaist');
  });
  return inspectRuntimeStatus();
}
