/** Opt-in cloud proof. Run from repo root with Node --env-file=.env --conditions=livestreak-dev --import tsx host/scripts/prove-cloud-replay.ts. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";
import express from "express";
import { Effect } from "effect";
import { createS3ObjectStore } from "../src/storage/object-store.js";
import { readStorageConfig } from "../src/config/host.js";
import { createRecordingService } from "../src/features/recordings/service.js";
import { createRecordingsRouter } from "../src/features/recordings/routes.js";
import { attachLiveWss } from "../src/features/live/transport.js";
import { createLiveRingStore } from "../src/features/live/ring.js";
import { createFmp4Chunker } from "../../packages/observe/src/pipeline/publish/encoder/fmp4-boxes.js";
import { createHostFmp4IngestTransport } from "../../packages/observe/src/pipeline/publish/sinks/live/transport.js";
const config = readStorageConfig();
const accessToken = process.env.LIVESTREAK_HOST_API_TOKEN;
if (!config || !accessToken)
  throw new Error("Cloud storage and private Host credential required");
const store = createS3ObjectStore(config);
await store.check();
const recordings = createRecordingService(store, accessToken);
const app = express();
app.use(express.json());
app.use(
  createRecordingsRouter({
    config: { contentWriteToken: accessToken },
    recordings,
  }),
);
const server = createServer(app);
const wss = attachLiveWss(server, createLiveRingStore(), recordings, true);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const scope = {
  chain: "evm" as const,
  marketId: `0x${randomBytes(32).toString("hex")}`,
  runId: `cloud-proof-${Date.now()}`,
};
const transport = createHostFmp4IngestTransport({
  baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  streamId: scope.marketId,
  runId: scope.runId,
  chain: scope.chain,
  accessToken,
});
let transportError: Error | undefined;
transport.onError((error) => {
  transportError = error;
});
const chunker = createFmp4Chunker();
const duration = Number(process.env.LIVESTREAK_PROOF_DURATION_SECONDS ?? 120);
const startRss = process.memoryUsage().rss;
let peakRss = startRss;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);
const producer = spawn(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-re",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=24",
    "-t",
    String(duration),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-b:v",
    "1800k",
    "-minrate",
    "1800k",
    "-maxrate",
    "1800k",
    "-bufsize",
    "3600k",
    "-x264-params",
    "nal-hrd=cbr",
    "-g",
    "96",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "empty_moov+default_base_moof+frag_keyframe",
    "-f",
    "mp4",
    "pipe:1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const send = (chunks: ReturnType<typeof chunker.push>) => {
  for (const chunk of chunks) {
    if (chunk.kind === "init") transport.sendInit(chunk.data);
    else transport.sendFragment(chunk.data);
  }
};
let stderr = "";
producer.stderr.on("data", (bytes) => {
  stderr += String(bytes);
});
producer.stdout.on("data", (bytes) => send(chunker.push(bytes)));
try {
  await new Promise<void>((resolve, reject) => {
    producer.once("error", reject);
    producer.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${stderr}`)),
    );
  });
  send(chunker.flush());
  await Effect.runPromise(transport.end());
  const deadline = Date.now() + 180000;
  let receipt = await recordings.read(scope);
  while (
    receipt?.status !== "ready" &&
    receipt?.status !== "failed" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    receipt = await recordings.read(scope);
  }
  if (transportError) throw transportError;
  if (receipt?.status !== "ready")
    throw new Error(`Recording did not finalize: ${receipt?.error ?? receipt?.status}`);
  const recovered = await createRecordingService(store, accessToken).read(scope);
  const proof = {
    receipt: recovered,
    startRss,
    peakRss,
    rssGrowth: peakRss - startRss,
    producerExited: true,
  };
  await writeFile("/tmp/flow07-cloud-proof.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} finally {
  clearInterval(sample);
  producer.kill();
  for (const client of wss.wss.clients) client.terminate();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
