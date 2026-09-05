import { localhostDeployment } from '@livestreak/contracts/evm'
import type { OptionsContractAddresses } from '@livestreak/options'

export const LOCALHOST_RPC_URL = localhostDeployment.rpc

export const LOCALHOST_AA_CONTRACTS = localhostDeployment.scopes.aa?.contracts ?? {}

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
