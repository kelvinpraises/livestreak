import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  asMarketId,
  asUserAddress,
  type ApproveNftInput,
  type SetApprovalForAllInput,
  type TransferNftInput
} from "@livestreak/options";
import { resolveOperatorContext } from "../gateway/operator.js";
import { createOptionsEdge } from "../adapters/options.js";
import { defaultInitDocPath, saveInitDoc } from "../prefs/init-doc.js";
import {
  configOpt,
  parseApprovedFlag,
  parseMarketIdArg,
  parseTokenId,
  passwordOpt,
  readCommandConfig
} from "./args.js";
import { renderNftMintResult, renderTxResult } from "../render/output.js";

const MAX_UINT64 = (1n << 64n) - 1n;

// Parse the --salt flag (decimal or 0x-hex) into a uint64 bigint for MarketDriver.mintWithSalt.
export const parseUint64Salt = (value: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("salt must be a non-negative integer (decimal or 0x-hex)");
  }
  if (parsed < 0n || parsed > MAX_UINT64) {
    throw new Error("salt must fit uint64 (0 .. 2^64-1)");
  }
  return parsed;
};

export const runNftMint = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly market: string;
  readonly salt?: string;
  readonly to?: string;
}): Promise<string> => {
  const configPath = input.configPath ?? defaultInitDocPath;
  const ctx = await resolveOperatorContext({ ...input, configPath });
  const marketId = parseMarketIdArg(input.market);

  // All mints (plain + deterministic-salt) route through the options bridge, which returns
  // {txId, tokenId}. Salt is a uint64 (the options mintWithSalt salt type was reconciled in wave 5).
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });
  const to = asUserAddress(input.to ?? ctx.userAddress);
  const result =
    input.salt !== undefined
      ? await edge.mintWithSalt({ marketId: asMarketId(marketId), salt: parseUint64Salt(input.salt), to })
      : await edge.mint({ marketId: asMarketId(marketId), to });
  const tokenId = result.tokenId;
  const tx = result.txId;

  await saveInitDoc(configPath, {
    ...ctx.doc,
    run: {
      runId: ctx.doc.run?.runId ?? `mint-${Date.now()}`,
      ...(ctx.doc.run?.streamId === undefined ? {} : { streamId: ctx.doc.run.streamId }),
      marketId,
      tokenId,
      ...(ctx.doc.run?.status === undefined ? {} : { status: ctx.doc.run.status })
    }
  });

  return renderNftMintResult({ tokenId, tx, marketId });
};

export const runNftTransfer = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token: string;
  readonly from: string;
  readonly to: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: TransferNftInput = {
    tokenId: parseTokenId(input.token),
    from: asUserAddress(input.from),
    to: asUserAddress(input.to)
  };

  const tx = await edge.callAction("transferNft", args);
  return renderTxResult("nft transfer", { tx });
};

export const runNftApprove = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token: string;
  readonly operator: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: ApproveNftInput = {
    tokenId: parseTokenId(input.token),
    operator: asUserAddress(input.operator)
  };

  const tx = await edge.callAction("approveNft", args);
  return renderTxResult("nft approve", { tx });
};

export const runNftApproveAll = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly operator: string;
  readonly approved: boolean;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: SetApprovalForAllInput = {
    operator: asUserAddress(input.operator),
    approved: parseApprovedFlag(input.approved)
  };

  const tx = await edge.callAction("setApprovalForAll", args);
  return renderTxResult("nft approve-all", { tx });
};

const nftMintCommand = Command.make(
  "mint",
  {
    market: Options.text("market"),
    salt: Options.text("salt").pipe(Options.optional),
    to: Options.text("to").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ market, salt, to, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runNftMint({
          market,
          ...(Option.isSome(salt) ? { salt: salt.value } : {}),
          ...(Option.isSome(to) ? { to: to.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const nftTransferCommand = Command.make(
  "transfer",
  {
    token: Options.text("token"),
    from: Options.text("from"),
    to: Options.text("to"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, from, to, config, password }) =>
    Effect.tryPromise({
      try: () => runNftTransfer({ token, from, to, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const nftApproveCommand = Command.make(
  "approve",
  {
    token: Options.text("token"),
    operator: Options.text("operator"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, operator, config, password }) =>
    Effect.tryPromise({
      try: () => runNftApprove({ token, operator, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const nftApproveAllCommand = Command.make(
  "approve-all",
  {
    operator: Options.text("operator"),
    approved: Options.boolean("approved"),
    config: configOpt,
    password: passwordOpt
  },
  ({ operator, approved, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runNftApproveAll({ operator, approved, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const nftCommand = Command.make("nft", {}).pipe(
  Command.withSubcommands([
    nftMintCommand,
    nftTransferCommand,
    nftApproveCommand,
    nftApproveAllCommand
  ])
);

export const nftCommands = [nftCommand];
