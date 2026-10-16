import { createLeagueUI } from "../src/league-ui.mjs";
const content = document.querySelector("#content");
let token = sessionStorage.getItem("igfl.dev-session");
async function call(body) {
  const r = await fetch("/dev-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, token }),
  });
  const data = await r.json();
  if (!data.ok) {
    const error = new Error(data.error.message);
    error.code = data.error.code;
    throw error;
  }
  return data.data;
}
const accounts = await call({ operation: "accounts" });
const toolbar = document.createElement("aside");
toolbar.className = "dev-toolbar";
toolbar.innerHTML =
  '<strong>합성 데이터 개발 검증</strong><span>실제 개인정보 입력·메일 발송 없음</span><label>검증 계정<select id="dev-account"><option value="">공개 방문자</option></select></label>';
document.querySelector(".header").before(toolbar);
const selector = toolbar.querySelector("select");
accounts.forEach((a) => selector.add(new Option(a.name, a.id)));
selector.value = sessionStorage.getItem("igfl.dev-account") || "";
const ui = createLeagueUI({
  content,
  transport: (operation, data) => call({ operation, ...data }),
  development: true,
  onLogout: async () => {
    token = null;
    sessionStorage.removeItem("igfl.dev-session");
    sessionStorage.removeItem("igfl.dev-account");
    selector.value = "";
  },
});
selector.onchange = async () => {
  if (selector.value) {
    const result = await call({ operation: "select", id: selector.value });
    token = result.token;
    sessionStorage.setItem("igfl.dev-session", token);
    sessionStorage.setItem("igfl.dev-account", selector.value);
  } else {
    token = null;
    sessionStorage.removeItem("igfl.dev-session");
    sessionStorage.removeItem("igfl.dev-account");
  }
  await render();
};
async function render() {
  let route = location.hash.slice(1) || "ranking";
  if (route === "home") route = "ranking";
  if (route === "login") route = "activity";
  await ui.show(route, true);
}
window.addEventListener("hashchange", () => void render());
await render();
