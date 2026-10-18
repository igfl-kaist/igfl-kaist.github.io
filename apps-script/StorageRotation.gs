// Editor-only administration. No Drive deletion scope, no automatic file deletion.
function retiredFile_(p, id, reason, target) {
  const key = "IGFL_RETIRED:" + id;
  if (!p.getProperty(key))
    checkedProperty_(
      p,
      key,
      JSON.stringify({
        sheetId: id,
        replacementId: target,
        reason,
        retiredAt: Date.now(),
        deletionStatus: "pending-owner-deletion",
      }),
    );
}
function resumeStorageRotation_(config) {
  const p = storageProperties_(config),
    raw = p.getProperty("SHEET_ROTATION_JOB");
  if (!raw) return;
  const job = JSON.parse(raw),
    active = JSON.parse(p.getProperty("LEAGUE_ACTIVE_SNAPSHOT") || "null");
  if (!job.targetId) fail_("SHEET_CREATION_REVIEW_REQUIRED");
  if (active?.sheetId !== job.targetId) {
    if (JSON.stringify(active) !== job.sourcePointer)
      fail_("ROTATION_SOURCE_CHANGED");
    const state = loadLeague_(config),
      text = JSON.stringify(state);
    // Retries copy the exact committed source; no subsequent command may pass a pending job.
    const db = SpreadsheetApp.openById(job.targetId);
    let sheet = db.getSheetByName("LeagueSnapshots");
    if (!sheet)
      sheet = db
        .getSheets()[0]
        .setName("LeagueSnapshots")
        .appendRow(["snapshot_chunks"]);
    const pointer = writeSnapshot_(sheet, state);
    pointer.sheetId = job.targetId;
    if (job.cleanupId) pointer.cleanupId = job.cleanupId;
    const values = sheet.getRange(pointer.row, 1, pointer.count, 1).getValues();
    if (
      values.some((r) => typeof r[0] !== "string" || !r[0].startsWith("IGFL:"))
    )
      fail_("ROTATION_VERIFY_FAILED");
    const actual = Utilities.newBlob(
      Utilities.base64Decode(values.map((r) => r[0].slice(5)).join("")),
    ).getDataAsString("UTF-8");
    if (actual !== text) fail_("ROTATION_VERIFY_FAILED");
    // One atomic pointer switch AFTER exact read-back. Never copy the original Drive file.
    p.setProperty("LEAGUE_ACTIVE_SNAPSHOT", JSON.stringify(pointer));
  }
  // Commit may have succeeded before the execution stopped. Finalize without re-copying.
  retiredFile_(p, job.sourceId, job.reason, job.targetId);
  p.setProperty(
    "LAST_SHEET_ROTATION",
    JSON.stringify({
      at: Date.now(),
      sourceId: job.sourceId,
      targetId: job.targetId,
      reason: job.reason,
      verified: true,
    }),
  );
  p.deleteProperty("SHEET_ROTATION_JOB");
}
function rotateLeagueStorage_(config, reason, cleanupId) {
  const p = storageProperties_(config);
  if (p.getProperty("SHEET_ROTATION_JOB")) {
    resumeStorageRotation_(config);
    return;
  }
  read_(config, "Accounts"); // migration must finish before retiring the legacy auth file
  const pointer = p.getProperty("LEAGUE_ACTIVE_SNAPSHOT");
  if (!pointer) fail_("NOT_CONFIGURED");
  const sourceId = JSON.parse(pointer).sheetId || config.sheetId;
  const job = {
    sourceId,
    sourcePointer: pointer,
    reason,
    cleanupId,
    createdAt: Date.now(),
  };
  // Record intent before creation. An uncertain create is held for owner review, never retried blindly.
  p.setProperty("SHEET_ROTATION_JOB", JSON.stringify(job));
  const db = SpreadsheetApp.create("IGFL League — Clean " + job.createdAt);
  job.targetId = db.getId();
  p.setProperty("SHEET_ROTATION_JOB", JSON.stringify(job));
  resumeStorageRotation_(config);
}
function rotateLeagueStorage() {
  return locked_(() => {
    rotateLeagueStorage_(config_(), "owner-clean-copy");
    return inspectStorageStatus_();
  });
}
function inspectStorageStatus_() {
  const p = PropertiesService.getScriptProperties(),
    all = p.getProperties();
  const pointer = JSON.parse(all.LEAGUE_ACTIVE_SNAPSHOT || "null");
  const status = {
    authStorage: all.AUTH_STORAGE_VERSION || "migration-required",
    authRecordCounts: Object.fromEntries(
      ["Challenges", "Sessions", "Accounts"].map((n) => [
        n,
        Object.keys(all).filter((k) => k.startsWith(authPrefix_(n))).length,
      ]),
    ),
    propertiesBytes: Object.keys(all).reduce(
      (n, k) => n + propertyBytes_(k) + propertyBytes_(all[k]),
      0,
    ),
    activeSheet:
      "https://docs.google.com/spreadsheets/d/" +
      (pointer?.sheetId || all.AUTH_SHEET_ID) +
      "/edit",
    rotation: JSON.parse(all.SHEET_ROTATION_JOB || "null"),
    lastRotation: JSON.parse(all.LAST_SHEET_ROTATION || "null"),
    retiredFiles: Object.keys(all)
      .filter((k) => k.startsWith("IGFL_RETIRED:"))
      .map((k) => {
        const v = JSON.parse(all[k]);
        return {
          ...v,
          url: "https://docs.google.com/spreadsheets/d/" + v.sheetId + "/edit",
        };
      }),
    registrationOpen: leagueSettings_().registrationOpen,
    seasonOpen: leagueSettings_().seasonOpen,
    leagueEmailsEnabled: all.LEAGUE_EMAILS_ENABLED === "true",
  };
  Logger.log(
    JSON.stringify({
      authStorage: status.authStorage,
      authRecordCounts: status.authRecordCounts,
      propertiesBytes: status.propertiesBytes,
      activeSheet: status.activeSheet,
      registrationOpen: status.registrationOpen,
      seasonOpen: status.seasonOpen,
      leagueEmailsEnabled: status.leagueEmailsEnabled,
      pendingFiles: status.retiredFiles.filter(
        (f) => f.deletionStatus === "pending-owner-deletion",
      ).length,
    }),
  );
  for (const file of status.retiredFiles) Logger.log(JSON.stringify(file));
  if (status.rotation)
    Logger.log(JSON.stringify({ rotation: status.rotation }));
  return status;
}
function inspectStorageStatus() {
  return locked_(() => inspectStorageStatus_());
}
// After deleting a retired file AND its copies/trash manually, the owner can record an attestation.
// Editor callers supply the exact retired ID. This is not evidence of Google/Vault physical deletion.
function recordManualFileDeletion(sheetId) {
  return locked_(() => {
    const p = PropertiesService.getScriptProperties();
    sheetId = sheetId || p.getProperty("MANUALLY_DELETED_SHEET_ID");
    const key = "IGFL_RETIRED:" + sheetId;
    const raw = p.getProperty(key);
    if (!raw || !sheetId || inspectActiveSheetId_() === sheetId)
      fail_("INVALID_RETIRED_FILE");
    const entry = JSON.parse(raw);
    entry.deletionStatus = "owner-reported-deleted";
    entry.reportedAt = Date.now();
    p.setProperty(key, JSON.stringify(entry));
    p.deleteProperty("MANUALLY_DELETED_SHEET_ID");
  });
}
function inspectActiveSheetId_() {
  const p = PropertiesService.getScriptProperties();
  return (
    JSON.parse(p.getProperty("LEAGUE_ACTIVE_SNAPSHOT") || "null")?.sheetId ||
    p.getProperty("AUTH_SHEET_ID")
  );
}
// Only for an interrupted create with no recorded ID. First inspect Drive for the
// exact 'Clean <createdAt>' title and delete/record any orphan manually. This does not restore data.
function acknowledgeUncertainSheetCreation() {
  return locked_(() => {
    const p = PropertiesService.getScriptProperties();
    const job = JSON.parse(p.getProperty("SHEET_ROTATION_JOB") || "null");
    if (!job || job.targetId) fail_("NO_UNCERTAIN_CREATION");
    checkedProperty_(
      p,
      "SHEET_CREATION_INCIDENT:" + job.createdAt,
      JSON.stringify({
        at: job.createdAt,
        status: "owner-reviewed-unknown-create",
        sourceId: job.sourceId,
      }),
    );
    p.deleteProperty("SHEET_ROTATION_JOB");
  });
}
