import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { AccountRole, getAddressEncoder, getU64Encoder } from '@solana/kit'
import { livestreakIdl } from '@livestreak/contracts/solana'

import {
  address,
  buildAdvanceIx,
  buildClaimDividendsIx,
  buildClaimLossLvstIx,
  buildCollectIx,
  buildCreateVaultSeededIx,
  buildFundIx,
  buildGoLiveIx,
  buildGrowProtocolIx,
  buildInitProtocolIx,
  buildInitializeIx,
  buildMintPositionIx,
  buildRegisterMarketIx,
  buildResolveIx,
  buildSetEndedIx,
  buildSetLanesIx,
  buildSetMarketStewardIx,
  buildSetDefaultStewardIx,
  buildStakeLvstIx,
  buildStopAllIx,
  buildStopFundingIx,
  buildStopSeedIx,
  buildTransferPositionIx,
  buildUnstakeLvstIx,
  buildWithdrawIx,
  buildWithdrawSeedIx,
  computeMarketId,
  computePositionTokenId,
  decodeMarketAccount,
  decodeMarketIndexAccount,
  decodePositionOwnerAccount,
  decodeRegistryAccount,
  accountDiscriminator,
} from '@livestreak/wallet'

// Fixed, valid base58 addresses for deterministic assertions.
const PROGRAM_ID = address('CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8')
const STEWARD = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const USER = address('So11111111111111111111111111111111111111112')
const USDC = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const LVST_MINT = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const ID_A = '0x' + '11'.repeat(32)
const ID_B = '0x' + '22'.repeat(32)

const addressEncoder = getAddressEncoder()
const u64le = getU64Encoder()
const bytesOf = (a) => new Uint8Array(addressEncoder.encode(a))

// Expected @solana/kit role for an IDL account entry.
const expectedRole = (a) => {
  if (a.writable && a.signer) return AccountRole.WRITABLE_SIGNER
  if (a.signer) return AccountRole.READONLY_SIGNER
  if (a.writable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}

const idlByName = Object.fromEntries(livestreakIdl.instructions.map((ix) => [ix.name, ix]))

// One representative invocation per IDL instruction name.
const built = {
  initialize: () =>
    buildInitializeIx({ programId: PROGRAM_ID, payer: USER, defaultSteward: STEWARD, lvstMint: LVST_MINT }),
  init_protocol: () =>
    buildInitProtocolIx({ programId: PROGRAM_ID, marketId: ID_A, payer: USER, usdcMint: USDC, capacity: 9000 }),
  grow_protocol: () => buildGrowProtocolIx({ programId: PROGRAM_ID, marketId: ID_A, payer: USER }),
  register_market: () =>
    buildRegisterMarketIx({
      programId: PROGRAM_ID,
      creator: USER,
      title: new TextEncoder().encode('Keynote'),
      streamId: new TextEncoder().encode('stream-keynote'),
      marketCount: 0n,
      marketId: ID_A,
    }),
  go_live: () =>
    buildGoLiveIx({ programId: PROGRAM_ID, marketId: ID_A, creator: USER, scheme: 0, pointer: new Uint8Array([1, 2]) }),
  set_ended: () =>
    buildSetEndedIx({ programId: PROGRAM_ID, marketId: ID_A, creator: USER, scheme: 1, pointer: new Uint8Array([3]) }),
  set_market_steward: () =>
    buildSetMarketStewardIx({ programId: PROGRAM_ID, marketId: ID_A, authority: USER, steward: STEWARD }),
  set_default_steward: () =>
    buildSetDefaultStewardIx({ programId: PROGRAM_ID, authority: USER, steward: STEWARD }),
  create_vault_seeded: () =>
    buildCreateVaultSeededIx({
      programId: PROGRAM_ID,
      marketId: ID_A,
      user: USER,
      usdcMint: USDC,
      question: new TextEncoder().encode('goal scored?'),
      seedSide: 1,
      rate: 5_000_000n,
      deposit: 500_000_000n,
    }),
  mint_position: () => buildMintPositionIx({ programId: PROGRAM_ID, marketId: ID_A, payer: USER, minter: USER, salt: 42n }),
  fund: () =>
    buildFundIx({
      programId: PROGRAM_ID,
      marketId: ID_A,
      user: USER,
      tokenId: ID_B,
      usdcMint: USDC,
      vaultId: ID_A,
      side: 0,
      rate: 7_000_000n,
      deposit: 700_000_000n,
    }),
  stop_all: () =>
    buildStopAllIx({ programId: PROGRAM_ID, marketId: ID_A, user: USER, tokenId: ID_B, usdcMint: USDC }),
  withdraw: () =>
    buildWithdrawIx({ programId: PROGRAM_ID, marketId: ID_A, user: USER, tokenId: ID_B, usdcMint: USDC, vaultId: ID_A }),
  stop_seed: () =>
    buildStopSeedIx({ programId: PROGRAM_ID, marketId: ID_A, user: USER, usdcMint: USDC, vaultId: ID_A }),
  withdraw_seed: () =>
    buildWithdrawSeedIx({ programId: PROGRAM_ID, marketId: ID_A, user: USER, usdcMint: USDC, vaultId: ID_A }),
  resolve: () =>
    buildResolveIx({ programId: PROGRAM_ID, marketId: ID_A, steward: STEWARD, vaultId: ID_A, winningSide: 0 }),
  advance: () =>
    buildAdvanceIx({ programId: PROGRAM_ID, marketId: ID_A, vaultId: ID_A, side: 0, maxSteps: 10n }),
  collect: () => buildCollectIx({ programId: PROGRAM_ID, marketId: ID_A, vaultId: ID_A }),
  transfer_position: () =>
    buildTransferPositionIx({ programId: PROGRAM_ID, owner: USER, tokenId: ID_B, newOwner: STEWARD }),
  stop_funding: () =>
    buildStopFundingIx({ programId: PROGRAM_ID, marketId: ID_A, user: USER, tokenId: ID_B, vaultId: ID_A, side: 0 }),
  set_lanes: () =>
    buildSetLanesIx({
      programId: PROGRAM_ID,
      marketId: ID_A,
      user: USER,
      tokenId: ID_B,
      usdcMint: USDC,
      lanes: [
        { vaultId: ID_A, side: 0, rate: 7_000_000n },
        { vaultId: ID_B, side: 1, rate: 3_000_000n },
      ],
      addDeposit: 500_000_000n,
    }),
  claim_loss_lvst: () =>
    buildClaimLossLvstIx({
      programId: PROGRAM_ID,
      marketId: ID_A,
      claimer: USER,
      tokenId: ID_B,
      lvstMint: LVST_MINT,
      vaultId: ID_A,
      side: 1,
    }),
  stake_lvst: () =>
    buildStakeLvstIx({ programId: PROGRAM_ID, marketId: ID_A, staker: USER, lvstMint: LVST_MINT, amount: 1_000_000n }),
  unstake_lvst: () =>
    buildUnstakeLvstIx({ programId: PROGRAM_ID, marketId: ID_A, staker: USER, lvstMint: LVST_MINT, amount: 250_000n }),
  claim_dividends: () =>
    buildClaimDividendsIx({ programId: PROGRAM_ID, marketId: ID_A, staker: USER, usdcMint: USDC }),
}

describe('livestreak instruction builders', () => {
  it('initialize data == deploy encoding (disc + steward pubkey + lvst mint pubkey)', async () => {
    const ix = await built.initialize()
    const disc = Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237])
    const expected = new Uint8Array([...disc, ...bytesOf(STEWARD), ...bytesOf(LVST_MINT)])
    assert.deepEqual(ix.data, expected)
    assert.equal(ix.data.length, 72)
  })

  it('set_lanes data == borsh(disc + Vec<LaneArg> + add_deposit)', async () => {
    const ix = await built.set_lanes()
    const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
    const u64of = (n) => Array.from(u64le.encode(n))
    const expected = new Uint8Array([
      ...idlByName['set_lanes'].discriminator, // 8-byte anchor disc
      ...u32le(2), // Vec<LaneArg> length prefix (u32-LE)
      ...Array(32).fill(0x11), 0, ...u64of(7_000_000n), // lane 0: vault ID_A, side 0, rate
      ...Array(32).fill(0x22), 1, ...u64of(3_000_000n), // lane 1: vault ID_B, side 1, rate
      ...u64of(500_000_000n), // add_deposit (u64-LE)
    ])
    assert.deepEqual(ix.data, expected)
    assert.equal(ix.data.length, 8 + 4 + 41 * 2 + 8) // disc + veclen + 2×(32+1+8) + u64
  })

  it('every instruction matches its IDL discriminator + account count/order', async () => {
    for (const [name, make] of Object.entries(built)) {
      const idl = idlByName[name]
      assert.ok(idl, `IDL has instruction ${name}`)
      const ix = await make()

      // (a) first 8 data bytes == IDL discriminator.
      assert.deepEqual(
        Array.from(ix.data.slice(0, 8)),
        idl.discriminator,
        `${name} discriminator`,
      )

      // (b) account count + per-slot role match the IDL, in order.
      assert.equal(ix.accounts.length, idl.accounts.length, `${name} account count`)
      idl.accounts.forEach((acc, i) => {
        assert.equal(ix.accounts[i].role, expectedRole(acc), `${name} account[${i}] (${acc.name}) role`)
        if (acc.address) {
          assert.equal(ix.accounts[i].address, acc.address, `${name} account[${i}] (${acc.name}) fixed address`)
        }
      })

      assert.equal(ix.programAddress, PROGRAM_ID)
    }
  })

  it('coverage: all IDL instructions are exercised', () => {
    assert.equal(Object.keys(built).length, livestreakIdl.instructions.length)
  })

  it('resolve omits the optional market_steward by filling the slot with the program id', async () => {
    const ix = await built.resolve()
    assert.equal(ix.accounts[3].address, PROGRAM_ID)
    assert.equal(ix.accounts[3].role, AccountRole.READONLY)
  })
})

describe('livestreak id helpers', () => {
  it('computePositionTokenId is a stable 0x-hex 32-byte id', () => {
    const id = computePositionTokenId(USER, 42n)
    assert.match(id, /^0x[0-9a-f]{64}$/)
    assert.equal(id, computePositionTokenId(USER, 42n))
    assert.notEqual(id, computePositionTokenId(USER, 43n))
  })

  it('computeMarketId is a stable 0x-hex 32-byte id', () => {
    const streamId = new TextEncoder().encode('stream-keynote')
    const id = computeMarketId(USER, streamId)
    assert.match(id, /^0x[0-9a-f]{64}$/)
    assert.equal(id, computeMarketId(USER, streamId))
  })
})

describe('livestreak account decoders', () => {
  it('round-trips a PositionOwner account against hand-encoded bytes', () => {
    const tokenId = ID_B
    const bump = 254
    const bytes = new Uint8Array([
      ...accountDiscriminator('PositionOwner'),
      ...Array(32).fill(0x22), // token_id = 0x22..22 == ID_B
      ...bytesOf(USER),
      ...Array(32).fill(0x11), // market_id = 0x11..11 == ID_A (after owner, keeps owner at offset 40)
      bump,
    ])
    const acc = decodePositionOwnerAccount(bytes)
    assert.equal(acc.tokenId, tokenId)
    assert.equal(acc.owner, USER)
    assert.equal(acc.marketId, ID_A)
    assert.equal(acc.bump, bump)
  })

  it('round-trips a Registry account', () => {
    const bytes = new Uint8Array([
      ...accountDiscriminator('Registry'),
      ...u64le.encode(7n),
      ...bytesOf(STEWARD),
      9,
      ...bytesOf(LVST_MINT), // lvst_mint appended last
    ])
    const acc = decodeRegistryAccount(bytes)
    assert.equal(acc.marketCount, 7n)
    assert.equal(acc.defaultSteward, STEWARD)
    assert.equal(acc.bump, 9)
    assert.equal(acc.lvstMint, LVST_MINT)
  })

  it('round-trips a MarketIndex account', () => {
    const bytes = new Uint8Array([
      ...accountDiscriminator('MarketIndex'),
      ...Array(32).fill(0x11),
      3,
    ])
    const acc = decodeMarketIndexAccount(bytes)
    assert.equal(acc.marketId, ID_A)
    assert.equal(acc.bump, 3)
  })

  it('round-trips a Market account (variable-length bytes fields)', () => {
    const title = new TextEncoder().encode('Keynote')
    const streamId = new TextEncoder().encode('stream-keynote')
    const pointer = new Uint8Array([9, 8, 7])
    const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
    const i64le = (n) => Array.from(u64le.encode(BigInt(n)))
    const bytes = new Uint8Array([
      ...accountDiscriminator('Market'),
      ...Array(32).fill(0x11), // market_id
      ...bytesOf(USER), // creator
      ...u32le(title.length), ...title,
      ...u32le(streamId.length), ...streamId,
      ...i64le(1_752_700_000), // created_at
      1, // stream_status
      0, // stream_scheme
      ...u32le(pointer.length), ...pointer,
      ...i64le(1_752_700_060), // stream_updated_at
      ...i64le(0), // stream_ended_at
      5, // bump
    ])
    const acc = decodeMarketAccount(bytes)
    assert.equal(acc.marketId, ID_A)
    assert.equal(acc.creator, USER)
    assert.deepEqual(acc.title, title)
    assert.deepEqual(acc.streamId, streamId)
    assert.equal(acc.createdAt, 1_752_700_000n)
    assert.equal(acc.streamStatus, 1)
    assert.deepEqual(acc.streamPointer, pointer)
    assert.equal(acc.streamUpdatedAt, 1_752_700_060n)
    assert.equal(acc.streamEndedAt, 0n)
    assert.equal(acc.bump, 5)
  })
})
