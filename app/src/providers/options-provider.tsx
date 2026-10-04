import { testUsdcMintTransaction, TEST_USDC_MINT_ABI } from "#/utils/test-usdc";
import { EVM_NETWORK } from "#/utils/chain";
import {
  ClaimSession,
  loadClaim,
  type ClaimOperation,
  type ClaimPorts,
} from '#/utils/claim-session'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createPublicClient,
  http,
  sha256,
  toBytes,
  hexToBytes,
  bytesToHex,
  parseUnits,
  isAddress,
  type Address,
} from 'viem'
import { Schema } from 'effect'
import {
  createWalletManager,
  createSuiReadClient,
  readUserOperationSuccess,
  pollUntilUserOperationIncluded,
  assertUserOperationSucceeded,
  type WalletConfigByChain,
} from '@livestreak/wallet'
import type { VerifiedVaultMandate } from '@livestreak/schema'
import {
  FundingSession,
  loadFunding,
  type FundingOperation,
  type FundingIntent,
  type FundingPorts,
} from '#/utils/funding-session'
import {
  EvmWalletInitConfig,
  solanaWalletInitFromDescriptor,
  type WalletInit,
} from '@livestreak/schema'
import { localnetDeployment } from '@livestreak/contracts/sui'
import { localnetDeployment as solanaLocalnetDeployment } from '@livestreak/contracts/solana/deployments/localnet'
import {
  asTxId,
  asTokenId,
  asVaultId,
  asMarketId,
  asUserAddress,
  bridgeActionScope,
  createOptionsBridge,
  createOptionsRuntime,
  createOptionsSuiConfig,
  perMinUSDCToRate,
  resolveOptionsAccountAddress,
  usdcToRaw,
  type BridgeCaller,
  type OptionsBoard,
  type OptionsBridge,
  type OptionsChainConfig,
  type OptionsFunctionView,
  type OptionsPausedLane,
  type OptionsRuntime,
  type OptionsAccrualPreview,
  type TxId,
  type UserAddress,
} from '@livestreak/options'

import {
  HOST_BASE_URL,
  EVM_CHAIN_ID,
  isOptionsModeEnabled,
  testOptionsSeed,
} from '#/utils/env'
import {
  EVM_TEST_USDC,
  buildOptionsContractAddresses,
  initialChain,
  isChainDeployed,
  EVM_AA_CONTRACTS,
  EVM_RPC_URL,
} from '#/utils/deployments'
import {
  chainLabel,
  isValidRecipientAddress,
  SESSION_CHAIN_KEY,
  SUPPORTED_CHAINS,
  type OptionsChainKind,
} from '#/utils/chain'
import {
  findTokenIdForVault,
  findOptionsFunction,
  findFundFunction,
  findStopFundingFunction,
} from '#/utils/options'

export type { OptionsChainKind }

const STEALTH_DOMAIN = 'livestreak-stealth-v1'
const SESSION_SECRET_KEY = 'livestreak_stealth_secret'
const SAFE_ADDR_CACHE_PREFIX = 'livestreak_safe_addr_'
const APP_CALLER = { id: 'app', trusted: true } satisfies BridgeCaller

// S12/A8 — the AA Safe address is a deterministic (counterfactual) function of the seed + chain, but
// deriving it on connect takes ~60–120s. Cache it in localStorage keyed by a hash of the secret +
// chain (never the raw secret) so a reconnect after reload is INSTANT instead of re-deriving. The
// key is non-reversible; the address is public.
function safeAddrCacheKey(secret: Uint8Array, chain: OptionsChainKind): string {
  const tag = sha256(toBytes(`${STEALTH_DOMAIN}:${chain}:${bytesToHex(secret)}`))
  return `${SAFE_ADDR_CACHE_PREFIX}${chain}_${tag.slice(2, 18)}`
}

function readCachedSafeAddress(secret: Uint8Array, chain: OptionsChainKind): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(safeAddrCacheKey(secret, chain))
  } catch {
    return null
  }
}

function writeCachedSafeAddress(
  secret: Uint8Array,
  chain: OptionsChainKind,
  address: string,
): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(safeAddrCacheKey(secret, chain), address)
  } catch {
    /* quota — non-fatal */
  }
}

interface AaChainDescriptor {
  chainId: number
  name: string
  entryPoint: string
  safeModule?: string
  bundlerPath: string
  rpcUrl?: string
}

// Advertised only when the host's Kora paymaster leg is up (see host buildSolanaSponsorshipDescriptor).
// Absent → self-pay solana walletInit (read-only board still works; writes fund their own fee).
interface SolanaSponsorshipDescriptor {
  paymasterPath: string
  payerAddress?: string
  feeTokens?: string[]
  rpcUrl?: string
}

interface AaCapabilityDescriptor {
  version: '0.1.0'
  paymasterPath: string
  chains: AaChainDescriptor[]
  solanaSponsorship?: SolanaSponsorshipDescriptor
}

interface OptionsContextValue {
  enabled: boolean
  ready: boolean
  chain: OptionsChainKind
  setChain: (chain: OptionsChainKind) => void
  isConnected: boolean
  isLoading: boolean
  /** S12/A8: human-readable progress while the wallet derives (e.g. "Deriving your Safe address…").
   *  null when idle. Surfaced by the connect UI so the ~1-min first derive doesn't look like a hang. */
  derivationStep: string | null
  fundingOperation: FundingOperation | null
  readFundingRules: (
    vaultId: string,
  ) => Promise<{ verified: VerifiedVaultMandate; chainNow: number }>
  recoverFunding: () => Promise<void>
  claimOperation: ClaimOperation | null
  recoverClaim: () => Promise<void>
  claiming: boolean
  error: string | null
  address: Address | null
  usdcBalance: number
  board: OptionsBoard | null
  controls: readonly OptionsFunctionView[]
  bridge: OptionsBridge | null
  connect: (password: string) => Promise<void>
  disconnect: () => void
  /** Re-read the connected user's board/balance now (e.g. after an out-of-band wallet top-up). */
  refresh: () => Promise<void>
  mintTestUsdc: (amountUsd?: number) => Promise<void>
  setActiveMarketId: (marketId: string | undefined) => void
  findFunction: (
    name: string,
    match?: (fn: OptionsFunctionView) => boolean,
  ) => OptionsFunctionView | undefined
  findFundFunction: (vaultId: string, side: 'yes' | 'no') => OptionsFunctionView | undefined
  findStopFundingFunction: (vaultId: string) => OptionsFunctionView | undefined
  /** Open / switch / re-rate a vault's stream (balance-first). The SDK runtime decides starter-deposit vs.
   *  pure re-rate and preserves every other lane. Backs both the vault-card "stream" and active-card "adjust". */
  fundStream: (vaultId: string, side: 'yes' | 'no', rateUsdPerMin: number) => Promise<TxId>
  stopFunding: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Re-rate an existing stream in place (the active-card "adjust rate"). Same SDK operation as fundStream. */
  updateLaneRate: (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
  ) => Promise<TxId>
  /** Pause a stream: the SDK drops its lane (deposit + accrued shares retained) and remembers the rate. */
  pauseLane: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Resume a paused stream at the remembered rate (from the SDK's paused registry). */
  resumeLane: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Balance-first deposit to a position NFT's shared budget. The SDK `addFunds` action re-asserts the
   *  NFT's existing lanes itself (extending/reviving streams, or parking funds when there are none), so the
   *  UI passes only the amount — never a reconstructed lane set. */
  addFundsNft: (tokenId: string, depositUsd: number) => Promise<TxId>
  /** Sweep to wallet: stop every lane and withdraw the NFT's remaining Drips balance to the owner (stopAll). */
  sweepNft: (tokenId: string) => Promise<TxId>
  /** Withdraw winnings from every resolved winning lane on this NFT in one tx (withdrawMany). */
  withdrawAllNft: (tokenId: string) => Promise<TxId>
  previewAccrual: (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
    horizonSec?: number,
  ) => Promise<OptionsAccrualPreview>
  claimWin: (vaultId: string) => Promise<TxId>
  hasNftForVault: (vaultId: string) => boolean
  mint: (marketId: string) => Promise<TxId>
  claimLoss: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Cash out ONE resolved vault: stop its streams → mint any loss LVST → withdraw winnings + overstream. */
  settleVault: (vaultId: string) => Promise<TxId>
  stake: (amountLvst: number) => Promise<TxId>
  unstake: (amountLvst: number) => Promise<TxId>
  claimDividends: () => Promise<TxId>
  transferNft: (tokenId: string, to: string) => Promise<TxId>
  approveNft: (tokenId: string, operator: string) => Promise<TxId>
  setApprovalForAll: (operator: string, approved: boolean) => Promise<TxId>
}

const OptionsContext = createContext<OptionsContextValue | null>(null)

// The paused-lane registry lives in the SDK runtime (canonical). The runtime survives the 3s poll itself;
// these adapters are the persistence PORT it calls — sessionStorage so paused state survives a reload. The
// runtime holds rate as bigint, which isn't JSON-serializable, so the stored form carries rate as a string.
const PAUSED_LANES_KEY = 'livestreak.pausedLanes'

type StoredPausedLane = {
  tokenId: string
  vaultId: string
  side: 'yes' | 'no'
  rate: string
}

function loadPausedLanes(): OptionsPausedLane[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(PAUSED_LANES_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as StoredPausedLane[]).map((p) => ({
      tokenId: p.tokenId,
      vaultId: asVaultId(p.vaultId),
      side: p.side,
      rate: BigInt(p.rate),
    }))
  } catch {
    return []
  }
}

function savePausedLanes(lanes: readonly OptionsPausedLane[]): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const stored: StoredPausedLane[] = lanes.map((p) => ({
      tokenId: p.tokenId,
      vaultId: p.vaultId,
      side: p.side,
      rate: p.rate.toString(),
    }))
    sessionStorage.setItem(PAUSED_LANES_KEY, JSON.stringify(stored))
  } catch {
    /* runtime in-memory registry still covers the poll */
  }
}

function buildWalletInit(descriptor: AaCapabilityDescriptor): WalletInit {
  const chain = descriptor.chains.find((c) => c.chainId === EVM_CHAIN_ID)
  if (!chain) {
    throw new Error(`Host AA descriptor has no chain ${EVM_CHAIN_ID}`)
  }

  const aa = EVM_AA_CONTRACTS
  const chainKey = String(EVM_CHAIN_ID)
  const rpcUrl = chain.rpcUrl ?? EVM_RPC_URL

  const evmConfig = Schema.decodeUnknownSync(EvmWalletInitConfig)({
    chainId: EVM_CHAIN_ID,
    provider: rpcUrl,
    bundlerUrl: `${HOST_BASE_URL}${chain.bundlerPath}`,
    paymasterUrl: `${HOST_BASE_URL}${chain.bundlerPath.replace("/aa/bundler/", "/aa/paymaster/")}`,
    isSponsored: true,
    useNativeCoins: false,
    entryPointAddress: chain.entryPoint,
    safe4337ModuleAddress: chain.safeModule ?? aa.safe4337Module,
    safeModulesSetupAddress: aa.safeModuleSetup,
    safeModulesVersion: '0.3.0',
    contractNetworks: {
      [chainKey]: {
        safeSingletonAddress: aa.safeSingleton,
        safeProxyFactoryAddress: aa.safeProxyFactory,
        multiSendAddress: aa.multiSend,
        multiSendCallOnlyAddress: aa.multiSendCallOnly,
        fallbackHandlerAddress: aa.fallbackHandler,
        signMessageLibAddress: aa.signMessageLib,
        createCallAddress: aa.createCall,
        simulateTxAccessorAddress: aa.simulateTxAccessor,
      },
    },
  })

  return { chain: 'evm', seedSource: 'raw', config: evmConfig }
}

const SOLANA_RPC_URL = solanaLocalnetDeployment.rpc

// Build the solana WalletInit from the host descriptor. When the descriptor advertises a
// Delegates to the shared schema helper so the app and the CLI gateway map the host's advertised
// Solana sponsorship the same way (Kora paymaster triple → fee-payer co-signed writes; else self-pay).
function buildSolanaWalletInit(descriptor: AaCapabilityDescriptor): WalletInit {
  return solanaWalletInitFromDescriptor(descriptor.solanaSponsorship, {
    hostBaseUrl: HOST_BASE_URL,
    fallbackRpc: SOLANA_RPC_URL,
    network: 'localnet',
  })
}

// Read-only viewer used to populate the board for a disconnected visitor — a dummy address that owns
// nothing, so the board carries the market + vaults with zero positions. Writes stay gated on isConnected.
const ANON_VIEWER: Record<OptionsChainKind, string> = {
  evm: '0x000000000000000000000000000000000000dead',
  sui: '0x000000000000000000000000000000000000000000000000000000000000dead',
  // System program — a valid base58 pubkey that owns nothing, so the board renders zero positions.
  solana: '11111111111111111111111111111111',
}

function buildChainConfig(
  chain: OptionsChainKind,
  secret: Uint8Array,
  walletInit: WalletInit | null,
): OptionsChainConfig {
  if (chain === 'sui') {
    return {
      ...createOptionsSuiConfig({ deployment: localnetDeployment, seed: secret }),
      hostUrl: HOST_BASE_URL,
    }
  }

  if (chain === 'solana') {
    if (!walletInit) throw new Error('Options wallet config not loaded')
    const accounts = solanaLocalnetDeployment.accounts
    return {
      walletInit,
      seed: secret,
      addresses: {
        programId: solanaLocalnetDeployment.programId,
        usdcMint: accounts.usdcMint,
        ...(accounts.lvstMint === undefined ? {} : { lvstMint: accounts.lvstMint }),
      },
      readRpcUrl: solanaLocalnetDeployment.rpc,
      includeProtocolSummary: true,
      hostUrl: HOST_BASE_URL,
    }
  }

  if (!walletInit) throw new Error('Options wallet config not loaded')

  return {
    walletInit,
    seed: secret,
    addresses: buildOptionsContractAddresses(),
    readRpcUrl: EVM_RPC_URL,
    includeProtocolSummary: true,
    hostUrl: HOST_BASE_URL,
  }
}

export function OptionsProvider({ children }: { children: ReactNode }) {
  const enabled = isOptionsModeEnabled()
  // Start on the last valid pick, else the smart default (the running chain / first deployed) — never a
  // hard-coded evm that a Solana-only run can't boot. `initialChain` is deployment-aware.
  const [chain, setChainState] = useState<OptionsChainKind>(() => initialChain(enabled))
  const [ready, setReady] = useState(() => !enabled || initialChain(enabled) === 'sui')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [derivationStep, setDerivationStep] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<Address | null>(null)
  const [board, setBoard] = useState<OptionsBoard | null>(null)
  const [controls, setControls] = useState<readonly OptionsFunctionView[]>([])
  const [usdcBalance, setUsdcBalance] = useState(0)

  const [fundingOperation, setFundingOperation] = useState<FundingOperation | null>(null)
  const [claimOperation, setClaimOperation] = useState<ClaimOperation | null>(null)
  const claimSessionRef = useRef<ClaimSession | null>(null)
  const fundingSessionRef = useRef<FundingSession | null>(null)
  const writeBusyRef = useRef(false)

  const walletInitRef = useRef<WalletInit | null>(null)
  const runtimeRef = useRef<OptionsRuntime | null>(null)
  const bridgeRef = useRef<OptionsBridge | null>(null)
  const pollingStopRef = useRef<(() => void) | null>(null)
  const boardUnsubRef = useRef<(() => void) | null>(null)
  // The active market is driven by the ROUTE (/stream/$id → setActiveMarketId), not a build-time
  // constant. Starts undefined: the homepage needs no single market, and each stream page sets its own.
  const activeMarketIdRef = useRef<string | undefined>(undefined)
  const chainRef = useRef(chain)
  chainRef.current = chain

  const teardownRuntime = useCallback(() => {
    boardUnsubRef.current?.()
    boardUnsubRef.current = null
    pollingStopRef.current?.()
    pollingStopRef.current = null
    runtimeRef.current = null
    bridgeRef.current = null
    setBoard(null)
    setControls([])
  }, [])

  const applyBoard = useCallback((next: OptionsBoard) => {
    setBoard(next)
    setError(next.dataError ?? null)
    const usdc = next.panel.user.usdcBalanceUSDC
    if (usdc !== undefined) {
      setUsdcBalance(usdc)
    }
  }, [])

  const syncFromBridge = useCallback(
    async (bridge: OptionsBridge) => {
      const nextBoard = await bridge.readBoard(APP_CALLER)
      if (bridgeRef.current !== bridge) return
      applyBoard(nextBoard)
      const nextControls = await bridge.readControls(APP_CALLER)
      if (bridgeRef.current === bridge) setControls(nextControls.functions)
    },
    [applyBoard],
  )

  const refreshConnected = useCallback(
    async (user: UserAddress, marketId?: string) => {
      const runtime = runtimeRef.current
      const bridge = bridgeRef.current
      if (!runtime || !bridge) return

      await runtime.refreshUser(user, marketId ? asMarketId(marketId) : undefined)
      await syncFromBridge(bridge)
    },
    [syncFromBridge],
  )

  const bootRuntime = useCallback(
    async (secret: Uint8Array, user: UserAddress) => {
      teardownRuntime()

      const selectedChain = chainRef.current
      // Never boot a chain this build has no valid deployment for — fail with a clear message instead of the
      // cryptic "Invalid contract address" throw that used to wedge the whole board.
      if (!isChainDeployed(selectedChain)) {
        throw new Error(
          `${chainLabel(selectedChain)} isn't deployed in this environment — pick a deployed chain.`,
        )
      }
      const chainConfig = {
        ...buildChainConfig(selectedChain, secret, walletInitRef.current),
        onTransactionSubmitting: (action?: string) => {
          fundingSessionRef.current?.submitting()
          claimSessionRef.current?.submitting(action)
        },
        onTransactionSubmitted: (txId: string, action?: string) => {
          fundingSessionRef.current?.submitted(txId, action)
          claimSessionRef.current?.submitted(txId, action)
        },
      }
      const marketId = activeMarketIdRef.current

      const runtime = createOptionsRuntime({
        config: {
          runtimeId: 'app',
          user,
          refreshIntervalMs: 3_000,
          ...(marketId
            ? { marketIds: [asMarketId(marketId)], defaultMarketId: asMarketId(marketId) }
            : {}),
        },
        chainConfig,
        // Paused-lane registry is owned by the runtime; this port persists it across reloads.
        pausedLanes: { initial: loadPausedLanes(), onChange: savePausedLanes },
      })
      const bridge = createOptionsBridge({ runtime })

      runtimeRef.current = runtime
      bridgeRef.current = bridge

      boardUnsubRef.current = bridge.subscribeBoard(APP_CALLER, (nextBoard) => {
        if (bridgeRef.current !== bridge) return
        applyBoard(nextBoard)
        // A: never swallow live-data errors — the e2e reads console, and the UI must surface a
        // "live data unavailable" state instead of silently masquerading fixture data as live.
        void bridge
          .readControls(APP_CALLER)
          .then((next) => {
            if (bridgeRef.current === bridge) setControls(next.functions)
          })
          .catch((err) => {
            console.error('[options] readControls failed', err)
            setError(err instanceof Error ? err.message : String(err))
          })
      })
      pollingStopRef.current = runtime.startPolling().stop

      await refreshConnected(user, marketId)
    },
    [applyBoard, refreshConnected, teardownRuntime],
  )

  // Read-only board for a disconnected visitor: boot the runtime against the dummy viewer (placeholder
  // secret; the writer is never invoked while disconnected) so the active market's vaults render.
  const bootAnonymous = useCallback(async () => {
    if (!activeMarketIdRef.current) return
    if (!isChainDeployed(chainRef.current)) return // read-only board: silently skip an undeployed chain
    if (chainRef.current !== 'sui' && !walletInitRef.current) return
    try {
      await bootRuntime(new Uint8Array(32), ANON_VIEWER[chainRef.current] as UserAddress)
    } catch (err) {
      console.error('[options] anonymous board boot failed', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [bootRuntime])

  // S12/A8: derive the Safe address with visible progress, hitting the localStorage cache first so a
  // reconnect after reload is instant instead of a silent ~1-min "Deriving…" that looks like a hang.
  const deriveUserAddress = useCallback(
    async (
      secret: Uint8Array,
      chainKind: OptionsChainKind,
      chainConfig: OptionsChainConfig,
    ): Promise<UserAddress> => {
      const cachedAddr = readCachedSafeAddress(secret, chainKind)
      if (cachedAddr) {
        setDerivationStep('Restoring your wallet address…')
        return cachedAddr as UserAddress
      }
      // EVM Safe counterfactual derivation is a slow (~1 min first-time) 4337 apparatus; Sui + Solana
      // derive a native Ed25519 address instantly, so don't threaten the user with a minute-long wait.
      setDerivationStep(
        chainKind === 'evm'
          ? 'Deriving your Safe address (first time, ~1 min)…'
          : 'Deriving your wallet address…',
      )
      const user = await resolveOptionsAccountAddress(chainConfig)
      writeCachedSafeAddress(secret, chainKind, user)
      return user
    },
    [],
  )

  // Load the host AA descriptor and build the walletInit for the given chain (EVM Safe/4337 apparatus
  // vs. Solana Kora-paymaster triple). Sui needs no descriptor and skips this path entirely.
  const loadDescriptor = useCallback(
    async (chainKind: OptionsChainKind, cancelled: () => boolean) => {
      try {
        const res = await fetch(`${HOST_BASE_URL}/aa/descriptor`)
        if (!res.ok) throw new Error(`AA descriptor HTTP ${res.status}`)
        const descriptor = (await res.json()) as AaCapabilityDescriptor
        if (cancelled()) return
        walletInitRef.current =
          chainKind === 'solana'
            ? buildSolanaWalletInit(descriptor)
            : buildWalletInit(descriptor)
        setReady(true)
      } catch (err) {
        if (!cancelled()) {
          setError(err instanceof Error ? err.message : String(err))
          setReady(true)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    // Atomic binding: drop the previous chain's walletInit IMMEDIATELY on any switch, before the async
    // re-fetch. The boot guards key on `!walletInitRef.current`, so this blocks the board from ever booting
    // with a stale config that doesn't match the selected chain (the picker↔board race).
    walletInitRef.current = null

    if (chain === 'sui') {
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)
    void loadDescriptor(chain, () => cancelled)

    return () => {
      cancelled = true
    }
  }, [enabled, chain, loadDescriptor])

  useEffect(() => {
    if (!enabled || !ready || typeof window === 'undefined') return
    // EVM/Solana wallet config can briefly be unloaded during a chain switch; skip (re-runs once ready
    // settles) rather than treating it as a derive failure that would wipe the secret. Sui needs none.
    if (chainRef.current !== 'sui' && !walletInitRef.current) return
    const cached = sessionStorage.getItem(SESSION_SECRET_KEY)
    if (!cached) {
      void bootAnonymous() // disconnected: read-only board for the active market
      return () => teardownRuntime()
    }

    let cancelled = false
    setIsLoading(true)
    void (async () => {
      try {
        const secret = hexToBytes(cached as `0x${string}`)
        const chainConfig = buildChainConfig(
          chainRef.current,
          secret,
          walletInitRef.current,
        )
        const user = await deriveUserAddress(secret, chainRef.current, chainConfig)
        if (cancelled) return
        setAddress(user as Address)
        setIsConnected(true)
        setDerivationStep('Loading market board…')
        await bootRuntime(secret, user)
      } catch (err) {
        if (cancelled) return
        setIsConnected(false)
        setAddress(null)
        console.error('[options] session reconnect failed', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          setIsLoading(false)
          setDerivationStep(null)
        }
      }
    })()

    return () => {
      cancelled = true
      teardownRuntime()
    }
  }, [
    enabled,
    ready,
    chain,
    bootRuntime,
    teardownRuntime,
    deriveUserAddress,
    bootAnonymous,
  ])

  const disconnect = useCallback(() => {
    if (writeBusyRef.current) return
    sessionStorage.removeItem(SESSION_SECRET_KEY)
    teardownRuntime()
    setAddress(null)
    setIsConnected(false)
    setUsdcBalance(0)
    setError(null)
    void bootAnonymous() // fall back to the read-only board for the current market
  }, [teardownRuntime, bootAnonymous])

  const setChain = useCallback(
    (next: OptionsChainKind) => {
      if (!SUPPORTED_CHAINS.some(option => option.id === next)) return
      if (writeBusyRef.current || isLoading || next === chainRef.current) return
      sessionStorage.setItem(SESSION_CHAIN_KEY, next)
      // B: switching chains KEEPS the derived secret and re-derives the new chain's address from the
      // SAME seed (EVM Safe ⇄ Sui address) with no re-login. We tear down the active chain's runtime
      // and clear chain-specific display state, but leave SESSION_SECRET_KEY intact; the reconnect
      // effect (keyed on `chain`) then re-derives + reboots from the cached secret. Only a genuinely
      // disconnected session (no secret) reverts to the disconnected state.
      const wasConnected =
        typeof window !== 'undefined' && !!sessionStorage.getItem(SESSION_SECRET_KEY)
      teardownRuntime()
      setAddress(null)
      setUsdcBalance(0)
      setError(null)
      if (wasConnected) {
        setIsLoading(true)
      } else {
        setIsConnected(false)
      }
      setChainState(next)
    },
    [isLoading, teardownRuntime],
  )

  const connect = useCallback(
    async (password: string) => {
      if (!enabled) return
      // Test-only override: a configured `VITE_OPTIONS_SEED` makes connect derive from a fixed
      // seed (e.g. "1234") so the operator wallet is reproducible across E2E runs. Derivation is
      // byte-identical to the CLI's deriveSeedFromPassword (sha256(STEALTH_DOMAIN + seed)). When the
      // env var is unset this is undefined and the typed password is used exactly as before.
      const effectiveSeed = testOptionsSeed() ?? password
      if (!effectiveSeed.trim()) {
        setError('Password required')
        throw new Error('Password required')
      }
      // EVM (Safe/4337) and Solana (Kora/self-pay) both need a loaded walletInit before we can derive
      // or write; Sui signs natively with no descriptor, so it is exempt.
      if (chainRef.current !== 'sui' && !walletInitRef.current) {
        setError('Options config not ready — is host running?')
        throw new Error('Wallet configuration is unavailable. Check that Host is running.')
      }

      setIsLoading(true)
      setError(null)
      try {
        const secret = toBytes(sha256(toBytes(STEALTH_DOMAIN + effectiveSeed)))
        sessionStorage.setItem(SESSION_SECRET_KEY, bytesToHex(secret))

        setDerivationStep('Preparing wallet…')
        const chainConfig = buildChainConfig(
          chainRef.current,
          secret,
          walletInitRef.current,
        )
        const user = await deriveUserAddress(secret, chainRef.current, chainConfig)
        setAddress(user as Address)
        setIsConnected(true)
        setDerivationStep('Loading market board…')
        await bootRuntime(secret, user)
      } catch (err) {
        console.error('[options] connect failed', err)
        setError(err instanceof Error ? err.message : String(err))
        setIsConnected(false)
        setAddress(null)
        teardownRuntime()
        throw err
      } finally {
        setIsLoading(false)
        setDerivationStep(null)
      }
    },
    [enabled, bootRuntime, teardownRuntime, deriveUserAddress],
  )

  // Point the runtime at a (newly-viewed) market. We REBOOT the runtime rather than just refreshing
  // once, because the 3s poll targets the market baked into the runtime config at boot
  // (config.defaultMarketId) — a one-off refresh would be overwritten by the next poll on the old
  // market. Rebooting from the cached secret re-pins board + poll to the new market together.
  const setActiveMarketId = useCallback(
    (marketId: string | undefined) => {
      if (marketId === activeMarketIdRef.current) return
      activeMarketIdRef.current = marketId
      if (!marketId) {
        teardownRuntime()
        return
      }
      const user = address as UserAddress | null
      const cached =
        typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_SECRET_KEY) : null
      if (isConnected && user && cached) {
        void bootRuntime(hexToBytes(cached as `0x${string}`), user).catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
      } else if (marketId) {
        void bootAnonymous()
      } else {
        teardownRuntime()
      }
    },
    [address, isConnected, bootRuntime, bootAnonymous, teardownRuntime],
  )

  const requireUser = useCallback((): UserAddress => {
    if (!address) throw new Error('Wallet not connected')
    return asUserAddress(address)
  }, [address])

  const requireBridge = useCallback((): OptionsBridge => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error('Options bridge not ready')
    return bridge
  }, [])

  const requirePanel = useCallback(() => {
    if (!board) throw new Error('Options board not ready')
    return board.panel
  }, [board])

  const resolveTokenId = useCallback(
    (vaultId: string): bigint => {
      const panel = requirePanel()
      const tokenId = findTokenIdForVault(panel, vaultId)
      if (!tokenId) throw new Error('No NFT for this market')
      return BigInt(tokenId)
    },
    [requirePanel],
  )

  /** True when the connected user already holds a position NFT covering this vault's market (D). */
  const hasNftForVault = useCallback(
    (vaultId: string): boolean => {
      if (!board) return false
      return findTokenIdForVault(board.panel, vaultId) !== undefined
    },
    [board],
  )

  const afterWrite = useCallback(async () => {
    const user = address as UserAddress | null
    if (user) await refreshConnected(user, activeMarketIdRef.current)
  }, [address, refreshConnected])

  const callBridgeAction = useCallback(
    async (action: string, args: unknown): Promise<TxId> => {
      if (writeBusyRef.current)
        throw new Error('Wait for the current wallet action to finish.')
      writeBusyRef.current = true
      setClaiming(true)
      const execute = async (): Promise<TxId> => {
        const cashout = address ? loadClaim(localStorage, chainRef.current, address) : null
        if (cashout && !['confirmed', 'failed'].includes(cashout.status))
          throw new Error(
            'Finish or recover your pending cash-out before another wallet action.',
          )
        const pending = address
          ? loadFunding(localStorage, chainRef.current, address)
          : null
        if (pending && !['confirmed', 'failed'].includes(pending.status))
          throw new Error(
            'Check your pending funding transaction before changing this wallet’s positions.',
          )
        const result = await requireBridge().callAction(APP_CALLER, {
          scope: bridgeActionScope,
          action,
          args,
        })
        if (typeof result !== 'string' && !('txId' in result))
          throw new Error('Options write returned a read result')
        await afterWrite()
        return typeof result === 'string' ? result : result.txId
      }
      try {
        if (!navigator.locks)
          throw new Error('This browser does not support safe wallet actions across tabs.')
        return await navigator.locks.request(
          `livestreak.fund:${chainRef.current}:${address}`,
          { ifAvailable: true },
          (lock) => {
            if (!lock)
              throw new Error(
                'A wallet action is running in another tab. Wait for it to finish.',
              )
            return execute()
          },
        )
      } finally {
        writeBusyRef.current = false
        setClaiming(false)
      }
    },
    [address, requireBridge, afterWrite],
  )

  const mintTestUsdc = useCallback(async (amountUsd = 100): Promise<void> => {
    if (!isConnected || !address || chainRef.current !== 'evm') throw new Error('Connect your Arbitrum Sepolia wallet first.');
    if (writeBusyRef.current) throw new Error('Wait for the current wallet action to finish.');
    const user = address;
    const secret = sessionStorage.getItem(SESSION_SECRET_KEY);
    if (!secret || !walletInitRef.current) throw new Error('Reconnect your wallet before minting test USDC.');
    const cfg = buildChainConfig('evm', hexToBytes(secret as `0x${string}`), walletInitRef.current);
    const manager = createWalletManager('evm', cfg.seed, cfg.walletInit.config as WalletConfigByChain['evm']);
    writeBusyRef.current = true;
    setClaiming(true);
    const client = createPublicClient({ transport: http(EVM_RPC_URL, { timeout: 15000 }) });
    const pendingKey = `livestreak.test-usdc-mint:${EVM_NETWORK.chainId}:${user.toLowerCase()}`;
    try {
      if (!navigator.locks) throw new Error('This browser does not support safe wallet actions across tabs.');
      await navigator.locks.request(`livestreak.fund:evm:${user}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('A wallet action is running in another tab.');
        const account = await manager.getAccount();
        if ((await account.getAddress()).toLowerCase() !== user.toLowerCase()) throw new Error('Wallet changed. Reconnect before minting.');
        const tx = testUsdcMintTransaction(await client.getChainId(), EVM_TEST_USDC, user, amountUsd);
        const reader = await account.toReadOnlyAccount();
        let hash = localStorage.getItem(pendingKey);
        if (!hash) {
          // Simulate the exact contract call before requesting a sponsored transaction.
          await client.simulateContract({ address: tx.to, abi: TEST_USDC_MINT_ABI, functionName: 'mint', args: [user, parseUnits(String(amountUsd), 6)], account: user });
          if (chainRef.current !== 'evm' || sessionStorage.getItem(SESSION_SECRET_KEY) !== secret) throw new Error('Wallet changed before submission.');
          hash = (await account.sendTransaction(tx)).hash;
          localStorage.setItem(pendingKey, hash);
        }
        const result = await pollUntilUserOperationIncluded(reader, hash);
        if (readUserOperationSuccess(result) === false) localStorage.removeItem(pendingKey);
        assertUserOperationSucceeded(result);
        localStorage.removeItem(pendingKey);
        if (chainRef.current === 'evm' && sessionStorage.getItem(SESSION_SECRET_KEY) === secret) await refreshConnected(user as UserAddress, activeMarketIdRef.current);
      });
    } finally {
      manager.dispose();
      writeBusyRef.current = false;
      setClaiming(false);
    }
  }, [address, isConnected, refreshConnected]);

  const findFunction = useCallback(
    (name: string, match?: (fn: OptionsFunctionView) => boolean) =>
      findOptionsFunction(controls, name, match),
    [controls],
  )

  const findFundFunctionForVault = useCallback(
    (vaultId: string, side: 'yes' | 'no') => findFundFunction(controls, vaultId, side),
    [controls],
  )

  const findStopFundingFunctionForVault = useCallback(
    (vaultId: string) => findStopFundingFunction(controls, vaultId),
    [controls],
  )

  // Balance-first top-up: hand the SDK `addFunds` action only the deposit — it re-asserts the NFT's existing
  // lanes itself (extending/reviving every stream, or parking the funds when there are none), so the UI
  // never reconstructs the lane set. Works with zero active lanes (parks as budget).
  const addFundsNft = useCallback(
    async (tokenId: string, depositUsd: number): Promise<TxId> => {
      const deposit = usdcToRaw(depositUsd)
      if (deposit <= 0n) throw new Error('Enter an amount greater than 0')
      return callBridgeAction('addFunds', {
        tokenId: asTokenId(BigInt(tokenId)),
        deposit,
      })
    },
    [callBridgeAction],
  )

  // Sweep to wallet: stopAll halts every lane (banking shares) and withdraws the remaining shared Drips
  // balance back to the owner's wallet.
  const sweepNft = useCallback(
    async (tokenId: string): Promise<TxId> =>
      callBridgeAction('stopAllFunding', { tokenId: asTokenId(BigInt(tokenId)) }),
    [callBridgeAction],
  )

  // Withdraw all winnings: collect from every resolved winning lane on the NFT in one withdrawMany call.
  // The winning vaults are derived from the panel here (provider-side), so the UI just calls withdrawAllNft.
  const withdrawAllNft = useCallback(
    async (tokenId: string): Promise<TxId> => {
      const panel = requirePanel()
      const nft = panel.nfts.find((n) => n.tokenId === tokenId)
      const vaultIds = (nft?.lanes ?? [])
        .filter((l) => l.settlement?.canClaimWin === true)
        .map((l) => l.vaultId)
      if (vaultIds.length === 0) throw new Error('No winnings to withdraw')
      return callBridgeAction('withdrawMany', {
        tokenId: asTokenId(BigInt(tokenId)),
        vaultIds: vaultIds.map((v) => asVaultId(v)),
        to: requireUser(),
      })
    },
    [callBridgeAction, requirePanel, requireUser],
  )

  // --- Active-stream lane controls (stream / adjust / pause / resume) ---
  // The SDK runtime owns ALL lane orchestration now: it reads its own snapshot to build the setLanes set,
  // preserves every other lane, applies the balance-first starter deposit, and owns the paused registry.
  // The app just names the gesture and forwards the high-level args — no lane reconstruction here.

  useEffect(() => {
    fundingSessionRef.current = null
    claimSessionRef.current = null
    setClaimOperation(null)
    setFundingOperation(null)
    if (!address || !isConnected) return
    try {
      const session = new FundingSession(localStorage, chain, address, setFundingOperation)
      claimSessionRef.current = new ClaimSession(
        localStorage,
        chain,
        address,
        setClaimOperation,
      )
      setClaimOperation(claimSessionRef.current.operation)
      fundingSessionRef.current = session
      setFundingOperation(session.operation)
      const sync = () => {
        try {
          const next = new FundingSession(localStorage, chain, address, setFundingOperation)
          if (!writeBusyRef.current) {
            fundingSessionRef.current = next
            setFundingOperation(next.operation)
            claimSessionRef.current = new ClaimSession(
              localStorage,
              chain,
              address,
              setClaimOperation,
            )
            setClaimOperation(claimSessionRef.current.operation)
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
      window.addEventListener('storage', sync)
      return () => window.removeEventListener('storage', sync)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [address, chain, isConnected])

  const readFundingRules = useCallback(async (vaultId: string) => {
    const runtime = runtimeRef.current
    if (!runtime?.chain.reader.readVaultMandate || !runtime.chain.reader.readChainTime) {
      throw new Error('Waiting for verified market rules.')
    }
    const [verified, chainNow] = await Promise.all([
      runtime.chain.reader.readVaultMandate(asVaultId(vaultId)),
      runtime.chain.reader.readChainTime(),
    ])
    if (runtimeRef.current !== runtime)
      throw new Error('Network changed. Reload the market rules.')
    if (!Number.isSafeInteger(chainNow)) throw new Error('Chain time is unavailable.')
    return { verified, chainNow }
  }, [])

  const fundingPorts = useCallback(
    (intent: FundingIntent): FundingPorts => {
      const runtime = runtimeRef.current
      const user = requireUser()
      const selected = chainRef.current
      if (!runtime || !isConnected)
        throw new Error('Connect your wallet to fund this question.')
      const assertSession = () => {
        if (runtimeRef.current !== runtime || chainRef.current !== selected)
          throw new Error('Network or market changed during funding.')
      }
      const position = async () => {
        assertSession()
        await refreshConnected(user, intent.marketId)
        return runtime
          .readPanel()
          .nfts.find(
            (n) =>
              n.marketId === intent.marketId &&
              (selected === 'evm'
                ? n.owner.toLowerCase() === user.toLowerCase()
                : n.owner === user),
          )
      }
      return {
        preflight: async () => {
          assertSession()
          if (!Number.isFinite(intent.rate) || intent.rate < 0.01 || intent.rate > 10)
            throw new Error('Choose a rate between 0.01 and 10 USDC per minute.')
          const { verified, chainNow } = await readFundingRules(intent.vaultId)
          if (verified.terms.marketId !== intent.marketId)
            throw new Error('This question belongs to a different market.')
          if (chainNow >= verified.mandate.fundingClose)
            throw new Error('Funding has closed for this question.')
          const nft = await position()
          const budget = nft?.account.balanceRaw ? BigInt(nft.account.balanceRaw) : 0n
          const needed = budget > 0n ? 0n : perMinUSDCToRate(intent.rate) * 600n
          if ((await runtime.chain.reader.readUsdcBalance(user)) < needed)
            throw new Error(
              `Insufficient USDC. You need ${(Number(needed) / 1_000_000).toFixed(2)} USDC for the initial stream budget.`,
            )
        },
        hasPosition: async () => !!(await position()),
        mint: async () => {
          assertSession()
          await requireBridge().callAction(APP_CALLER, {
            scope: bridgeActionScope,
            action: 'mint',
            args: { marketId: asMarketId(intent.marketId), to: user },
          })
          await refreshConnected(user, intent.marketId)
        },
        fund: async () => {
          assertSession()
          const result = await requireBridge().callAction(APP_CALLER, {
            scope: bridgeActionScope,
            action: 'streamLane',
            args: {
              vaultId: asVaultId(intent.vaultId),
              side: intent.side,
              ratePerMin: intent.rate,
              starterMinutes: 10,
            },
          })
          if (typeof result !== 'string')
            throw new Error('Funding returned an unexpected result.')
          return result
        },
        verify: async () => {
          const nft = await position()
          if (!nft) return false
          const actual = await runtime.chain.reader.readNft(
            asTokenId(BigInt(nft.tokenId)),
            user,
          )
          return (
            (selected === 'evm'
              ? actual.owner.toLowerCase() === user.toLowerCase()
              : actual.owner === user) &&
            actual.lanes.some(
              (l) =>
                l.vaultId === intent.vaultId &&
                l.side === intent.side &&
                l.committedRate === perMinUSDCToRate(intent.rate),
            )
          )
        },
        receipt: async (txId) => {
          assertSession()
          const cached = sessionStorage.getItem(SESSION_SECRET_KEY)
          if (!cached)
            throw new Error('Reconnect the same wallet to check this transaction.')
          const cfg = buildChainConfig(
            selected,
            hexToBytes(cached as `0x${string}`),
            walletInitRef.current,
          )
          if (selected === 'sui') {
            const suiConfig = cfg.walletInit.config as WalletConfigByChain['sui']
            const rpc = Array.isArray(suiConfig.rpcUrl)
              ? suiConfig.rpcUrl[0]
              : suiConfig.rpcUrl
            const result = await createSuiReadClient(
              rpc as string,
              suiConfig.network,
            ).getTransactionBlock({ digest: txId, options: { showEffects: true } })
            return result.effects ? result.effects.status.status === 'success' : undefined
          }
          const manager = createWalletManager(
            selected,
            cfg.seed,
            cfg.walletInit.config as WalletConfigByChain[typeof selected],
          )
          const account = await manager.getAccount()
          const readOnly = await account.toReadOnlyAccount()
          return readUserOperationSuccess(await readOnly.getUserOperationReceipt(txId))
        },
      }
    },
    [isConnected, requireUser, refreshConnected, readFundingRules, requireBridge],
  )

  const streamLane = useCallback(
    async (vaultId: string, side: 'yes' | 'no', rateUsdPerMin: number): Promise<TxId> => {
      if (writeBusyRef.current)
        throw new Error('This wallet already has an action in progress.')
      const session = fundingSessionRef.current
      const runtime = runtimeRef.current
      if (!session || !runtime)
        throw new Error('Wallet recovery storage is unavailable. Reconnect before funding.')
      const vault = runtime
        .readPanel()
        .markets.flatMap((m) => m.vaults)
        .find((v) => v.vaultId === vaultId)
      if (!vault)
        throw new Error(
          'This question is not on the selected network. Switch to its network before funding.',
        )
      const intent: FundingIntent = {
        vaultId,
        marketId: vault.marketId,
        side,
        rate: rateUsdPerMin,
      }
      writeBusyRef.current = true
      setClaiming(true)
      try {
        const run = () => {
          const pending = loadClaim(localStorage, chainRef.current, address!)
          if (pending && !['confirmed', 'failed'].includes(pending.status))
            throw new Error('Recover your pending cash-out before funding again.')
          return session.run(intent, fundingPorts(intent))
        }
        if (navigator.locks) {
          return asTxId(
            await navigator.locks.request(
              `livestreak.fund:${chainRef.current}:${address}`,
              { ifAvailable: true },
              (lock) => {
                if (!lock)
                  throw new Error(
                    'Funding is already open in another tab. Wait for it to finish.',
                  )
                return run()
              },
            ),
          )
        }
        throw new Error(
          'This browser does not support safe funding across tabs. Use a current browser.',
        )
      } finally {
        writeBusyRef.current = false
        setClaiming(false)
      }
    },
    [address, fundingPorts],
  )

  const recoverFunding = useCallback(async () => {
    const session = fundingSessionRef.current
    if (!session?.operation || writeBusyRef.current) return
    writeBusyRef.current = true
    setClaiming(true)
    try {
      if (!navigator.locks)
        throw new Error('This browser does not support safe recovery across tabs.')
      await navigator.locks.request(
        `livestreak.fund:${chainRef.current}:${address}`,
        { ifAvailable: true },
        (lock) => {
          if (!lock)
            throw new Error(
              'Funding is still running in another tab. Wait for it to finish.',
            )
          return session.recover(fundingPorts(session.operation!))
        },
      )
    } finally {
      writeBusyRef.current = false
      setClaiming(false)
    }
  }, [address, fundingPorts])

  const pauseLane = useCallback(
    (vaultId: string, side: 'yes' | 'no'): Promise<TxId> =>
      callBridgeAction('pauseLane', { vaultId: asVaultId(vaultId), side }),
    [callBridgeAction],
  )

  const resumeLane = useCallback(
    (vaultId: string, side: 'yes' | 'no'): Promise<TxId> =>
      callBridgeAction('resumeLane', { vaultId: asVaultId(vaultId), side }),
    [callBridgeAction],
  )

  const previewAccrual = useCallback(
    async (
      vaultId: string,
      side: 'yes' | 'no',
      rateUsdPerMin: number,
      horizonSec?: number,
    ): Promise<OptionsAccrualPreview> => {
      return requireBridge().previewAccrual(APP_CALLER, {
        vaultId: asVaultId(vaultId),
        side,
        rate: perMinUSDCToRate(rateUsdPerMin),
        ...(horizonSec !== undefined ? { horizonSec } : {}),
      })
    },
    [requireBridge],
  )

  const claimWin = useCallback(
    async (vaultId: string): Promise<TxId> => {
      const user = requireUser()
      return callBridgeAction('withdraw', {
        tokenId: asTokenId(resolveTokenId(vaultId)),
        vaultId: asVaultId(vaultId),
        to: user,
      })
    },
    [callBridgeAction, requireUser, resolveTokenId],
  )

  const mint = useCallback(
    async (marketId: string): Promise<TxId> => {
      const user = requireUser()
      return callBridgeAction('mint', {
        marketId: asMarketId(marketId),
        to: user,
      })
    },
    [callBridgeAction, requireUser],
  )

  const claimLoss = useCallback(
    async (vaultId: string, side: 'yes' | 'no'): Promise<TxId> => {
      const user = requireUser()
      return callBridgeAction('claimLossLvst', {
        tokenId: asTokenId(resolveTokenId(vaultId)),
        vaultId: asVaultId(vaultId),
        side,
        to: user,
      })
    },
    [callBridgeAction, requireUser, resolveTokenId],
  )

  const claimPorts = useCallback(
    (vaultId: string): ClaimPorts => {
      const runtime = runtimeRef.current,
        bridge = requireBridge(),
        user = requireUser(),
        selected = chainRef.current
      if (!runtime || !isConnected)
        throw new Error('Connect the position owner to cash out.')
      const assertSession = () => {
        if (runtimeRef.current !== runtime || selected !== chainRef.current)
          throw new Error('Wallet network or market changed during cash-out.')
      }
      return {
        next: async () => {
          assertSession()
          const vault = await runtime.chain.reader.readVault(asVaultId(vaultId))
          if (vault.status !== 'resolved' || vault.outcome === 'pending')
            throw new Error('This question is not resolved or is disputed.')
          const ids = await runtime.chain.reader.listOwnerTokens(user)
          const nfts = await Promise.all(
            ids.map((id) => runtime.chain.reader.readNft(id, user)),
          )
          const owned = nfts.filter(
            (n) =>
              n.marketId === vault.marketId &&
              (selected === 'evm'
                ? n.owner.toLowerCase() === user.toLowerCase()
                : n.owner === user),
          )
          for (const nft of owned) {
            const lanes = nft.lanes.filter((l) => l.vaultId === vaultId)
            const base = { tokenId: nft.tokenId, vaultId: asVaultId(vaultId) }
            const active = lanes.find((l) => l.committedRate > 0n)
            if (active)
              return {
                id: `stop:${nft.tokenId}:${active.side}`,
                action: 'stopFunding',
                args: { ...base, side: active.side },
              }
            const lost = lanes.find(
              (l) =>
                l.side !== vault.outcome && !l.lossClaimed && (l.lossClaimable ?? 0n) > 0n,
            )
            if (lost)
              return {
                id: `loss:${nft.tokenId}:${lost.side}`,
                action: 'claimLossLvst',
                args: { ...base, side: lost.side, to: user },
              }
            if (
              lanes.some(
                (l) =>
                  (l.claimable ?? 0n) > 0n ||
                  (l.overstreamClaimable ?? 0n) > 0n ||
                  (l.side === vault.outcome && l.collectPending),
              )
            )
              return {
                id: `withdraw:${nft.tokenId}`,
                action: 'withdraw',
                args: { ...base, to: user },
              }
          }
          await refreshConnected(user, vault.marketId)
          return null
        },
        execute: async (step) => {
          assertSession()
          const result = await bridge.callAction(APP_CALLER, {
            scope: bridgeActionScope,
            action: step.action,
            args: step.args,
          })
          if (typeof result !== 'string' && !('txId' in result))
            throw new Error('Claim returned a read result')
          await afterWrite()
          return typeof result === 'string' ? result : result.txId
        },
        receipt: async (hash) => {
          assertSession()
          const secret = sessionStorage.getItem(SESSION_SECRET_KEY)
          if (!secret) throw new Error('Reconnect the same wallet to check this claim.')
          const cfg = buildChainConfig(
            selected,
            hexToBytes(secret as `0x${string}`),
            walletInitRef.current,
          )
          if (selected === 'sui') {
            const c = cfg.walletInit.config as WalletConfigByChain['sui']
            const rpc = Array.isArray(c.rpcUrl) ? c.rpcUrl[0] : c.rpcUrl
            const tx = await createSuiReadClient(
              rpc as string,
              c.network,
            ).getTransactionBlock({ digest: hash, options: { showEffects: true } })
            return tx.effects ? tx.effects.status.status === 'success' : undefined
          }
          const account = await createWalletManager(
            selected,
            cfg.seed,
            cfg.walletInit.config as WalletConfigByChain[typeof selected],
          ).getAccount()
          return readUserOperationSuccess(
            await (await account.toReadOnlyAccount()).getUserOperationReceipt(hash),
          )
        },
      }
    },
    [afterWrite, isConnected, refreshConnected, requireBridge, requireUser],
  )
  const runClaim = useCallback(
    async (vaultId: string, recover: boolean): Promise<TxId> => {
      if (writeBusyRef.current)
        throw new Error('Wait for the current wallet action to finish.')
      const session = claimSessionRef.current
      if (!session || !address) throw new Error('Connect your wallet before cash-out.')
      writeBusyRef.current = true
      setClaiming(true)
      try {
        if (!navigator.locks)
          throw new Error('This browser cannot safely serialize wallet actions.')
        return await navigator.locks.request(
          `livestreak.fund:${chainRef.current}:${address}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) throw new Error('A wallet action is running in another tab.')
            const pending = loadFunding(localStorage, chainRef.current, address)
            if (pending && !['confirmed', 'failed'].includes(pending.status))
              throw new Error('Recover your pending funding before cash-out.')
            const ports = claimPorts(vaultId)
            if (recover) {
              await session.recover(ports)
              await afterWrite()
              return asTxId(session.operation?.txId ?? 'recovery-read')
            }
            return asTxId(await session.run(vaultId, ports))
          },
        )
      } finally {
        writeBusyRef.current = false
        setClaiming(false)
      }
    },
    [address, afterWrite, claimPorts],
  )
  const settleVault = useCallback((vaultId: string) => runClaim(vaultId, false), [runClaim])
  const recoverClaim = useCallback(async () => {
    const op = claimSessionRef.current?.operation
    if (op) await runClaim(op.vaultId, true)
  }, [runClaim])

  const stake = useCallback(
    async (amountLvst: number): Promise<TxId> => {
      return callBridgeAction('stakeLvst', {
        amount: parseUnits(String(amountLvst), 18),
      })
    },
    [callBridgeAction],
  )

  const unstake = useCallback(
    async (amountLvst: number): Promise<TxId> => {
      return callBridgeAction('unstakeLvst', {
        amount: parseUnits(String(amountLvst), 18),
      })
    },
    [callBridgeAction],
  )

  const claimDividends = useCallback(async (): Promise<TxId> => {
    return callBridgeAction('claimDividends', {})
  }, [callBridgeAction])

  const transferNft = useCallback(
    async (tokenId: string, to: string): Promise<TxId> => {
      const user = requireUser()
      if (!isValidRecipientAddress(chainRef.current, to)) {
        throw new Error('Invalid recipient address')
      }
      return callBridgeAction('transferNft', {
        from: user,
        to: asUserAddress(to),
        tokenId: asTokenId(BigInt(tokenId)),
      })
    },
    [callBridgeAction, requireUser],
  )

  const approveNft = useCallback(
    async (tokenId: string, operator: string): Promise<TxId> => {
      if (!isAddress(operator)) throw new Error('Invalid operator address')
      return callBridgeAction('approveNft', {
        operator: asUserAddress(operator),
        tokenId: asTokenId(BigInt(tokenId)),
      })
    },
    [callBridgeAction],
  )

  const setApprovalForAll = useCallback(
    async (operator: string, approved: boolean): Promise<TxId> => {
      if (!isAddress(operator)) throw new Error('Invalid operator address')
      return callBridgeAction('setApprovalForAll', {
        operator: asUserAddress(operator),
        approved,
      })
    },
    [callBridgeAction],
  )

  const value = useMemo<OptionsContextValue>(
    () => ({
      enabled,
      ready,
      chain,
      setChain,
      isConnected,
      isLoading,
      derivationStep,
      claiming,
      claimOperation,
      recoverClaim,
      fundingOperation,
      readFundingRules,
      recoverFunding,
      error,
      address,
      usdcBalance,
      board,
      controls,
      bridge: bridgeRef.current,
      connect,
      disconnect,
      refresh: afterWrite,
      mintTestUsdc,
      setActiveMarketId,
      findFunction,
      findFundFunction: findFundFunctionForVault,
      findStopFundingFunction: findStopFundingFunctionForVault,
      fundStream: streamLane,
      stopFunding: pauseLane, // stop ≡ pause on-chain (drop lane, keep deposit+shares); stays visible & resumable
      updateLaneRate: streamLane,
      pauseLane,
      resumeLane,
      addFundsNft,
      sweepNft,
      withdrawAllNft,
      previewAccrual,
      claimWin,
      hasNftForVault,
      mint,
      claimLoss,
      settleVault,
      stake,
      unstake,
      claimDividends,
      transferNft,
      approveNft,
      setApprovalForAll,
    }),
    [
      enabled,
      ready,
      chain,
      setChain,
      isConnected,
      isLoading,
      derivationStep,
      claiming,
      claimOperation,
      recoverClaim,
      fundingOperation,
      readFundingRules,
      recoverFunding,
      error,
      address,
      usdcBalance,
      board,
      controls,
      connect,
      disconnect,
      afterWrite,
      mintTestUsdc,
      setActiveMarketId,
      findFunction,
      findFundFunctionForVault,
      findStopFundingFunctionForVault,
      streamLane,
      pauseLane,
      resumeLane,
      addFundsNft,
      sweepNft,
      withdrawAllNft,
      previewAccrual,
      claimWin,
      hasNftForVault,
      mint,
      claimLoss,
      settleVault,
      stake,
      unstake,
      claimDividends,
      transferNft,
      approveNft,
      setApprovalForAll,
    ],
  )

  return <OptionsContext.Provider value={value}>{children}</OptionsContext.Provider>
}

export function useOptionsContext(): OptionsContextValue {
  const ctx = useContext(OptionsContext)
  if (!ctx) throw new Error('useOptionsContext must be used within <OptionsProvider>')
  return ctx
}
