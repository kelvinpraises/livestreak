/**
 * Contract addresses + chain/AA config — the committed source of truth.
 *
 * These are all PUBLIC values (chain id, RPC/bundler/paymaster URLs, contract
 * addresses) baked into the client bundle at build time, so they live here in
 * code rather than in env vars or CI secrets. To point at a new deployment or a
 * production host server, edit the literals below. All hooks import from here.
 */

import { createPublicClient, http, defineChain, type Address } from 'viem'

/** Network + endpoints. Edit here for prod (e.g. real bundler/paymaster host). */
export const CHAIN_ID = 5003
export const RPC_URL = 'https://rpc.sepolia.mantle.xyz'
export const BUNDLER_URL = 'http://localhost:4848/bundler/mantle'
export const PAYMASTER_URL = 'http://localhost:4848/paymaster/mantle'

export const mantleSepolia = defineChain({
  id: CHAIN_ID,
  name: 'Mantle Sepolia',
  nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Mantle Sepolia Explorer', url: 'https://sepolia.mantlescan.xyz' } },
})

const ZERO = '0x0000000000000000000000000000000000000000' as Address

/** Contract addresses — update these after deploying the protocol contracts. */
export const contracts = {
  vault: ZERO,
  flowToken: ZERO,
  agentRegistry: ZERO,
  observerRegistry: ZERO,
  steward: ZERO,
  protocolLP: ZERO,
  usdc: ZERO,
} as const

/** True when contracts are deployed (not zero addresses) */
export function isDeployed(): boolean {
  return contracts.vault !== ZERO
}

/** Shared public client for read operations */
export const publicClient = createPublicClient({
  chain: mantleSepolia,
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
// every EVM chain). Bundler/paymaster come from the URLs configured at the top of
// this file. This shape mirrors @livestreak/schema's EvmWalletInitConfig.

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

/** Build the wdkConfig passed to `new WalletManagerEvmErc4337(secret, config)`. */
export function walletConfig() {
  const chainId = CHAIN_ID
  return {
    chainId,
    provider: RPC_URL,
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
