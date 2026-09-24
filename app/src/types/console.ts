// The unified console model — the ONE shape the Desk/Focus/Attention console renders.
// UI-first contract: today it is fed by fixtures (utils/console-fixtures.ts); the walk-backwards
// step later maps each package's board + functions[] into this shape at the gateway. The renderer
// must never know which package produced a thing.

export type ConsoleRole = 'observe' | 'bookmaker' | 'options' | 'steward'

/** CONTRACT: a desk dot is never freehand — every tone must be justified by state the console
 *  shows. 'warn'/'err' require a matching attention card targeting the thing OR a stated fact in
 *  its note/sub (the click must answer the dot). 'idle' (grey) is reserved for read-only things;
 *  anything with verbs is 'ok' or worse. The mapper derives tone from the same facts it prints. */
export type ThingTone = 'ok' | 'warn' | 'err' | 'idle'

/** One entity on the Desk. The tree is derived: parentId chains up to the session root. */
export interface ConsoleThing {
  readonly id: string
  readonly parentId?: string
  readonly kind: string // session | state | stream | market | vault | position | lvst | steward ...
  readonly label: string
  /** One-line summary. CONTRACT: derived by the mapper from status + counts — never authored prose.
   *  (Fixtures hand-write it; the walk-backwards mapper must compute it or the package must emit it.) */
  readonly note?: string
  readonly tone: ThingTone
  readonly fresh?: boolean // just materialized — brief highlight
}

export type VerbState = 'ready' | 'locked' | 'done' | 'busy' | 'failed' | 'guarded'

export type VerbFieldKind = 'text' | 'number' | 'select' | 'picker'

export interface VerbFieldOption {
  readonly label: string
  readonly note?: string
  /** Shown struck-through but VISIBLE — an option can be spent (already added, ended) yet must stay legible. */
  readonly disabled?: boolean
  /** Submit value when it differs from the label (e.g. label = a vault's question, value = its
   *  vaultId). The display always shows the label; only the dispatched value changes. */
  readonly value?: string
}

export interface VerbField {
  readonly name: string
  readonly value: string
  /** Wire argument name when it differs from the display name (e.g. "seed side" → "creatorSide").
   *  Defaults to `name`. Only the live mapper sets it; fixtures never need it. */
  readonly arg?: string
  /** Field control, default 'text'. 'picker' = searchable option list (radio, or checkboxes with `multi`). */
  readonly kind?: VerbFieldKind
  readonly options?: readonly VerbFieldOption[] // select + picker
  readonly multi?: boolean // picker only: multi-select
  /** Discriminant select: each option label maps to the field set it reveals. ALL arms ship in the
   *  model (picking is not a board change — the renderer swaps locally, no roundtrip). Arms may
   *  nest further discriminants. Projected from the shape DSL's `variant("source", {...})`. */
  readonly arms?: Readonly<Record<string, readonly VerbField[]>>
}

/** The values a verb's form held when Run fired: field display name → value (array = multi picker).
 *  Read from the live DOM; only the ACTIVE discriminant arm's fields ship. */
export type ConsoleFormValues = Readonly<Record<string, string | readonly string[]>>

/** One action on the focused thing. `fields` present ⇒ composite card (form + Run). */
export interface ConsoleVerb {
  readonly name: string
  readonly state: VerbState
  /** Opaque dispatch handle — FunctionDescriptor.id in the live console. The renderer never
   *  reads it; absent in fixtures (test bed runs answer with a cue only). */
  readonly callRef?: string
  /** UI-local action handle (no wire call) — e.g. options' Add options picker, which only edits
   *  desk membership. The page template interprets it; the renderer never reads it. */
  readonly localRef?: string
  /** Args the mapper already knows (tokenId, recipient…) merged under the form's values at
   *  dispatch — never rendered as fields. Form values win on collision. */
  readonly presetArgs?: Readonly<Record<string, string>>
  /** Mode switch: when the named field's value differs from `current` at Run, the dispatcher
   *  fires THIS call (with the value under `arg`) instead of `callRef` — e.g. switching a
   *  publish kind re-shapes the cell before its details can be configured. */
  readonly switchRef?: {
    readonly callRef: string
    readonly field: string
    readonly arg?: string
    readonly current: string
    readonly presetArgs?: Readonly<Record<string, string>>
  }
  readonly hot?: boolean // the suggested next action — at most one per card
  readonly fields?: readonly VerbField[]
  readonly hint?: string // locked: the unmet needs, plain words
  readonly path?: string // locked: the computed unlock chain, e.g. "prepare → start"
  readonly consequence?: string // guarded: what really happens if you run it
  readonly reason?: string // failed: what broke
  readonly doneAt?: string // done: timestamp label
}

export interface ConsoleFocusCard {
  readonly title: string
  /** CONTRACT: `status · fact · fact` — derived state, never prose. Same grammar on every card. */
  readonly sub: string
  readonly verbs: readonly ConsoleVerb[]
  /** CONTRACT: important state not shown elsewhere, plus AT MOST the latest happening. Never a log. */
  readonly history?: readonly string[]
}

export type AttentionTone = 'do' | 'wait' | 'err' | 'good'

/** A pointer, never a control: clicking one only moves Focus to `targetId`. */
export interface AttentionCard {
  readonly title: string
  readonly detail: string
  readonly targetId: string
  readonly tone: AttentionTone
}

export interface ConsoleModel {
  readonly role: ConsoleRole
  readonly things: readonly ConsoleThing[]
  readonly focus: Readonly<Record<string, ConsoleFocusCard>>
  readonly attention: readonly AttentionCard[]
  readonly defaultFocusId: string
}
