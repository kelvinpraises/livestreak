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
  for (const role of ["broadcaster", "bookmaker", "viewer"]) {
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
  const vault = await call("bookmaker", "bookmaker", "createVault", {
    marketId,
    question: "Will this live audiovisual broadcast continue?",
    creatorSide: "yes",
    creatorStake: "5000000",
    seedRate: "8333",
  });
  receipt.vaultId = vault?.tokenId;
  if (!receipt.vaultId) throw new Error("Missing vault receipt");
  receipt.media.duringVault = receipt.media.fragments - beforeVault;
  await requireAdvancing("afterVault");
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
  receipt.status = "media-and-separate-role-funding-passed";
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
