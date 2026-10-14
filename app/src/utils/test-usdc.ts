import { encodeFunctionData, parseAbi, parseUnits, type Address } from 'viem'
import { EVM_NETWORK } from './chain'

export const TEST_USDC_MINT_ABI = parseAbi(['function mint(address to, uint256 amount)'])
export function testUsdcMintTransaction(chainId: number, token: Address | undefined, recipient: Address, amountUsd: number) {
  if (chainId !== EVM_NETWORK.chainId) throw new Error(`Test USDC mint is available only on ${EVM_NETWORK.name}.`)
  if (!token) throw new Error('Our test USDC deployment is not configured.');
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !/^\d+(\.\d{1,6})?$/.test(String(amountUsd))) throw new Error('Enter a positive USDC amount with at most six decimal places.')
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: TEST_USDC_MINT_ABI, functionName: 'mint', args: [recipient, parseUnits(String(amountUsd), 6)] }),
  }
}
