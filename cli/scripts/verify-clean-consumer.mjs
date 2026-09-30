// Checked-in clean-consumer release probe for `@livestreak/cli`.
//
// Pack → fresh /tmp consumer → install → import surface + offline proofs →
// clean-TypeScript compile → isolated lock dry-run. Touches no repo state;
// /tmp is removed on success and on failure. Run from the repo root with the
// workspace Node: `node cli/scripts/verify-clean-consumer.mjs`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const workspaceTsc = resolve(repo, "node_modules", "typescript", "bin", "tsc");

const work = mkdtempSync(join(tmpdir(), "ls-clean-"));
const consumer = join(work, "consumer");
const done = (code) => {
  rmSync(work, { recursive: true, force: true });
  process.exit(code);
};
const step = (label, fn) => {
  try {
    fn();
    console.log(`ok ${label}`);
  } catch (cause) {
    console.error(`FAIL ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    if (cause instanceof Error && cause.stdout !== undefined) {
      console.error(String(cause.stdout).slice(-2000));
    }
    done(1);
  }
};
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });

const IMPORT_PROBE = `
const m = await import("@livestreak/cli/agent-client");
for (const name of ["IngestPumpError", "classifyRemoteError", "createAgentClient", "createRemoteUiClient", "generateCounterFrames", "runRemoteDrive"]) {
  if (typeof m[name] !== "function") throw new Error("missing export: " + name);
}
await m.runRemoteDrive({ sessionId: "x", pairingPassword: "y", mediaOnly: true, log: () => {} }).then(
  () => { throw new Error("mediaOnly accepted without ingest"); },
  (e) => { if (!/mediaOnly requires the ingest block/.test(e.message)) throw e; }
);
await m.runRemoteDrive({ sessionId: "x", pairingPassword: "y", directVideoPath: "v.mp4", ingest: { width: 1, height: 1, fps: 1, frames: (async function* () {})() }, log: () => {} }).then(
  () => { throw new Error("dual producer accepted"); },
  (e) => { if (!/choose one producer/.test(e.message)) throw e; }
);
let n = 0;
for await (const f of m.generateCounterFrames(4, 4, 3)) {
  if (f.length !== 64) throw new Error("frame size " + f.length);
  n++;
}
if (n !== 3) throw new Error("frame count " + n);
console.log("surface+offline ok");
`;

const TS_PROBE = `
import { runRemoteDrive, generateCounterFrames, IngestPumpError, createAgentClient } from "@livestreak/cli/agent-client";
import type { RemoteDriveInput, IngestPump } from "@livestreak/cli/agent-client";
export const run = runRemoteDrive;
export const frames = generateCounterFrames;
export const pumpError = IngestPumpError;
export const client = createAgentClient;
export type { RemoteDriveInput, IngestPump };
`;

// 1. pack the workspace CLI.
mkdirSync(join(work, "pack"), { recursive: true });
step("pack", () => {
  run("npm", ["pack", "--workspace=@livestreak/cli", `--pack-destination=${join(work, "pack")}`], repo);
});
const tarball = join(
  work,
  "pack",
  readdirSync(join(work, "pack")).find((f) => f.endsWith(".tgz")) ?? "missing.tgz"
);

// 2. install into a clean consumer (no workspace symlinks or parent node_modules).
mkdirSync(consumer, { recursive: true });
step("clean install", () => {
  run("npm", ["init", "-y"], consumer);
  run("npm", ["install", "--no-save", tarball], consumer);
});

// 3. import the packed entry and run the offline proofs (zero network).
step("packed import + offline proofs", () => {
  writeFileSync(join(consumer, "probe-import.mjs"), IMPORT_PROBE);
  run(process.execPath, ["probe-import.mjs"], consumer);
});

// 4. compile a clean TypeScript consumer against the shipped declarations.
step("clean-ts compile", () => {
  writeFileSync(join(consumer, "probe.ts"), TS_PROBE);
  run(process.execPath, [
    workspaceTsc,
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    join(consumer, "probe.ts")
  ], consumer);
});

// 5. the root lock graph must dry-run clean in place.
step("lockfile dry-run", () => {
  run("npm", ["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund"], repo);
});

console.log("clean-consumer probe PASS");
done(0);
