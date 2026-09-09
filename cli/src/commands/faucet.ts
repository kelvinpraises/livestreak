import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { asMarketId } from "@livestreak/options";
import { resolveOperatorContext } from "../gateway/operator.js";
import { createOptionsEdge } from "../adapters/options.js";
import { isLocalRpc, mintMockUsdc, usdcToAtomic, USDC_DECIMALS } from "../adapters/faucet.js";
import { configOpt, passwordOpt, readCommandConfig } from "./args.js";

// `livestreak faucet --token usdc --amount N` — mint N whole test-USDC to the operator AA wallet on a
// LOCAL stack, so a first-run operator can `vault create` without hand-rolling `cast` mints (S9).
const DEFAULT_FAUCET_USDC = 1000n;

export const runFaucet = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token: string;
  readonly amount?: string;
}): Promise<string> => {
  const token = input.token.trim().toLowerCase();
  if (token !== "usdc") {
    throw new Error(`unsupported faucet token "${input.token}" (only "usdc" is supported)`);
  }

  const ctx = await resolveOperatorContext(input);
  if (!isLocalRpc(ctx.doc.chain.rpc)) {
    throw new Error(
      `faucet is local-only: chain.rpc ${ctx.doc.chain.rpc} is not a local dev RPC. ` +
        "Mint test USDC only against localhost/127.0.0.1."
    );
  }

  const whole = input.amount === undefined ? DEFAULT_FAUCET_USDC : BigInt(input.amount);
  if (whole <= 0n) {
    throw new Error("amount must be a positive whole number of USDC");
  }
  const atomic = usdcToAtomic(whole);

  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    marketId: ctx.doc.run?.marketId === undefined ? undefined : asMarketId(ctx.doc.run.marketId)
  });
  const usdc = await edge.chain.reader.readUsdcAddress();
  const before = await edge.chain.reader.readUsdcBalance(ctx.userAddress);

  const tx = await mintMockUsdc({
    account: ctx.account,
    usdc,
    to: ctx.userAddress as `0x${string}`,
    amount: atomic
  });

  const after = await edge.chain.reader.readUsdcBalance(ctx.userAddress);
  const fmt = (raw: bigint): string => (Number(raw) / 10 ** USDC_DECIMALS).toString();

  return [
    "livestreak faucet — minted test USDC",
    "",
    `token:   usdc (${usdc})`,
    `to:      ${ctx.userAddress}`,
    `minted:  ${whole} USDC`,
    `balance: ${fmt(before)} → ${fmt(after)} USDC`,
    `tx:      ${tx}`
  ].join("\n");
};

const tokenOpt = Options.text("token").pipe(
  Options.withDescription("Token to mint (only 'usdc' supported)"),
  Options.withDefault("usdc")
);
const amountOpt = Options.text("amount").pipe(
  Options.withDescription("Whole USDC to mint (default 1000)"),
  Options.optional
);

export const faucetCommand = Command.make(
  "faucet",
  { token: tokenOpt, amount: amountOpt, config: configOpt, password: passwordOpt },
  ({ token, amount, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runFaucet({
          token,
          ...(Option.isSome(amount) ? { amount: amount.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const faucetCommands = [faucetCommand];
