import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAuthClient, validateEndpoint } from '../src/auth-client.mjs';

function server() {
  let now = 1800000000000, remaining = 100, sendFails = false, duplicateUuid = false, createdSheets = 0;
  const properties = { AUTH_SECRET: 'a'.repeat(64), AUTH_SHEET_ID: 'test-sheet', PILOT_EMAILS: 'player@kaist.ac.kr' };
  const tables = { Challenges: [['record_json']], Sessions: [['record_json']] }, mail = [];
  function sheet(name) {
    return { getLastRow: () => tables[name].length,
      appendRow: row => tables[name].push(row), deleteRow: row => tables[name].splice(row - 1, 1),
      getRange: (row, col, count = 1) => ({ getValues: () => tables[name].slice(row - 1, row - 1 + count), setValue: value => { tables[name][row - 1] = [value]; } }) };
  }
  let held = false;
  const context = vm.createContext({
    Date: { now: () => now },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }), getProperty: key => properties[key], setProperty: (key, value) => { properties[key] = value; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: sheet }), flush: () => {}, create: () => {
      createdSheets++; tables.Challenges=[];tables.Sessions=[];
      return {getSheets:()=>[{setName:()=>sheet('Challenges')}],insertSheet:sheet,getId:()=> 'test-sheet'};
    } },
    LockService: { getScriptLock: () => ({ tryLock: () => { assert.equal(held, false); held = true; return true; }, releaseLock: () => { held = false; } }) },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm:{SHA_256:'sha256'}, computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()], getUuid: () => duplicateUuid?'12345678-1234-4234-8234-123456789012':randomUUID(), computeHmacSha256Signature: (text, key) => [...createHmac('sha256', key).update(text).digest()] },
    MailApp: { getRemainingDailyQuota: () => remaining, sendEmail: value => { assert.equal(held, false, 'network mail must run outside lock'); if (sendFails) throw new Error('private provider message'); mail.push(value); remaining--; } }
  });
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context);
  function call(action, data = {}) {
    const params = { action, ...data };
    return context.doPost({ postData: { type: 'application/x-www-form-urlencoded;charset=UTF-8', length: 100 }, parameter: params, parameters: Object.fromEntries(Object.entries(params).map(([key,value]) => [key,[value]])) });
  }
  const request = (purpose = 'login') => call('requestCode', { email: 'player@kaist.ac.kr', purpose });
  function verification(challenge, overrides = {}) { return call('verifyCode', { email: 'player@kaist.ac.kr', purpose: 'login', challengeId: challenge.data.challengeId, code: mail.at(-1).body.match(/\d{6}/)[0], ...overrides }); }
  return { call, request, verification, mail, tables, properties, advance: ms => { now += ms; }, failMail: () => { sendFails = true; }, noQuota: () => { remaining = 0; }, initialize:()=>context.initializeAuth_(), duplicateUuid:()=>{duplicateUuid=true;}, createdSheets:()=>createdSheets };
}

test('owner setup creates a server secret once and refuses reinitialization',()=>{
 const s=server();delete s.properties.AUTH_SECRET;delete s.properties.AUTH_SHEET_ID;
 s.initialize();assert.match(s.properties.AUTH_SECRET,/^[a-f0-9]{64}$/);assert.equal(s.createdSheets(),1);
 const secret=s.properties.AUTH_SECRET;assert.throws(()=>s.initialize(),/Already initialized/);assert.equal(s.properties.AUTH_SECRET,secret);assert.equal(s.createdSheets(),1);
});
test('owner setup rejects a broken entropy source and preserves existing secrets',()=>{
 const s=server();delete s.properties.AUTH_SECRET;delete s.properties.AUTH_SHEET_ID;s.duplicateUuid();
 assert.throws(()=>s.initialize(),/entropy source/);assert.equal(s.properties.AUTH_SECRET,undefined);assert.equal(s.createdSheets(),0);
 const other=server();delete other.properties.AUTH_SHEET_ID;const old=other.properties.AUTH_SECRET;other.initialize();assert.equal(other.properties.AUTH_SECRET,old);
});

test('email/domain/pilot restrictions run on the server', () => {
  const s = server();
  for(const email of ['p@kaist.ac.kr.evil.test','p@lab.kaist.ac.kr','p@gmail.com']) assert.equal(s.call('requestCode',{email,purpose:'login'}).error.code,'INVALID_EMAIL');
  assert.equal(s.call('requestCode',{email:'other@kaist.ac.kr',purpose:'login'}).error.code,'PILOT_ONLY');
  assert.equal(s.mail.length,0);
});
test('real server session, consumed OTP, logout revocation and no raw secrets in storage', () => {
  const s=server(), challenge=s.request(); assert.equal(challenge.ok,true);
  const verified=s.verification(challenge); assert.equal(verified.ok,true);
  const token=verified.data.sessionToken;
  assert.equal(s.call('session',{sessionToken:token}).data.email,'player@kaist.ac.kr');
  assert.equal(s.verification(challenge).error.code,'INVALID_CODE');
  const persisted=JSON.stringify(s.tables);
  assert.equal(persisted.includes(token),false);
  assert.equal(Object.hasOwn(JSON.parse(s.tables.Challenges[1][0]),'code'),false);
  assert.equal(s.call('session',{sessionToken:'b'.repeat(64)}).error.code,'SESSION_EXPIRED');
  assert.equal(s.call('logout',{sessionToken:token}).ok,true);
  assert.equal(s.call('session',{sessionToken:token}).error.code,'SESSION_EXPIRED');
  assert.equal(s.call('logout',{sessionToken:token}).ok,true);
});
test('OTP expires after five minutes and is bound to email/purpose', () => {
  const s=server(), challenge=s.request();
  assert.equal(s.verification(challenge,{purpose:'register'}).error.code,'INVALID_CODE');
  assert.equal(s.verification(challenge,{email:'someone@kaist.ac.kr'}).error.code,'INVALID_CODE');
  s.advance(300000); assert.equal(s.verification(challenge).error.code,'INVALID_CODE');
});
test('five failed guesses lock the challenge', () => {
  const s=server(), challenge=s.request(), real=s.mail[0].body.match(/\d{6}/)[0];
  const wrong=real==='000000'?'000001':'000000';
  for(let i=0;i<4;i++) assert.equal(s.verification(challenge,{code:wrong}).error.code,'INVALID_CODE');
  assert.equal(s.verification(challenge,{code:wrong}).error.code,'TOO_MANY_ATTEMPTS');
  assert.equal(s.verification(challenge).error.code,'TOO_MANY_ATTEMPTS');
});
test('cooldown and reissue invalidate the previous code', () => {
  const s=server(), old=s.request(), oldCode=s.mail[0].body.match(/\d{6}/)[0];
  assert.equal(s.request().error.code,'RATE_LIMITED'); s.advance(60000);
  const next=s.request(); assert.equal(next.ok,true);
  assert.equal(s.verification(old,{code:oldCode}).error.code,'INVALID_CODE');
  assert.equal(s.verification(next).ok,true);
});
test('mail failure cannot produce a usable challenge; quota prevents sends', () => {
  const s=server(); s.failMail(); assert.equal(s.request().error.code,'MAIL_FAILED');
  assert.equal(JSON.parse(s.tables.Challenges[1][0]).state,'failed');
  const other=server();other.noQuota();assert.equal(other.request().error.code,'QUOTA_EXCEEDED');assert.equal(other.mail.length,0);
});
test('session expires after twelve hours; pilot configuration fails closed', () => {
  const s=server(), challenge=s.request(), verified=s.verification(challenge);
  s.advance(43200000);assert.equal(s.call('session',{sessionToken:verified.data.sessionToken}).error.code,'SESSION_EXPIRED');
  delete s.properties.AUTH_SECRET;assert.equal(s.call('health').error.code,'NOT_CONFIGURED');
});
test('hourly limit and global rolling daily budget', () => {
  const s=server();
  for(let i=0;i<5;i++){assert.equal(s.request().ok,true);s.advance(60000);}
  assert.equal(s.request().error.code,'RATE_LIMITED');
  const other=server();
  for(let i=0;i<50;i++){assert.equal(other.request().ok,true);other.advance(1200000);}
  assert.equal(other.request().error.code,'QUOTA_EXCEEDED');
});
test('client uses a readable simple POST, keeps OTP/token out of URL', async () => {
  const endpoint='https://script.google.com/macros/s/example/exec';
  assert.equal(validateEndpoint(endpoint),true);
  for(const invalid of ['http://script.google.com/macros/s/a/exec','https://evil.test/exec',endpoint+'?token=x'])assert.equal(validateEndpoint(invalid),false);
  const client=createAuthClient(endpoint,async (url,options)=>{
    assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.mode,'cors');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);
    assert.equal(options.body.get('code'),'123456');
    return { ok:true,type:'cors',json:async()=>({protocol:'igfl-auth-v1',ok:true,data:{accepted:true}}) };
  });
  assert.deepEqual(await client('verifyCode',{code:'123456'}),{accepted:true});
});
test('client rejects opaque/non-JSON/protocol failures', async () => {
  const endpoint='https://script.google.com/macros/s/example/exec';
  await assert.rejects(createAuthClient(endpoint,async()=>({ok:true,type:'opaque'}))('health'),e=>e.code==='CONNECTION_FAILED');
  await assert.rejects(createAuthClient(endpoint,async()=>({ok:true,json:async()=>({ok:true})}))('health'),e=>e.code==='INVALID_RESPONSE');
  await assert.rejects(createAuthClient(endpoint,async()=>{throw new Error('fetch failed');})('health'),e=>e.code==='CONNECTION_FAILED');
});
