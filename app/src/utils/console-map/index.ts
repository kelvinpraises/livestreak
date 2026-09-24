// buildConsoleModels — the composition seam for the live console. Groups the session's
// functions by package (one tab per package present, so a scoped grant yields fewer tabs
// than the dev super-grant's four) and runs each package's mapper. A package WITHOUT a
// mapper yet falls back to its fixture model, reported in fixtureTabs so the page can
// badge it honestly — each mapper landing flips one entry in `mappers`.

import type { CapabilityGrant, ConsolePackage, FunctionDescriptor } from '@livestreak/schema'
import type { ConsoleModel } from '#/types/console'
import { consoleFixtures } from '#/utils/console-fixtures'
import type { PackageMapper, PendingCall } from '#/utils/console-map/types'
import { mapBookmaker } from '#/utils/console-map/map-bookmaker'
import { mapOptions } from '#/utils/console-map/map-options'
import { mapSteward } from '#/utils/console-map/map-steward'
import { mapObserve } from '#/utils/console-map/map-observe'

const mappers: Partial<Record<ConsolePackage, PackageMapper>> = {
  bookmaker: mapBookmaker,
  options: mapOptions,
  steward: mapSteward,
  observe: mapObserve,
}

export interface BuiltConsoleModels {
  readonly models: Readonly<Record<string, ConsoleModel>>
  /** Tabs still rendered from fixture data (no live mapper yet). */
  readonly fixtureTabs: ReadonlySet<string>
}

export function buildConsoleModels(input: {
  readonly functions: readonly FunctionDescriptor[]
  readonly board: Readonly<Record<string, unknown>>
  readonly grant?: CapabilityGrant
  readonly pending: ReadonlyMap<string, PendingCall>
  readonly localPicks?: ReadonlySet<string>
  readonly nowMs?: number
}): BuiltConsoleModels {
  const byPackage = new Map<ConsolePackage, FunctionDescriptor[]>()
  for (const fn of input.functions) {
    const list = byPackage.get(fn.package)
    if (list === undefined) byPackage.set(fn.package, [fn])
    else list.push(fn)
  }

  // Tab order is the protocol's handoff order (observer → bookmaker → bettor → steward),
  // not wire arrival order. Unknown packages (future plugins) follow, in arrival order.
  const TAB_ORDER: readonly ConsolePackage[] = ['observe', 'bookmaker', 'options', 'steward']
  const ordered = [
    ...TAB_ORDER.filter((pkg) => byPackage.has(pkg)),
    ...[...byPackage.keys()].filter((pkg) => !TAB_ORDER.includes(pkg)),
  ]

  const models: Record<string, ConsoleModel> = {}
  const fixtureTabs = new Set<string>()
  for (const pkg of ordered) {
    const fns = byPackage.get(pkg)!
    const mapper = mappers[pkg]
    if (mapper !== undefined) {
      models[pkg] = mapper({
        functions: fns,
        board: input.board[pkg],
        grant: input.grant,
        pending: input.pending,
        localPicks: input.localPicks,
        nowMs: input.nowMs,
      })
      continue
    }
    const fixture = consoleFixtures[pkg]
    if (fixture !== undefined) {
      models[pkg] = fixture
      fixtureTabs.add(pkg)
    }
  }
  return { models, fixtureTabs }
}
