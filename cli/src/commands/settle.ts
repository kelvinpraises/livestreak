import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  asTokenId,
  asUserAddress,
  validateOptionsVaultSide,
  type ClaimLossLvstInput,
  type WithdrawInput
} from "@livestreak/options";
import { resolveOperatorContext } from "../gateway/operator.js";
import { buildCallActionEnvelope, createOptionsEdge, type OptionsEdge } from "../adapters/options.js";
import {
  configOpt,
  parseTokenId,
  parseVaultId,
  passwordOpt,
  readCommandConfig,
  tokenOpt
} from "./args.js";
import { renderTxResult } from "../render/output.js";

// S7 — CLI ↔ UI position parity. A position minted in the UI is NOT persisted to
// `livestreak.json.run.tokenId`, so `settle withdraw`/`claim-loss` couldn't settle it without the
// user copying a 78-digit token id between surfaces. When `--token` is omitted (and no run.tokenId
// is cached), discover the caller's position NFT for the vault on-chain by reading the options board
// (scoped to the caller's address + market) and matching the NFT whose lanes include this vault.
export const discoverTokenForVault = async (
  edge: OptionsEdge,
  vaultId: string,
  userAddress: string
): Promise<string> => {
  const target = vaultId.trim().toLowerCase();
  const owner = userAddress.toLowerCase();
  const board = await edge.readBoard();
  const matches = board.panel.nfts.filter(
    (nft) =>
      nft.owner.toLowerCase() === owner &&
      nft.lanes.some((lane) => lane.vaultId.toLowerCase() === target)
  );
  if (matches.length === 1) {
    return matches[0]!.tokenId;
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple position NFTs found for vault ${vaultId} (tokens: ${matches
        .map((m) => m.tokenId)
        .join(", ")}); pass --token to choose one`
    );
  }
  throw new Error(
    `no position NFT found on-chain for vault ${vaultId} owned by ${userAddress}. ` +
      "Pass --token <positionNFT>, or place a position on this vault first."
  );
};

// Prefer explicit --token, then the cached run.tokenId, then on-chain discovery.
const resolveSettleToken = async (
  edge: OptionsEdge,
  input: { readonly token?: string; readonly vault: string; readonly runTokenId?: string; readonly userAddress: string }
): Promise<string> => {
  if (input.token !== undefined && input.token.trim().length > 0) {
    return input.token.trim();
  }
  if (input.runTokenId !== undefined && input.runTokenId.trim().length > 0) {
    return input.runTokenId.trim();
  }
  return discoverTokenForVault(edge, input.vault, input.userAddress);
};

// Post-resolution settlement, the last leg of the keynote loop. Both paths reuse the options
// bridge (no re-encoded chain writes): `withdraw` pulls a winning position's payout, `claim-loss`
// mints loss LVST (`claimLossLvst`) for a losing position. Token defaults to the persisted
// run.tokenId, mirroring the lane commands.

export const runWithdraw = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vault: string;
  readonly to?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });
  const token = await resolveSettleToken(edge, {
    ...(input.token === undefined ? {} : { token: input.token }),
    vault: input.vault,
    ...(ctx.doc.run?.tokenId === undefined ? {} : { runTokenId: ctx.doc.run.tokenId }),
    userAddress: ctx.userAddress
  });

  const args: WithdrawInput = {
    tokenId: parseTokenId(token),
    vaultId: parseVaultId(input.vault),
    to: asUserAddress(input.to ?? ctx.userAddress)
  };

  const tx = await edge.callAction("withdraw", args);
  return renderTxResult("settle withdraw", { tx });
};

export const runClaimLoss = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token?: string;
  readonly vault: string;
  readonly side: string;
  readonly to?: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });
  const token = await resolveSettleToken(edge, {
    ...(input.token === undefined ? {} : { token: input.token }),
    vault: input.vault,
    ...(ctx.doc.run?.tokenId === undefined ? {} : { runTokenId: ctx.doc.run.tokenId }),
    userAddress: ctx.userAddress
  });

  const args: ClaimLossLvstInput = {
    tokenId: parseTokenId(token),
    vaultId: parseVaultId(input.vault),
    side: validateOptionsVaultSide(input.side),
    to: asUserAddress(input.to ?? ctx.userAddress)
  };

  const tx = await edge.callAction("claimLossLvst", args);
  return renderTxResult("settle claim-loss", { tx });
};

export const buildWithdrawEnvelope = (tokenId: bigint, vaultId: string, to: string) =>
  buildCallActionEnvelope("withdraw", {
    tokenId: asTokenId(tokenId),
    vaultId: parseVaultId(vaultId),
    to: asUserAddress(to)
  } satisfies WithdrawInput);

export const buildClaimLossEnvelope = (
  tokenId: bigint,
  vaultId: string,
  side: string,
  to: string
) =>
  buildCallActionEnvelope("claimLossLvst", {
    tokenId: asTokenId(tokenId),
    vaultId: parseVaultId(vaultId),
    side: validateOptionsVaultSide(side),
    to: asUserAddress(to)
  } satisfies ClaimLossLvstInput);

const withdrawCommand = Command.make(
  "withdraw",
  {
    token: tokenOpt,
    vault: Options.text("vault"),
    to: Options.text("to").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vault, to, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runWithdraw({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vault,
          ...(Option.isSome(to) ? { to: to.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const claimLossCommand = Command.make(
  "claim-loss",
  {
    token: tokenOpt,
    vault: Options.text("vault"),
    side: Options.text("side"),
    to: Options.text("to").pipe(Options.optional),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, vault, side, to, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runClaimLoss({
          ...(Option.isSome(token) ? { token: token.value } : {}),
          vault,
          side,
          ...(Option.isSome(to) ? { to: to.value } : {}),
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const settleCommand = Command.make("settle", {}).pipe(
  Command.withSubcommands([withdrawCommand, claimLossCommand])
);

export const settleCommands = [settleCommand];
