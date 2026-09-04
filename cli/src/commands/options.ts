import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  asMarketId,
  asUserAddress,
  asVaultId,
  validateOptionsVaultSide,
  type ClaimLossLvstInput,
  type FundStreamInput,
  type StakeLvstInput,
  type UnstakeLvstInput,
  type WithdrawInput
} from "@livestreak/options";
import { ensureErc20Approval } from "../chains/evm-tx.js";
import { resolveOperatorContext } from "./context.js";
import { createOptionsEdge } from "../edges/options.js";
import { operatorCreateVault } from "../edges/vault.js";
import { routeClaimAction } from "./claim-routing.js";
import {
  configOpt,
  marketOpt,
  parseBigIntArg,
  parseTokenId,
  passwordOpt,
  readCommandConfig,
  resolveTokenArg,
  tokenOpt
} from "./cli-args.js";
import {
  renderOptionsBoard,
  renderTxResult,
  renderVaultCreateResult
} from "../render/output.js";

export const runVaults = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly marketId?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const marketId = input.marketId ?? ctx.doc.run?.marketId;
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    ...(marketId === undefined ? {} : { marketId: asMarketId(marketId) })
  });

  await edge.refresh();
  const board = await edge.readBoard();
  return renderOptionsBoard(board);
};

export const runVaultCreate = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly marketId: string;
  readonly question: string;
  readonly side: string;
  readonly rate: string;
  readonly deposit: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const side = validateOptionsVaultSide(input.side);
  const usdc = await createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    marketId: asMarketId(input.marketId)
  }).chain.reader.readUsdcAddress();

  const result = await operatorCreateVault({
    account: ctx.account,
    publicClient: ctx.publicClient,
    vaultDriverAddress: ctx.doc.options.vaultDriver,
    usdcAddress: usdc,
    marketId: asMarketId(input.marketId),
    question: input.question,
    side,
    rate: parseBigIntArg(input.rate, "rate"),
    deposit: parseBigIntArg(input.deposit, "deposit")
  });

  return renderVaultCreateResult(result);
};

export const runFund = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vault: string;
  readonly side: string;
  readonly rate: string;
  readonly deposit: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const token = resolveTokenArg(input.token, ctx.doc.run?.tokenId);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const fundArgs: FundStreamInput = {
    tokenId: parseTokenId(token),
    vaultId: asVaultId(input.vault),
    side: validateOptionsVaultSide(input.side),
    rate: parseBigIntArg(input.rate, "rate"),
    deposit: parseBigIntArg(input.deposit, "deposit")
  };

  const usdc = await edge.chain.reader.readUsdcAddress();
  const approveTx = await ensureErc20Approval(
    ctx.account,
    ctx.publicClient,
    usdc,
    ctx.doc.options.marketDriver,
    fundArgs.deposit
  );

  const fundTx = await edge.callAction("fund", fundArgs);
  return renderTxResult("fund", { ...(approveTx === undefined ? {} : { approveTx }), fundTx });
};

export const runClaim = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vault: string;
  readonly side: string;
  readonly loss?: boolean;
  readonly to?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const token = resolveTokenArg(input.token, ctx.doc.run?.tokenId);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const side = validateOptionsVaultSide(input.side);
  const to = asUserAddress(input.to ?? ctx.userAddress);

  if (input.loss === true) {
    const args: ClaimLossLvstInput = {
      tokenId: parseTokenId(token),
      vaultId: asVaultId(input.vault),
      side,
      to
    };
    const tx = await edge.callAction(routeClaimAction(true), args);
    return renderTxResult("claimLossLvst", { tx });
  }

  const args: WithdrawInput = {
    tokenId: parseTokenId(token),
    vaultId: asVaultId(input.vault),
    to
  };
  const tx = await edge.callAction(routeClaimAction(false), args);
  return renderTxResult("withdraw", { tx });
};

export const runStake = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly amount: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: StakeLvstInput = { amount: parseBigIntArg(input.amount, "amount") };
  const tx = await edge.callAction("stakeLvst", args);
  return renderTxResult("stakeLvst", { tx });
};

export const runUnstake = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly amount: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: UnstakeLvstInput = { amount: parseBigIntArg(input.amount, "amount") };
  const tx = await edge.callAction("unstakeLvst", args);
  return renderTxResult("unstakeLvst", { tx });
};

export const runDividends = async (input: {
  readonly configPath?: string;
  readonly password?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const tx = await edge.callAction("claimDividends", {});
  return renderTxResult("claimDividends", { tx });
};

export const vaultsCommand = Command.make(
  "vaults",
  { market: marketOpt, config: configOpt, password: passwordOpt },
  ({ market, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runVaults({
          ...readCommandConfig(config, password),
          ...(Option.isSome(market) ? { marketId: market.value } : {})
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const vaultCreateCommand = Command.make(
  "create",
  {
    market: Options.text("market"),
    question: Options.text("question"),
    side: Options.text("side"),
    rate: Options.text("rate"),
    deposit: Options.text("deposit"),
    config: configOpt,
    password: passwordOpt
  },
  ({ market, question, side, rate, deposit, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runVaultCreate({
          marketId: market,
          question,
          side,
          rate,
          deposit,
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const vaultCommand = Command.make("vault", {}).pipe(
  Command.withSubcommands([vaultCreateCommand])
);

export const fundCommand = Command.make(
  "fund",
  {
    token: tokenOpt,
    vault: Options.text("vault"),
    side: Options.text("side"),
    rate: Options.text("rate"),
    deposit: Options.text("deposit"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vault, side, rate, deposit, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runFund({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vault,
          side,
          rate,
          deposit,
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const lossFlag = Options.boolean("loss").pipe(Options.optional);

export const claimCommand = Command.make(
  "claim",
  {
    token: tokenOpt,
    vault: Options.text("vault"),
    side: Options.text("side"),
    loss: lossFlag,
    to: Options.text("to").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vault, side, loss, to, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runClaim({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vault,
          side,
          ...(Option.isSome(loss) && loss.value ? { loss: true } : {}),
          ...(Option.isSome(to) ? { to: to.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const stakeCommand = Command.make(
  "stake",
  {
    amount: Options.text("amount"),
    config: configOpt,
    password: passwordOpt
  },
  ({ amount, config, password }) =>
    Effect.tryPromise({
      try: () => runStake({ amount, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const unstakeCommand = Command.make(
  "unstake",
  {
    amount: Options.text("amount"),
    config: configOpt,
    password: passwordOpt
  },
  ({ amount, config, password }) =>
    Effect.tryPromise({
      try: () => runUnstake({ amount, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const dividendsCommand = Command.make(
  "dividends",
  { config: configOpt, password: passwordOpt },
  ({ config, password }) =>
    Effect.tryPromise({
      try: () => runDividends(readCommandConfig(config, password)),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const optionsCommands = [
  vaultsCommand,
  vaultCommand,
  fundCommand,
  claimCommand,
  stakeCommand,
  unstakeCommand,
  dividendsCommand
];
