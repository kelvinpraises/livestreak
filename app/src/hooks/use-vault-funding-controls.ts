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

  return {
    useOptions,
    fundYes,
    fundNo,
    stopFn,
    activeFundedSide,
    stopFunding: options.stopFunding,
  }
}
