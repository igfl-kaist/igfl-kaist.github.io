import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, extname, sep, dirname } from "node:path";
import { League } from "../server/league.mjs";
import { validateTeamImage } from "../server/images.mjs";
import { fixture } from "../dev/fixtures.mjs";
const root = resolve("dist"),
  file = resolve(process.env.IGFL_DEV_DATA_PATH || ".local/league-dev.json"),
  port = Number(process.env.IGFL_DEV_PORT || 4173);
await mkdir(dirname(file), { recursive: true });
let state;
try {
  state = JSON.parse(await readFile(file, "utf8"));
} catch {
  state = fixture();
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
}
const sessions = new Map();
let queue = Promise.resolve();
async function persist(next) {
  await writeFile(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
  await rename(file + ".tmp", file);
  state = next;
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://127.0.0.1:4173");
    if (url.pathname === "/dev-api") {
      if (
        req.method !== "POST" ||
        req.headers.origin !== `http://127.0.0.1:${server.address().port}`
      )
        throw new Error("Local origin required");
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 300000) throw new Error("Too large");
      }
      const data = JSON.parse(body),
        result = await (queue = queue
          .catch(() => {})
          .then(async () => {
            if (data.operation === "accounts")
              return [
                { id: "new", name: "새 선수 등록 검증" },
                { id: "admin", name: "운영진 검증" },
                ...state.players.map((p) => ({ id: p.id, name: p.name })),
              ];
            if (data.operation === "select") {
              const id = data.id;
              if (
                !["new", "admin", ...state.players.map((p) => p.id)].includes(
                  id,
                )
              )
                throw new Error("Invalid synthetic account");
              const token = randomUUID();
              sessions.set(token, {
                userId: id,
                email:
                  id === "new"
                    ? "new-player@kaist.ac.kr"
                    : `${id}@example.invalid`,
                admin: id === "admin",
              });
              return { token };
            }
            const actor = sessions.get(data.token) || null;
            if (data.operation === "view") {
              const next = structuredClone(state);
              if (League.maintain(next, Date.now())) {
                next.revision++;
                await persist(next);
              }
              return League.privateView(state, actor);
            }
            if (data.operation === "command") {
              const out = League.execute(
                state,
                actor,
                data.command,
                data.args,
                {
                  now: Date.now(),
                  id: randomUUID,
                  validateImage: (v) =>
                    validateTeamImage(v, (b) => [...Buffer.from(b, "base64")]),
                },
              );
              await persist(out.state);
              if (out.result.withdrawn)
                for (const [key, value] of sessions)
                  if (value.userId === actor.userId) sessions.delete(key);
              return out.result;
            }
            throw new Error("Unknown operation");
          }));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, data: result }));
      return;
    }
    if (
      url.pathname === "/preview/" ||
      url.pathname === "/preview/index.html"
    ) {
      const html = (await readFile("index.html", "utf8"))
        .replace("<head>", '<head><base href="/preview/">')
        .replaceAll('href="./src/', 'href="/src/')
        .replace('src="./src/main.mjs"', 'src="/dev/main.mjs"');
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    const filePath = resolve(
      url.pathname.startsWith("/dev/") ? "." : root,
      "." + decodeURIComponent(url.pathname),
    );
    const allowedRoot = url.pathname.startsWith("/dev/")
      ? resolve("dev")
      : root;
    if (!filePath.startsWith(allowedRoot + sep) && filePath !== root)
      throw new Error("Not found");
    const target = filePath === root ? resolve(root, "index.html") : filePath;
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html; charset=utf-8",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(target)] || "application/octet-stream",
    );
    res.end(await readFile(target));
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = e.code ? 409 : 400;
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: e.code || "SERVER_ERROR", message: e.message },
      }),
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `IGFL 합성 데이터 검증: http://127.0.0.1:${server.address().port}/preview/ (실제 메일 발송 없음)`,
  ),
);
