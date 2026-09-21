// Typed instruction builders for all 25 livestreak instructions. Discriminators are read
// from the imported IDL const (never hand-typed); args are borsh-encoded per the IDL
// layouts; accounts are resolved from the PDA helpers so callers pass only free variables.
// Every builder returns a @solana/kit Instruction that plugs into buildLivestreakTransaction.
import {
  AccountRole,
  addEncoderSizePrefix,
  fixEncoderSize,
  getAddressEncoder,
  getBytesEncoder,
  getU16Encoder,
  getU32Encoder,
  getU64Encoder,
  getU8Encoder,
  type Address,
  type AccountMeta,
  type Instruction,
  type ReadonlyUint8Array,
} from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { livestreakIdl } from '@livestreak/contracts/solana'

import { bytesFromHex32, computePositionTokenId, type Hex32 } from './ids.js'
import {
  findAta,
  findEscrowPda,
  findLvstAuthorityPda,
  findLvstEscrowPda,
  findMarketIndexPda,
  findMarketPda,
  findPositionPda,
  findMarketStewardPda,
  findProtocolStatePda,
  findRegistryPda,
  findUsdcAta,
} from './pdas.js'

// ── discriminators + codecs ─────────────────────────────────────────────────────

type IxName = (typeof livestreakIdl.instructions)[number]['name']

const DISCRIMINATORS: Record<string, Uint8Array> = Object.fromEntries(
  livestreakIdl.instructions.map((ix) => [ix.name, Uint8Array.from(ix.discriminator)]),
)

/** The 8-byte anchor discriminator for an instruction, straight from the IDL. */
export const instructionDiscriminator = (name: IxName): Uint8Array => DISCRIMINATORS[name]

const u8 = getU8Encoder()
const u16 = getU16Encoder()
const u32 = getU32Encoder()
const u64 = getU64Encoder()
const pubkey = getAddressEncoder()
const id32 = fixEncoderSize(getBytesEncoder(), 32) // [u8; 32] fixed array — raw 32 bytes
const vecBytes = addEncoderSizePrefix(getBytesEncoder(), getU32Encoder()) // Vec<u8> — u32-LE len prefix

const enc = <T>(codec: { encode(value: T): ReadonlyUint8Array }, value: T): Uint8Array =>
  new Uint8Array(codec.encode(value))

function encodeData(name: IxName, ...parts: Uint8Array[]): Uint8Array {
  const chunks = [instructionDiscriminator(name), ...parts]
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

const writableSigner = (address: Address): AccountMeta => ({ address, role: AccountRole.WRITABLE_SIGNER })
const readonlySigner = (address: Address): AccountMeta => ({ address, role: AccountRole.READONLY_SIGNER })
const writable = (address: Address): AccountMeta => ({ address, role: AccountRole.WRITABLE })
const readonly = (address: Address): AccountMeta => ({ address, role: AccountRole.READONLY })

const first = ([address]: readonly [Address, unknown]): Address => address

// ── common builder inputs ────────────────────────────────────────────────────────

interface Base {
  programId: Address
}
interface MarketScoped extends Base {
  marketId: Hex32
}

// ── protocol lifecycle ─────────────────────────────────────────────────────────

export interface InitializeInput extends Base {
  payer: Address
  defaultSteward: Address
  /** The canonical LVST reward-token mint, recorded in the registry for the staking guard. */
  lvstMint: Address
}

/** initialize: create the singleton registry with a default steward + canonical LVST mint. */
export async function buildInitializeIx(input: InitializeInput): Promise<Instruction> {
  const registry = first(await findRegistryPda(input.programId))
  return {
    programAddress: input.programId,
    accounts: [writableSigner(input.payer), writable(registry), readonly(SYSTEM_PROGRAM_ADDRESS)],
    data: encodeData('initialize', enc(pubkey, input.defaultSteward), enc(pubkey, input.lvstMint)),
  }
}

export interface InitProtocolInput extends MarketScoped {
  payer: Address
  usdcMint: Address
  capacity: number
}

/** init_protocol: allocate the per-market engine-state blob + USDC escrow. */
export async function buildInitProtocolIx(input: InitProtocolInput): Promise<Instruction> {
  const [market, protocolState, escrow] = await Promise.all([
    findMarketPda(input.programId, input.marketId).then(first),
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findEscrowPda(input.programId, input.marketId).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.payer),
      readonly(market),
      writable(protocolState),
      readonly(input.usdcMint),
      writable(escrow),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('init_protocol', enc(u16, input.capacity)),
  }
}

export interface GrowProtocolInput extends MarketScoped {
  /** Rent-top-up payer (mut signer); the delta for the larger size moves payer -> protocol_state. */
  payer: Address
}

/** grow_protocol: realloc a market's engine-state blob up one +10_240-byte rung (permissionless). */
export async function buildGrowProtocolIx(input: GrowProtocolInput): Promise<Instruction> {
  const protocolState = first(await findProtocolStatePda(input.programId, input.marketId))
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.payer),
      writable(protocolState),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('grow_protocol'),
  }
}

// ── market registration + stream lifecycle ───────────────────────────────────────

export interface RegisterMarketInput extends Base {
  creator: Address
  title: Uint8Array
  streamId: Uint8Array
  /** registry.market_count at register time — read the Registry account first. */
  marketCount: bigint
  /** the market_id this (creator, streamId) resolves to — from computeMarketId. */
  marketId: Hex32
}

/** register_market: append a market + its enumeration-index entry. */
export async function buildRegisterMarketIx(input: RegisterMarketInput): Promise<Instruction> {
  const [registry, market, marketIndex] = await Promise.all([
    findRegistryPda(input.programId).then(first),
    findMarketPda(input.programId, input.marketId).then(first),
    findMarketIndexPda(input.programId, input.marketCount).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.creator),
      writable(registry),
      writable(market),
      writable(marketIndex),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('register_market', enc(vecBytes, input.title), enc(vecBytes, input.streamId)),
  }
}

export interface StreamPointerInput extends MarketScoped {
  creator: Address
  scheme: number
  pointer: Uint8Array
}

/** go_live: publish the first stream pointer (marks the stream live). */
export async function buildGoLiveIx(input: StreamPointerInput): Promise<Instruction> {
  const market = first(await findMarketPda(input.programId, input.marketId))
  return {
    programAddress: input.programId,
    accounts: [readonlySigner(input.creator), writable(market)],
    data: encodeData('go_live', enc(u8, input.scheme), enc(vecBytes, input.pointer)),
  }
}

/** set_ended: publish the evidence pointer within the grace window (marks ended). */
export async function buildSetEndedIx(input: StreamPointerInput): Promise<Instruction> {
  const market = first(await findMarketPda(input.programId, input.marketId))
  return {
    programAddress: input.programId,
    accounts: [readonlySigner(input.creator), writable(market)],
    data: encodeData('set_ended', enc(u8, input.scheme), enc(vecBytes, input.pointer)),
  }
}

// ── steward governance ────────────────────────────────────────────────────────────

export interface SetMarketStewardInput extends MarketScoped {
  authority: Address
  steward: Address
}

/** set_market_steward: upsert a per-market steward override (default-steward gated). */
export async function buildSetMarketStewardIx(input: SetMarketStewardInput): Promise<Instruction> {
  const [registry, market, marketSteward] = await Promise.all([
    findRegistryPda(input.programId).then(first),
    findMarketPda(input.programId, input.marketId).then(first),
    findMarketStewardPda(input.programId, input.marketId).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.authority),
      readonly(registry),
      readonly(market),
      writable(marketSteward),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('set_market_steward', enc(pubkey, input.steward)),
  }
}

export interface SetDefaultStewardInput extends Base {
  authority: Address
  steward: Address
}

/** set_default_steward: hand over the registry-wide default steward (current-steward gated). */
export async function buildSetDefaultStewardIx(input: SetDefaultStewardInput): Promise<Instruction> {
  const registry = first(await findRegistryPda(input.programId))
  return {
    programAddress: input.programId,
    accounts: [readonlySigner(input.authority), writable(registry)],
    data: encodeData('set_default_steward', enc(pubkey, input.steward)),
  }
}

export interface ResolveInput extends MarketScoped {
  steward: Address
  vaultId: Hex32
  winningSide: number
  /**
   * The per-market override PDA when one exists (from findMarketStewardPda). Omit when
   * the market uses the registry default — anchor's optional-account convention fills the
   * slot with the program id, exactly as `market_steward: None` does on-chain.
   */
  marketSteward?: Address
}

/** resolve: settle a vault to a winning side (effective-steward gated). */
export async function buildResolveIx(input: ResolveInput): Promise<Instruction> {
  const [protocolState, registry] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findRegistryPda(input.programId).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      readonlySigner(input.steward),
      writable(protocolState),
      readonly(registry),
      readonly(input.marketSteward ?? input.programId),
    ],
    data: encodeData('resolve', enc(id32, bytesFromHex32(input.vaultId)), enc(u8, input.winningSide)),
  }
}

// ── seed-creator engine ops (UserEngineOp) ────────────────────────────────────────

async function userEngineOpAccounts(
  programId: Address,
  marketId: Hex32,
  user: Address,
  usdcMint: Address,
): Promise<AccountMeta[]> {
  const [protocolState, escrow, userUsdc] = await Promise.all([
    findProtocolStatePda(programId, marketId).then(first),
    findEscrowPda(programId, marketId).then(first),
    findUsdcAta(user, usdcMint).then(first),
  ])
  return [
    writableSigner(user),
    writable(protocolState),
    writable(escrow),
    writable(userUsdc),
    readonly(TOKEN_PROGRAM_ADDRESS),
  ]
}

export interface CreateVaultSeededInput extends MarketScoped {
  user: Address
  usdcMint: Address
  question: Uint8Array
  seedSide: number
  rate: bigint
  deposit: bigint
}

/** create_vault_seeded: open a vault seeded on one side (creator pays USDC). */
export async function buildCreateVaultSeededIx(input: CreateVaultSeededInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await userEngineOpAccounts(input.programId, input.marketId, input.user, input.usdcMint),
    data: encodeData(
      'create_vault_seeded',
      enc(vecBytes, input.question),
      enc(u8, input.seedSide),
      enc(u64, input.rate),
      enc(u64, input.deposit),
    ),
  }
}

export interface SeedVaultOpInput extends MarketScoped {
  user: Address
  usdcMint: Address
  vaultId: Hex32
}

/** stop_seed: creator stops their seed lane; the unstreamed remainder is refunded. */
export async function buildStopSeedIx(input: SeedVaultOpInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await userEngineOpAccounts(input.programId, input.marketId, input.user, input.usdcMint),
    data: encodeData('stop_seed', enc(id32, bytesFromHex32(input.vaultId))),
  }
}

/** withdraw_seed: creator claims the seed lane's post-resolution payout. */
export async function buildWithdrawSeedIx(input: SeedVaultOpInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await userEngineOpAccounts(input.programId, input.marketId, input.user, input.usdcMint),
    data: encodeData('withdraw_seed', enc(id32, bytesFromHex32(input.vaultId))),
  }
}

// ── position mint + position-gated engine ops (PositionEngineOp) ───────────────────

export interface MintPositionInput extends MarketScoped {
  minter: Address
  salt: bigint
}

/**
 * mint_position: mint the caller's position NFT for a market. The token_id is derived
 * client-side via computePositionTokenId(minter, salt) — pass that same id to the
 * fund/withdraw/stopAll builders below.
 */
export async function buildMintPositionIx(input: MintPositionInput): Promise<Instruction> {
  const tokenId = computePositionTokenId(input.minter, input.salt)
  const [protocolState, market, position] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findMarketPda(input.programId, input.marketId).then(first),
    findPositionPda(input.programId, tokenId).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.minter),
      writable(protocolState),
      readonly(market),
      writable(position),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('mint_position', enc(u64, input.salt)),
  }
}

async function positionEngineOpAccounts(
  programId: Address,
  marketId: Hex32,
  user: Address,
  tokenId: Hex32,
  usdcMint: Address,
): Promise<AccountMeta[]> {
  const [protocolState, position, escrow, userUsdc] = await Promise.all([
    findProtocolStatePda(programId, marketId).then(first),
    findPositionPda(programId, tokenId).then(first),
    findEscrowPda(programId, marketId).then(first),
    findUsdcAta(user, usdcMint).then(first),
  ])
  return [
    writableSigner(user),
    writable(protocolState),
    readonly(position),
    writable(escrow),
    writable(userUsdc),
    readonly(TOKEN_PROGRAM_ADDRESS),
  ]
}

export interface FundInput extends MarketScoped {
  user: Address
  tokenId: Hex32
  usdcMint: Address
  vaultId: Hex32
  side: number
  rate: bigint
  deposit: bigint
}

/** fund: open/extend a bettor lane on a vault side (bettor pays USDC). */
export async function buildFundIx(input: FundInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await positionEngineOpAccounts(
      input.programId,
      input.marketId,
      input.user,
      input.tokenId,
      input.usdcMint,
    ),
    data: encodeData(
      'fund',
      enc(id32, bytesFromHex32(input.vaultId)),
      enc(u8, input.side),
      enc(u64, input.rate),
      enc(u64, input.deposit),
    ),
  }
}

export interface PositionVaultOpInput extends MarketScoped {
  user: Address
  tokenId: Hex32
  usdcMint: Address
  vaultId: Hex32
}

/** withdraw: claim a resolved lane's winnings for the position. */
export async function buildWithdrawIx(input: PositionVaultOpInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await positionEngineOpAccounts(
      input.programId,
      input.marketId,
      input.user,
      input.tokenId,
      input.usdcMint,
    ),
    data: encodeData('withdraw', enc(id32, bytesFromHex32(input.vaultId))),
  }
}

export interface StopAllInput extends MarketScoped {
  user: Address
  tokenId: Hex32
  usdcMint: Address
}

/** stop_all: stop every lane on the position; unstreamed remainders are refunded. */
export async function buildStopAllIx(input: StopAllInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await positionEngineOpAccounts(
      input.programId,
      input.marketId,
      input.user,
      input.tokenId,
      input.usdcMint,
    ),
    data: encodeData('stop_all'),
  }
}

// ── permissionless engine ops (EngineOp) ──────────────────────────────────────────

async function engineOpAccounts(programId: Address, marketId: Hex32): Promise<AccountMeta[]> {
  const [protocolState, escrow] = await Promise.all([
    findProtocolStatePda(programId, marketId).then(first),
    findEscrowPda(programId, marketId).then(first),
  ])
  return [writable(protocolState), readonly(escrow)]
}

export interface AdvanceInput extends MarketScoped {
  vaultId: Hex32
  side: number
  maxSteps: bigint
}

/** advance: crank a vault side's streaming board forward (permissionless). */
export async function buildAdvanceIx(input: AdvanceInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await engineOpAccounts(input.programId, input.marketId),
    data: encodeData(
      'advance',
      enc(id32, bytesFromHex32(input.vaultId)),
      enc(u8, input.side),
      enc(u64, input.maxSteps),
    ),
  }
}

export interface CollectInput extends MarketScoped {
  vaultId: Hex32
}

/** collect: sweep a resolved vault's house skim into the treasury ledger (permissionless). */
export async function buildCollectIx(input: CollectInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await engineOpAccounts(input.programId, input.marketId),
    data: encodeData('collect', enc(id32, bytesFromHex32(input.vaultId))),
  }
}

// ── position ownership + lane reconfiguration ─────────────────────────────────────

export interface TransferPositionInput extends Base {
  owner: Address
  tokenId: Hex32
  newOwner: Address
}

/** transfer_position: reassign a position NFT to a new owner (owner-gated, no token movement). */
export async function buildTransferPositionIx(input: TransferPositionInput): Promise<Instruction> {
  const position = first(await findPositionPda(input.programId, input.tokenId))
  return {
    programAddress: input.programId,
    accounts: [readonlySigner(input.owner), writable(position)],
    data: encodeData('transfer_position', enc(pubkey, input.newOwner)),
  }
}

export interface StopFundingInput extends MarketScoped {
  user: Address
  tokenId: Hex32
  vaultId: Hex32
  side: number
}

/** stop_funding: stop a single lane (one vault, one side) of a position; no cash moves. */
export async function buildStopFundingIx(input: StopFundingInput): Promise<Instruction> {
  const [protocolState, position] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findPositionPda(input.programId, input.tokenId).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [readonlySigner(input.user), writable(protocolState), readonly(position)],
    data: encodeData('stop_funding', enc(id32, bytesFromHex32(input.vaultId)), enc(u8, input.side)),
  }
}

/** One desired lane in a set_lanes full-set declaration (mirrors the on-chain LaneArg). */
export interface LaneArgInput {
  vaultId: Hex32
  side: number
  rate: bigint
}

// Vec<LaneArg> borsh layout: u32-LE length prefix, then per item vault_id([u8;32]) ++ side(u8) ++ rate(u64-LE).
const encodeLanes = (lanes: readonly LaneArgInput[]): Uint8Array => {
  const items = lanes.map((l) => {
    const item = new Uint8Array(32 + 1 + 8)
    item.set(bytesFromHex32(l.vaultId), 0)
    item.set(enc(u8, l.side), 32)
    item.set(enc(u64, l.rate), 33)
    return item
  })
  const out = new Uint8Array(4 + items.reduce((n, it) => n + it.length, 0))
  out.set(enc(u32, lanes.length), 0)
  let offset = 4
  for (const it of items) {
    out.set(it, offset)
    offset += it.length
  }
  return out
}

export interface SetLanesInput extends MarketScoped {
  user: Address
  tokenId: Hex32
  usdcMint: Address
  /** The COMPLETE desired lane set; the engine diffs it against current lanes (add/remove). */
  lanes: readonly LaneArgInput[]
  /** Optional top-up pulled user->escrow before the reshape (re-funds run-dry re-added lanes). */
  addDeposit: bigint
}

/** set_lanes: declarative full-set lane reconfiguration for a position, with an optional top-up. */
export async function buildSetLanesIx(input: SetLanesInput): Promise<Instruction> {
  return {
    programAddress: input.programId,
    accounts: await positionEngineOpAccounts(
      input.programId,
      input.marketId,
      input.user,
      input.tokenId,
      input.usdcMint,
    ),
    data: encodeData('set_lanes', encodeLanes(input.lanes), enc(u64, input.addDeposit)),
  }
}

// ── LVST loss-mint + staking dividends ────────────────────────────────────────────

export interface ClaimLossLvstInput extends MarketScoped {
  claimer: Address
  tokenId: Hex32
  /** The canonical LVST mint (its authority is the lvst_authority PDA); claimer_lvst is its ATA. */
  lvstMint: Address
  vaultId: Hex32
  side: number
}

/** claim_loss_lvst: a losing position mints LVST against its vault-read loss basis (owner-gated). */
export async function buildClaimLossLvstIx(input: ClaimLossLvstInput): Promise<Instruction> {
  const [protocolState, position, lvstAuthority, claimerLvst] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findPositionPda(input.programId, input.tokenId).then(first),
    findLvstAuthorityPda(input.programId).then(first),
    findAta(input.claimer, input.lvstMint).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      readonlySigner(input.claimer),
      writable(protocolState),
      readonly(position),
      readonly(lvstAuthority),
      writable(input.lvstMint),
      writable(claimerLvst),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: encodeData('claim_loss_lvst', enc(id32, bytesFromHex32(input.vaultId)), enc(u8, input.side)),
  }
}

export interface StakeLvstInput extends MarketScoped {
  staker: Address
  /** The canonical LVST mint (key-checked against the registry); staker_lvst is its ATA. */
  lvstMint: Address
  amount: bigint
}

/** stake_lvst: stake LVST into the per-market escrow to earn dividends (lazily inits the escrow). */
export async function buildStakeLvstIx(input: StakeLvstInput): Promise<Instruction> {
  const [protocolState, registry, lvstEscrow, stakerLvst] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findRegistryPda(input.programId).then(first),
    findLvstEscrowPda(input.programId, input.marketId).then(first),
    findAta(input.staker, input.lvstMint).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      writableSigner(input.staker),
      writable(protocolState),
      readonly(registry),
      readonly(input.lvstMint),
      writable(lvstEscrow),
      writable(stakerLvst),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: encodeData('stake_lvst', enc(u64, input.amount)),
  }
}

export interface UnstakeLvstInput extends MarketScoped {
  staker: Address
  /** The canonical LVST mint (binds the escrow); staker_lvst is its ATA. */
  lvstMint: Address
  amount: bigint
}

/** unstake_lvst: withdraw staked LVST from the per-market escrow (paid out by the protocol PDA). */
export async function buildUnstakeLvstIx(input: UnstakeLvstInput): Promise<Instruction> {
  const [protocolState, lvstEscrow, stakerLvst] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findLvstEscrowPda(input.programId, input.marketId).then(first),
    findAta(input.staker, input.lvstMint).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      readonlySigner(input.staker),
      writable(protocolState),
      readonly(input.lvstMint),
      writable(lvstEscrow),
      writable(stakerLvst),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: encodeData('unstake_lvst', enc(u64, input.amount)),
  }
}

export interface ClaimDividendsInput extends MarketScoped {
  staker: Address
  usdcMint: Address
}

/** claim_dividends: a staker claims their accrued USDC dividends out of the shared escrow. */
export async function buildClaimDividendsIx(input: ClaimDividendsInput): Promise<Instruction> {
  const [protocolState, escrow, stakerUsdc] = await Promise.all([
    findProtocolStatePda(input.programId, input.marketId).then(first),
    findEscrowPda(input.programId, input.marketId).then(first),
    findUsdcAta(input.staker, input.usdcMint).then(first),
  ])
  return {
    programAddress: input.programId,
    accounts: [
      readonlySigner(input.staker),
      writable(protocolState),
      writable(escrow),
      writable(stakerUsdc),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: encodeData('claim_dividends'),
  }
}
