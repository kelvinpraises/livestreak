// E-01 clean-consumer verifier (repository-side pack/install runner).
// Pack the workspace CLI → fresh tmp consumer → install tarball → copy the
// example's package manifest + src/ layout → run its advertised `npm run read`
// command against a THROWAWAY grant → prove the installed package and the
// resolved module both live under the clean consumer (URL + realpath,
// symlink-escape rejected) and a structurally valid board was received.
// Fixture runs can never print FLOW01-READ-OK.
// Env: HOST_URL, SESSION_ID, LIVESTREAK_PAIR_PASSWORD, READ_WAIT_MS (opt).
// Exit 0 only on a positively verified real Host/gateway run.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const example = resolve(here, "..");
const repo = resolve(example, "..", "..");

const hostUrl = process.env.HOST_URL;
const sessionId = process.env.SESSION_ID;
const pairingPassword = process.env.LIVESTREAK_PAIR_PASSWORD;
const waitMs = process.env.READ_WAIT_MS ?? "10000";

const work = mkdtempSync(join(tmpdir(), "ls-e01-"));
const consumer = join(work, "consumer");
const done = (code) => {
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
};

if (typeof hostUrl !== "string" || hostUrl.length === 0) {
  console.error("FAIL missing HOST_URL env");
  done(1);
}
if (typeof sessionId !== "string" || sessionId.length === 0) {
  console.error("FAIL missing SESSION_ID env");
  done(1);
}
if (typeof pairingPassword !== "string" || pairingPassword.length === 0) {
  console.error("FAIL missing LIVESTREAK_PAIR_PASSWORD env (never pass the secret as argv)");
  done(1);
}

const runBounded = (cmd, args, cwd, timeout) =>
  execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8", timeout });

try {
  // 1. Pack the workspace CLI into a fresh pack destination.
  const packDir = join(work, "pack");
  mkdirSync(packDir, { recursive: true });
  runBounded("npm", ["pack", "--workspace=@livestreak/cli", `--pack-destination=${packDir}`], repo, 120000);
  const tarballName = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
  if (tarballName === undefined) throw new Error("pack produced no tarball");
  const tarball = join(packDir, tarballName);

  // 2. Clean consumer: no workspace symlinks or parent node_modules.
  mkdirSync(consumer, { recursive: true });
  runBounded("npm", ["init", "-y"], consumer, 60000);
  runBounded("npm", ["install", "--no-save", tarball], consumer, 180000);

  // 3. Copy the example's manifest + src/ layout and run its ADVERTISED entry.
  copyFileSync(join(example, "package.json"), join(consumer, "package.json"));
  mkdirSync(join(consumer, "src"), { recursive: true });
  copyFileSync(join(example, "src", "read-boards.mjs"), join(consumer, "src", "read-boards.mjs"));
  if (existsSync(join(consumer, "node_modules")) === false) throw new Error("clean install missing node_modules");

  const child = spawnSync(
    "npm",
    ["run", "read", "--", hostUrl, sessionId, "--wait-ms", waitMs],
    {
      cwd: consumer,
      env: { ...process.env, LIVESTREAK_PAIR_PASSWORD: pairingPassword },
      encoding: "utf8",
      timeout: 60000
    }
  );
  if (child.error !== undefined) throw new Error(`reader spawn failed: ${child.error.message}`);
  if (child.signal !== null && child.signal !== undefined) throw new Error(`reader killed by signal ${child.signal}`);
  const out = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0) throw new Error(`reader exited ${child.status}: ${out.slice(-2000)}`);

  const lines = (child.stdout ?? "").split("\n");
  const readyLine = lines.find((l) => l.includes('"ready":true'));
  const resultLine = [...lines].reverse().find((l) => l.includes("functionCount"));
  if (readyLine === undefined || resultLine === undefined) throw new Error(`unexpected reader output: ${out.slice(-2000)}`);
  let ready;
  let result;
  try {
    ready = JSON.parse(readyLine);
    result = JSON.parse(resultLine);
  } catch {
    throw new Error(`malformed reader JSON: ${out.slice(-2000)}`);
  }

  // 4. Prove containment: the real installed PACKAGE and the resolved module
  // must both live under the clean consumer, and the module under the package
  // and outside the repo (symlink escape rejected either way).
  const realConsumer = realpathSync(consumer);
  const realPkg = realpathSync(join(consumer, "node_modules", "@livestreak/cli"));
  const expectedPkg = join(realConsumer, "node_modules", "@livestreak/cli");
  if (realPkg !== expectedPkg) {
    throw new Error(`package escape: ${realPkg} (expected ${expectedPkg})`);
  }
  const resolvedPath = fileURLToPath(ready.resolved);
  let realResolved;
  try {
    realResolved = realpathSync(resolvedPath);
  } catch {
    throw new Error(`resolved module missing on disk: ${resolvedPath}`);
  }
  const realRepo = realpathSync(repo);
  const underPkg = realResolved === realPkg || realResolved.startsWith(`${realPkg}/`);
  const outsideRepo = realResolved !== realRepo && realResolved.startsWith(`${realRepo}/`) === false;
  if (underPkg === false || outsideRepo === false) {
    throw new Error(`wrong module path: ${realResolved} (expected under ${realPkg}, outside repo)`);
  }

  // 5. Prove a structurally valid board was received; empty catalog is legitimate.
  if (typeof result.functionCount !== "number") throw new Error("missing functionCount");
  if (Array.isArray(result.boardKeys) === false || result.boardKeys.length === 0) {
    throw new Error("empty boardKeys — not proof of Flow 01");
  }
  const summary = result.boardSummary;
  if (typeof summary !== "object" || summary === null) throw new Error("missing boardSummary");
  const observe = summary.observe;
  if (!observe || !Number.isSafeInteger(observe.revision) || observe.revision < 0 ||
      typeof observe.catalogVersion !== "string" || !observe.catalogVersion.length ||
      typeof observe.runId !== "string" || !observe.runId.length ||
      !Array.isArray(observe.cellIds) || !observe.cellIds.includes("system:config") ||
      observe.cellCount !== observe.cellIds.length || !result.boardKeys.includes("observe") ||
      !Array.isArray(result.functionIds) || result.functionIds.length !== result.functionCount ||
      result.functionIds.some((id) => typeof id !== "string")) {
    throw new Error("malformed Observe board/catalog summary");
  }

  console.log(JSON.stringify({ boardSummary: summary, functionCount: result.functionCount, functionIds: result.functionIds }));
  console.log(`FLOW01-READ-OK ${realResolved} boards=${result.boardKeys.join(",")} functions=${result.functionCount}`);
  done(0);
} catch (cause) {
  console.error(`FAIL ${cause instanceof Error ? cause.message : String(cause)}`);
  done(1);
}
