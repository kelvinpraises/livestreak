/* tslint:disable */
/* eslint-disable */

export class ProtocolView {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    account_vault_ids(token_id: string): string;
    board(vault_id: string, side: number): string;
    /**
     * `[maxEnds, rates]` — the canonical unsettled funder depletion schedule.
     */
    boundaries(vault_id: string, side: number): string;
    calc_token_id_with_salt(minter: string, salt: bigint): string;
    claimable(token_id: string, vault_id: string, side: number): string;
    collected(vault_id: string): boolean;
    /**
     * Decode a ProtocolState `data` payload (the postcard blob, header already stripped).
     */
    static decode(bytes: Uint8Array): ProtocolView;
    lane_count(token_id: string): number;
    /**
     * Every vault id in the registry (hex array JSON).
     */
    list_vault_ids(): string;
    loss_claimable(token_id: string, vault_id: string, side: number): string;
    lvst_staked(user: string): string;
    /**
     * Vault ids belonging to one market (hex array JSON).
     */
    market_vaults(market_id: string): string;
    mint_rate(): string;
    pending_boundaries(vault_id: string, side: number): bigint;
    pending_dividends(user: string): string;
    pending_shares(vault_id: string, side: number, token_id: string, now: bigint): string;
    position(vault_id: string, side: number, token_id: string): string;
    pot(vault_id: string): string;
    /**
     * The deterministic per-(creator, vault) seed account id.
     */
    seed_account(creator: string, vault_id: string): string;
    share_price(vault_id: string, side: number): string;
    /**
     * The three-ledger partition + the conservation sum the escrow must equal.
     */
    summary(): string;
    vault(vault_id: string): string;
    /**
     * (yesPool, noPool, yesShares, noShares) — shares WAD-descaled like the on-chain view.
     */
    vault_pools(vault_id: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_protocolview_free: (a: number, b: number) => void;
    readonly protocolview_account_vault_ids: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_board: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly protocolview_boundaries: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly protocolview_calc_token_id_with_salt: (a: number, b: number, c: number, d: bigint) => [number, number, number, number];
    readonly protocolview_claimable: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly protocolview_collected: (a: number, b: number, c: number) => [number, number, number];
    readonly protocolview_decode: (a: number, b: number) => [number, number, number];
    readonly protocolview_lane_count: (a: number, b: number, c: number) => [number, number, number];
    readonly protocolview_list_vault_ids: (a: number) => [number, number];
    readonly protocolview_loss_claimable: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly protocolview_lvst_staked: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_market_vaults: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_mint_rate: (a: number) => [number, number];
    readonly protocolview_pending_boundaries: (a: number, b: number, c: number, d: number) => [bigint, number, number];
    readonly protocolview_pending_dividends: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_pending_shares: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint) => [number, number, number, number];
    readonly protocolview_position: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly protocolview_pot: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_seed_account: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly protocolview_share_price: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly protocolview_summary: (a: number) => [number, number];
    readonly protocolview_vault: (a: number, b: number, c: number) => [number, number, number, number];
    readonly protocolview_vault_pools: (a: number, b: number, c: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
