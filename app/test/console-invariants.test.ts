// The fixtures are the ConsoleModel spec — this locks the contract rules they demonstrate.
// Every live mapper's golden test reuses consoleModelViolations so wire-derived models are
// held to exactly the same rules.

import { describe, expect, it } from 'vitest'
import { consoleFixtures } from '../src/utils/console-fixtures'
import { consoleModelViolations } from './helpers/console-invariants'

describe('console fixtures honor the ConsoleModel contract', () => {
  for (const [name, model] of Object.entries(consoleFixtures)) {
    it(`${name} has no contract violations`, () => {
      expect(consoleModelViolations(model)).toEqual([])
    })
  }
})
