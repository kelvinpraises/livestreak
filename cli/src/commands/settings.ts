import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  defaultSettingsPath,
  ensureSettings,
  loadSettings,
  saveSettings,
  buildDefaultSettings
} from "../prefs/settings.js";
import { createHostClient } from "../adapters/host.js";

export const runSettingsInit = async (input: {
  readonly hostUrl?: string;
  readonly outPath?: string;
}): Promise<string> => {
  const outPath = input.outPath ?? defaultSettingsPath();
  const hostUrl = input.hostUrl ?? "http://127.0.0.1:8787";
  let doc = buildDefaultSettings(hostUrl);

  // Refresh AA paths from host descriptor when reachable.
  try {
    const host = createHostClient(hostUrl);
    const aaDescriptor = await host.getAaDescriptor();
    const chainId = Number(doc.defaultChain.split(":")[1] ?? "31337");
    const aaChain = aaDescriptor.chains.find((c) => c.chainId === chainId);
    if (aaChain !== undefined) {
      const chain = doc.chains[doc.defaultChain];
      if (chain !== undefined) {
        doc = {
          ...doc,
          chains: {
            ...doc.chains,
            [doc.defaultChain]: {
              ...chain,
              aa: {
                bundlerPath: aaChain.bundlerPath,
                paymasterPath:
                  (aaChain as { paymasterPath?: string }).paymasterPath ??
                  aaDescriptor.paymasterPath,
                isSponsored: true
              }
            }
          }
        };
      }
    }
  } catch {
    /* host offline — keep defaults */
  }

  await saveSettings(outPath, doc);
  return `settings written: ${outPath}`;
};

export const runSettingsShow = async (input?: { readonly path?: string }): Promise<string> => {
  const doc = await loadSettings(input?.path ?? defaultSettingsPath());
  return JSON.stringify(doc, null, 2);
};

const hostUrlOpt = Options.text("host-url").pipe(
  Options.withDescription("Host base URL (default http://127.0.0.1:8787)"),
  Options.optional
);
const outOpt = Options.text("out").pipe(
  Options.withDescription("Output path (default ./settings.json)"),
  Options.optional
);
const pathOpt = Options.text("path").pipe(
  Options.withDescription("Settings file path"),
  Options.optional
);

const settingsInitCommand = Command.make(
  "init",
  { hostUrl: hostUrlOpt, out: outOpt },
  ({ hostUrl, out }) =>
    Effect.tryPromise({
      try: () =>
        runSettingsInit({
          ...(Option.isSome(hostUrl) ? { hostUrl: hostUrl.value } : {}),
          ...(Option.isSome(out) ? { outPath: out.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((msg) => Console.log(msg)))
);

const settingsShowCommand = Command.make(
  "show",
  { path: pathOpt },
  ({ path }) =>
    Effect.tryPromise({
      try: () =>
        runSettingsShow({
          ...(Option.isSome(path) ? { path: path.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((msg) => Console.log(msg)))
);

export const settingsCommand = Command.make("settings").pipe(
  Command.withSubcommands([settingsInitCommand, settingsShowCommand])
);

export const ensureSettingsForCommand = (): Promise<Awaited<ReturnType<typeof ensureSettings>>> =>
  ensureSettings();
