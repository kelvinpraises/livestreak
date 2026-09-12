import { localhostDeployment } from '@livestreak/contracts/evm'
import type { OptionsContractAddresses } from '@livestreak/options'

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
