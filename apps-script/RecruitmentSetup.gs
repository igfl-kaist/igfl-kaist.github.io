/** Owner-only pilot operations. None of these functions is exposed by doPost. */
function configureManualDeletionPolicy() {
  return locked_(() => {
    const p = storageProperties_(config_());
    requireClosedLaunch_(p);
    p.setProperty("OPERATIONS_CONTACT", PRIVACY.contact);
    p.setProperty("PRIVACY_VERSION", PRIVACY.collectionVersion);
    p.setProperty("PRIVACY_NOTICE", PRIVACY.collectionNotice);
    p.setProperty(
      "PRIVACY_MANUAL_DELETION_POLICY",
      JSON.stringify({
        version: PRIVACY.manualDeletionPolicyVersion,
        adoptedAt: Date.now(),
        basis: "operator-manual-erasure-and-no-restoration",
      }),
    );
    return inspectRecruitmentLaunch_();
  });
}
function inspectRecruitmentLaunch_() {
  const config = config_(),
    p = storageProperties_(config),
    all = p.getProperties();
  const policy = JSON.parse(all.PRIVACY_MANUAL_DELETION_POLICY || "null"),
    maintenance = JSON.parse(all.PRIVACY_MAINTENANCE_STATUS || "null");
  let operator = null;
  try {
    operator = operationsAccount_(config);
  } catch (_) {}
  const checks = {
    authStorageReady: all.AUTH_STORAGE_VERSION === "properties-v1",
    kaistEmailScope: config.emailScope === "kaist",
    operatorBound:
      !!operator &&
      (all.LEAGUE_ADMIN_USER_IDS || "").split(",").includes(operator.userId),
    noticesCurrent:
      all.PRIVACY_VERSION === PRIVACY.collectionVersion &&
      all.PRIVACY_NOTICE === PRIVACY.collectionNotice &&
      all.OPERATIONS_CONTACT === PRIVACY.contact,
    manualPolicyAdopted:
      policy?.version === PRIVACY.manualDeletionPolicyVersion &&
      policy.basis === "operator-manual-erasure-and-no-restoration",
    noPendingFiles: !Object.keys(all)
      .filter((k) => k.startsWith("IGFL_RETIRED:"))
      .some(
        (k) => JSON.parse(all[k]).deletionStatus === "pending-owner-deletion",
      ),
    noPendingErasure: !all.PENDING_ACCOUNT_ERASURE && !all.SHEET_ROTATION_JOB,
    maintenanceHealthy:
      maintenance?.status === "succeeded" &&
      maintenance.lastSucceededAt <= Date.now() &&
      Date.now() - maintenance.lastSucceededAt <= 2 * 3600000,
    preseasonPrepared:
      all.LEAGUE_PHASE === "preseason" &&
      all.LEAGUE_SEASON_ID === COMPETITION.preseasonId,
    seasonClosed: all.LEAGUE_SEASON_OPEN !== "true",
    automaticMailClosed: all.LEAGUE_EMAILS_ENABLED !== "true",
    mailAvailable: MailApp.getRemainingDailyQuota() > 0,
    propertyCapacity:
      Object.entries(all).reduce(
        (n, [key, value]) => n + propertyBytes_(key) + propertyBytes_(value),
        0,
      ) < 400000,
  };
  const status = {
    ready: Object.values(checks).every(Boolean),
    checks,
    authRequestBudgetPer24Hours: IGFL_.dailyBudget,
    remainingMailRecipients: MailApp.getRemainingDailyQuota(),
    registrationOpen: leagueSettings_(config).registrationOpen,
    privacyStorageApproved: all.PRIVACY_STORAGE_APPROVED === "true",
    seasonOpen: all.LEAGUE_SEASON_OPEN === "true",
    leagueEmailsEnabled: all.LEAGUE_EMAILS_ENABLED === "true",
    privacyVersion: all.PRIVACY_VERSION || null,
    manualPolicyVersion: policy?.version || null,
  };
  Logger.log(JSON.stringify(status));
  return status;
}
function inspectRecruitmentLaunch() {
  return locked_(() => inspectRecruitmentLaunch_());
}
/** Opens only player registration and the existing team application workflow. */
function openPlayerRecruitment() {
  return locked_(() => {
    const status = inspectRecruitmentLaunch_();
    if (!status.ready) fail_("RECRUITMENT_NOT_READY");
    const p = storageProperties_(config_());
    // This records the operator's pilot decision, not external/legal approval.
    p.setProperty("PRIVACY_STORAGE_APPROVED", "true");
    p.setProperty("LEAGUE_REGISTRATION_OPEN", "true");
    return inspectRecruitmentLaunch_();
  });
}
/** Reversible owner stop; preserves members, consents, policies and records. */
function closePlayerRecruitment() {
  return locked_(() => {
    const p = storageProperties_(config_());
    p.setProperty("LEAGUE_REGISTRATION_OPEN", "false");
    p.setProperty("PRIVACY_STORAGE_APPROVED", "false");
    return inspectRecruitmentLaunch_();
  });
}
/** Executes shared registration/withdrawal rules in memory. No mail, files or auth records. */
function verifyRecruitmentRules() {
  const now = Date.now(),
    actor = {
      userId: "synthetic-recruitment-check",
      email: "synthetic-check@kaist.ac.kr",
    };
  const initial = League.createState({
    ...leagueSettings_(config_()),
    registrationOpen: true,
  });
  let counter = 0;
  const context = { now, id: () => "synthetic-" + ++counter };
  const joined = League.execute(
    initial,
    actor,
    "registerPlayer",
    {
      expectedRevision: initial.revision,
      name: "합성 가입 검증",
      identifier: "SYNTHETIC-ONLY",
      eligibility: "graduate",
      department: "ISE",
      lab: "합성 연구실",
      advisor: "합성 지도교수",
      referee: false,
      consent: true,
      consentVersion: PRIVACY.collectionVersion,
      publicConsent: true,
      publicConsentVersion: PRIVACY.publicVersion,
    },
    context,
  ).state;
  const erased = League.execute(
    joined,
    actor,
    "withdrawAccount",
    {
      expectedRevision: joined.revision,
      confirmed: true,
    },
    context,
  ).state;
  const checks = {
    registered: joined.players.length === 1 && joined.profiles.length === 1,
    privateProfileHidden: !JSON.stringify(League.publicView(joined)).includes(
      "SYNTHETIC-ONLY",
    ),
    collectionVersionStored:
      joined.profiles[0].consentVersion === PRIVACY.collectionVersion,
    publicVersionStored:
      joined.profiles[0].publicConsentVersion === PRIVACY.publicVersion,
    erased:
      erased.players.length === 0 &&
      erased.profiles.length === 0 &&
      !JSON.stringify(erased).includes(actor.email),
  };
  const result = {
    passed: Object.values(checks).every(Boolean),
    inMemoryOnly: true,
    checks,
  };
  Logger.log(JSON.stringify(result));
  if (!result.passed) fail_("RECRUITMENT_RULES_FAILED");
  return result;
}
