// Typed instruction builders for all 16 livestreak instructions. Discriminators are read
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
  findEscrowPda,
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
}

/** initialize: create the singleton registry with a default steward. */
export async function buildInitializeIx(input: InitializeInput): Promise<Instruction> {
  const registry = first(await findRegistryPda(input.programId))
  return {
    programAddress: input.programId,
    accounts: [writableSigner(input.payer), writable(registry), readonly(SYSTEM_PROGRAM_ADDRESS)],
    data: encodeData('initialize', enc(pubkey, input.defaultSteward)),
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
