import { access } from "node:fs/promises";
import { basename } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { resolveKeystore } from "../gateway/operator.js";
import { parseMarketIdArg, configOpt, passwordOpt, readCommandConfig } from "./args.js";
import {
  createHostSignaling,
  resolveStreamFileEntry,
  triggerStreamMetadata
} from "../adapters/stream.js";

// `stream --video <path> --market <id>` — push a REAL local file to the UI over WebRTC (no transforms).
// Drives observe's file→WebRTC entry (SEAM-WEBRTC / agent-4) with a host-mediated signaling channel
// (SEAM-WEBRTC / agent-2), and triggers the local metadata mock so the stream shows title/category.
export const runStream = async (input: {
  readonly videoPath: string;
  readonly market: string;
  readonly title?: string;
  readonly category?: string;
  readonly configPath?: string;
  readonly password?: string;
}): Promise<string> => {
  const marketId = parseMarketIdArg(input.market);
  await access(input.videoPath);

  // Thin keystore handle: streaming needs the host/doc config, not an operator chain-signer.
  const { doc } = await resolveKeystore(input);

  const title = input.title ?? basename(input.videoPath);
  const category = input.category ?? "general";

  // Local metadata mock so the UI can render a title/category for this stream id (best-effort).
  await triggerStreamMetadata(doc, { marketId, title, category }).catch((error: unknown) => {
    console.error(
      `[stream] metadata mock skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  const signaling = createHostSignaling(doc.host.url);
  const entry = await resolveStreamFileEntry();
  const handle = await entry({ videoPath: input.videoPath, marketId, signaling });
  await handle.done;

  return [
    "livestreak stream — delivered",
    "",
    `marketId: ${marketId}`,
    `title:    ${title}`,
    `category: ${category}`,
    `file:     ${input.videoPath}`
  ].join("\n");
};

const videoOpt = Options.file("video").pipe(
  Options.withDescription("Path to a local video file to stream (no transcode)")
);
const marketOpt = Options.text("market").pipe(
  Options.withDescription("Target market/stream id (0x-prefixed bytes32)")
);
const titleOpt = Options.text("title").pipe(
  Options.withDescription("Stream title (defaults to the file name)"),
  Options.optional
);
const categoryOpt = Options.text("category").pipe(
  Options.withDescription("Stream category (defaults to 'general')"),
  Options.optional
);

export const streamCommand = Command.make(
  "stream",
  {
    video: videoOpt,
    market: marketOpt,
    title: titleOpt,
    category: categoryOpt,
    config: configOpt,
    password: passwordOpt
  },
  ({ video, market, title, category, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runStream({
          videoPath: video,
          market,
          ...(Option.isSome(title) ? { title: title.value } : {}),
          ...(Option.isSome(category) ? { category: category.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const streamCommands = [streamCommand];
