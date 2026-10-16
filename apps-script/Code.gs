/* IGFL auth pilot. No passwords, raw OTPs, or raw session tokens are stored. */
const IGFL_ = Object.freeze({ protocol: 'igfl-auth-v1', version: '0.1.0', codeTtl: 300000, sessionTtl: 43200000, cooldown: 60000, maxAttempts: 5, emailHourly: 5, dailyBudget: 50 });

function doGet() { return json_({ ok: true, data: { service: 'IGFL Auth', version: IGFL_.version, method: 'POST' } }); }
function doPost(event) {
  try {
    if (!event || !event.postData || event.postData.length > 4096 || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(event.postData.type)) fail_('BAD_REQUEST');
    const input = event.parameter || {};
    if (Object.keys(input).some(key => event.parameters && event.parameters[key].length !== 1)) fail_('BAD_REQUEST');
    let data;
    switch (input.action) {
      case 'health': config_(); data = { service: 'IGFL Auth', version: IGFL_.version, pilot: true }; break;
      case 'requestCode': data = requestCode_(input); break;
      case 'verifyCode': data = verifyCode_(input); break;
      case 'session': data = session_(input); break;
      case 'logout': data = logout_(input); break;
      default: fail_('BAD_REQUEST');
    }
    return json_({ ok: true, data: data });
  } catch (error) {
    // Never return the exception message/stack: provider failures may contain private data.
    return json_({ ok: false, error: { code: error.igflCode || 'SERVER_ERROR', retryAfterSeconds: error.retryAfterSeconds || undefined } });
  }
}
function json_(body) { return ContentService.createTextOutput(JSON.stringify(Object.assign({ protocol: IGFL_.protocol }, body))).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, retry) { const error = new Error('IGFL request failed'); error.igflCode = code; error.retryAfterSeconds = retry; throw error; }
function config_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  if (!/^[a-f0-9]{64}$/i.test(properties.AUTH_SECRET || '') || !properties.AUTH_SHEET_ID || !properties.PILOT_EMAILS) fail_('NOT_CONFIGURED');
  return { secret: properties.AUTH_SECRET, sheetId: properties.AUTH_SHEET_ID, pilot: properties.PILOT_EMAILS.split(',').map(e => e.trim().toLowerCase()).filter(Boolean) };
}
function normalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@kaist\.ac\.kr$/.test(email)) fail_('INVALID_EMAIL');
  return email;
}
function purpose_(value) { if (value !== 'login' && value !== 'register') fail_('BAD_REQUEST'); return value; }
function locked_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) fail_('BUSY');
  try { return callback(); } finally { lock.releaseLock(); }
}
function table_(config, name) {
  const sheet = SpreadsheetApp.openById(config.sheetId).getSheetByName(name);
  if (!sheet) fail_('NOT_CONFIGURED');
  return sheet;
}
function read_(config, name) {
  const sheet = table_(config, name), count = sheet.getLastRow() - 1;
  if (count < 1) return [];
  return sheet.getRange(2, 1, count, 1).getValues().map((row, i) => ({ row: i + 2, value: JSON.parse(row[0]) }));
}
function append_(config, name, value) { table_(config, name).appendRow([JSON.stringify(value)]); SpreadsheetApp.flush(); }
function write_(config, name, row, value) { table_(config, name).getRange(row, 1).setValue(JSON.stringify(value)); SpreadsheetApp.flush(); }
function hmac_(config, text) {
  return Utilities.computeHmacSha256Signature(text, config.secret, Utilities.Charset.UTF_8).map(n => ('0' + ((n + 256) % 256).toString(16)).slice(-2)).join('');
}
function safeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
function unique_(config, label) {
  const properties = PropertiesService.getScriptProperties();
  const counter = Number(properties.getProperty('NONCE_COUNTER') || 0) + 1;
  properties.setProperty('NONCE_COUNTER', String(counter));
  return hmac_(config, [label, counter, Date.now(), Utilities.getUuid()].join('|'));
}
function code_(config, nonce) {
  // Rejection sampling avoids modulo bias. The PRF key is a 256-bit server secret.
  for (let counter = 0; counter < 100; counter++) {
    const number = parseInt(hmac_(config, 'otp-generate|' + nonce + '|' + counter).slice(0, 8), 16);
    if (number < 4294000000) return String(number % 1000000).padStart(6, '0');
  }
  fail_('SERVER_ERROR');
}
function codeHash_(config, challenge, code) { return hmac_(config, ['otp-verify', challenge.id, challenge.email, challenge.purpose, code].join('|')); }
function prune_(config, now) {
  // 24h pilot retention: delete only expired/terminal records older than a day.
  ['Challenges', 'Sessions'].forEach(name => {
    const rows = read_(config, name);
    for (let i = rows.length - 1; i >= 0; i--) {
      const record = rows[i].value;
      if (record.createdAt < now - 86400000 && record.expiresAt <= now) table_(config, name).deleteRow(rows[i].row);
    }
  });
}
function requestCode_(input) {
  const config = config_(), email = normalizeEmail_(input.email), purpose = purpose_(input.purpose);
  if (config.pilot.indexOf(email) < 0) fail_('PILOT_ONLY');
  const issued = locked_(() => {
    const now = Date.now();
    prune_(config, now);
    const rows = read_(config, 'Challenges');
    const recent = rows.filter(r => r.value.email === email && r.value.createdAt > now - 3600000);
    const last = recent.reduce((max, r) => Math.max(max, r.value.createdAt), 0);
    if (last && now - last < IGFL_.cooldown) fail_('RATE_LIMITED', Math.ceil((last + IGFL_.cooldown - now) / 1000));
    if (recent.length >= IGFL_.emailHourly) fail_('RATE_LIMITED', Math.ceil((Math.min.apply(null, recent.map(r => r.value.createdAt)) + 3600000 - now) / 1000));
    if (rows.filter(r => r.value.createdAt > now - 86400000).length >= IGFL_.dailyBudget || MailApp.getRemainingDailyQuota() < 1) fail_('QUOTA_EXCEEDED');
    rows.filter(r => r.value.email === email && !r.value.consumedAt && !r.value.invalidatedAt).forEach(r => { r.value.invalidatedAt = now; write_(config, 'Challenges', r.row, r.value); });
    const challenge = { id: unique_(config, 'challenge'), email: email, purpose: purpose, createdAt: now, expiresAt: now + IGFL_.codeTtl, attempts: 0, state: 'sending', consumedAt: 0, invalidatedAt: 0 };
    const code = code_(config, challenge.id);
    challenge.codeHash = codeHash_(config, challenge, code);
    append_(config, 'Challenges', challenge);
    return { challenge: challenge, code: code };
  });
  let sent = true;
  try {
    MailApp.sendEmail({ to: email, subject: '[IGFL] 이메일 인증번호', name: 'IGFL', body: 'IGFL 인증번호: ' + issued.code + '\n\n5분 안에 홈페이지에 입력해 주세요.\n요청하지 않았다면 이 메일을 무시해 주세요.\n이 번호를 다른 사람에게 알려주지 마세요.' });
  } catch (error) { sent = false; }
  locked_(() => {
    const row = read_(config, 'Challenges').find(r => r.value.id === issued.challenge.id);
    if (!row) fail_('SERVER_ERROR');
    row.value.state = sent ? 'sent' : 'failed';
    if (!sent) row.value.invalidatedAt = Date.now();
    write_(config, 'Challenges', row.row, row.value);
  });
  if (!sent) fail_('MAIL_FAILED');
  return { challengeId: issued.challenge.id, expiresAt: issued.challenge.expiresAt, resendAt: issued.challenge.createdAt + IGFL_.cooldown };
}
function verifyCode_(input) {
  const config = config_(), email = normalizeEmail_(input.email), purpose = purpose_(input.purpose);
  if (!/^[a-f0-9]{64}$/.test(String(input.challengeId || '')) || !/^\d{6}$/.test(String(input.code || ''))) fail_('INVALID_CODE');
  return locked_(() => {
    const now = Date.now(), row = read_(config, 'Challenges').find(r => r.value.id === input.challengeId);
    if (!row) fail_('INVALID_CODE');
    const challenge = row.value;
    if (challenge.email !== email || challenge.purpose !== purpose || challenge.state !== 'sent' || challenge.consumedAt || challenge.invalidatedAt || challenge.expiresAt <= now) fail_('INVALID_CODE');
    if (challenge.attempts >= IGFL_.maxAttempts) fail_('TOO_MANY_ATTEMPTS');
    challenge.attempts++;
    if (!safeEqual_(challenge.codeHash, codeHash_(config, challenge, input.code))) {
      write_(config, 'Challenges', row.row, challenge);
      fail_(challenge.attempts >= IGFL_.maxAttempts ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE');
    }
    // Consume before creating the session. A failed later write cannot replay the OTP.
    challenge.consumedAt = now;
    write_(config, 'Challenges', row.row, challenge);
    const token = unique_(config, 'session');
    const session = { tokenHash: hmac_(config, 'session-verify|' + token), userId: hmac_(config, 'user-id|' + email), email: email, createdAt: now, expiresAt: now + IGFL_.sessionTtl, revokedAt: 0, scope: 'auth-pilot' };
    append_(config, 'Sessions', session);
    return { sessionToken: token, expiresAt: session.expiresAt };
  });
}
function findSession_(config, input) {
  if (!/^[a-f0-9]{64}$/.test(String(input.sessionToken || ''))) fail_('SESSION_EXPIRED');
  const hash = hmac_(config, 'session-verify|' + input.sessionToken);
  const row = read_(config, 'Sessions').find(r => safeEqual_(r.value.tokenHash, hash));
  if (!row || row.value.revokedAt || row.value.expiresAt <= Date.now()) fail_('SESSION_EXPIRED');
  return row;
}
function session_(input) {
  const config = config_();
  return locked_(() => {
    const session = findSession_(config, input).value;
    return { userId: session.userId, email: session.email, expiresAt: session.expiresAt, scope: session.scope, registered: false };
  });
}
function logout_(input) {
  const config = config_();
  return locked_(() => {
    // Idempotent logout; an expired/revoked/missing token grants no access.
    let row;
    try { row = findSession_(config, input); } catch (error) { if (error.igflCode === 'SESSION_EXPIRED') return { loggedOut: true }; throw error; }
    row.value.revokedAt = Date.now(); write_(config, 'Sessions', row.row, row.value);
    return { loggedOut: true };
  });
}

// Owner runs once from the editor, never reachable through doPost.
function initializeAuth_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('PILOT_EMAILS')) throw new Error('Set PILOT_EMAILS in Script Properties first.');
  if (properties.getProperty('AUTH_SHEET_ID')) throw new Error('Already initialized; existing storage is preserved.');
  if (!properties.getProperty('AUTH_SECRET')) {
    // Google documents getUuid as java.util.UUID.randomUUID (cryptographically strong PRNG).
    // Three independent v4 UUIDs supply 366 random bits before SHA-256 extraction.
    const uuids = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()];
    if (new Set(uuids).size !== 3 || uuids.some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))) throw new Error('Unexpected UUID entropy source.');
    const secret = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, uuids.join('|'), Utilities.Charset.UTF_8).map(n => ('0' + ((n + 256) % 256).toString(16)).slice(-2)).join('');
    properties.setProperty('AUTH_SECRET', secret);
  }
  if (!/^[a-f0-9]{64}$/i.test(properties.getProperty('AUTH_SECRET'))) throw new Error('Invalid AUTH_SECRET; existing secret is preserved.');
  const sheet = SpreadsheetApp.create('IGFL Auth Pilot — Private');
  sheet.getSheets()[0].setName('Challenges').appendRow(['record_json']);
  sheet.insertSheet('Sessions').appendRow(['record_json']);
  properties.setProperty('AUTH_SHEET_ID', sheet.getId());
}
