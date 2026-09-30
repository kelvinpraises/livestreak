// Flow 01 read-only bootstrap — the ONLY supported import is the packed entry.
// Usage: LIVESTREAK_PAIR_PASSWORD=<pairingPassword> node src/read-boards.mjs <hostUrl> <sessionId> [--wait-ms N]
// (Preferred: npm run read -- <hostUrl> <sessionId> --wait-ms N)
// Prints READY with the resolved module URL, then one JSON result line.
// Exit 0 only when a structurally valid board was received; nonzero otherwise.
import { createAgentClient } from "@livestreak/cli/agent-client";

const isPlainObject = (v) => typeof v === "object" && v !== null && Array.isArray(v) === false;

// Correct argv parse: flags consume their value so values never leak into positionals.
const raw = process.argv.slice(2);
let waitMsRaw = "10000";
const positional = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--wait-ms") {
    waitMsRaw = raw[i + 1] ?? "";
    i++;
  } else if (raw[i].startsWith("--")) {
    console.error(`read-boards failed: unknown flag ${raw[i]}`);
    process.exit(1);
  } else {
    positional.push(raw[i]);
  }
}
const [hostUrl, sessionId] = positional;
const waitMs = Number(waitMsRaw);

if (typeof hostUrl !== "string" || hostUrl.length === 0) {
  console.error("read-boards failed: usage: <hostUrl> <sessionId> [--wait-ms N]");
  process.exit(1);
}
if (typeof sessionId !== "string" || sessionId.length === 0) {
  console.error("read-boards failed: usage: <hostUrl> <sessionId> [--wait-ms N]");
  process.exit(1);
}
if (Number.isFinite(waitMs) === false || waitMs <= 0 || waitMs > 60000) {
  console.error("read-boards failed: --wait-ms must be 1..60000");
  process.exit(1);
}
const pairingPassword = process.env.LIVESTREAK_PAIR_PASSWORD;
if (typeof pairingPassword !== "string" || pairingPassword.length === 0) {
  console.error("read-boards failed: missing LIVESTREAK_PAIR_PASSWORD env (pass the pairing password via env, never argv)");
  process.exit(1);
}

let exitCode = 0;
const deadline = Date.now() + waitMs;
const client = createAgentClient({ hostBaseUrl: hostUrl, sessionId, pairingPassword });
const withDeadline = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out within ${waitMs}ms budget`)), Math.max(0, deadline - Date.now()));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

try {
  // Bound the whole operation: a hanging connect must not outlive --wait-ms.
  await withDeadline(client.connect(), "connect");
  console.log(JSON.stringify({ ready: true, resolved: import.meta.resolve("@livestreak/cli/agent-client") }));

  let boards;
  let summary;
  while (true) {
    boards = client.boards();
    summary = summarizeBoards(boards);
    if (summary.valid) break;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, Math.min(200, Math.max(0, deadline - Date.now()))));
  }
  if (summary.valid === false) {
    throw new Error(summary.reason);
  }

  const functions = client.functions() ?? [];
  if (!Array.isArray(functions) || functions.some((f) => !isPlainObject(f) || typeof f.id !== "string")) {
    throw new Error("malformed function catalog (expected descriptors with string ids)");
  }
  // A board-only grant may legitimately expose zero actions — report honestly.
  console.log(
    JSON.stringify({
      functionCount: functions.length,
      functionIds: functions.map((f) => f?.id).filter((id) => typeof id === "string"),
      boardKeys: Object.keys(boards),
      boardSummary: summary.summary
    })
  );
} catch (error) {
  console.error(`read-boards failed: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  try {
    client.close();
  } catch {
    // Close must not mask the result.
  }
}
process.exit(exitCode);

function summarizeBoards(boards) {
  if (!isPlainObject(boards)) return { valid: false, reason: "malformed boards (expected object)" };
  // This broadcaster bootstrap proves the Observe role. Its public board
  // envelope is revision/catalogVersion/cells, with a system:config run cell.
  // Arbitrary objects and other roles alone cannot satisfy that contract.
  const board = boards.observe;
  if (!isPlainObject(board)) return { valid: false, reason: "missing or malformed Observe board" };
  if (!Number.isSafeInteger(board.revision) || board.revision < 0 ||
      typeof board.catalogVersion !== "string" || !board.catalogVersion.length ||
      !isPlainObject(board.cells)) {
    return { valid: false, reason: "malformed Observe board envelope" };
  }
  const config = board.cells["system:config"];
  if (!isPlainObject(config) || !isPlainObject(config.readonly) ||
      typeof config.readonly.runId !== "string" || !config.readonly.runId.length) {
    return { valid: false, reason: "Observe board missing system:config run state" };
  }
  return {
    valid: true,
    summary: {
      observe: {
        revision: board.revision,
        catalogVersion: board.catalogVersion,
        runId: config.readonly.runId,
        cellIds: Object.keys(board.cells),
        cellCount: Object.keys(board.cells).length
      }
    }
  };
}
