import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = new URL("../vendor/creator-token-transfer-validator/", import.meta.url);
const expectedCommit = "59adb8b36ab0256c7430b017b1c9f8b4841d6e1e";
const git = (...args) => execFileSync("git", ["-C", fileURLToPath(vendor), ...args], { encoding: "utf8" }).trim();

if (git("rev-parse", "HEAD") !== expectedCommit || git("status", "--porcelain") !== "") {
  throw new Error("Real validator must be a clean checkout of the documented exact commit.");
}
if (/^[+U-]/m.test(git("submodule", "status", "--recursive"))) {
  throw new Error("Validator submodules are missing or differ from the pinned revisions.");
}
for (const [name, version] of Object.entries({
  "@limitbreak/creator-token-standards": "5.0.0",
  "@openzeppelin/contracts": "4.8.3",
})) {
  const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"));
  if (installed.version !== version) throw new Error(`Repeat parity review before changing ${name}.`);
}
const foundryVersion = execFileSync("forge", ["--version"], { encoding: "utf8" });
if (!foundryVersion.includes("1.3.6-v1.3.6")) throw new Error("Use the CI-pinned Foundry v1.3.6.");
const result = spawnSync("forge", ["test", "--match-contract", "^NFTCollectionRealValidatorTest$", "--match-path", "test-integration/foundry/*.t.sol", "-vvv"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
