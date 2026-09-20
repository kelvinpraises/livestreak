// The ProtocolState blob reader: the on-chain engine compiled to WASM, so client reads
// are byte-exact with chain semantics by construction (no TS re-implementation to drift).
// One account fetch -> every view, locally. Wire: amounts cross as decimal strings and
// convert to bigint here; ids are 0x-hex 32-byte strings.
import { PROTOCOL_HEADER_LEN } from "./seeds.js";

type WasmModule = typeof import("./wasm/livestreak_wasm.js");
type WasmProtocolView = import("./wasm/livestreak_wasm.js").ProtocolView;

let wasmModule: Promise<WasmModule> | undefined;

async function loadWasm(): Promise<WasmModule> {
  if (!wasmModule) {
    wasmModule = (async () => {
      const mod = await import("./wasm/livestreak_wasm.js");
      if (typeof window === "undefined" && typeof process !== "undefined") {
        // Node: feed the bytes ourselves (no fetch for file URLs).
        const { readFile } = await import("node:fs/promises");
        const { fileURLToPath } = await import("node:url");
        const wasmPath = fileURLToPath(new URL("./wasm/livestreak_wasm_bg.wasm", import.meta.url));
        mod.initSync({ module: await readFile(wasmPath) });
      } else {
        await mod.default(new URL("./wasm/livestreak_wasm_bg.wasm", import.meta.url));
      }
      return mod;
    })();
  }
  return wasmModule;
}

export interface EngineBoard {
  pool: bigint;
  sideRate: bigint;
  g: bigint;
  lastAdvance: number;
  sideShares: bigint;
}

export interface EngineVault {
  id: `0x${string}`;
  marketId: `0x${string}`;
  question: string;
  creator: `0x${string}`;
  status: number;
  outcome: number;
  resolvedAt: number;
  exists: boolean;
}

export interface EnginePosition {
  rate: bigint;
  gPaid: bigint;
  sharesAccrued: bigint;
  maxEnd: number;
  depleted: boolean;
  fundStart: number;
  lostUsdc: bigint;
}

export interface EngineBoundary {
  maxEnd: number;
  rate: bigint;
}

export interface EngineSummary {
  vaultCount: number;
  dripsHeld: bigint;
  vaultHeld: bigint;
  treasuryHeld: bigint;
  escrowExpected: bigint;
  totalStaked: bigint;
}

/** Typed view over one decoded ProtocolState blob. Create via {@link decodeProtocolState}. */
export class EngineView {
  constructor(private readonly view: WasmProtocolView) {}

  listVaultIds(): `0x${string}`[] {
    return JSON.parse(this.view.list_vault_ids());
  }

  marketVaults(marketId: string): `0x${string}`[] {
    return JSON.parse(this.view.market_vaults(marketId));
  }

  vault(vaultId: string): EngineVault {
    return JSON.parse(this.view.vault(vaultId));
  }

  board(vaultId: string, side: number): EngineBoard {
    const raw = JSON.parse(this.view.board(vaultId, side));
    return {
      pool: BigInt(raw.pool),
      sideRate: BigInt(raw.sideRate),
      g: BigInt(raw.g),
      lastAdvance: raw.lastAdvance,
      sideShares: BigInt(raw.sideShares),
    };
  }

  vaultPools(vaultId: string): { yesPool: bigint; noPool: bigint; yesShares: bigint; noShares: bigint } {
    const raw = JSON.parse(this.view.vault_pools(vaultId));
    return {
      yesPool: BigInt(raw.yesPool),
      noPool: BigInt(raw.noPool),
      yesShares: BigInt(raw.yesShares),
      noShares: BigInt(raw.noShares),
    };
  }

  sharePrice(vaultId: string, side: number): bigint {
    return BigInt(this.view.share_price(vaultId, side));
  }

  pot(vaultId: string): bigint {
    return BigInt(this.view.pot(vaultId));
  }

  collected(vaultId: string): boolean {
    return this.view.collected(vaultId);
  }

  boundaries(vaultId: string, side: number): EngineBoundary[] {
    const raw: { maxEnd: number; rate: string }[] = JSON.parse(this.view.boundaries(vaultId, side));
    return raw.map((b) => ({ maxEnd: b.maxEnd, rate: BigInt(b.rate) }));
  }

  pendingBoundaries(vaultId: string, side: number): bigint {
    return this.view.pending_boundaries(vaultId, side);
  }

  pendingShares(vaultId: string, side: number, tokenId: string, nowSecs: number): bigint {
    return BigInt(this.view.pending_shares(vaultId, side, tokenId, BigInt(nowSecs)));
  }

  claimable(tokenId: string, vaultId: string, side: number): bigint {
    return BigInt(this.view.claimable(tokenId, vaultId, side));
  }

  lossClaimable(tokenId: string, vaultId: string, side: number): bigint {
    return BigInt(this.view.loss_claimable(tokenId, vaultId, side));
  }

  accountVaultIds(tokenId: string): `0x${string}`[] {
    return JSON.parse(this.view.account_vault_ids(tokenId));
  }

  position(vaultId: string, side: number, tokenId: string): EnginePosition {
    const raw = JSON.parse(this.view.position(vaultId, side, tokenId));
    return {
      rate: BigInt(raw.rate),
      gPaid: BigInt(raw.gPaid),
      sharesAccrued: BigInt(raw.sharesAccrued),
      maxEnd: raw.maxEnd,
      depleted: raw.depleted,
      fundStart: raw.fundStart,
      lostUsdc: BigInt(raw.lostUsdc),
    };
  }

  laneCount(tokenId: string): number {
    return this.view.lane_count(tokenId);
  }

  seedAccount(creator: string, vaultId: string): `0x${string}` {
    return this.view.seed_account(creator, vaultId) as `0x${string}`;
  }

  calcTokenIdWithSalt(minter: string, salt: bigint): `0x${string}` {
    return this.view.calc_token_id_with_salt(minter, salt) as `0x${string}`;
  }

  lvstStaked(user: string): bigint {
    return BigInt(this.view.lvst_staked(user));
  }

  pendingDividends(user: string): bigint {
    return BigInt(this.view.pending_dividends(user));
  }

  mintRate(): bigint {
    return BigInt(this.view.mint_rate());
  }

  summary(): EngineSummary {
    const raw = JSON.parse(this.view.summary());
    return {
      vaultCount: raw.vaultCount,
      dripsHeld: BigInt(raw.dripsHeld),
      vaultHeld: BigInt(raw.vaultHeld),
      treasuryHeld: BigInt(raw.treasuryHeld),
      escrowExpected: BigInt(raw.escrowExpected),
      totalStaked: BigInt(raw.totalStaked),
    };
  }

  free(): void {
    this.view.free();
  }
}

/**
 * Decode a full ProtocolState ACCOUNT (anchor discriminator + header + blob) into views.
 * Pass the raw account data straight from RPC.
 */
export async function decodeProtocolState(accountData: Uint8Array): Promise<EngineView> {
  const mod = await loadWasm();
  const blob = accountData.subarray(PROTOCOL_HEADER_LEN);
  return new EngineView(mod.ProtocolView.decode(blob));
}

/** Decode just the postcard payload (header already stripped) — the litesvm/test shape. */
export async function decodeProtocolBlob(blob: Uint8Array): Promise<EngineView> {
  const mod = await loadWasm();
  return new EngineView(mod.ProtocolView.decode(blob));
}
