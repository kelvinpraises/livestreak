// buildConsoleModels: one tab per package present in functions[], fixture fallback
// (badged via fixtureTabs) until that package's live mapper lands.

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor } from '@livestreak/schema'
import { buildConsoleModels } from '../src/utils/console-map'
import { consoleFixtures } from '../src/utils/console-fixtures'

const fn = (pkg: FunctionDescriptor['package'], name: string): FunctionDescriptor => ({
  id: `${pkg}.test.${name}`,
  package: pkg,
  name,
  label: name,
  scope: `bridge:action:${name}`,
  disabled: false,
})

describe('buildConsoleModels', () => {
  it('yields one tab per package present; mapped packages are live, the rest fixture-backed', () => {
    const built = buildConsoleModels({
      functions: [fn('bookmaker', 'createVault'), fn('options', 'fund'), fn('observe', 'configure')],
      board: {},
      pending: new Map(),
    })
    expect(Object.keys(built.models).sort()).toEqual(['bookmaker', 'observe', 'options'])
    // All four packages now have live mappers — nothing falls back to fixtures.
    expect(built.fixtureTabs.size).toBe(0)
    expect(built.models.bookmaker).not.toBe(consoleFixtures.bookmaker)
    expect(built.models.options).not.toBe(consoleFixtures.options)
    expect(built.models.observe).not.toBe(consoleFixtures.observe)
    expect(built.models.observe?.role).toBe('observe')
  })

  it('yields no tabs when no functions are in scope', () => {
    const built = buildConsoleModels({ functions: [], board: {}, pending: new Map() })
    expect(Object.keys(built.models)).toEqual([])
    expect(built.fixtureTabs.size).toBe(0)
  })
})
