import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'

export function useVaultFundingControls(vaultId: string) {
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected

  const fundYes = useOptions ? options.findFundFunction(vaultId, 'yes') : undefined
  const fundNo = useOptions ? options.findFundFunction(vaultId, 'no') : undefined
  const stopFn = useOptions ? options.findStopFundingFunction(vaultId) : undefined
  const activeFundedSide = stopFn && !stopFn.disabled && stopFn.target?.side
    ? stopFn.target.side
    : undefined
  // D: whether the market's position NFT already exists. When it doesn't, the single funding flow
  // mints it on first fund, so the UI must still let the user initiate (see FocusedVault gating).
  const hasNft = useOptions ? options.hasNftForVault(vaultId) : true

  return {
    useOptions,
    fundYes,
    fundNo,
    stopFn,
    activeFundedSide,
    hasNft,
    stopFunding: options.stopFunding,
  }
}
