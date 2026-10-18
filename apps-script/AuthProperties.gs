function storageProperties_(config) {
  return config?.properties || PropertiesService.getScriptProperties();
}
// Server-only, bounded records. Never fall back to legacy Sheets after migration.
function authPrefix_(name) {
  if (!["Challenges", "Sessions", "Accounts"].includes(name))
    fail_("STORAGE_ERROR");
  return "IGFL_AUTH:" + name + ":";
}
function propertyBytes_(value) {
  return encodeURIComponent(String(value)).replace(/%[A-F\d]{2}/gi, "x").length;
}
function checkedProperty_(p, key, value) {
  const bytes = propertyBytes_(value);
  if (bytes > 8000) fail_("AUTH_STORAGE_LIMIT");
  const values = p.getProperties();
  values[key] = value;
  const total = Object.keys(values).reduce(
    (n, k) => n + propertyBytes_(k) + propertyBytes_(values[k]),
    0,
  );
  // Leave headroom for configuration, retry journals and the provider's 500 KB limit.
  if (total > 420000) fail_("AUTH_STORAGE_LIMIT");
  p.setProperty(key, value);
}
function read_(config, name) {
  const p = storageProperties_(config),
    prefix = authPrefix_(name);
  if (p.getProperty("AUTH_STORAGE_VERSION") !== "properties-v1")
    fail_("AUTH_MIGRATION_REQUIRED");
  const values = p.getProperties();
  return Object.keys(values)
    .filter((k) => k.startsWith(prefix))
    .sort()
    .map((key) => ({ row: key, value: JSON.parse(values[key]) }));
}
function append_(config, name, value) {
  const p = storageProperties_(config);
  read_(config, name); // readiness/type check
  const counter = Number(p.getProperty("AUTH_RECORD_COUNTER") || 0) + 1;
  p.setProperty("AUTH_RECORD_COUNTER", String(counter));
  checkedProperty_(p, authPrefix_(name) + counter, JSON.stringify(value));
}
function write_(config, name, key, value) {
  const p = storageProperties_(config);
  if (!key.startsWith(authPrefix_(name)) || !p.getProperty(key))
    fail_("STORAGE_ERROR");
  checkedProperty_(p, key, JSON.stringify(value));
}
function deleteRecord_(config, name, key) {
  if (!key.startsWith(authPrefix_(name))) fail_("STORAGE_ERROR");
  storageProperties_(config).deleteProperty(key);
}
// Owner-only. Run AFTER deploying this version so old web-app code cannot write legacy rows.
function migrateAuthenticationStorage() {
  return locked_(() => {
    const result = migrateAuthenticationStorage_(config_());
    Logger.log(JSON.stringify(result));
    return result;
  });
}
function migrateAuthenticationStorage_(config) {
  const p = storageProperties_(config);
  if (p.getProperty("LEAGUE_REGISTRATION_OPEN") === "true")
    fail_("CLOSE_REGISTRATION_FIRST");
  if (p.getProperty("AUTH_STORAGE_VERSION") === "properties-v1")
    return { status: "already-migrated" };
  // A retry replaces only uncommitted properties. The old files remain untouched.
  const source = SpreadsheetApp.openById(config.sheetId),
    expected = {},
    now = Date.now();
  for (const name of ["Challenges", "Sessions", "Accounts"]) {
    const sheet = source.getSheetByName(name),
      count = sheet ? sheet.getLastRow() - 1 : 0;
    expected[name] =
      count > 0
        ? sheet
            .getRange(2, 1, count, 1)
            .getValues()
            .filter((r) => r[0])
            .map((r) => JSON.parse(r[0]))
        : [];
    expected[name] = expected[name].filter(
      (r) =>
        name === "Accounts" ||
        (name === "Sessions"
          ? !r.revokedAt && r.expiresAt > now
          : r.createdAt > now - 86400000),
    );
    if (name === "Challenges")
      expected[name].forEach((r) => {
        if (r.consumedAt || r.invalidatedAt || r.expiresAt <= now)
          delete r.codeHash;
      });
    const prefix = authPrefix_(name);
    Object.keys(p.getProperties())
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => p.deleteProperty(k));
    expected[name].forEach((r, i) =>
      checkedProperty_(p, prefix + "m" + i, JSON.stringify(r)),
    );
    const actual = p.getProperties();
    expected[name].forEach((r, i) => {
      if (actual[prefix + "m" + i] !== JSON.stringify(r))
        fail_("MIGRATION_VERIFY_FAILED");
    });
  }
  // Single readiness commit. An interrupted copy never becomes an auth store.
  checkedProperty_(p, "AUTH_STORAGE_VERSION", "properties-v1");
  const result = {
    status: "migrated",
    at: now,
    counts: Object.fromEntries(
      Object.entries(expected).map(([k, v]) => [k, v.length]),
    ),
  };
  p.setProperty("AUTH_MIGRATION_STATUS", JSON.stringify(result));
  return result;
}
