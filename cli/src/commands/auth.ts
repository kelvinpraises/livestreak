import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { buildSessionWallet } from "../gateway/auth/session-wallet.js";
import { resolveOperator } from "../gateway/auth/identity.js";
import { resolvePassword } from "../gateway/auth/password.js";
import { ensureSettings, defaultSettingsPath } from "../prefs/settings.js";
import { passwordOpt } from "./args.js";

export interface RunAuthLoginResult {
  readonly operator: string;
  readonly chain: string;
  readonly settingsPath: string;
}

export const runAuthLogin = async (input?: {
  readonly password?: string;
  readonly settingsPath?: string;
  readonly chain?: string;
}): Promise<RunAuthLoginResult> => {
  const settingsPath = input?.settingsPath ?? defaultSettingsPath();
  const doc = await ensureSettings(settingsPath);
  const caip2 = input?.chain ?? doc.defaultChain;

  const password = await resolvePassword(input?.password);
  const { seed } = resolveOperator(password);
  const sessionWallet = await buildSessionWallet(doc, seed, caip2);

  return {
    operator: sessionWallet.operatorAddress,
    chain: caip2,
    settingsPath
  };
};

export const renderAuthLoginResult = (result: RunAuthLoginResult): string =>
  [
    "livestreak auth login — complete",
    "",
    `operator: ${result.operator}`,
    `chain:    ${result.chain}`,
    `settings: ${result.settingsPath}`,
    "",
    "Seed used in-memory only — never written to settings.json."
  ].join("\n");

const chainOpt = Options.text("chain").pipe(
  Options.withDescription("CAIP-2 chain id (default from settings.defaultChain)"),
  Options.optional
);
const settingsPathOpt = Options.text("settings").pipe(
  Options.withDescription("Path to settings.json"),
  Options.optional
);

const authLoginCommand = Command.make(
  "login",
  { password: passwordOpt, chain: chainOpt, settings: settingsPathOpt },
  ({ password, chain, settings }) =>
    Effect.tryPromise({
      try: () =>
        runAuthLogin({
          ...(Option.isSome(password) ? { password: password.value } : {}),
          ...(Option.isSome(chain) ? { chain: chain.value } : {}),
          ...(Option.isSome(settings) ? { settingsPath: settings.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((result) => Console.log(renderAuthLoginResult(result))))
);

export const authCommand = Command.make("auth").pipe(
  Command.withSubcommands([authLoginCommand])
);
