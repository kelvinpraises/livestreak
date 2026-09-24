// The console shell: Desk · Focus · Attention, composed. Generic by construction — it receives
// ConsoleModels keyed by tab name and renders whatever it's given. It contains no package names,
// no role branches, no layout modes. Selection state and the run cue live here; that's all.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Gear } from '@phosphor-icons/react'
import type { ConsoleFormValues, ConsoleModel } from '#/types/console'
import { ConsoleDesk } from '#/components/organisms/console-desk'
import { ConsoleFocus } from '#/components/organisms/console-focus'
import { ConsoleAttention } from '#/components/organisms/console-attention'

// Inline styles can't carry media queries — the region grid stacks to one column on narrow
// viewports via this class pair (Desk → Focus → Attention in source order).
const RESPONSIVE_CSS = `
.ls-console-wrap { max-width: 1180px; margin: 0 auto; padding: 28px 24px; }
.ls-console-grid {
  display: grid;
  grid-template-columns: minmax(170px, 0.95fr) minmax(0, 1.7fr) minmax(180px, 0.95fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 960px) {
  .ls-console-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .ls-console-wrap { padding: 20px 14px; }
}
`

const REGION_LABEL: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'rgba(255,255,255,0.4)',
  margin: '0 0 6px',
  fontFamily: 'var(--font-mono)',
}

// Location persistence, simplest form: active tab + per-tab selection in localStorage. Invalid or
// stale entries fall back to defaults via the existing focusId validation — nothing else to check.
const LOCATION_KEY = 'livestreak-console-location'

const readLocation = (key: string): { tab?: string; selected?: Record<string, string | undefined> } => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
      tab?: string
      selected?: Record<string, string | undefined>
    }
  } catch {
    return {}
  }
}

function ConsoleShellInner({
  models,
  onRun,
  onOpenSettings,
  storageKey = LOCATION_KEY,
}: {
  readonly models: Readonly<Record<string, ConsoleModel>>
  /** Optional real dispatcher; absent = test bed, runs answer with a cue only.
   *  `values` is the verb form's named snapshot at run time (active discriminant arm only). */
  readonly onRun?: (tab: string, thingId: string, verbName: string, values: ConsoleFormValues) => void
  /** Wires the gear button; absent = gear stays inert (test bed). */
  readonly onOpenSettings?: () => void
  /** Location-persistence key; the live console suffixes the session id so sessions
   *  and the test bed don't share state. */
  readonly storageKey?: string
}) {
  const tabs = useMemo(() => Object.keys(models), [models])
  const [tab, setTab] = useState(() => {
    const stored = readLocation(storageKey).tab
    return stored !== undefined && tabs.includes(stored) ? stored : (tabs[0] ?? '')
  })
  const [selected, setSelected] = useState<Record<string, string | undefined>>(
    () => readLocation(storageKey).selected ?? {}
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ tab, selected }))
    } catch {
      /* storage unavailable — location just doesn't persist */
    }
  }, [storageKey, tab, selected])
  const [cue, setCue] = useState<string | undefined>(undefined)
  const cueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(cueTimer.current), [])

  // The live console's models arrive async (empty until the ready frame) — the stored/initial
  // tab may not exist yet or ever, so resolve to the first real tab at render time.
  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? '')
  const model = models[activeTab]
  if (model === undefined) return null

  const wanted = selected[activeTab]
  const focusId =
    wanted !== undefined && model.things.some((t) => t.id === wanted) ? wanted : model.defaultFocusId
  const card = model.focus[focusId]

  const select = (id: string) => setSelected((prev) => ({ ...prev, [activeTab]: id }))

  const run = (verbName: string, values: ConsoleFormValues) => {
    onRun?.(activeTab, focusId, verbName, values)
    setCue(onRun ? `${verbName} · sent` : `${verbName} · test bed, not wired`)
    clearTimeout(cueTimer.current)
    cueTimer.current = setTimeout(() => setCue(undefined), 2200)
  }

  return (
    <div className="ls-console-wrap">
      <style>{RESPONSIVE_CSS}</style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div data-testid="console-tabs" style={{ display: 'flex', gap: 6, flex: 1 }}>
          {tabs.map((t) => {
            const active = t === activeTab
            return (
              <button
                key={t}
                type="button"
                data-testid={`console-tab-${t}`}
                onClick={() => setTab(t)}
                style={{
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: active ? '1px solid rgba(0,255,135,0.45)' : '1px solid rgba(255,255,255,0.1)',
                  background: active ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#00ff87' : 'rgba(255,255,255,0.55)',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-label="settings"
          title="settings"
          data-testid="console-settings"
          onClick={onOpenSettings}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.03)',
            color: 'rgba(255,255,255,0.45)',
            cursor: 'pointer',
          }}
        >
          <Gear size={14} />
        </button>
      </div>

      <div className="ls-console-grid">
        <div>
          <p style={REGION_LABEL}>Desk</p>
          <ConsoleDesk things={model.things} selectedId={focusId} onSelect={select} />
        </div>
        <div>
          <p style={REGION_LABEL}>Focus</p>
          {card !== undefined ? (
            <ConsoleFocus card={card} cue={cue} onRun={run} />
          ) : (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>nothing focused</p>
          )}
        </div>
        <div>
          <p style={REGION_LABEL}>Attention</p>
          <ConsoleAttention cards={model.attention} onJump={select} />
        </div>
      </div>
    </div>
  )
}

/** Memoized: with stabilized model identity and stable callbacks, a board push that changes
 *  nothing renders nothing. */
export const ConsoleShell = memo(ConsoleShellInner)
