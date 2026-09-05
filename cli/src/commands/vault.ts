import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import type { CreateVaultIntent } from "@livestreak/bookmaker";
import { asMarketId, validateOptionsVaultSide } from "@livestreak/options";
import { buildBookmakerChain, createVaultViaBookmaker } from "../adapters/bookmaker.js";
import { resolveOperatorContext } from "../gateway/operator.js";
import { createOptionsEdge } from "../adapters/options.js";
import { configOpt, parseBigIntArg, passwordOpt, readCommandConfig } from "./args.js";
import { renderVaultCreateResult } from "../render/output.js";

// Default vault resolution window when the operator does not pass one (7 days out).
const DEFAULT_RESOLUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RESOLUTION_SOURCE = "operator-cli";

export const runVaultCreate = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly marketId: string;
  readonly question: string;
  readonly side: string;
  readonly rate: string;
  readonly deposit: string;
  readonly resolutionSource?: string;
  readonly resolutionWindowMs?: number;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const side = validateOptionsVaultSide(input.side);

  // USDC address is read on-chain (the deploy file does not carry it); bookmaker
  // approves USDC internally, so the CLI no longer issues its own approve here.
  const usdc = await createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    marketId: asMarketId(input.marketId)
  }).chain.reader.readUsdcAddress();

  const chain = buildBookmakerChain({
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    addresses: {
      vaultDriver: ctx.doc.options.vaultDriver,
      marketRegistry: ctx.doc.options.marketRegistry,
      vault: ctx.doc.options.vault,
      usdc
    },
    readRpcUrl: ctx.doc.chain.rpc
  });

  const intent: CreateVaultIntent = {
    action: "createVault",
    marketId: input.marketId,
    question: input.question,
    creatorSide: side,
    creatorStake: parseBigIntArg(input.deposit, "deposit"),
    seedRate: parseBigIntArg(input.rate, "rate"),
    resolutionSource: input.resolutionSource ?? DEFAULT_RESOLUTION_SOURCE,
    resolutionWindowExpiresAtMs:
      input.resolutionWindowMs ?? Date.now() + DEFAULT_RESOLUTION_WINDOW_MS
  };

  const { result, idempotent } = await createVaultViaBookmaker({ chain, intent });

  return renderVaultCreateResult({
    vaultId: result.vaultId,
    createTx: result.txId,
    idempotent
  });
};

const vaultCreateCommand = Command.make(
  "create",
  {
    market: Options.text("market"),
    question: Options.text("question"),
    side: Options.text("side"),
    rate: Options.text("rate"),
    deposit: Options.text("deposit"),
    resolutionSource: Options.text("resolution-source").pipe(Options.optional),
    resolutionWindowMs: Options.integer("resolution-window-ms").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ market, question, side, rate, deposit, resolutionSource, resolutionWindowMs, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runVaultCreate({
          marketId: market,
          question,
          side,
          rate,
          deposit,
          ...(Option.isSome(resolutionSource) ? { resolutionSource: resolutionSource.value } : {}),
          ...(Option.isSome(resolutionWindowMs) ? { resolutionWindowMs: resolutionWindowMs.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const vaultCommand = Command.make("vault", {}).pipe(
  Command.withSubcommands([vaultCreateCommand])
);
