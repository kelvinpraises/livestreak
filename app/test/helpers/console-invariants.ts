// Executable form of the ConsoleModel contract rules documented in app/src/types/console.ts.
// Runs against the fixtures (they are the spec) and against every live mapper's output as the
// walk-backwards lands — a mapper that breaks a rule fails the same assertion the fixtures pass.

import type { ConsoleModel } from '../../src/types/console'

/** Returns human-readable violations; empty = the model honors the contract. */
export function consoleModelViolations(model: ConsoleModel): string[] {
  const out: string[] = []
  const byId = new Map(model.things.map((t) => [t.id, t]))

  // Desk tree: every parentId resolves, chains terminate (no cycles).
  for (const thing of model.things) {
    if (thing.parentId !== undefined && !byId.has(thing.parentId)) {
      out.push(`thing ${thing.id}: parentId ${thing.parentId} does not exist`)
    }
    let cursor = thing.parentId
    let depth = 0
    while (cursor !== undefined && depth < 16) {
      cursor = byId.get(cursor)?.parentId
      depth += 1
    }
    if (depth >= 16) out.push(`thing ${thing.id}: parent chain does not terminate (cycle?)`)
  }

  // Attention cards are pointers — every target must be a real thing.
  for (const card of model.attention) {
    if (!byId.has(card.targetId)) {
      out.push(`attention "${card.title}": targetId ${card.targetId} does not exist`)
    }
  }

  // Focus: default focus is a real thing with a card; every focus key is a real thing.
  if (!byId.has(model.defaultFocusId)) {
    out.push(`defaultFocusId ${model.defaultFocusId} is not a thing`)
  }
  if (model.focus[model.defaultFocusId] === undefined) {
    out.push(`defaultFocusId ${model.defaultFocusId} has no focus card`)
  }
  for (const focusId of Object.keys(model.focus)) {
    if (!byId.has(focusId)) out.push(`focus card ${focusId} has no matching thing`)
  }

  const attentionTargets = new Set(model.attention.map((c) => c.targetId))
  for (const thing of model.things) {
    const card = model.focus[thing.id]

    // Dot contract: warn/err must be answered — by an attention card targeting the thing,
    // or a stated fact on the desk row itself (note).
    if ((thing.tone === 'warn' || thing.tone === 'err') && !attentionTargets.has(thing.id) && thing.note === undefined) {
      out.push(`thing ${thing.id}: tone '${thing.tone}' has no attention card and no note to justify it`)
    }

    // Grey is reserved for read-only things — anything with verbs is 'ok' or worse.
    if (thing.tone === 'idle' && card !== undefined && card.verbs.length > 0) {
      out.push(`thing ${thing.id}: tone 'idle' but its focus card has verbs`)
    }

    // At most one hot (suggested-next) verb per card.
    if (card !== undefined) {
      const hot = card.verbs.filter((v) => v.hot === true)
      if (hot.length > 1) {
        out.push(`focus ${thing.id}: ${hot.length} hot verbs (${hot.map((v) => v.name).join(', ')}) — max 1`)
      }
    }
  }

  return out
}
