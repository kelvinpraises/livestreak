import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { Button } from '#/components/atoms/button'
import { SUPPORTED_CHAINS } from '#/utils/chain'

// Segmented two-pill control. This is NOT a hand-rolled overlay (no fragile
// dismiss logic to fix), so converting it to a DropdownMenu/Select would change
// a segmented control into a dropdown — a visible design change that breaks the
// parity bar. Instead we canonicalize each pill onto the shadcn `Button` atom
// (variant="ghost") and keep the exact look via inline styles, which win over
// the cva classes through tailwind-merge + inline-style precedence.
export function ChainSelector() {
  const optionsEnabled = isOptionsModeEnabled()
  const { chain, setChain, isLoading } = useOptionsContext()

  if (!optionsEnabled) return null

  return (
    <div data-testid="chain-selector" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {SUPPORTED_CHAINS.map(item => {
        const active = chain === item.id
        return (
          <Button
            key={item.id}
            variant="ghost"
            data-testid={`chain-select-${item.id}`}
            type="button"
            disabled={isLoading || active}
            title={active ? undefined : 'Switch chain — re-derives this chain’s wallet from your seed'}
            onClick={() => setChain(item.id)}
            style={{
              height: 'auto',
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${active ? 'rgba(0,255,135,0.35)' : 'rgba(255,255,255,0.1)'}`,
              background: active ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.04)',
              color: active ? '#00ff87' : 'rgba(255,255,255,0.45)',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
              cursor: isLoading ? 'wait' : active ? 'default' : 'pointer',
              opacity: isLoading && !active ? 0.6 : 1,
            }}
          >
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}
