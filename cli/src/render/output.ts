import type { OnChainStreamState } from "../adapters/onchain.js";
import type { OptionsBoard } from "@livestreak/options";

export interface VaultCreateRenderInput {
  readonly vaultId: string;
  readonly createTx: string;
  readonly idempotent?: boolean;
}

export interface NftMintRenderInput {
  readonly tokenId: string;
  readonly marketId: string;
  readonly tx: string;
}

export interface ProduceRenderInput {
  readonly title: string;
  readonly marketId: `0x${string}`;
  readonly streamId: `0x${string}`;
  readonly vodUrl: string;
  readonly goLiveTx: string;
  readonly setEndedTx: string;
  readonly streamState: OnChainStreamState;
  readonly mp4Path: string;
  readonly idempotent?: boolean;
}

export const formatMarketId = (marketId: string): string => marketId;

export const formatStreamState = (state: OnChainStreamState): string =>
  JSON.stringify(
    {
      status: state.status,
      scheme: state.scheme,
      id: state.id,
      updatedAt: state.updatedAt.toString(),
      endedAt: state.endedAt.toString()
    },
    null,
    2
  );

export const renderProduceResult = (input: ProduceRenderInput): string => {
  const lines = [
    input.idempotent === true
      ? "livestreak produce — market already exists for this operator (idempotent no-op)"
      : "livestreak produce — complete",
    ...(input.idempotent === true
      ? [
          "",
          "note: produce is idempotent per operator — one operator identity owns exactly one",
          "      market (the marketId is deterministic). To add a fresh bettable surface, create",
          "      a vault on this market instead: livestreak vault create --market <marketId> ..."
        ]
      : []),
    "",
    `title:      ${input.title}`,
    `marketId:   ${formatMarketId(input.marketId)}`,
    `streamId:   ${input.streamId}`,
    `mp4:        ${input.mp4Path}`,
    `vodUrl:     ${input.vodUrl}`,
    `goLiveTx:   ${input.goLiveTx}`,
    `setEndedTx: ${input.setEndedTx}`,
    "",
    "streamState:",
    formatStreamState(input.streamState)
  ];

  return lines.join("\n");
};

export const renderHostHealth = (input: {
  readonly baseUrl: string;
  readonly healthy: boolean;
  readonly walrusNetwork: string | null;
}): string =>
  [
    "livestreak host",
    "",
    `url:     ${input.baseUrl}`,
    `health:  ${input.healthy ? "ok" : "degraded"}`,
    `walrus:  ${input.walrusNetwork ?? "not configured"}`
  ].join("\n");

export const renderOptionsBoard = (board: OptionsBoard): string => {
  const { panel } = board;
  const lines = [
    "livestreak vaults",
    "",
    `revision: ${board.revision}`,
    `account:  ${panel.account}`,
    ""
  ];

  for (const market of panel.markets) {
    lines.push(`market ${market.marketId} — ${market.title}`);
    for (const vault of market.vaults) {
      lines.push(
        `  vault ${vault.vaultId} [${vault.status}/${vault.outcome}] ${vault.question}`
      );
      lines.push(
        `    pools yes=${vault.pools.yesUSDC} no=${vault.pools.noUSDC}`
      );
    }
    lines.push("");
  }

  if (panel.nfts.length > 0) {
    lines.push("positions:");
    for (const nft of panel.nfts) {
      lines.push(`  token ${nft.tokenId} market=${nft.marketId} lanes=${nft.laneCount}`);
      for (const lane of nft.lanes) {
        lines.push(
          `    ${lane.vaultId} ${lane.side} claimable=${lane.claimableUSDC ?? "0"} loss=${lane.lossClaimableLVST ?? "0"}`
        );
      }
    }
    lines.push("");
  }

  lines.push(
    `LVST balance=${panel.lvst.balanceLVST} staked=${panel.lvst.stakedLVST} dividends=${panel.lvst.pendingDividendsUSDC}`
  );

  return lines.join("\n");
};

export const renderTxResult = (
  action: string,
  txs: Record<string, string | undefined>
): string => {
  const lines = [`livestreak ${action}`, ""];
  for (const [key, value] of Object.entries(txs)) {
    if (value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join("\n");
};

export const renderVaultCreateResult = (result: VaultCreateRenderInput): string => {
  const lines = ["livestreak vault create", "", `vaultId: ${result.vaultId}`];
  lines.push(`createTx: ${result.createTx}`);
  if (result.idempotent === true) {
    lines.push("note: confirmed an already-submitted createVault (idempotent)");
  }
  return lines.join("\n");
};

export const renderNftMintResult = (input: NftMintRenderInput): string =>
  [
    "livestreak nft mint",
    "",
    `tokenId:  ${input.tokenId}`,
    `marketId: ${input.marketId}`,
    `tx:       ${input.tx}`,
    "",
    "run.tokenId saved to livestreak.json"
  ].join("\n");
