import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { createCreatorWallet } from "../adapters/onchain.js";
import { resolveOperator } from "../gateway/identity.js";
import { resolvePassword } from "../gateway/password.js";
import { configOpt, passwordOpt, readCommandConfig } from "./args.js";
import { defaultInitDocPath, loadInitDoc, saveInitDoc } from "../prefs/init-doc.js";

export interface RunLoginResult {
  readonly operator: `0x${string}`;
  readonly configPath: string;
}

export const runLogin = async (input?: {
  readonly configPath?: string;
  readonly password?: string;
}): Promise<RunLoginResult> => {
  const configPath = input?.configPath ?? defaultInitDocPath;
  const doc = await loadInitDoc(configPath);

  const password = await resolvePassword(input?.password);
  const { seed } = resolveOperator(password);
  // Seed is now in scope — used immediately to derive the AA address, then discarded.

  const walletConfig = {
    ...doc.wallet.config,
    provider: doc.chain.rpc,
    chainId: doc.chain.chainId
  } as const;

  const { account } = await createCreatorWallet({ seed, config: walletConfig });
  const operator = (await account.getAddress()) as `0x${string}`;

  // Cache only the public address — never the seed or password.
  await saveInitDoc(configPath, {
    ...doc,
    run: {
      runId: doc.run?.runId ?? `login-${Date.now()}`,
      ...(doc.run?.streamId === undefined ? {} : { streamId: doc.run.streamId }),
      ...(doc.run?.marketId === undefined ? {} : { marketId: doc.run.marketId }),
      ...(doc.run?.tokenId === undefined ? {} : { tokenId: doc.run.tokenId }),
      ...(doc.run?.status === undefined ? {} : { status: doc.run.status }),
      operator
    }
  });

  return { operator, configPath };
};

export const renderLoginResult = (result: RunLoginResult): string =>
  [
    "livestreak login — complete",
    "",
    `operator: ${result.operator}`,
    `cached in: ${result.configPath}  (run.operator — public address only, seed discarded)`
  ].join("\n");

export const loginCommand = Command.make(
  "login",
  { config: configOpt, password: passwordOpt },
  ({ config, password }) =>
    Effect.tryPromise({
      try: () => runLogin(readCommandConfig(config, password)),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((result) => Console.log(renderLoginResult(result))))
);
