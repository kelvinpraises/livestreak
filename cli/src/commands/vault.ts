import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import type { CreateVaultIntent } from "@livestreak/bookmaker";
import { asMarketId, validateOptionsVaultSide } from "@livestreak/options";
import { buildBookmakerChain, createVaultViaBookmaker } from "../adapters/bookmaker.js";
import { resolveOperatorContext } from "../gateway/operator.js";
import { createOptionsEdge } from "../adapters/options.js";
import { describeChainError } from "../adapters/revert.js";
import { isLocalRpc, mintMockUsdc, USDC_DECIMALS } from "../adapters/faucet.js";
import { configOpt, parseBigIntArg, passwordOpt, readCommandConfig } from "./args.js";
import { renderVaultCreateResult } from "../render/output.js";

const fmtUsdc = (raw: bigint): string => (Number(raw) / 10 ** USDC_DECIMALS).toString();

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

  const deposit = parseBigIntArg(input.deposit, "deposit");

  // USDC address is read on-chain (the deploy file does not carry it); bookmaker
  // approves USDC internally, so the CLI no longer issues its own approve here.
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    marketId: asMarketId(input.marketId)
  });
  const usdc = await edge.chain.reader.readUsdcAddress();

  // S9 — operator funding ergonomics. A fresh operator AA wallet holds 0 USDC, so the createVault
  // userOp would revert with a bare ExecutionFailed selector. Pre-flight the balance: auto-mint on a
  // local stack (frictionless first run), or fail with a human hint pointing at `livestreak faucet`.
  const balance = await edge.chain.reader.readUsdcBalance(ctx.userAddress);
  if (balance < deposit) {
    if (isLocalRpc(ctx.doc.chain.rpc)) {
      // Mint enough headroom to cover the deposit in one shot.
      await mintMockUsdc({
        account: ctx.account,
        usdc,
        to: ctx.userAddress as `0x${string}`,
        amount: deposit
      });
    } else {
      throw new Error(
        `insufficient USDC: need ${fmtUsdc(deposit)}, have ${fmtUsdc(balance)} (operator ${ctx.userAddress}). ` +
          "Fund the operator wallet, or on a local stack run `livestreak faucet --token usdc --amount N`."
      );
    }
  }

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
    creatorStake: deposit,
    seedRate: parseBigIntArg(input.rate, "rate"),
    resolutionSource: input.resolutionSource ?? DEFAULT_RESOLUTION_SOURCE,
    resolutionWindowExpiresAtMs:
      input.resolutionWindowMs ?? Date.now() + DEFAULT_RESOLUTION_WINDOW_MS
  };

  let result: Awaited<ReturnType<typeof createVaultViaBookmaker>>["result"];
  let idempotent: boolean;
  try {
    ({ result, idempotent } = await createVaultViaBookmaker({ chain, intent }));
  } catch (error) {
    // Decode the inner revert reason; if it's still an opaque ExecutionFailed and the wallet is now
    // short on USDC, attach the actionable balance hint (S9).
    const reason = describeChainError(error);
    const live = await edge.chain.reader.readUsdcBalance(ctx.userAddress).catch(() => undefined);
    const hint =
      live !== undefined && live < deposit
        ? ` — insufficient USDC: need ${fmtUsdc(deposit)}, have ${fmtUsdc(live)}; run \`livestreak faucet --token usdc --amount N\``
        : "";
    throw new Error(`vault create failed: ${reason}${hint}`);
  }

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
