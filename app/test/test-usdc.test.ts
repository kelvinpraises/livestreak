import { describe, expect, it } from 'vitest'
import { decodeFunctionData } from 'viem'
import { testUsdcMintTransaction, TEST_USDC_MINT_ABI } from '../src/utils/test-usdc'
const token = '0x1234567890123456789012345678901234567890'
const user = '0x1234567890123456789012345678901234567890'
describe('Arbitrum Sepolia test USDC mint', () => {
  it('uses our configured test token, requested selector and six-decimal units', () => {
    const tx = testUsdcMintTransaction(421614, token, user, 100)
    expect(tx.to).toBe(token)
    expect(tx.data.slice(0,10)).toBe('0x40c10f19')
    expect(decodeFunctionData({abi:TEST_USDC_MINT_ABI,data:tx.data}).args).toEqual([user,100000000n])
    expect(tx.value).toBe(0n)
  })
  it('rejects other networks and invalid amounts before any request', () => {
    expect(() => testUsdcMintTransaction(31337,token,user,100)).toThrow('Arbitrum Sepolia')
    for (const amount of [NaN,Infinity,0,-1,0.0000001]) expect(() => testUsdcMintTransaction(421614,token,user,amount)).toThrow('positive USDC')
  })
})

it('does not mint when our deployment has no test token', () => {
  expect(() => testUsdcMintTransaction(421614,undefined,user,100)).toThrow('not configured')
})
