import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createAgentClient } from "@livestreak/cli/agent-client";
import WebSocket from "ws";

// No signing key is given to this bot. Each action goes to the appropriate role's gateway.
const config = JSON.parse(
  await readFile(process.env.LIVESTREAK_BROADCAST_CONFIG ?? "broadcast.json", "utf8"),
);
const clients = {};
const receipt = {
  startedAt: new Date().toISOString(),
  steps: [],
  media: { initBytes: 0, fragments: 0 },
};
let producer, viewer, obsId;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, ms = 30000) => {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} timed out`);
    await sleep(50);
  }
};
const call = async (role, target, action, args = {}, id) => {
  const result = await clients[role].call(target, action, args, id);
  receipt.steps.push({
    role,
    target,
    action,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  });
  if (!result.ok) throw new Error(`${role}/${action}: ${result.error}`);
  return result.result;
};
const family = (kind, action) => `observe.obs.${obsId}.${kind}.${action}`;
const cells = () => clients.broadcaster.boards().observe?.cells ?? {};
const requireAdvancing = async (label) => {
  const before = receipt.media.fragments;
  await waitFor(() => receipt.media.fragments >= before + 2, label);
  receipt.media[label] = { before, after: receipt.media.fragments };
};
try {
  for (const role of ["broadcaster", "bookmaker", "viewer", "steward"]) {
    clients[role] = createAgentClient({ hostBaseUrl: config.hostBaseUrl, ...config[role] });
    await clients[role].connect();
  }
  await waitFor(() => cells()["system:config"], "initial broadcaster board");
  const old = new Set(Object.keys(cells()["system:config"].readonly?.observations ?? {}));
  await call("broadcaster", "observe", "configure", {
    title: config.title ?? "RTMP audiovisual broadcast",
    chain: config.chain ?? "eip155:31337",
  });
  await waitFor(
    () =>
      Object.keys(cells()["system:config"].readonly?.observations ?? {}).some(
        (id) => !old.has(id),
      ),
    "new observation",
  );
  obsId = Object.keys(cells()["system:config"].readonly.observations).find(
    (id) => !old.has(id),
  );
  receipt.obsId = obsId;
  await call("broadcaster", "observe", "captureKind", { obsId, kind: "rtmp" });
  await call(
    "broadcaster",
    "observe",
    "configure",
    {
      port: config.port ?? 48785,
      streamName: obsId,
      width: 320,
      height: 240,
      fps: 10,
      audio: true,
    },
    family("capture", "configure"),
  );
  await call("broadcaster", "observe", "configure", {}, family("publish", "configure"));
  await call("broadcaster", "observe", "register", {}, family("market", "register"));
  await waitFor(
    () => cells()[`obs:${obsId}:market`]?.readonly?.marketId,
    "registered market",
  );
  const marketId = cells()[`obs:${obsId}:market`].readonly.marketId;
  receipt.marketId = marketId;
  console.log(`STREAM_READY ${marketId}`);
  await call("broadcaster", "observe", "prepare", {}, family("run", "prepare"));
  await call("broadcaster", "observe", "start", {}, family("run", "start"));
  await sleep(500);
  producer = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-re",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=10",
      "-re",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-c:a",
      "aac",
      "-f",
      "flv",
      `rtmp://127.0.0.1:${config.port ?? 48785}/live/${obsId}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let producerError = "";
  producer.stderr.on(
    "data",
    (bytes) => (producerError = (producerError + bytes).slice(-2048)),
  );
  producer.once("error", (error) => {
    producerError = String(error);
  });
  const chunks = [];
  viewer = new WebSocket(
    `${config.hostBaseUrl.replace(/^http/, "ws")}/live/watch/${marketId}`,
  );
  viewer.on("error", (error) => {
    receipt.media.error = String(error);
  });
  viewer.on("message", (data, binary) => {
    if (!binary) return;
    if (data[0] === 1) {
      receipt.media.initBytes = data.length - 1;
      chunks.push(data.subarray(1));
    }
    if (data[0] === 2) {
      receipt.media.fragments++;
      chunks.push(data.subarray(1));
    }
  });
  await waitFor(
    () => receipt.media.initBytes > 0 && receipt.media.fragments >= 2,
    `viewer video proof (${producerError})`,
  );
  await call("broadcaster", "observe", "goLive", {}, family("market", "goLive"));
  if (config.preEconomyDelayMs) await sleep(config.preEconomyDelayMs);
  const beforeVault = receipt.media.fragments;
  await call("bookmaker", "bookmaker", "configure", { marketId });
  const question = "Will the eligible video show two distinct moving frames during the decision window?";
  const closes = Math.floor(Date.now()/1000) + (config.fundingWindowSec ?? 120);
  const mandate = {
    version: "livestreak-mandate/1", chainId: config.chain ?? "eip155:31337", marketId, question,
    yesMeaning: "Two distinct video frames show visible movement in the declared window",
    noMeaning: "Eligible complete video shows fewer than two moving frames in the declared window",
    method: "discretionary", evaluation: {kind:"rubric",rubric:"Compare eligible decoded frames from this exact market during the decision window. Explain movement and ambiguity; missing footage is unresolved, never an automatic NO."},
    evidence: [{sourceId:`market-video:${marketId}`,kind:"video",description:"This market's timestamped decoded video, with origin and window eligibility recorded"}],
    authority:"market-designated-steward", authorityChanges:"registry-authority-may-change",
    fundingClose:closes,decisionStart:closes,decisionEnd:closes+300,
    missingEvidence:{deadline:closes+600,treatment:"unresolved-escalate-no-guaranteed-refund",procedure:"At the deadline record unavailable/ambiguous evidence, alert the designated Steward and remain unresolved; this alpha has no guaranteed refund transition"},
    ambiguityProcedure:"Record conflicting observations and explain them; escalate at the missing-evidence deadline without manufacturing an answer"
  };
  const operationId = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,"0")).join("")}`;
  const creationArgs = { marketId, question, creatorSide:"yes", creatorStake:"5000000", seedRate:"8333", mandate, operationId };
  const vault = await call("bookmaker", "bookmaker", "createVault", creationArgs);
  receipt.vaultId = vault?.tokenId;
  if (!receipt.vaultId) throw new Error("Missing vault receipt");
  receipt.media.duringVault = receipt.media.fragments - beforeVault;
  await requireAdvancing("afterVault");
  receipt.commitment = vault.commitment;
  receipt.creationOperationId = operationId;
  const retried = await call("bookmaker", "bookmaker", "createVault", creationArgs);
  if (retried?.tokenId !== receipt.vaultId) throw new Error("Creation replay produced a different vault");
  receipt.creationReplay = "same-vault";
  const viewerRule = await call("viewer", "options", "readMandate", {vaultId:receipt.vaultId});
  const stewardRule = await call("steward", "steward", "readMandate", {vaultId:receipt.vaultId});
  if (viewerRule?.terms?.commitment !== receipt.commitment || stewardRule?.terms?.commitment !== receipt.commitment || JSON.stringify(viewerRule.mandate) !== JSON.stringify(stewardRule.mandate)) throw new Error("Independent mandate verification mismatch");
  receipt.independentRules = "viewer-and-steward-verified";
  receipt.fundingClose = closes;

  await call("viewer", "options", "configure", { marketId });
  await waitFor(() => clients.viewer.boards().options?.snapshot?.account, "viewer account");
  receipt.viewerAccount = clients.viewer.boards().options.snapshot.account;
  await call("viewer", "options", "setApprovalForAll", { approved: true });
  const mint = await call("viewer", "options", "mint", {
    marketId,
    to: receipt.viewerAccount,
  });
  receipt.tokenId = mint?.tokenId;
  if (!receipt.tokenId) throw new Error("Missing viewer token receipt");
  const beforeFunding = receipt.media.fragments;
  await call("viewer", "options", "fund", {
    tokenId: receipt.tokenId,
    vaultId: receipt.vaultId,
    side: "yes",
    rate: "1000",
    deposit: "1000000",
  });
  receipt.media.duringFunding = receipt.media.fragments - beforeFunding;
  await requireAdvancing("afterFunding");
  if (config.mediaFile) await writeFile(config.mediaFile, Buffer.concat(chunks));
  if (config.exerciseControls !== false) {
    await call("broadcaster", "observe", "pause", {}, family("pause", "pause"));
    await sleep(1500);
    receipt.pausedRun = cells()[`obs:${obsId}:run`]?.status;
    if (receipt.pausedRun?.[0] !== "paused") throw new Error("Pause did not reach paused state");
    await call("broadcaster", "observe", "resume", {}, family("pause", "resume"));
    await requireAdvancing("afterResume");
  }
  receipt.status = "bound-vault-and-independent-rules-passed";
  console.log(JSON.stringify(receipt, null, 2));
  if (config.keepAliveMs) await sleep(config.keepAliveMs);
} catch (error) {
  receipt.status = "failed";
  receipt.error = String(error);
  console.error(JSON.stringify(receipt, null, 2));
  process.exitCode = 1;
} finally {
  producer?.kill("SIGTERM");
  viewer?.close();
  if (obsId && clients.broadcaster)
    await call("broadcaster", "observe", "stop", {}, family("run", "stop")).catch((error) =>
      {
      receipt.status = "failed";
      receipt.error = `stop: ${error}`;
      process.exitCode = 1;
      console.error(receipt.error);
    },
    );
  receipt.stoppedRun = obsId ? cells()[`obs:${obsId}:run`]?.status : undefined;
  if (config.receiptFile)
    await writeFile(config.receiptFile, JSON.stringify(receipt, null, 2));
  for (const client of Object.values(clients)) client.close();
}
