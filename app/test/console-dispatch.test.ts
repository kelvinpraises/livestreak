// Pure dispatch logic: values → envelope (renaming, schema defaults, coercion) and the
// pending-call reducer's busy → settling → cleared/failed lifecycle.

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor, JsonSchema } from '@livestreak/schema'
import {
  applySchemaDefaults,
  boardStamp,
  buildCall,
  pendingReducer,
  renameValues,
  type PendingEntry,
  type PendingState,
} from '../src/utils/console-dispatch'

const CREATE_VAULT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: [
    { name: 'marketId', value: { type: 'string', required: true }, help: '' },
    { name: 'question', value: { type: 'string', required: true }, help: '' },
    { name: 'creatorSide', value: { type: 'enum', required: true, values: ['yes', 'no'] }, help: '' },
    { name: 'creatorStake', value: { type: 'string', required: true, format: 'bigint' }, help: '' },
    { name: 'resolutionSource', value: { type: 'string', required: true, default: 'manual' }, help: '' },
    { name: 'resolutionWindowExpiresAtMs', value: { type: 'integer' }, help: '' },
  ],
}

const createVaultFn: FunctionDescriptor = {
  id: 'bookmaker.root.action.createVault',
  package: 'bookmaker',
  name: 'createVault',
  label: 'Create vault',
  scope: 'bridge:action:createVault',
  target: { kind: 'vault', marketId: '0x2669aa' },
  disabled: false,
  inputSchema: CREATE_VAULT_SCHEMA,
}

const verb = {
  fields: [
    { name: 'question', value: '' },
    { name: 'seed side', arg: 'creatorSide', value: 'yes' },
    { name: 'stake · base units', arg: 'creatorStake', value: '5000000' },
  ],
}

describe('renameValues', () => {
  it('maps display names to wire args, including discriminant arm fields', () => {
    const v = {
      fields: [
        {
          name: 'source',
          value: 'file',
          arms: {
            file: [{ name: 'path', arg: 'filePath', value: '' }],
            browser: [{ name: 'url', value: '' }],
          },
        },
      ],
    }
    expect(renameValues(v, { source: 'file', path: './x.mp4' })).toEqual({
      source: 'file',
      filePath: './x.mp4',
    })
  })
})

describe('applySchemaDefaults', () => {
  it('fills omitted defaulted properties, never overwrites present ones', () => {
    const out = applySchemaDefaults(CREATE_VAULT_SCHEMA, { question: 'q' })
    expect(out.resolutionSource).toBe('manual')
    expect(applySchemaDefaults(CREATE_VAULT_SCHEMA, { resolutionSource: 'oracle' }).resolutionSource).toBe('oracle')
  })
})

describe('buildCall', () => {
  it('builds the envelope: prefilled target ids merged, args coerced, defaults applied', () => {
    const built = buildCall(createVaultFn, verb, {
      question: 'Will there be a goal?',
      'seed side': 'yes',
      'stake · base units': '5000000',
    })
    expect(built.ok).toBe(true)
    expect(built.target).toBe('bookmaker')
    expect(built.envelope).toEqual({
      scope: 'bridge:action',
      action: 'createVault',
      id: 'bookmaker.root.action.createVault',
      args: {
        marketId: '0x2669aa',
        question: 'Will there be a goal?',
        creatorSide: 'yes',
        creatorStake: '5000000',
        resolutionSource: 'manual',
      },
    })
  })

  it('fails locally on coercion errors — no envelope, first error surfaced', () => {
    const built = buildCall(createVaultFn, verb, { 'seed side': 'yes', 'stake · base units': '5000000' })
    expect(built.ok).toBe(false)
    expect(built.error).toContain('question')
    expect(built.envelope).toBeUndefined()
  })
})

describe('boardStamp', () => {
  it('prefers revision, falls back to updatedAtMs, else undefined', () => {
    expect(boardStamp({ revision: 7, updatedAtMs: 99 })).toBe(7)
    expect(boardStamp({ updatedAtMs: 99 })).toBe(99)
    expect(boardStamp({})).toBeUndefined()
    expect(boardStamp(undefined)).toBeUndefined()
  })
})

describe('pendingReducer', () => {
  const entry: PendingEntry = { phase: 'busy', startedAt: 100, pkg: 'bookmaker', stampAtCall: 5 }
  const fired: PendingState = pendingReducer(new Map(), { type: 'fired', callRef: 'r1', entry })

  it('busy → settling on ok, cleared when the package board stamp moves past the call', () => {
    const settling = pendingReducer(fired, { type: 'settled_ok', callRef: 'r1' })
    expect(settling.get('r1')?.phase).toBe('settling')
    // A push with the stamp from BEFORE the call must not clear it.
    const stale = pendingReducer(settling, { type: 'boards', stamps: { bookmaker: 5 } })
    expect(stale.get('r1')?.phase).toBe('settling')
    const cleared = pendingReducer(settling, { type: 'boards', stamps: { bookmaker: 6 } })
    expect(cleared.has('r1')).toBe(false)
  })

  it('failed overrides and survives board pushes until retried/cleared', () => {
    const failed = pendingReducer(fired, { type: 'failed', callRef: 'r1', error: 'nope' })
    expect(failed.get('r1')).toMatchObject({ phase: 'failed', error: 'nope' })
    const after = pendingReducer(failed, { type: 'boards', stamps: { bookmaker: 99 } })
    expect(after.get('r1')?.phase).toBe('failed')
  })

  it('expired clears only a still-settling entry from the same firing', () => {
    const settling = pendingReducer(fired, { type: 'settled_ok', callRef: 'r1' })
    expect(pendingReducer(settling, { type: 'expired', callRef: 'r1', firedBefore: 100 }).has('r1')).toBe(false)
    // A newer firing (startedAt > firedBefore) is not the one the timer belonged to.
    expect(pendingReducer(settling, { type: 'expired', callRef: 'r1', firedBefore: 99 }).has('r1')).toBe(true)
    // Busy (still on the wire) never expires.
    expect(pendingReducer(fired, { type: 'expired', callRef: 'r1', firedBefore: 100 }).has('r1')).toBe(true)
  })
})
