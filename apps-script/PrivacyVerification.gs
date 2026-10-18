// Editor-only verification. Never routed by doPost. Synthetic addresses cannot receive mail.
function probeConfig_(probe) {
  const values = probe.properties;
  return {
    sheetId: probe.sheetId,
    properties: {
      getProperty: (key) => values[key] || null,
      setProperty: (key, value) => {
        values[key] = String(value);
      },
      deleteProperty: (key) => {
        delete values[key];
      },
    },
  };
}
function preparePrivacyProbe() {
  return locked_(() => {
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty("PRIVACY_PROBE")) throw new Error("PROBE_ALREADY_EXISTS");
    if (leagueSettings_().registrationOpen)
      throw new Error("CLOSE_REGISTRATION_FIRST");
    const db = SpreadsheetApp.create("IGFL Privacy Probe — Synthetic Only");
    db.getSheets()[0].setName("Challenges").appendRow(["record_json"]);
    for (const name of ["Sessions", "Accounts", "LeagueSnapshots"])
      db.insertSheet(name).appendRow([
        name === "LeagueSnapshots" ? "snapshot_chunks" : "record_json",
      ]);
    const now = Date.now(),
      day = 86400000;
    const probe = {
      sheetId: db.getId(),
      preparedAt: now,
      status: "armed",
      properties: { LEAGUE_ADMIN_USER_IDS: "probe-admin" },
    };
    const config = probeConfig_(probe),
      state = League.createState(leagueSettings_(config));
    for (const id of ["probe-keep", "probe-erase"]) {
      state.players.push({
        id,
        name: id,
        lab: "합성 연구실",
        teamId: null,
        referee: false,
      });
      state.profiles.push({ id, email: id + "@example.invalid" });
      append_(config, "Accounts", {
        userId: id,
        email: id + "@example.invalid",
        createdAt: now - 2 * day,
        lastSeenAt: now - 2 * day,
      });
    }
    for (const id of ["probe-admin", "probe-unregistered"])
      append_(config, "Accounts", {
        userId: id,
        email: id + "@example.invalid",
        createdAt: now - 2 * day,
        lastSeenAt: now - 2 * day,
      });
    for (const [id, age, lifetime] of [
      ["old", day + 1, 300000],
      ["expired", 600000, 300000],
      ["live", 0, 300000],
    ])
      append_(config, "Challenges", {
        id,
        email: "probe-keep@example.invalid",
        createdAt: now - age,
        expiresAt: now - age + lifetime,
        codeHash: "SYNTHETIC_HASH_ONLY",
      });
    for (const [id, expiresAt] of [
      ["expired", now - 1],
      ["live", now + 43200000],
    ])
      append_(config, "Sessions", {
        id,
        userId: "probe-keep",
        email: "probe-keep@example.invalid",
        createdAt: now - 1000,
        expiresAt,
        tokenHash: "SYNTHETIC_HASH_ONLY",
      });
    for (const name of ["Challenges", "Sessions"])
      append_(config, name, {
        id: "erase",
        userId: "probe-erase",
        email: "probe-erase@example.invalid",
        createdAt: now,
        expiresAt: now + day,
      });
    state.audit.push(
      { id: "old", at: now - 91 * day },
      { id: "recent", at: now },
    );
    state.seasons.push({ id: "expired", endsAt: now - 731 * day });
    state.matches.push({
      id: "expired",
      seasonId: "expired",
      status: "final",
      startsAt: now - 732 * day,
      teamA: "t1",
      teamB: "t2",
      score: { a: 1, b: 0 },
      refereeId: "probe-keep",
      history: [],
      rosters: { t1: ["probe-keep"] },
      submissions: {
        t1: { players: [{ id: "probe-keep" }], goals: { "probe-keep": 1 } },
      },
    });
    saveLeague_(config, state);
    state.revision++;
    saveLeague_(config, state);
    config.properties.setProperty(
      "PENDING_ACCOUNT_ERASURE",
      JSON.stringify({
        userId: "probe-erase",
        email: "probe-erase@example.invalid",
      }),
    );
    p.setProperty("PRIVACY_PROBE", JSON.stringify(probe));
    Logger.log(
      JSON.stringify({
        status: probe.status,
        preparedAt: now,
        syntheticOnly: true,
        sheetId: probe.sheetId,
      }),
    );
  });
}
function runPrivacyProbe_() {
  const p = PropertiesService.getScriptProperties(),
    raw = p.getProperty("PRIVACY_PROBE");
  if (!raw) return;
  const probe = JSON.parse(raw);
  if (probe.status !== "armed") return;
  const config = probeConfig_(probe);
  try {
    privacyMaintenance_(config, Date.now());
    const state = loadLeague_(config),
      auth = {};
    for (const name of ["Challenges", "Sessions", "Accounts"])
      auth[name] = read_(config, name).map((r) => r.value);
    const pointer = JSON.parse(
      config.properties.getProperty("LEAGUE_ACTIVE_SNAPSHOT"),
    );
    const old =
      pointer.row > 2
        ? table_(config, "LeagueSnapshots")
            .getRange(2, 1, pointer.row - 2, 1)
            .getValues()
        : [];
    probe.checks = {
      expiredAuthRemoved:
        auth.Challenges.length === 2 && auth.Sessions.length === 1,
      expiredCodeHashRemoved: auth.Challenges.every(
        (r) => r.id !== "expired" || !r.codeHash,
      ),
      currentAuthPreserved:
        auth.Challenges.some((r) => r.id === "live" && r.codeHash) &&
        auth.Sessions[0]?.id === "live",
      unregisteredAccountRemoved:
        auth.Accounts.length === 2 &&
        !auth.Accounts.some((r) => r.userId === "probe-unregistered"),
      registeredAndAdminPreserved: ["probe-keep", "probe-admin"].every((id) =>
        auth.Accounts.some((r) => r.userId === id),
      ),
      erasureCompleted:
        !JSON.stringify({ state, auth }).includes("probe-erase") &&
        !config.properties.getProperty("PENDING_ACCOUNT_ERASURE"),
      oldSnapshotCellsCleared: old.every((r) => r[0] === ""),
      oldAuditRemoved:
        state.audit.length === 1 && state.audit[0].id === "recent",
      seasonPersonalRecordsRemoved:
        state.matches[0].personalRecordsExpired &&
        state.matches[0].submissions.t1.players.length === 0 &&
        !state.matches[0].refereeId,
      teamScorePreserved:
        state.matches[0].score.a === 1 && state.matches[0].score.b === 0,
      collectionStillClosed:
        !state.settings.registrationOpen && !state.settings.seasonOpen,
    };
    probe.status = Object.values(probe.checks).every(Boolean)
      ? "passed"
      : "failed";
  } catch (_) {
    probe.status = "failed";
    probe.error = "PRIVACY_PROBE_FAILED";
  }
  probe.completedAt = Date.now();
  p.setProperty("PRIVACY_PROBE", JSON.stringify(probe));
  Logger.log(
    JSON.stringify({
      status: probe.status,
      completedAt: probe.completedAt,
      checks: probe.checks || {},
      error: probe.error,
    }),
  );
  if (probe.status !== "passed") throw new Error("PRIVACY_PROBE_FAILED");
}
// Install ONE time-based trigger. Probe runs once; normal cleanup continues afterward.
function runScheduledPrivacyMaintenance() {
  runPrivacyMaintenance();
  return locked_(() => runPrivacyProbe_());
}
function inspectPrivacyMaintenance() {
  const p = PropertiesService.getScriptProperties(),
    probe = JSON.parse(p.getProperty("PRIVACY_PROBE") || "null");
  const status = {
    production: JSON.parse(
      p.getProperty("PRIVACY_MAINTENANCE_STATUS") || "null",
    ),
    probe: probe
      ? {
          status: probe.status,
          preparedAt: probe.preparedAt,
          completedAt: probe.completedAt,
          checks: probe.checks,
        }
      : null,
  };
  Logger.log(JSON.stringify(status));
  return status;
}
