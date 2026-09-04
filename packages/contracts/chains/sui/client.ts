import { bcs } from "@mysten/sui/bcs";
import { SuiJsonRpcClient, type SuiTransactionBlockResponse } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MODULES, target } from "./package.js";
import { SIDE_NO, SIDE_YES, SUI_CLOCK_OBJECT_ID, USDC_ONE, type SuiDeployment } from "./types.js";
import { bytesArg, u64Arg } from "./deploy/utils.js";

export type BoardView = {
  pool: bigint;
  sideRate: bigint;
  g: bigint;
  lastAdvance: bigint;
};

export type VaultResolutionView = {
  vaultExists: boolean;
  status: number;
  outcome: number;
  resolvedAt: bigint;
  pot: bigint;
  streamStatus: number;
  streamEndedAt: bigint;
  hotActive: boolean;
  disputeActive: boolean;
};

export class LiveStreakSuiClient {
  readonly coinType: string;

  constructor(
    readonly deployment: SuiDeployment,
    readonly client: SuiJsonRpcClient,
    readonly signer: Ed25519Keypair,
  ) {
    this.coinType = `${deployment.packageId}::mock_usdc::MOCK_USDC`;
  }

  get packageId(): string {
    return this.deployment.packageId;
  }

  get objects() {
    return this.deployment.objects;
  }

  get address(): string {
    return this.signer.getPublicKey().toSuiAddress();
  }

  async execute(tx: Transaction): Promise<SuiTransactionBlockResponse> {
    tx.setGasBudgetIfNotSet(100_000_000);
    const result = await this.client.signAndExecuteTransaction({
      signer: this.signer,
      transaction: tx,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== "success") {
      throw new Error(`Transaction failed: ${result.effects?.status?.error ?? "unknown"}`);
    }
    await this.client.waitForTransaction({ digest: result.digest });
    return result;
  }

  async inspect(tx: Transaction, sender = this.address) {
    return this.client.devInspectTransactionBlock({
      sender,
      transactionBlock: tx,
    });
  }

  async mintUsdc(recipient: string, amount: bigint): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.mockUsdc, "mint_to"),
      arguments: [tx.object(this.objects.usdcMintCap), u64Arg(tx, amount), tx.pure.address(recipient)],
    });
    await this.execute(tx);
  }

  async registerMarket(title: string, streamId: Uint8Array): Promise<Uint8Array> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.marketRegistry, "register_market"),
      arguments: [
        tx.object(this.objects.marketRegistry),
        bytesArg(tx, new TextEncoder().encode(title)),
        bytesArg(tx, streamId),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    const result = await this.execute(tx);
    const ev = result.events?.find((e) => e.type.includes("MarketRegistered"));
    if (!ev?.parsedJson || typeof ev.parsedJson !== "object") {
      throw new Error("MarketRegistered event missing");
    }
    const marketId = (ev.parsedJson as { market_id: number[] }).market_id;
    return Uint8Array.from(marketId);
  }

  async createVault(
    marketId: Uint8Array,
    question: string,
    seedSide: number,
    rate: bigint,
    deposit: bigint,
  ): Promise<Uint8Array> {
    const tx = new Transaction();
    const [payment] = tx.moveCall({
      target: target(this.packageId, MODULES.mockUsdc, "mint"),
      arguments: [tx.object(this.objects.usdcMintCap), u64Arg(tx, deposit)],
    });
    tx.moveCall({
      target: target(this.packageId, MODULES.vaultDriver, "create_vault"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.vaultDriverRegistry),
        tx.object(this.objects.vaultRegistry),
        tx.object(this.objects.marketRegistry),
        tx.object(this.objects.dripsRegistry),
        tx.object(this.objects.streamsRegistry),
        bytesArg(tx, marketId),
        bytesArg(tx, new TextEncoder().encode(question)),
        tx.pure.u8(seedSide),
        tx.pure.u256(rate),
        tx.pure.u128(deposit),
        payment,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    const result = await this.execute(tx);
    const ev = result.events?.find((e) => e.type.endsWith("::vault_driver::VaultCreated"));
    if (!ev?.parsedJson || typeof ev.parsedJson !== "object") {
      throw new Error("VaultCreated event missing");
    }
    return Uint8Array.from((ev.parsedJson as { vault_id: number[] }).vault_id);
  }

  async mintNft(marketId: Uint8Array, to: string): Promise<{ tokenId: bigint; objectId: string }> {
    const tx = new Transaction();
    const metadataType = `${this.packageId}::driver_utils::AccountMetadata` as const;
    tx.moveCall({
      target: target(this.packageId, MODULES.marketDriver, "mint"),
      arguments: [
        tx.object(this.objects.marketDriverRegistry),
        tx.object(this.objects.marketRegistry),
        bytesArg(tx, marketId),
        tx.pure.address(to),
        tx.makeMoveVec({ type: metadataType, elements: [] }),
      ],
    });
    const result = await this.execute(tx);
    const ev = result.events?.find((e) => e.type.includes("MarketNftMinted"));
    if (!ev?.parsedJson || typeof ev.parsedJson !== "object") {
      throw new Error("MarketNftMinted event missing");
    }
    const tokenId = BigInt((ev.parsedJson as { token_id: string }).token_id);
    const nftType = `${this.packageId}::market_driver::MarketPositionNFT`;
    const owned = await this.client.getOwnedObjects({
      owner: to,
      filter: { StructType: nftType },
      options: { showContent: true },
    });
    const match = owned.data.find(
      (o) =>
        o.data?.content?.dataType === "moveObject" &&
        (o.data.content.fields as { token_id: string }).token_id === tokenId.toString(),
    );
    if (!match?.data?.objectId) throw new Error("Minted NFT object not found");
    return { tokenId, objectId: match.data.objectId };
  }

  async fundLane(
    nftObjectId: string,
    vaultId: Uint8Array,
    side: number,
    rate: bigint,
    deposit: bigint,
  ): Promise<void> {
    const tx = new Transaction();
    const [payment] = tx.moveCall({
      target: target(this.packageId, MODULES.mockUsdc, "mint"),
      arguments: [tx.object(this.objects.usdcMintCap), u64Arg(tx, deposit)],
    });
    tx.moveCall({
      target: target(this.packageId, MODULES.marketDriver, "fund"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.marketDriverRegistry),
        tx.object(nftObjectId),
        tx.object(this.objects.vaultDriverRegistry),
        tx.object(this.objects.vaultRegistry),
        tx.object(this.objects.dripsRegistry),
        tx.object(this.objects.streamsRegistry),
        bytesArg(tx, vaultId),
        tx.pure.u8(side),
        tx.pure.u256(rate),
        tx.pure.u128(deposit),
        payment,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await this.execute(tx);
  }

  async advance(vaultId: Uint8Array, side: number, maxSteps: number): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.vault, "advance"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.vaultRegistry),
        bytesArg(tx, vaultId),
        tx.pure.u8(side),
        u64Arg(tx, maxSteps),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await this.execute(tx);
  }

  async caughtUp(vaultId: Uint8Array, side: number): Promise<boolean> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.vault, "caught_up"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.vaultRegistry),
        bytesArg(tx, vaultId),
        tx.pure.u8(side),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    const result = await this.inspect(tx);
    const ret = result.results?.[0]?.returnValues?.[0];
    if (!ret) return false;
    return bcs.bool().parse(Uint8Array.from(ret[0]));
  }

  async getBoard(vaultId: Uint8Array, side: number): Promise<BoardView> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.vault, "get_board"),
      typeArguments: [this.coinType],
      arguments: [tx.object(this.objects.vaultRegistry), bytesArg(tx, vaultId), tx.pure.u8(side)],
    });
    const result = await this.inspect(tx);
    const values = result.results?.[0]?.returnValues;
    if (!values || values.length < 4) {
      return { pool: 0n, sideRate: 0n, g: 0n, lastAdvance: 0n };
    }
    const readU256 = (i: number) => BigInt(bcs.u256().parse(Uint8Array.from(values[i]![0])));
    const readU64 = (i: number) => BigInt(bcs.u64().parse(Uint8Array.from(values[i]![0])));
    return {
      pool: readU256(0),
      sideRate: readU256(1),
      g: readU256(2),
      lastAdvance: readU64(3),
    };
  }

  async advanceUntilCaughtUp(vaultId: Uint8Array, side: number, chunk = 64, guard = 40): Promise<number> {
    let calls = 0;
    while (!(await this.caughtUp(vaultId, side))) {
      await this.advance(vaultId, side, chunk);
      calls++;
      if (calls > guard) throw new Error(`advanceUntilCaughtUp exceeded guard (side=${side})`);
    }
    return calls;
  }

  async resolveVault(vaultId: Uint8Array, outcome: number): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.stewardRegistry, "resolve_vault"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.stewardRegistry),
        tx.object(this.objects.vaultRegistry),
        bytesArg(tx, vaultId),
        tx.pure.u8(outcome),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await this.execute(tx);
  }

  async harvest(vaultId: Uint8Array, side: number): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.vaultDriver, "harvest"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.vaultDriverRegistry),
        tx.object(this.objects.vaultRegistry),
        tx.object(this.objects.dripsRegistry),
        tx.object(this.objects.streamsRegistry),
        bytesArg(tx, vaultId),
        tx.pure.u8(side),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await this.execute(tx);
  }

  async collectVault(vaultId: Uint8Array): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.vaultDriver, "collect_vault"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.vaultDriverRegistry),
        tx.object(this.objects.vaultRegistry),
        tx.object(this.objects.dripsRegistry),
        tx.object(this.objects.streamsRegistry),
        tx.object(this.objects.treasuryRegistry),
        bytesArg(tx, vaultId),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    await this.execute(tx);
  }

  async registerSteward(steward: string): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.stewardRegistry, "register_steward"),
      arguments: [tx.object(this.objects.stewardRegistry), tx.pure.address(steward)],
    });
    await this.execute(tx);
  }

  async setDefaultSteward(steward: string): Promise<void> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.stewardRegistry, "set_default_steward"),
      arguments: [tx.object(this.objects.stewardRegistry), tx.pure.address(steward)],
    });
    await this.execute(tx);
  }

  async viewVault(marketId: Uint8Array, vaultId: Uint8Array): Promise<VaultResolutionView> {
    const tx = new Transaction();
    tx.moveCall({
      target: target(this.packageId, MODULES.resolutionReads, "view_vault"),
      typeArguments: [this.coinType],
      arguments: [
        tx.object(this.objects.marketRegistry),
        tx.object(this.objects.stewardRegistry),
        tx.object(this.objects.vaultRegistry),
        bytesArg(tx, marketId),
        bytesArg(tx, vaultId),
      ],
    });
    const result = await this.inspect(tx);
    const values = result.results?.[0]?.returnValues;
    if (!values || values.length < 1) {
      throw new Error("view_vault returned no data");
    }
    const structBytes = Uint8Array.from(values[0]![0]);
    const view = bcs
      .struct("VaultResolutionView", {
        vault_exists: bcs.bool(),
        status: bcs.u8(),
        outcome: bcs.u8(),
        resolved_at: bcs.u64(),
        pot: bcs.u256(),
        stream_status: bcs.u8(),
        stream_ended_at: bcs.u64(),
        hot_active: bcs.bool(),
        dispute_active: bcs.bool(),
      })
      .parse(structBytes);
    return {
      vaultExists: view.vault_exists,
      status: view.status,
      outcome: view.outcome,
      resolvedAt: BigInt(view.resolved_at),
      pot: BigInt(view.pot),
      streamStatus: view.stream_status,
      streamEndedAt: BigInt(view.stream_ended_at),
      hotActive: view.hot_active,
      disputeActive: view.dispute_active,
    };
  }

  async coinBalance(owner: string): Promise<bigint> {
    const res = await this.client.getBalance({ owner, coinType: this.coinType });
    return BigInt(res.totalBalance);
  }
}

export { SIDE_YES, SIDE_NO, USDC_ONE };
