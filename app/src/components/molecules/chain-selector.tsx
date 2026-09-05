import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import type { OptionsChainKind } from '#/utils/chain'

const CHAINS: { id: OptionsChainKind; label: string }[] = [
  { id: 'evm', label: 'EVM' },
  { id: 'sui', label: 'Sui' },
]

export function ChainSelector() {
  const optionsEnabled = isOptionsModeEnabled()
  const { chain, setChain, isConnected, isLoading } = useOptionsContext()

  if (!optionsEnabled) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {CHAINS.map(item => {
        const active = chain === item.id
        return (
          <button
            key={item.id}
            type="button"
            disabled={isLoading || (isConnected && !active)}
            title={isConnected && !active ? 'Disconnect to switch chain' : undefined}
            onClick={() => setChain(item.id)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${active ? 'rgba(0,255,135,0.35)' : 'rgba(255,255,255,0.1)'}`,
              background: active ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.04)',
              color: active ? '#00ff87' : 'rgba(255,255,255,0.45)',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
              cursor: isLoading || (isConnected && !active) ? 'not-allowed' : 'pointer',
              opacity: isConnected && !active ? 0.45 : 1,
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
