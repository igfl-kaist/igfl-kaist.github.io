import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Script } from "node:vm";
await mkdir(".local", { recursive: true });
const files = [
  "apps-script/Code.gs",
  "apps-script/AuthProperties.gs",
  "apps-script/StorageRotation.gs",
  "src/privacy-content.mjs",
  "src/competition.mjs",
  "src/directory-examples.mjs",
  "server/policies.mjs",
  "server/league.mjs",
  "server/images.mjs",
  "apps-script/LeagueAdapter.gs",
  "apps-script/OwnerSetup.gs",
  "apps-script/RecruitmentSetup.gs",
  "apps-script/DirectoryExamplesSetup.gs",
  "apps-script/PrivacyVerification.gs",
];
const source = (await Promise.all(files.map((f) => readFile(f, "utf8"))))
  .map((s) => s.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""))
  .join("\n");
new Script(source, { filename: "AppsScript.gs" });
await writeFile(".local/AppsScript.gs", source);
console.log("Apps Script bundle: .local/AppsScript.gs");
