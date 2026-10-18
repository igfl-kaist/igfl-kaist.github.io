import test from "node:test";
import assert from "node:assert/strict";
import { PRIVACY } from "../src/privacy-content.mjs";
import { privacyPage } from "../src/privacy-page.mjs";
import { harness } from "./helpers/gas.mjs";

test("owner notice publication configures the public contact and shared consent versions without opening collection or mail", () => {
  const h = harness(),
    pointer = h.properties.LEAGUE_ACTIVE_SNAPSHOT;
  const status = h.c.configurePrivacyNotices();
  assert.equal(status.operationsContact, "sy.choi@kaist.ac.kr");
  assert.equal(status.registrationOpen, false);
  assert.equal(status.privacyStorageApproved, false);
  assert.equal(status.seasonOpen, false);
  assert.equal(status.leagueEmailsEnabled, false);
  assert.equal(h.properties.PRIVACY_NOTICE, PRIVACY.collectionNotice);
  assert.equal(h.properties.PRIVACY_VERSION, PRIVACY.collectionVersion);
  const view = h.c.loadLeague_(h.c.config_());
  assert.equal(view.settings.publicConsentVersion, PRIVACY.publicVersion);
  assert.equal(view.settings.operationsContact, PRIVACY.contact);
  assert.equal(h.properties.LEAGUE_ACTIVE_SNAPSHOT, pointer);
  h.properties.LEAGUE_EMAILS_ENABLED = "true";
  assert.throws(
    () => h.c.configurePrivacyNotices(),
    (e) => e.igflCode === "CLOSE_LEAGUE_BEFORE_NOTICE_SETUP",
  );
});

test("public notices contain the exact shared consents, operator contact and closed-registration notice without collecting information", () => {
  for (const consent of [false, true]) {
    const html = privacyPage(consent);
    assert.match(html, /실제 선수 가입은 닫혀/);
    assert.ok(html.includes("mailto:" + PRIVACY.contact));
    assert.ok(html.includes(PRIVACY.publicNotice));
    assert.ok(html.includes(PRIVACY.collectionVersion));
    assert.doesNotMatch(html, /<form|<input|<script|type="checkbox"/i);
  }
  assert.ok(privacyPage(true).includes(PRIVACY.collectionNotice));
  assert.match(privacyPage(), /24시간.*시간별|24시간 기준/);
  assert.match(privacyPage(), /이전 파일·사본·휴지통/);
  assert.match(privacyPage(), /확인되지 않은 국가나 삭제 기간/);
});
