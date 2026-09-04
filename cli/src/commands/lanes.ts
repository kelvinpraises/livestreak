import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  asUserAddress,
  asTokenId,
  validateOptionsVaultSide,
  type SetLanesInput,
  type StopAllFundingInput,
  type StopFundingInput,
  type WithdrawManyInput
} from "@livestreak/options";
import { ensureErc20Approval } from "../chains/evm-tx.js";
import { resolveOperatorContext } from "./context.js";
import { createOptionsEdge, buildCallActionEnvelope } from "../edges/options.js";
import {
  configOpt,
  parseLaneSpecs,
  parseNonNegativeBigIntArg,
  parseTokenId,
  parseVaultId,
  parseVaultIdList,
  passwordOpt,
  readCommandConfig,
  resolveTokenArg,
  tokenOpt
} from "./cli-args.js";
import { renderTxResult } from "../render/output.js";

const laneOpt = Options.text("lane").pipe(
  Options.repeated,
  Options.withDescription(
    "Repeatable vaultId:side:rate (hedge / multi-lane; max 10 lanes per NFT — use another token for >10)"
  )
);

const addDepositOpt = Options.text("add-deposit").pipe(Options.optional);

export const runSetLanes = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly lanes: readonly string[];
  readonly addDeposit?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const token = resolveTokenArg(input.token, ctx.doc.run?.tokenId);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const lanes = parseLaneSpecs(input.lanes);
  const addDeposit =
    input.addDeposit === undefined ? 0n : parseNonNegativeBigIntArg(input.addDeposit, "add-deposit");

  let approveTx: string | undefined;
  if (addDeposit > 0n) {
    const usdc = await edge.chain.reader.readUsdcAddress();
    approveTx = await ensureErc20Approval(
      ctx.account,
      ctx.publicClient,
      usdc,
      ctx.doc.options.marketDriver,
      addDeposit
    );
  }

  const args: SetLanesInput = {
    tokenId: parseTokenId(token),
    lanes,
    addDeposit
  };

  const tx = await edge.callAction("setLanes", args);
  return renderTxResult("set-lanes", { ...(approveTx === undefined ? {} : { approveTx }), tx });
};

export const runStopFunding = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vault: string;
  readonly side: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const token = resolveTokenArg(input.token, ctx.doc.run?.tokenId);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: StopFundingInput = {
    tokenId: parseTokenId(token),
    vaultId: parseVaultId(input.vault),
    side: validateOptionsVaultSide(input.side)
  };

  const tx = await edge.callAction("stopFunding", args);
  return renderTxResult("stop-funding", { tx });
};

export const runStopAllFunding = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const token = resolveTokenArg(input.token, ctx.doc.run?.tokenId);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: StopAllFundingInput = {
    tokenId: parseTokenId(token)
  };

  const tx = await edge.callAction("stopAllFunding", args);
  return renderTxResult("stop-all", { tx });
};

export const runWithdrawMany = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vaults: string;
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

  const args: WithdrawManyInput = {
    tokenId: parseTokenId(token),
    vaultIds: parseVaultIdList(input.vaults),
    to: asUserAddress(input.to ?? ctx.userAddress)
  };

  const tx = await edge.callAction("withdrawMany", args);
  return renderTxResult("withdraw-many", { tx });
};

export const buildSetLanesEnvelope = (
  tokenId: bigint,
  lanes: readonly string[],
  addDeposit: bigint
) =>
  buildCallActionEnvelope("setLanes", {
    tokenId: asTokenId(tokenId),
    lanes: parseLaneSpecs(lanes),
    addDeposit
  } satisfies SetLanesInput);

export const buildStopFundingEnvelope = (
  tokenId: bigint,
  vaultId: string,
  side: string
) =>
  buildCallActionEnvelope("stopFunding", {
    tokenId: asTokenId(tokenId),
    vaultId: parseVaultId(vaultId),
    side: validateOptionsVaultSide(side)
  });

export const buildWithdrawManyEnvelope = (
  tokenId: bigint,
  vaultIds: readonly string[],
  to: string
) =>
  buildCallActionEnvelope("withdrawMany", {
    tokenId: asTokenId(tokenId),
    vaultIds: vaultIds.map((vaultId) => parseVaultId(vaultId)),
    to: asUserAddress(to)
  });

export const setLanesCommand = Command.make(
  "set-lanes",
  {
    token: tokenOpt,
    lane: laneOpt,
    addDeposit: addDepositOpt,
    config: configOpt,
    password: passwordOpt
  },
  ({ token, lane, addDeposit, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runSetLanes({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          lanes: lane,
          ...(Option.isSome(addDeposit) ? { addDeposit: addDeposit.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const stopFundingCommand = Command.make(
  "stop-funding",
  {
    token: tokenOpt,
    vault: Options.text("vault"),
    side: Options.text("side"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vault, side, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runStopFunding({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vault,
          side,
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const stopAllCommand = Command.make(
  "stop-all",
  {
    token: tokenOpt,
    config: configOpt,
    password: passwordOpt
  },
  ({ token, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runStopAllFunding({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const withdrawManyCommand = Command.make(
  "withdraw-many",
  {
    token: tokenOpt,
    vaults: Options.text("vaults"),
    to: Options.text("to").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vaults, to, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runWithdrawMany({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vaults,
          ...(Option.isSome(to) ? { to: to.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const laneCommands = [
  setLanesCommand,
  stopFundingCommand,
  stopAllCommand,
  withdrawManyCommand
];
