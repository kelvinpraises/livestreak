// One verb on the focused thing, in any of its six states. `fields` present on a runnable verb
// renders the composite card (inline form + Run) — a derived rule, never a per-package choice:
//   ready   → lit row (hot = the one suggested next action, tinted)
//   locked  → muted row with the unmet needs and, when one exists, the computed unlock path
//   done    → check + timestamp
//   busy    → in-flight (write confirming / step running)
//   guarded → runnable but consequence-carrying; the consequence is spelled out under it
//   failed  → what broke, why, and a Retry — failure lives HERE, on the thing, never elsewhere

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowClockwise, ArrowElbowDownRight, Check, LockSimple, Warning, X } from '@phosphor-icons/react'
import type { ConsoleFormValues, ConsoleVerb, VerbField } from '#/types/console'
import { ConsolePicker } from '#/components/molecules/console-picker'

const mono = 'var(--font-mono)'

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0, // let inputs shrink in narrow flex rows instead of overflowing
  fontSize: 11,
  fontFamily: mono,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.25)',
  color: 'rgba(255,255,255,0.85)',
}

function FieldControl({ verbName, field }: { readonly verbName: string; readonly field: VerbField }) {
  const testId = `verb-field-${verbName}-${field.name}`
  switch (field.kind) {
    case 'picker':
      return (
        <div style={{ flex: 1 }}>
          <ConsolePicker field={field} />
        </div>
      )
    case 'select':
      return (
        <select data-testid={testId} defaultValue={field.value} style={inputStyle}>
          {(field.options ?? []).map((o) => (
            <option key={o.label} value={o.label} disabled={o.disabled}>
              {o.label}
              {o.disabled ? ', unavailable' : ''}
            </option>
          ))}
        </select>
      )
    case 'number':
      return (
        <input data-testid={testId} type="number" defaultValue={field.value} placeholder={field.name} style={inputStyle} />
      )
    default:
      return <input data-testid={testId} defaultValue={field.value} placeholder={field.name} style={inputStyle} />
  }
}

function FieldRow({
  verbName,
  field,
  onMutate,
}: {
  readonly verbName: string
  readonly field: VerbField
  /** Signals a value change that raw DOM delegation can't see (segment flips). */
  readonly onMutate?: () => void
}) {
  if (field.kind === 'select' && field.arms !== undefined) {
    return <DiscriminantField verbName={verbName} field={field} onMutate={onMutate} />
  }
  if (field.kind === 'picker') {
    // Full-width, no side label — the verb name already says what's being picked, and the
    // search placeholder repeats it. A "markets" label next to "Add market" is noise.
    return <FieldControl verbName={verbName} field={field} />
  }
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: mono }}>
      <span
        style={{
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          minWidth: 72,
        }}
      >
        {field.name}
      </span>
      <FieldControl verbName={verbName} field={field} />
    </label>
  )
}

/** A discriminant: the choice that shapes the fields below it — rendered as a FORK, not a field.
 *  ≤4 short-labeled arms render as a segmented radiogroup: all alternatives visible, a sliding
 *  thumb as the motion spine, arrow-key switching. Bigger sets fall back to the select + elbow
 *  glyph. All arms stay mounted (typed values survive); an inactive segment whose arm holds edits
 *  shows a memory dot. Hovering an inactive segment ~2s floats its fields in as a GHOST overlay
 *  (own glass layer, dashed, inert) — zero layout shift, never clipped. Swap motion is two-beat
 *  with a directional drift matching segment order:
 *    exit  — old fields fade+drift out FIRST (90ms), THEN the space closes over them.
 *    enter — space opens first (120–220ms, distance-scaled), content arrives 40ms behind.
 *  prefers-reduced-motion swaps instantly. Nothing above the control ever moves. */
function DiscriminantField({
  verbName,
  field,
  onMutate,
}: {
  readonly verbName: string
  readonly field: VerbField
  readonly onMutate?: () => void
}) {
  const options = field.options ?? []
  // Derived control rule, never an authored flag: few short arms → segments; otherwise select.
  const asSegments = options.length > 0 && options.length <= 4 && options.every((o) => o.label.length <= 12)
  const [selValue, setSelValue] = useState(field.value) // the control responds instantly…
  const [arm, setArm] = useState(field.value) // …the arm block follows after the exit beat
  const [preview, setPreview] = useState<string | undefined>(undefined)
  const [dirtyArms, setDirtyArms] = useState<ReadonlySet<string>>(() => new Set())
  const [thumb, setThumb] = useState<{ x: number; w: number } | undefined>(undefined)
  const outer = useRef<HTMLDivElement | null>(null)
  const segRow = useRef<HTMLDivElement | null>(null)
  const groupValue = useRef<HTMLInputElement | null>(null)
  const fromHeight = useRef<number | undefined>(undefined)
  const swapDir = useRef(0)
  const pendingSwap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  const reduced = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(
    () => () => {
      clearTimeout(pendingSwap.current)
      clearTimeout(previewTimer.current)
    },
    []
  )

  const armEl = (key: string): HTMLElement | undefined => {
    const el = outer.current
    if (el === null) return undefined
    return Array.from(el.querySelectorAll<HTMLElement>('[data-arm]')).find((d) => d.dataset['arm'] === key)
  }

  const closePreview = () => {
    clearTimeout(previewTimer.current)
    setPreview(undefined)
  }

 
  const startPreview = (label: string) => {
    clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => setPreview(label), 1200)
  }

  const pick = (value: string) => {
    if (value === selValue) return
    closePreview()
    const idx = (v: string) => options.findIndex((o) => o.label === v)
    swapDir.current = idx(value) >= idx(arm) ? 1 : -1
    setSelValue(value)
    clearTimeout(pendingSwap.current)
    fromHeight.current = outer.current?.offsetHeight
    const old = armEl(arm)
    const oldHasFields = (field.arms?.[arm] ?? []).length > 0
    if (reduced.current || old === undefined || !oldHasFields || typeof old.animate !== 'function') {
      setArm(value)
      return
    }
    old.getAnimations?.().forEach((a) => a.cancel())
    old.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${swapDir.current * -6}px)` },
      ],
      { duration: 90, easing: 'ease-out', fill: 'forwards' }
    )
    // Deterministic clock, not onfinish — the swap must land even where animations don't run.
    pendingSwap.current = setTimeout(() => setArm(value), 90)
  }

  // Segments aren't form controls, so two pieces make the flip diffable: a hidden input carries
  // the choice into the snapshot (readValues sees it), and onMutate tells the card to re-diff —
  // React's change delegation ignores hidden inputs, so an explicit callback, not an event trick.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    onMutate?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selValue])

  // The thumb tracks the active segment.
  useLayoutEffect(() => {
    if (!asSegments) return
    const btn = Array.from(segRow.current?.querySelectorAll<HTMLElement>('[data-seg]') ?? []).find(
      (b) => b.dataset['seg'] === selValue
    )
    if (btn !== undefined) setThumb({ x: btn.offsetLeft, w: btn.offsetWidth })
  }, [selValue, asSegments])

  useLayoutEffect(() => {
    const el = outer.current
    const from = fromHeight.current
    if (el === null || from === undefined) return
    fromHeight.current = undefined
    const incoming = armEl(arm)
    incoming?.getAnimations?.().forEach((a) => a.cancel()) // clear a stale exit fill before re-entry
    if (reduced.current) return
    const to = el.scrollHeight
    if (from !== to) {
      const dur = Math.round(Math.min(220, Math.max(120, Math.abs(to - from) * 1.6)))
      el.style.height = `${from}px`
      el.style.overflow = 'hidden'
      void el.offsetHeight
      el.style.transition = `height ${dur}ms cubic-bezier(0.25, 1, 0.5, 1)`
      el.style.height = `${to}px`
      const settle = () => {
        el.style.transition = ''
        el.style.height = 'auto'
        el.style.overflow = ''
        el.removeEventListener('transitionend', settle)
      }
      el.addEventListener('transitionend', settle)
    }
    incoming?.animate?.(
      [
        { opacity: 0, transform: `translateX(${swapDir.current * 8}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      {
        duration: 140,
        delay: 40,
        easing: 'ease-out',
        fill: 'backwards', // holds invisible through the delay — space opens, then content arrives
      }
    )
  }, [arm])

  // Preview open: clear stale exit fills so the ghost isn't stuck at opacity 0, then fade it in.
  useLayoutEffect(() => {
    if (preview === undefined) return
    const ghost = armEl(preview)
    ghost?.getAnimations?.().forEach((a) => a.cancel())
    if (!reduced.current) {
      ghost?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 100, easing: 'ease-out' })
    }
  }, [preview])

  // Branch memory: does this arm's DOM hold values differing from its defaults? (Picker search
  // excluded — searching isn't a change. Hidden inputs excluded — they're plumbing.)
  const refreshDirty = (armKey: string) => {
    const div = armEl(armKey)
    if (div === undefined) return
    const dirty = Array.from(
      div.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
    ).some((el) => {
      if (el.dataset['testid']?.startsWith('picker-search') === true) return false
      if (el instanceof HTMLInputElement) {
        if (el.type === 'hidden') return false
        if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked
        return el.value !== el.defaultValue
      }
      const def = Array.from(el.options).find((o) => o.defaultSelected)
      return def !== undefined && el.value !== def.value
    })
    setDirtyArms((prev) => {
      if (prev.has(armKey) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(armKey)
      else next.delete(armKey)
      return next
    })
  }

  // Radiogroup keys: one arrow press switches arms — cheaper than any popup.
  const onGroupKey = (e: React.KeyboardEvent) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    e.preventDefault()
    const enabled = options.filter((o) => o.disabled !== true)
    const i = enabled.findIndex((o) => o.label === selValue)
    const next = enabled[(i + step + enabled.length) % enabled.length]
    if (next === undefined) return
    pick(next.label)
    requestAnimationFrame(() => {
      Array.from(segRow.current?.querySelectorAll<HTMLElement>('[data-seg]') ?? [])
        .find((b) => b.dataset['seg'] === next.label)
        ?.focus()
    })
  }

  const activeArmEmpty = (field.arms?.[selValue] ?? []).length === 0
  // ALL arms stay mounted (typed values survive swapping away and back). The active arm renders in
  // flow; a previewed arm renders as a floating GHOST above it — inert, dashed ("not real yet"),
  // on its own layer so the glance costs zero layout shift and never clips.
  const armZone = (
    <div ref={outer} style={{ height: 'auto', position: 'relative' }}>
      {Object.entries(field.arms ?? {}).map(([armKey, armFields]) => {
        if (armFields.length === 0) return null
        const isGhost = armKey === preview && armKey !== arm
        return (
          <div
            key={armKey}
            data-arm={armKey}
            onInput={() => refreshDirty(armKey)}
            onChange={() => refreshDirty(armKey)}
            // Longhand-only, SAME keys in both states. React's style differ writes only changed
            // keys — a shorthand (padding/border) present in one state and absent in the other
            // gets cleared WITHOUT its unchanged longhand sibling being re-applied, which is how
            // every once-previewed arm silently lost its left padding (the rail-touching bug).
            style={{
              display: armKey === arm || isGhost ? 'flex' : 'none',
              marginTop: 4,
              marginLeft: 4,
              paddingTop: isGhost ? 6 : 0,
              paddingRight: isGhost ? 10 : 0,
              paddingBottom: isGhost ? 8 : 0,
              paddingLeft: 10,
              borderWidth: isGhost ? 1 : '0 0 0 1px',
              borderStyle: isGhost ? 'dashed' : 'solid',
              borderColor: isGhost ? 'rgba(0,255,135,0.35)' : 'rgba(0,255,135,0.22)',
              flexDirection: 'column',
              gap: 4,
              ...(isGhost
                ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 5,
                    pointerEvents: 'none',
                    // Glass: semi-opaque backdrop + blur — content stays fully legible (opacity 1).
                    background: 'rgba(13, 18, 15, 0.72)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    borderRadius: 8,
                    boxShadow: '0 10px 26px rgba(0,0,0,0.5)',
                  }
                : {}),
            }}
          >
            {armFields.map((f) => (
              <FieldRow key={f.name} verbName={verbName} field={f} onMutate={onMutate} />
            ))}
          </div>
        )
      })}
    </div>
  )

  if (asSegments) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: mono }}>
          <span
            style={{
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              minWidth: 72,
            }}
          >
            {field.name}
          </span>
          {/* Carries the group's choice into the diff snapshot (segments aren't form controls). */}
          <input
            type="hidden"
            ref={groupValue}
            value={selValue}
            readOnly
            data-testid={`verb-field-${verbName}-${field.name}`}
          />
          <div
            ref={segRow}
            role="radiogroup"
            aria-label={field.name}
            onKeyDown={onGroupKey}
            style={{
              position: 'relative',
              display: 'inline-flex',
              gap: 2,
              padding: 2,
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 7,
            }}
          >
            {thumb !== undefined ? (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 2,
                  bottom: 2,
                  left: thumb.x,
                  width: thumb.w,
                  background: 'rgba(0,255,135,0.1)',
                  border: '1px solid rgba(0,255,135,0.35)',
                  borderRadius: 5,
                  transition: reduced.current
                    ? 'none'
                    : 'left 180ms cubic-bezier(0.25, 1, 0.5, 1), width 180ms cubic-bezier(0.25, 1, 0.5, 1)',
                }}
              />
            ) : null}
            {options.map((o) => {
              const active = o.label === selValue
              return (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-seg={o.label}
                  data-testid={`verb-seg-${verbName}-${field.name}-${o.label}`}
                  disabled={o.disabled}
                  tabIndex={active ? 0 : -1}
                  onClick={() => pick(o.label)}
                  onPointerEnter={() => {
                    if (!active && o.disabled !== true) startPreview(o.label)
                  }}
                  onPointerLeave={closePreview}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    fontSize: 10,
                    fontFamily: mono,
                    padding: '3px 10px',
                    borderRadius: 5,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: active
                      ? '#00ff87'
                      : o.disabled === true
                        ? 'rgba(255,255,255,0.25)'
                        : 'rgba(255,255,255,0.55)',
                    cursor: o.disabled === true ? 'default' : 'pointer',
                  }}
                >
                  {o.label}
                  {/* Branch memory: this inactive arm holds your edits. */}
                  {!active && dirtyArms.has(o.label) ? (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: 2,
                        right: 3,
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        background: 'rgba(0,255,135,0.8)',
                      }}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
        {armZone}
      </div>
    )
  }

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontFamily: mono }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            minWidth: 72,
          }}
        >
          {field.name}
          <ArrowElbowDownRight
            size={10}
            style={{ opacity: activeArmEmpty ? 0.2 : 0.55, transition: 'opacity 160ms ease' }}
            aria-hidden="true"
          />
        </span>
        <select
          data-testid={`verb-field-${verbName}-${field.name}`}
          value={selValue}
          onChange={(e) => pick(e.target.value)}
          style={inputStyle}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.label} value={o.label} disabled={o.disabled}>
              {o.label}
              {o.disabled ? ', unavailable' : ''}
            </option>
          ))}
        </select>
      </label>
      {armZone}
    </div>
  )
}

function Fields({ verb, onMutate }: { readonly verb: ConsoleVerb; readonly onMutate?: () => void }) {
  if (!verb.fields || verb.fields.length === 0) return null
  return (
    <div style={{ margin: '6px 0 2px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {verb.fields.map((f) => (
        <FieldRow key={f.name} verbName={verb.name} field={f} onMutate={onMutate} />
      ))}
    </div>
  )
}

const HOLD_MS = 5000

/** Guarded verbs run by HOLDING (~5s): a light green fill grows left→right across the pill.
 *  Accessibility, slider-style: the pill exposes progressbar semantics (aria-valuenow = %) and a
 *  polite live region announces progress in 20% steps — "closing out · 40%" — plus start/cancel/
 *  done. Keyboard holds work (hold Space/Enter). Screen-reader virtual cursors that can't sustain
 *  a press need an alternate path later (see reply notes). */
function HoldRunButton({ verb, onRun }: { readonly verb: ConsoleVerb; readonly onRun: (name: string) => void }) {
  const [progress, setProgress] = useState(0)
  const [announce, setAnnounce] = useState('')
  const [armed, setArmed] = useState(false)
  const raf = useRef<number | undefined>(undefined)
  const startTs = useRef<number | undefined>(undefined)
  const lastStep = useRef(-1)
  const keyHeld = useRef(false)
  const maxProgress = useRef(0)
  const armTs = useRef(0)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current ?? 0)
      clearTimeout(disarmTimer.current)
    },
    []
  )

  const disarm = () => {
    clearTimeout(disarmTimer.current)
    setArmed(false)
  }

  const stop = (done: boolean) => {
    cancelAnimationFrame(raf.current ?? 0)
    startTs.current = undefined
    lastStep.current = -1
    setProgress(0)
    setAnnounce(done ? `${verb.name} · done` : progress > 0 ? `${verb.name} · cancelled` : '')
    if (done) {
      disarm()
      onRun(verb.name)
    }
  }

  // Two-step confirm fallback for AT that can't sustain a press (screen-reader virtual cursors,
  // switch control): a DISCRETE activation (tap/click with no real hold behind it) arms the button
  // — "press again to confirm" — and a second discrete press ≥700ms later runs it. Auto-disarms
  // after 5s. Real holds bypass all of this; a hold-release's trailing click is ignored.
  const onDiscreteActivate = () => {
    if (maxProgress.current > 0.08) {
      maxProgress.current = 0
      return // this click is the tail of a hold attempt, not a discrete activation
    }
    if (!armed) {
      setArmed(true)
      armTs.current = Date.now()
      setAnnounce(`${verb.name} · press again to confirm`)
      clearTimeout(disarmTimer.current)
      disarmTimer.current = setTimeout(() => {
        setArmed(false)
        setAnnounce(`${verb.name} · confirm expired`)
      }, 5000)
      return
    }
    if (Date.now() - armTs.current >= 700) {
      disarm()
      setAnnounce(`${verb.name} · done`)
      onRun(verb.name)
    }
  }

  const tick = (ts: number) => {
    if (startTs.current === undefined) startTs.current = ts
    const p = Math.min(1, (ts - startTs.current) / HOLD_MS)
    setProgress(p)
    maxProgress.current = Math.max(maxProgress.current, p)
    const step = Math.floor(p * 5)
    if (step > lastStep.current) {
      lastStep.current = step
      setAnnounce(`${verb.name} · ${step * 20}%`)
    }
    if (p >= 1) {
      stop(true)
      return
    }
    raf.current = requestAnimationFrame(tick)
  }

  const begin = () => {
    if (startTs.current !== undefined) return
    lastStep.current = -1
    maxProgress.current = 0
    raf.current = requestAnimationFrame(tick)
  }

  return (
    <>
      <button
        type="button"
        data-testid={`verb-hold-${verb.name}`}
        aria-label={
          armed
            ? `${verb.name}, press again to confirm`
            : `${verb.name}, hold for 5 seconds, or press twice to confirm`
        }
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onClick={onDiscreteActivate}
        onPointerDown={begin}
        onPointerUp={() => stop(false)}
        onPointerLeave={() => stop(false)}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !keyHeld.current) {
            keyHeld.current = true
            begin()
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            keyHeld.current = false
            stop(false)
          }
        }}
        onBlur={() => {
          keyHeld.current = false
          stop(false)
        }}
        style={{
          position: 'relative',
          overflow: 'hidden',
          fontSize: 11,
          padding: '3px 12px',
          borderRadius: 6,
          border: armed ? '1px solid rgba(255,178,36,0.5)' : '1px solid rgba(0,255,135,0.35)',
          background: armed ? 'rgba(255,178,36,0.1)' : 'rgba(0,255,135,0.06)',
          color: armed ? '#ffb224' : '#00ff87',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: `${progress * 100}%`,
            background: 'rgba(0,255,135,0.28)',
            transition: progress === 0 ? 'width 180ms ease' : 'none',
            pointerEvents: 'none',
          }}
        />
        <span style={{ position: 'relative' }}>{armed ? 'Confirm?' : 'Hold'}</span>
      </button>
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {announce}
      </span>
    </>
  )
}

function RunButton({ verb, onRun }: { readonly verb: ConsoleVerb; readonly onRun: (name: string) => void }) {
  return (
    <button
      type="button"
      data-testid={`verb-run-${verb.name}`}
      onClick={() => onRun(verb.name)}
      style={{
        fontSize: 11,
        padding: '3px 12px',
        borderRadius: 6,
        border: '1px solid rgba(0,255,135,0.35)',
        background: 'rgba(0,255,135,0.12)',
        color: '#00ff87',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      Run
    </button>
  )
}

/** Is this element inside an inactive (hidden) or previewed (ghost) discriminant arm?
 *  Only the ACTIVE arm's values are real form state. */
const inInactiveArm = (el: HTMLElement): boolean => {
  const arm = el.closest<HTMLElement>('[data-arm]')
  if (arm === null) return false
  return arm.style.display === 'none' || arm.style.position === 'absolute'
}

export function ConsoleVerbRow({
  verb,
  onRun,
}: {
  readonly verb: ConsoleVerb
  readonly onRun: (name: string, values: ConsoleFormValues) => void
}) {
  // After a completed run the button HIDES; it only returns when something updates — here, the
  // user editing the form (real data updates re-render the verb from fresh model state anyway).
  // "sent" is feedback, not a state: it flashes ~2.5s then fades, leaving the spot quiet.
  const [ran, setRan] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [sentVisible, setSentVisible] = useState(false)
  const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fieldsRef = useRef<HTMLDivElement | null>(null)
  const snapshot = useRef('')
  useEffect(() => () => clearTimeout(sentTimer.current), [])

  // A REAL model update to this verb (state flip, new facts) resets the run-once latch — fresh
  // state means re-runnable, exactly as the update-restores-Run rule specifies. With stabilized
  // models, identical pushes never reach here.
  const verbJson = JSON.stringify(verb)
  const mountedJson = useRef(verbJson)
  useEffect(() => {
    if (mountedJson.current === verbJson) return
    mountedJson.current = verbJson
    setRan(false)
    setDirty(false)
    setSentVisible(false)
  }, [verbJson])

  // Serialize current form values (picker search excluded — typing a search isn't a change).
  const readValues = (): string => {
    const root = fieldsRef.current
    if (root === null) return ''
    const parts: string[] = []
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
      if (el.dataset['testid']?.startsWith('picker-search') === true) return
      parts.push(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? String(el.checked) : el.value)
    })
    return parts.join('\u0000')
  }

  // Named form snapshot for dispatch: field display name → value(s). Picker options collapse to
  // their checked labels; the discriminant group's hidden input IS a value (the chosen arm);
  // inactive/ghost arms and picker-search inputs are not form state and never ship.
  const readNamedValues = (): ConsoleFormValues => {
    const root = fieldsRef.current
    if (root === null) return {}
    const out: Record<string, string | string[]> = {}
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
      const testid = el.dataset['testid'] ?? ''
      if (testid.startsWith('picker-search')) return
      if (inInactiveArm(el)) return
      const pickerField = el instanceof HTMLInputElement ? /^picker-(.+)$/.exec(el.getAttribute('name') ?? '') : null
      if (pickerField !== null) {
        const name = pickerField[1] ?? ''
        if (el instanceof HTMLInputElement && el.checked) {
          const prev = out[name]
          out[name] = Array.isArray(prev) ? [...prev, el.value] : prev !== undefined ? [String(prev), el.value] : [el.value]
        } else if (out[name] === undefined) {
          out[name] = [] // picker present but nothing checked yet
        }
        return
      }
      const prefix = `verb-field-${verb.name}-`
      if (!testid.startsWith(prefix)) return
      out[testid.slice(prefix.length)] = el.value
    })
    return out
  }

  const runOnce = (name: string) => {
    setRan(true)
    setDirty(false)
    snapshot.current = readValues()
    setSentVisible(true)
    clearTimeout(sentTimer.current)
    sentTimer.current = setTimeout(() => setSentVisible(false), 2500)
    onRun(name, readNamedValues())
  }

  // Diff against the as-run snapshot: type a change → Run returns; revert it back → Run hides again.
  const markDirty = () => {
    if (!ran) return
    const isDirty = readValues() !== snapshot.current
    setDirty(isDirty)
    if (isDirty) setSentVisible(false)
  }
  const showButton = !ran || dirty
  // Fixed-footprint slot: button, sent-mark, or nothing all occupy the same box — zero CLS.
  const slot = (content: React.ReactNode, minWidth: number) => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        minWidth,
        height: 24,
        flexShrink: 0,
      }}
    >
      {content}
    </span>
  )
  const sentMark = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10.5,
        color: 'rgba(0,255,135,0.7)',
        fontFamily: mono,
        opacity: sentVisible ? 1 : 0,
        transition: 'opacity 300ms ease',
      }}
    >
      <Check size={12} /> sent
    </span>
  )
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 8,
    fontSize: 12.5,
    fontFamily: 'var(--font-sans)',
  }

  if (verb.state === 'done') {
    return (
      <div data-testid={`verb-${verb.name}`} style={{ ...base, color: 'rgba(255,255,255,0.55)' }}>
        <Check size={13} color="#00ff87" />
        <span style={{ flex: 1 }}>{verb.name}</span>
        {verb.doneAt ? (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', fontFamily: mono }}>{verb.doneAt}</span>
        ) : null}
      </div>
    )
  }

  if (verb.state === 'busy') {
    return (
      <div
        data-testid={`verb-${verb.name}`}
        style={{ ...base, background: 'rgba(255,178,36,0.1)', color: '#ffb224' }}
      >
        <ArrowClockwise size={13} />
        <span style={{ flex: 1 }}>{verb.name}</span>
        <span style={{ fontSize: 10.5, fontFamily: mono }}>running…</span>
      </div>
    )
  }

  if (verb.state === 'failed') {
    return (
      <div
        data-testid={`verb-${verb.name}`}
        style={{
          border: '1px solid rgba(255,45,120,0.35)',
          borderRadius: 8,
          padding: '7px 8px',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: '#ff2d78' }}>
          <X size={13} />
          <span style={{ fontWeight: 600, flex: 1 }}>{verb.name} failed</span>
        </div>
        {verb.reason ? (
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: '3px 0 6px' }}>{verb.reason}</p>
        ) : null}
        {/* The form STAYS on failure — a local coercion error ("question: Required") must be fixable
            in place; without fields, Retry could only replay the same bad args forever. */}
        <div ref={fieldsRef}>
          <Fields verb={verb} />
        </div>
        <button
          type="button"
          data-testid={`verb-retry-${verb.name}`}
          // Retry re-reads the (possibly corrected) form; empty values fall back to the stored envelope.
          onClick={() => onRun(verb.name, readNamedValues())}
          style={{
            fontSize: 11,
            padding: '3px 12px',
            borderRadius: 6,
            border: '1px solid rgba(255,45,120,0.4)',
            background: 'rgba(255,45,120,0.12)',
            color: '#ff2d78',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (verb.state === 'guarded') {
    return (
      <div
        data-testid={`verb-${verb.name}`}
        // Destructive acts stand apart: triple the stack gap above a guarded verb.
        style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 8px', marginTop: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <Warning size={13} color="#ffb224" />
          <span style={{ flex: 1, color: 'rgba(255,255,255,0.7)' }}>{verb.name}</span>
          {slot(showButton ? <HoldRunButton verb={verb} onRun={runOnce} /> : sentMark, 76)}
        </div>
        {verb.consequence ? (
          <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', margin: '3px 0 0 21px' }}>
            {verb.consequence}
          </p>
        ) : null}
      </div>
    )
  }

  if (verb.state === 'locked') {
    return (
      <div data-testid={`verb-${verb.name}`} style={{ ...base, color: 'rgba(255,255,255,0.4)' }}>
        <LockSimple size={13} />
        <span style={{ flex: 1 }}>{verb.name}</span>
        <span style={{ fontSize: 10.5, fontFamily: mono }}>
          {verb.hint}
          {verb.path ? ` · path: ${verb.path}` : ''}
        </span>
      </div>
    )
  }

  // ready — the composite card when fields exist, a plain lit row otherwise. The tint rule:
  // more than one stack (fields under the header) → green card; a single name+Run line → plain.
  const isComposite = verb.fields !== undefined && verb.fields.length > 0
  return (
    <div
      data-testid={`verb-${verb.name}`}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        background: isComposite ? 'rgba(0,255,135,0.08)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#00ff87', flex: 1 }}>{verb.name}</span>
        {slot(showButton ? <RunButton verb={verb} onRun={runOnce} /> : sentMark, 56)}
      </div>
      {verb.hint ? (
        <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', margin: '1px 0 0', fontFamily: mono }}>
          {verb.hint}
        </p>
      ) : null}
      <div ref={fieldsRef} onInput={markDirty} onChange={markDirty}>
        <Fields verb={verb} onMutate={markDirty} />
      </div>
    </div>
  )
}
