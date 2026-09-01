/**
 * Contract addresses + chain config, read from env.
 * All hooks import from here. After deployment, just update .env.
 */

import { createPublicClient, http, defineChain, type Address } from 'viem'

export const arcTestnet = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID || 5042002),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_ARC_RPC_URL || 'https://testnet-rpc.arc.network'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet-scan.arc.network' } },
})

const ZERO = '0x0000000000000000000000000000000000000000' as Address

export const contracts = {
  vault: (import.meta.env.VITE_VAULT_ADDRESS || ZERO) as Address,
  flowToken: (import.meta.env.VITE_FLOW_TOKEN_ADDRESS || ZERO) as Address,
  agentRegistry: (import.meta.env.VITE_AGENT_REGISTRY_ADDRESS || ZERO) as Address,
  observerRegistry: (import.meta.env.VITE_OBSERVER_REGISTRY_ADDRESS || ZERO) as Address,
  steward: (import.meta.env.VITE_STEWARD_ADDRESS || ZERO) as Address,
  protocolLP: (import.meta.env.VITE_PROTOCOL_LP_ADDRESS || ZERO) as Address,
  usdc: (import.meta.env.VITE_USDC_ADDRESS || '0x3600000000000000000000000000000000000000') as Address,
} as const

/** True when contracts are deployed (not zero addresses) */
export function isDeployed(): boolean {
  return contracts.vault !== ZERO
}

/** Shared public client for read operations */
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
})

// ─── ABIs (minimal fragments for reads) ───

export const AGENT_REGISTRY_ABI = [
  {
    type: 'function', name: 'getAgent',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'agentAddress', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'vaultsCreated', type: 'uint256' },
      { name: 'wins', type: 'uint256' },
      { name: 'losses', type: 'uint256' },
      { name: 'accuracy', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getAgentList',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'totalAgents',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const VAULT_ABI = [
  {
    type: 'function', name: 'vaults',
    inputs: [{ name: 'vaultId', type: 'bytes32' }],
    outputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'option', type: 'string' },
      { name: 'optionType', type: 'uint8' },
      { name: 'creator', type: 'address' },
      { name: 'noTotal', type: 'uint256' },
      { name: 'yesTotal', type: 'uint256' },
      { name: 'noCurveK', type: 'uint256' },
      { name: 'yesCurveK', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'hotUntil', type: 'uint256' },
      { name: 'hotSeverity', type: 'uint8' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'proofCid', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
      { name: 'challengeUntil', type: 'uint256' },
      { name: 'creatorSideYes', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'totalVaults',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const FLOW_TOKEN_ABI = [
  {
    type: 'function', name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'totalStaked',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const PROTOCOL_LP_ABI = [
  {
    type: 'function', name: 'totalDeposited',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'surplus',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// ─── ERC-4337 / Safe account-abstraction config (for @livestreak/wallet) ───
//
// These are the CREATE2 deterministic Safe + EntryPoint addresses (identical on
// every EVM chain). Bundler/paymaster default to the local host server; override
// via env in production. This shape mirrors @livestreak/schema's WalletInitConfig.

const AA_ADDRESSES = {
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeSingleton: '0x1cf8d29422e1264787cba22589fc77f420fdb048',
  safeProxyFactory: '0xa9a878ece38017405daa6fef6f55372a3774e981',
  safe4337Module: '0xa8faf83e7dec6beec5cf460aa2a4433964f99887',
  safeModuleSetup: '0x0a506308777a2b272fa78c95720e17530bbab1d9',
  multiSend: '0x24f5b0ebb7742a074e7d9127d55733ea61cf22bf',
  multiSendCallOnly: '0x1a5519bda3b677d1030af5ce471986f33f8e8b66',
  fallbackHandler: '0x99f2a318aeb900c9c00d36e54fd9a0f1b520e847',
  signMessageLib: '0x3fd2ed43201105763ddcf55ec1ecaac5c846f20c',
  createCall: '0xac9d3fceac5703242663a434f5c8aa6c213ab967',
  simulateTxAccessor: '0x2979b39572fd8e47168e2aa7caed7df46b609327',
} as const

const BUNDLER_URL = (import.meta.env.VITE_BUNDLER_URL as string) || 'http://localhost:4848/bundler/arc'
const PAYMASTER_URL = (import.meta.env.VITE_PAYMASTER_URL as string) || 'http://localhost:4848/paymaster/arc'

/** Build the wdkConfig passed to `new WalletManagerEvmErc4337(secret, config)`. */
export function walletConfig() {
  const chainId = Number(import.meta.env.VITE_CHAIN_ID || 5042002)
  const rpcUrl = (import.meta.env.VITE_ARC_RPC_URL as string) || 'https://testnet-rpc.arc.network'
  return {
    chainId,
    provider: rpcUrl,
    bundlerUrl: BUNDLER_URL,
    paymasterUrl: PAYMASTER_URL,
    entryPointAddress: AA_ADDRESSES.entryPoint,
    safeModulesVersion: '0.3.0',
    isSponsored: true as const,
    useNativeCoins: false as const,
    safe4337ModuleAddress: AA_ADDRESSES.safe4337Module,
    safeModulesSetupAddress: AA_ADDRESSES.safeModuleSetup,
    contractNetworks: {
      [String(chainId)]: {
        safeSingletonAddress: AA_ADDRESSES.safeSingleton,
        safeProxyFactoryAddress: AA_ADDRESSES.safeProxyFactory,
        multiSendAddress: AA_ADDRESSES.multiSend,
        multiSendCallOnlyAddress: AA_ADDRESSES.multiSendCallOnly,
        fallbackHandlerAddress: AA_ADDRESSES.fallbackHandler,
        signMessageLibAddress: AA_ADDRESSES.signMessageLib,
        createCallAddress: AA_ADDRESSES.createCall,
        simulateTxAccessorAddress: AA_ADDRESSES.simulateTxAccessor,
      },
    },
  }
}
