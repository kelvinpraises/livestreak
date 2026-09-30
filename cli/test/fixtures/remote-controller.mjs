// Outside role controller for the real-gateway role proof.
//
// Runs as a COPY inside a clean temporary consumer of the PACKED
// `@livestreak/cli` tarball, so the ONLY import that can resolve is the packed
// public entry (asserted at runtime via the reported resolved URL).
// Usage:
//   node remote-controller.mjs <hostUrl> <sessionId> <pairingPassword> boards
//   node remote-controller.mjs <hostUrl> <sessionId> <pairingPassword> call <target> <action> [argsJson] [id]
//   node remote-controller.mjs <hostUrl> <sessionId> <pairingPassword> calls <callsJson>
//   node remote-controller.mjs <hostUrl> <sessionId> <pairingPassword> wait-boards <title> [timeoutMs]
// Prints READY (with the resolved module URL) after connect, then one JSON
// result line. Exit 0 whenever the Host answered (even ok:false); nonzero only
// on connect/transport failure.
import { createAgentClient } from "@livestreak/cli/agent-client";

const [hostUrl, sessionId, pairingPassword, command, ...rest] = process.argv.slice(2);

const fail = (message) => {
  console.error(`controller failed: ${message}`);
  process.exit(1);
};

if (typeof hostUrl !== "string" || typeof sessionId !== "string" || typeof pairingPassword !== "string") {
  fail("usage: <hostUrl> <sessionId> <pairingPassword> boards|wait-boards|call|calls …");
}

const big = (_key, value) => (typeof value === "bigint" ? value.toString() : value);

const client = createAgentClient({ hostBaseUrl: hostUrl, sessionId, pairingPassword });
try {
  await client.connect();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log(JSON.stringify({ ready: true, resolved: import.meta.resolve("@livestreak/cli/agent-client") }));

const runCall = async (spec) => {
  if (typeof spec?.target !== "string" || typeof spec?.action !== "string") {
    fail("each call needs {target, action, args?, id?}");
  }
  let args = spec.args ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      fail("call args is not JSON");
    }
  }
  return client.call(spec.target, spec.action, args, spec.id);
};

try {
  if (command === "boards") {
    console.log(JSON.stringify({ functions: client.functions(), boards: client.boards() }, big));
  } else if (command === "wait-boards") {
    // Poll OUR OWN board view until it contains the title (or the budget ends).
    // A patch pushed after our hello still reaches us live; this removes the
    // gateway-push vs client-hello race from the caller.
    const [title, timeoutRaw] = rest;
    const budget = Number(timeoutRaw ?? 10000);
    const deadline = Date.now() + (Number.isFinite(budget) ? budget : 10000);
    let found = false;
    while (!found && Date.now() < deadline) {
      if (JSON.stringify(client.boards()).includes(String(title))) {
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(JSON.stringify({ found, boards: client.boards() }, big));
  } else if (command === "call") {
    const [target, action, argsJson, id] = rest;
    const outcome = await runCall({ target, action, args: argsJson, id });
    console.log(JSON.stringify(outcome));
  } else if (command === "calls") {
    // Sequential calls on ONE client (revocation proof: the second call must
    // fail locally without ever touching the socket).
    let specs = [];
    try {
      specs = JSON.parse(rest[0] ?? "[]");
    } catch {
      fail("calls needs a JSON array");
    }
    if (!Array.isArray(specs)) {
      fail("calls needs a JSON array");
    }
    const outcomes = [];
    for (const spec of specs) {
      outcomes.push(await runCall(spec));
    }
    console.log(JSON.stringify(outcomes));
  } else {
    fail(`unknown command ${command ?? "(none)"}`);
  }
} finally {
  client.close();
}
