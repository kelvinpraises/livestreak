import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { createCreatorWallet } from "../chains/evm.js";
import { createHostClient } from "../edges/host.js";
import { publishVod } from "../edges/market.js";
import { runProducerCapture } from "../edges/observe.js";
import { resolveOperator } from "../gateway/identity.js";
import { defaultInitDocPath, loadInitDoc, saveInitDoc } from "../prefs/init-doc.js";
import { renderHostHealth, renderProduceResult } from "../render/output.js";

export interface ProduceOutcome {
  readonly title: string;
  readonly marketId: `0x${string}`;
  readonly streamId: `0x${string}`;
  readonly mp4Path: string;
  readonly vodUrl: string;
  readonly goLiveTx: string;
  readonly setEndedTx: string;
  readonly streamState: import("../edges/market.js").OnChainStreamState;
}

const readPassword = (password: string | undefined): string => {
  const resolved = password ?? process.env["LIVESTREAK_PASSWORD"];
  if (resolved === undefined || resolved.length === 0) {
    throw new Error(
      "Operator password required: set LIVESTREAK_PASSWORD or pass --password"
    );
  }
  return resolved;
};

const assertReadableFile = async (path: string): Promise<void> => {
  await access(path);
};

export const runProduce = async (input: {
  readonly title: string;
  readonly videoPath: string;
  readonly password?: string;
  readonly configPath?: string;
}): Promise<ProduceOutcome> => {
  const configPath = input.configPath ?? defaultInitDocPath;
  const doc = await loadInitDoc(configPath);
  const { seed } = resolveOperator(readPassword(input.password));

  await assertReadableFile(input.videoPath);

  const walletConfig = {
    ...doc.wallet.config,
    provider: doc.chain.rpc,
    chainId: doc.chain.chainId
  } as const;

  const { account, publicClient, walletInit } = await createCreatorWallet({
    seed,
    config: walletConfig
  });

  const runId = doc.run?.runId ?? `produce-${Date.now()}`;
  const sinkPath = join(tmpdir(), `livestreak-${runId}.mp4`);

  const capture = await runProducerCapture({
    title: input.title,
    videoPath: input.videoPath,
    sinkPath,
    walletInit,
    seed,
    marketRegistryAddress: doc.chain.marketRegistry,
    runId
  });

  const host = createHostClient(doc.host.url);
  const bytes = new Uint8Array(await readFile(capture.mp4Path));
  const pointer = await host.uploadBlob(bytes, "video/mp4", "locked");

  const published = await publishVod({
    account,
    publicClient,
    marketRegistryAddress: doc.chain.marketRegistry,
    marketId: capture.marketId,
    pointer
  });

  await saveInitDoc(configPath, {
    ...doc,
    run: {
      runId,
      streamId: capture.streamId,
      marketId: capture.marketId,
      status: "ended"
    }
  });

  return {
    title: input.title,
    marketId: capture.marketId,
    streamId: capture.streamId,
    mp4Path: capture.mp4Path,
    vodUrl: pointer.url,
    goLiveTx: published.goLiveTx,
    setEndedTx: published.setEndedTx,
    streamState: published.streamState
  };
};

export const runHostInspect = async (configPath?: string): Promise<string> => {
  const doc = await loadInitDoc(configPath ?? defaultInitDocPath);
  const host = createHostClient(doc.host.url);
  const [health, descriptor] = await Promise.all([host.health(), host.getDescriptor()]);

  return renderHostHealth({
    baseUrl: descriptor.baseUrl,
    healthy: health.ok,
    walrusNetwork: descriptor.walrus.network
  });
};

const titleOpt = Options.text("title");
const videoOpt = Options.file("video");
const passwordOpt = Options.text("password").pipe(Options.optional);
const configOpt = Options.file("config").pipe(
  Options.withDescription("Path to livestreak.json"),
  Options.optional
);

export const produceCommand = Command.make(
  "produce",
  {
    title: titleOpt,
    video: videoOpt,
    password: passwordOpt,
    config: configOpt
  },
  ({ title, video, password, config }) =>
    Effect.tryPromise({
      try: () =>
        runProduce({
          title,
          videoPath: video,
          ...(Option.isSome(password) ? { password: password.value } : {}),
          ...(Option.isSome(config) ? { configPath: config.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(
      Effect.flatMap((result) => Console.log(renderProduceResult(result)))
    )
);

export const hostCommand = Command.make(
  "host",
  { config: configOpt },
  ({ config }) =>
    Effect.tryPromise({
      try: () => runHostInspect(Option.getOrUndefined(config)),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);
