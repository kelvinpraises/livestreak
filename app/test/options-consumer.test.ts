import { describe, expect, it } from 'vitest'
import type { OptionsFunctionView, OptionsNftPanel } from '@livestreak/options'
import { findOptionsFunction, hasBalanceReadout } from '../src/utils/options'

// CONCERN 2 — balance/runway readout is DATA-gated (field presence), not chain-gated. EVM supplies
// `balanceUSDC`; Sui and Solana omit it (documented SDK gaps), so the readout stays hidden there without
// the app faking a zero.
describe('hasBalanceReadout — data-presence gate (chain-agnostic)', () => {
  const account = (over: Partial<OptionsNftPanel['account']>): OptionsNftPanel['account'] =>
    ({ status: 'idle', ...over }) as OptionsNftPanel['account']

  it('shows the readout when a chain supplies balanceUSDC (EVM)', () => {
    expect(hasBalanceReadout(account({ balanceUSDC: 12.5, balanceRaw: '12500000' }))).toBe(true)
  })

  it('shows the readout even for a zero balance the chain explicitly reported', () => {
    expect(hasBalanceReadout(account({ balanceUSDC: 0, balanceRaw: '0' }))).toBe(true)
  })

  it('hides the readout when balanceUSDC is absent (Sui / Solana gap) — no faked number', () => {
    expect(hasBalanceReadout(account({}))).toBe(false)
  })
})

// CONCERN 3 — controls render by name-lookup over the schema-bearing functions[] registry, NOT a
// hardcoded allowlist. An unknown-but-schema'd action is simply not found (undefined) and the action
// button treats undefined as disabled — nothing crashes on an unrecognized verb.
describe('findOptionsFunction — schema-driven, tolerant of unknown verbs', () => {
  const fns: OptionsFunctionView[] = [
    { name: 'transferNft', scope: 's', label: 'Transfer', disabled: false, target: { kind: 'nft', tokenId: '0x1' } } as OptionsFunctionView,
    { name: 'claimLossLvst', scope: 's', label: 'Claim', disabled: false, target: { kind: 'vault', vaultId: '0x2', side: 'yes' } } as OptionsFunctionView,
    { name: 'setLanes', scope: 's', label: 'Set lanes', disabled: false, target: { kind: 'nft', tokenId: '0x1' } } as OptionsFunctionView,
    // A verb the app has no bespoke UI for — must NOT break lookups.
    { name: 'someBrandNewPhase9Verb', scope: 's', label: 'Future', disabled: false } as OptionsFunctionView,
  ]

  it('finds a known Phase-4 verb by name', () => {
    expect(findOptionsFunction(fns, 'setLanes')?.label).toBe('Set lanes')
    expect(findOptionsFunction(fns, 'claimLossLvst')?.name).toBe('claimLossLvst')
  })

  it('returns undefined for an unknown verb rather than throwing', () => {
    expect(findOptionsFunction(fns, 'noSuchAction')).toBeUndefined()
  })

  it('honours the target predicate', () => {
    expect(findOptionsFunction(fns, 'claimLossLvst', f => f.target?.kind === 'vault')).toBeDefined()
    expect(findOptionsFunction(fns, 'transferNft', f => f.target?.kind === 'vault')).toBeUndefined()
  })
})
