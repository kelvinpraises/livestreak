import { isAddress } from 'viem'
import { localhostDeployment } from '@livestreak/contracts/evm'
import { localnetDeployment as suiLocalnetDeployment } from '@livestreak/contracts/sui'
import { localnetDeployment as solanaLocalnetDeployment } from '@livestreak/contracts/solana/deployments/localnet'
import type { OptionsContractAddresses } from '@livestreak/options'

import { SUPPORTED_CHAINS, readStoredChain, type OptionsChainKind } from './chain'

export const LOCALHOST_RPC_URL = localhostDeployment.rpc

export const LOCALHOST_AA_CONTRACTS = localhostDeployment.scopes.aa?.contracts ?? {}

// The local MockUSDC (permissionless `mint`). Only the dev faucet (useWalletActions) reads it, on the
// localhost EVM stack; undefined on any deployment that ships no mock token.
export const LOCALHOST_MOCK_USDC = (
  localhostDeployment.scopes.protocol?.contracts as Record<string, string> | undefined
)?.mockUsdc as `0x${string}` | undefined

export function buildOptionsContractAddresses(): OptionsContractAddresses {
  const protocol = localhostDeployment.scopes.protocol?.contracts ?? {}
  const wire = localhostDeployment.scopes.wire?.contracts ?? {}
  const streaming = localhostDeployment.scopes.streaming?.contracts ?? {}

  return {
    marketRegistry: protocol.marketRegistry as `0x${string}`,
    vault: protocol.vault as `0x${string}`,
    marketDriver: wire.marketDriverProxy as `0x${string}`,
    stewardRegistry: protocol.stewardRegistry as `0x${string}`,
    treasury: protocol.treasury as `0x${string}`,
    lvstToken: protocol.lvstToken as `0x${string}`,
    dripsStreaming: streaming.dripsStreaming as `0x${string}`,
  }
}

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const SUI_ID_RE = /^0x[0-9a-fA-F]{64}$/
const isPubkey = (v: unknown): v is string => typeof v === 'string' && SOLANA_PUBKEY_RE.test(v)
const isNonZeroSuiId = (v: unknown): v is string =>
  typeof v === 'string' && SUI_ID_RE.test(v) && !/^0x0+$/.test(v)

// Whether THIS build actually carries a usable deployment for the chain — validated against the bundled
// artifacts, so it reflects what the app can really boot. A Solana-only run ships stale/empty EVM+Sui
// addresses that would otherwise hard-crash the board; this lets the picker grey them out and the default
// steer clear, instead of the app wedging on an undeployed chain.
export function isChainDeployed(chain: OptionsChainKind): boolean {
  try {
    if (chain === 'evm') {
      const a = buildOptionsContractAddresses()
      return [
        a.marketRegistry,
        a.vault,
        a.marketDriver,
        a.stewardRegistry,
        a.treasury,
        a.lvstToken,
        a.dripsStreaming,
      ].every((x) => typeof x === 'string' && isAddress(x))
    }
    if (chain === 'solana') {
      return isPubkey(solanaLocalnetDeployment.programId) && isPubkey(solanaLocalnetDeployment.accounts?.usdcMint)
    }
    if (chain === 'sui') {
      return isNonZeroSuiId((suiLocalnetDeployment as { packageId?: unknown }).packageId)
    }
    return false
  } catch {
    return false
  }
}

export const deployedChains = (): OptionsChainKind[] =>
  SUPPORTED_CHAINS.map((c) => c.id).filter(isChainDeployed)

// The chain to boot when nothing valid is stored. Prefer what the dev harness is actually running
// (VITE_DEFAULT_CHAIN, set by dev.sh from CHAIN=…), else the first chain with a real deployment, else evm
// as a last resort (matches the historical default, so a full EVM stack is unaffected).
export function defaultChain(): OptionsChainKind {
  const envDefault = (import.meta.env.VITE_DEFAULT_CHAIN ?? undefined) as OptionsChainKind | undefined
  if (envDefault && isChainDeployed(envDefault)) return envDefault
  return deployedChains()[0] ?? 'evm'
}

// The chain the provider starts on: a valid stored pick wins (respect the user), else the smart default.
export function initialChain(enabled: boolean): OptionsChainKind {
  if (!enabled) return 'evm'
  const stored = readStoredChain()
  return stored && isChainDeployed(stored) ? stored : defaultChain()
}
