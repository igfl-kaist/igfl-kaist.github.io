import { createAuthClient, validateEndpoint } from "./auth-client.mjs";
import { createLeagueUI } from "./league-ui.mjs";
const content = document.querySelector("#content");
const accountLink = document.querySelector("#account-link");
const config = await fetch("./config.json")
  .then((r) => r.json())
  .catch(() => ({}));
let api = validateEndpoint(config.authEndpoint)
  ? createAuthClient(config.authEndpoint)
  : null;
let session = null;
let ticker;
const tokenKey = "igfl.session.v1";
function readToken() {
  try {
    return sessionStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}
function saveToken(token) {
  try {
    token
      ? sessionStorage.setItem(tokenKey, token)
      : sessionStorage.removeItem(tokenKey);
  } catch {}
}
const leagueUI = createLeagueUI({
  content,
  isAuthenticated: () => !!session,
  transport: async (operation, { command, args } = {}) => {
    if (!api) throw new Error("리그 서버를 연결하지 못했어요.");
    const request = {
      operation,
      command: command || "",
      payload: JSON.stringify(args || {}),
      sessionToken: readToken() || "",
    };
    try {
      return await api("league", request);
    } catch (error) {
      if (error.code === "SESSION_EXPIRED") {
        saveToken(null);
        session = null;
        return api("league", { ...request, sessionToken: "" });
      }
      throw error;
    }
  },
  onLogout: async ({ alreadyRevoked = false } = {}) => {
    try {
      if (api && !alreadyRevoked)
        await api("logout", { sessionToken: readToken() });
    } finally {
      saveToken(null);
      session = null;
    }
  },
});
function el(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
const messages = {
  NOT_CONFIGURED:
    "인증 서버 연결을 준비 중이에요. 아직 인증 메일을 발송하지 않았어요.",
  CONNECTION_FAILED:
    "인증 서버 응답을 읽지 못했어요. 네트워크 또는 서버의 브라우저 접근 설정을 확인해 주세요. 발송 요청이 도착했을 수 있으니 잠시 후 다시 시도해 주세요.",
  INVALID_RESPONSE: "인증 서버 응답 형식이 올바르지 않아요.",
  INVALID_EMAIL: "@kaist.ac.kr 학교 이메일을 입력해 주세요.",
  PILOT_ONLY: "현재는 지정된 테스트 이메일만 인증할 수 있어요.",
  RATE_LIMITED: "요청이 많아요. 안내된 시간 후 다시 시도해 주세요.",
  QUOTA_EXCEEDED:
    "오늘 인증 메일 발송 한도에 도달했어요. 잠시 후 다시 이용해 주세요.",
  INVALID_CODE:
    "인증번호가 맞지 않거나 만료되었어요. 다시 확인하거나 새 번호를 받아 주세요.",
  TOO_MANY_ATTEMPTS: "입력 횟수를 초과했어요. 새 인증번호를 받아 주세요.",
  SESSION_EXPIRED: "로그인 시간이 만료되었어요. 다시 로그인해 주세요.",
  SERVER_ERROR:
    "서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  MAIL_FAILED: "메일을 보내지 못했어요. 잠시 후 새 번호를 요청해 주세요.",
};
function showError(node, error) {
  node.className = "status error";
  node.textContent =
    (messages[error.code] || messages.SERVER_ERROR) +
    (error.retryAfterSeconds
      ? ` (${error.retryAfterSeconds}초 후 재시도)`
      : "");
}
function home() {
  content.innerHTML = `<section class="hero"><div><div class="eyebrow">ISE & GSDS FUTSAL LEAGUE</div><h1>연구실 밖에서,<br>함께 뛰는 우리.</h1><p>서로 다른 연구실의 우리가 한 팀이 되는 곳.<br>자유롭게 경기를 만들고, 함께 리그의 이야기를 채워가요.</p><div class="actions"><a class="button" href="#register">선수로 함께하기 <span aria-hidden="true">↗</span></a><a class="button secondary" href="#teams">우리 리그의 팀들</a></div></div><div class="poster"><small>CONNECTED THROUGH FUTSAL</small><strong>OUR LAB.<br>OUR TEAM.</strong><small>IGFL · ISE & GSDS</small></div></section><div class="section-heading"><h2>우리의 리그는 이렇게</h2><span class="eyebrow">PLAY TOGETHER</span></div><section class="cards" aria-label="리그 안내"><article class="card"><span class="number">01 / JOIN</span><h3>함께할 팀을 찾아요</h3><p>ISE·GSDS 대학원생과 교직원, 두 학과 교수님께 지도받는 대학원생이 함께해요. 무소속으로 시작해도 좋아요.</p></article><article class="card"><span class="number">02 / PLAY</span><h3>우리의 경기를 만들어요</h3><p>팀끼리 시간과 장소를 정하고 중립 심판과 함께 뛰어요. 5대5, 전후반 각 20분, 무제한 교체로 진행해요.</p></article><article class="card"><span class="number">03 / CONNECT</span><h3>한 경기씩 쌓이는 기록</h3><p>확정한 결과는 Elo 파워랭킹에 반영돼요. 득점과 심판 활동도 함께 기억해요.</p></article></section><aside class="intro-note">리그 참가 안내와 시즌 일정을 준비하고 있어요. 선수 등록은 개인정보 안내가 확정되면 열려요.</aside>`;
}
function auth(register = false) {
  content.innerHTML = `<section class="auth-layout"><div class="auth-intro"><div class="eyebrow">WELCOME TO IGFL</div><h1>${register ? "우리 리그의 시작,<br>선수로 함께해요." : "다시 만나 반가워요."}</h1><p>카이스트 이메일로 받은<br>6자리 번호로 간편하게 로그인해요.</p><ul class="check-list"><li>비밀번호를 만들 필요가 없어요.</li><li>인증번호는 5분 동안 유효해요.</li><li>선수 등록에는 별도 정보 입력과 동의가 필요해요.</li></ul></div><div class="auth-card"><span class="badge">KAIST 이메일 인증</span><h2 class="field">${register ? "선수 등록" : "로그인"}</h2><p class="muted">우리 리그는 학교 이메일로 연결돼요.</p><form id="email-form"><div class="field"><label for="email">카이스트 이메일</label><input id="email" type="email" name="email" autocomplete="email" placeholder="name@kaist.ac.kr" required maxlength="254"><small class="help">@kaist.ac.kr 이메일을 사용해 주세요.</small></div><button class="button full" type="submit">인증번호 받기</button></form><form id="code-form" hidden><div class="field"><label for="code">이메일로 받은 인증번호</label><input class="code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required><div class="code-row"><span class="timer" id="timer"></span><button class="text-button" id="resend" type="button" disabled>인증번호 다시 받기</button></div></div><button class="button full" type="submit">인증하고 계속하기</button><button class="text-button" id="change-email" type="button">다른 이메일 사용</button></form><div id="auth-status" class="status" role="status" aria-live="polite"></div><div class="divider">로그인·이메일 확인을 위해 학교 이메일과 인증 요청 정보를 처리해요. 인증번호는 5분 동안 유효해요. 현재 인증 요청 기록은 24시간이 지난 뒤 시간별로 정리하며, Google 변경 이력의 삭제는 아직 검토 중이에요. 실제 선수 가입은 준비 중이에요.</div><details class="diagnostic"><summary>연결 점검</summary><p id="connection-state">인증 서버의 실제 응답을 확인해요.</p><button type="button" class="text-button" id="check-connection">서버 연결 확인</button></details></div></section>`;
  const emailForm = content.querySelector("#email-form"),
    codeForm = content.querySelector("#code-form"),
    status = content.querySelector("#auth-status"),
    email = content.querySelector("#email"),
    code = content.querySelector("#code"),
    resend = content.querySelector("#resend");
  let challenge,
    expiresAt = 0,
    resendAt = 0,
    sending = false,
    verifying = false;
  const purpose = register ? "register" : "login";
  function timer() {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    content.querySelector("#timer").textContent =
      `남은 시간 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    resend.disabled = sending || verifying || Date.now() < resendAt;
    codeForm.querySelector("[type=submit]").disabled =
      sending || verifying || remaining === 0;
  }
  async function request() {
    if (sending || verifying || !emailForm.reportValidity()) return;
    const normalized = email.value.trim().toLowerCase();
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@kaist\.ac\.kr$/.test(normalized)) {
      showError(status, { code: "INVALID_EMAIL" });
      return;
    }
    sending = true;
    const button = emailForm.querySelector("button");
    button.disabled = true;
    resend.disabled = true;
    status.className = "status";
    status.textContent = "인증번호를 보내고 있어요…";
    try {
      if (!api) throw { code: "NOT_CONFIGURED" };
      const data = await api("requestCode", { email: normalized, purpose });
      if (!document.contains(emailForm)) return;
      challenge = data.challengeId;
      expiresAt = data.expiresAt;
      resendAt = data.resendAt;
      email.value = normalized;
      email.readOnly = true;
      button.hidden = true;
      codeForm.hidden = false;
      code.value = "";
      status.textContent = "인증번호를 보냈어요. 메일함을 확인해 주세요.";
      timer();
      clearInterval(ticker);
      ticker = setInterval(timer, 1000);
      code.focus();
    } catch (error) {
      showError(status, error);
    } finally {
      sending = false;
      button.disabled = false;
      if (document.contains(emailForm)) {
        if (challenge) timer();
        else resend.disabled = false;
      }
    }
  }
  emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void request();
  });
  resend.addEventListener("click", () => void request());
  content.querySelector("#change-email").addEventListener("click", () => {
    clearInterval(ticker);
    challenge = null;
    codeForm.hidden = true;
    email.readOnly = false;
    emailForm.querySelector("button").hidden = false;
    status.textContent = "";
    email.focus();
  });
  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || verifying || !codeForm.reportValidity()) return;
    verifying = true;
    const button = codeForm.querySelector("[type=submit]");
    button.disabled = true;
    status.className = "status";
    status.textContent = "인증번호를 확인하고 있어요…";
    try {
      const data = await api("verifyCode", {
        email: email.value,
        purpose,
        challengeId: challenge,
        code: code.value,
      });
      saveToken(data.sessionToken);
      session = await api("session", { sessionToken: data.sessionToken });
      location.hash = "#activity";
    } catch (error) {
      showError(status, error);
    } finally {
      verifying = false;
      if (document.contains(button)) timer();
    }
  });
  content
    .querySelector("#check-connection")
    .addEventListener("click", async (event) => {
      const result = content.querySelector("#connection-state");
      event.target.disabled = true;
      try {
        if (!api) throw { code: "NOT_CONFIGURED" };
        const data = await api("health");
        result.textContent = `서버 응답 확인 완료 · ${data.service} · ${data.version}`;
      } catch (error) {
        result.textContent = messages[error.code] || messages.SERVER_ERROR;
      } finally {
        event.target.disabled = false;
      }
    });
}
function render() {
  clearInterval(ticker);
  leagueUI.stop();
  const route = location.hash.slice(1) || "home";
  document.querySelectorAll("nav a").forEach((a) => {
    a.setAttribute("aria-current", a.hash === `#${route}` ? "page" : "false");
  });
  accountLink.textContent = session ? "내 선수 활동" : "로그인 / 선수 등록";
  accountLink.href = session ? "#activity" : "#login";
  if (route === "home") home();
  else if (route === "login") session ? void leagueUI.show("activity") : auth();
  else if (route === "register" && !session) auth(true);
  else void leagueUI.show(route);
  window.scrollTo(0, 0);
}
if (api && readToken()) {
  content.innerHTML =
    '<p class="muted" role="status">로그인 정보를 확인하고 있어요…</p>';
  try {
    session = await api("session", { sessionToken: readToken() });
  } catch (error) {
    if (error.code === "SESSION_EXPIRED") saveToken(null);
  }
}
window.addEventListener("hashchange", render);
render();
