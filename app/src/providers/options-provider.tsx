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
import { sha256, toBytes, hexToBytes, bytesToHex, parseUnits, isAddress, type Address } from 'viem'
import { Schema } from 'effect'
import { EvmWalletInitConfig, type WalletInit } from '@livestreak/schema'
import { localnetDeployment } from '@livestreak/contracts/sui'
import {
  asTokenId,
  asVaultId,
  asMarketId,
  asUserAddress,
  bridgeActionScope,
  createOptionsBridge,
  createOptionsRuntime,
  createOptionsSuiConfig,
  resolveOptionsAccountAddress,
  type BridgeCaller,
  type OptionsBoard,
  type OptionsBridge,
  type OptionsChainConfig,
  type OptionsFunctionView,
  type OptionsRuntime,
  type OptionsAccrualPreview,
  type TxId,
  type UserAddress,
} from '@livestreak/options'

import { HOST_BASE_URL, LOCAL_CHAIN_ID, isOptionsModeEnabled, testOptionsSeed } from '#/utils/env'
import {
  buildOptionsContractAddresses,
  LOCALHOST_AA_CONTRACTS,
  LOCALHOST_RPC_URL,
} from '#/utils/deployments'
import {
  isValidRecipientAddress,
  readStoredChain,
  SESSION_CHAIN_KEY,
  type OptionsChainKind,
} from '#/utils/chain'
import {
  DEFAULT_FUND_DURATION_MIN,
  findTokenIdForVault,
  fundDepositForDuration,
  usdPerMinToChainRate,
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
  try { return localStorage.getItem(safeAddrCacheKey(secret, chain)) } catch { return null }
}

function writeCachedSafeAddress(secret: Uint8Array, chain: OptionsChainKind, address: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(safeAddrCacheKey(secret, chain), address) } catch { /* quota — non-fatal */ }
}

interface AaChainDescriptor {
  chainId: number
  name: string
  entryPoint: string
  safeModule?: string
  bundlerPath: string
  rpcUrl?: string
}

interface AaCapabilityDescriptor {
  version: '0.1.0'
  paymasterPath: string
  chains: AaChainDescriptor[]
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
  setActiveMarketId: (marketId: string | undefined) => void
  findFunction: (name: string, match?: (fn: OptionsFunctionView) => boolean) => OptionsFunctionView | undefined
  findFundFunction: (vaultId: string, side: 'yes' | 'no') => OptionsFunctionView | undefined
  findStopFundingFunction: (vaultId: string) => OptionsFunctionView | undefined
  fundStream: (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
    durationMinutes?: number,
  ) => Promise<TxId>
  stopFunding: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Add USDC deposit to a position NFT's shared funding (extends every lane's runway) by re-asserting
   *  its existing lanes with addDeposit — no lane is added or removed. */
  topUpNft: (
    tokenId: string,
    lanes: readonly { vaultId: string; side: 'yes' | 'no'; rate: string }[],
    depositUsd: number,
  ) => Promise<TxId>
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
  stake: (amountLvst: number) => Promise<TxId>
  unstake: (amountLvst: number) => Promise<TxId>
  claimDividends: () => Promise<TxId>
  transferNft: (tokenId: string, to: string) => Promise<TxId>
  approveNft: (tokenId: string, operator: string) => Promise<TxId>
  setApprovalForAll: (operator: string, approved: boolean) => Promise<TxId>
}

const OptionsContext = createContext<OptionsContextValue | null>(null)

function buildWalletInit(descriptor: AaCapabilityDescriptor): WalletInit {
  const chain = descriptor.chains.find(c => c.chainId === LOCAL_CHAIN_ID)
  if (!chain) {
    throw new Error(`Host AA descriptor has no chain ${LOCAL_CHAIN_ID}`)
  }

  const aa = LOCALHOST_AA_CONTRACTS
  const chainKey = String(LOCAL_CHAIN_ID)
  const rpcUrl = chain.rpcUrl ?? LOCALHOST_RPC_URL

  const evmConfig = Schema.decodeUnknownSync(EvmWalletInitConfig)({
    chainId: LOCAL_CHAIN_ID,
    provider: rpcUrl,
    bundlerUrl: `${HOST_BASE_URL}${chain.bundlerPath}`,
    paymasterUrl: `${HOST_BASE_URL}${descriptor.paymasterPath}/local`,
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

function buildChainConfig(
  chain: OptionsChainKind,
  secret: Uint8Array,
  walletInit: WalletInit | null,
): OptionsChainConfig {
  if (chain === 'sui') {
    return createOptionsSuiConfig({
      deployment: localnetDeployment,
      seed: secret,
    })
  }

  if (!walletInit) throw new Error('Options wallet config not loaded')

  return {
    walletInit,
    seed: secret,
    addresses: buildOptionsContractAddresses(),
    readRpcUrl: LOCALHOST_RPC_URL,
    includeProtocolSummary: true,
  }
}

export function OptionsProvider({ children }: { children: ReactNode }) {
  const enabled = isOptionsModeEnabled()
  const [chain, setChainState] = useState<OptionsChainKind>(() =>
    enabled ? readStoredChain() : 'evm',
  )
  const [ready, setReady] = useState(!enabled || readStoredChain() === 'sui')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [derivationStep, setDerivationStep] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<Address | null>(null)
  const [board, setBoard] = useState<OptionsBoard | null>(null)
  const [controls, setControls] = useState<readonly OptionsFunctionView[]>([])
  const [usdcBalance, setUsdcBalance] = useState(0)

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
    const usdc = next.panel.user.usdcBalanceUSDC
    if (usdc !== undefined) {
      setUsdcBalance(Number(BigInt(usdc)) / 1_000_000)
    }
  }, [])

  const syncFromBridge = useCallback(async (bridge: OptionsBridge) => {
    applyBoard(await bridge.readBoard(APP_CALLER))
    const nextControls = await bridge.readControls(APP_CALLER)
    setControls(nextControls.functions)
  }, [applyBoard])

  const refreshConnected = useCallback(async (user: UserAddress, marketId?: string) => {
    const runtime = runtimeRef.current
    const bridge = bridgeRef.current
    if (!runtime || !bridge) return

    await runtime.refreshUser(user, marketId ? asMarketId(marketId) : undefined)
    await syncFromBridge(bridge)
  }, [syncFromBridge])

  const bootRuntime = useCallback(async (secret: Uint8Array, user: UserAddress) => {
    teardownRuntime()

    const selectedChain = chainRef.current
    const chainConfig = buildChainConfig(selectedChain, secret, walletInitRef.current)
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
    })
    const bridge = createOptionsBridge({ runtime })

    runtimeRef.current = runtime
    bridgeRef.current = bridge

    boardUnsubRef.current = bridge.subscribeBoard(APP_CALLER, (nextBoard) => {
      applyBoard(nextBoard)
      // A: never swallow live-data errors — the e2e reads console, and the UI must surface a
      // "live data unavailable" state instead of silently masquerading fixture data as live.
      void bridge.readControls(APP_CALLER)
        .then(next => setControls(next.functions))
        .catch(err => {
          console.error('[options] readControls failed', err)
          setError(err instanceof Error ? err.message : String(err))
        })
    })
    pollingStopRef.current = runtime.startPolling().stop

    await refreshConnected(user, marketId)
  }, [applyBoard, refreshConnected, teardownRuntime])

  // S12/A8: derive the Safe address with visible progress, hitting the localStorage cache first so a
  // reconnect after reload is instant instead of a silent ~1-min "Deriving…" that looks like a hang.
  const deriveUserAddress = useCallback(async (
    secret: Uint8Array,
    chainKind: OptionsChainKind,
    chainConfig: OptionsChainConfig,
  ): Promise<UserAddress> => {
    const cachedAddr = readCachedSafeAddress(secret, chainKind)
    if (cachedAddr) {
      setDerivationStep('Restoring your Safe address…')
      return cachedAddr as UserAddress
    }
    setDerivationStep('Deriving your Safe address (first time, ~1 min)…')
    const user = await resolveOptionsAccountAddress(chainConfig)
    writeCachedSafeAddress(secret, chainKind, user)
    return user
  }, [])

  const loadEvmDescriptor = useCallback(async (cancelled: () => boolean) => {
    try {
      const res = await fetch(`${HOST_BASE_URL}/aa/descriptor`)
      if (!res.ok) throw new Error(`AA descriptor HTTP ${res.status}`)
      const descriptor = (await res.json()) as AaCapabilityDescriptor
      walletInitRef.current = buildWalletInit(descriptor)
      if (!cancelled()) setReady(true)
    } catch (err) {
      if (!cancelled()) {
        setError(err instanceof Error ? err.message : String(err))
        setReady(true)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    if (chain === 'sui') {
      walletInitRef.current = null
      setReady(true)
      return
    }

    let cancelled = false
    setReady(false)
    void loadEvmDescriptor(() => cancelled)

    return () => {
      cancelled = true
    }
  }, [enabled, chain, loadEvmDescriptor])

  useEffect(() => {
    if (!enabled || !ready || typeof window === 'undefined') return
    const cached = sessionStorage.getItem(SESSION_SECRET_KEY)
    if (!cached) return
    // B: during an EVM⇄Sui switch the EVM wallet config can briefly be unloaded (a `ready`/`chain`
    // commit can fire before `loadEvmDescriptor` repopulates `walletInitRef`). Skip — do NOT treat
    // this as a derive failure, which would wipe SESSION_SECRET_KEY and drop the wallet. The chain
    // effect re-toggles `ready` once the descriptor loads, re-running this effect cleanly.
    if (chainRef.current === 'evm' && !walletInitRef.current) return

    setIsLoading(true)
    void (async () => {
      try {
        const secret = hexToBytes(cached as `0x${string}`)
        const chainConfig = buildChainConfig(chainRef.current, secret, walletInitRef.current)
        const user = await deriveUserAddress(secret, chainRef.current, chainConfig)
        setAddress(user as Address)
        setIsConnected(true)
        setDerivationStep('Loading market board…')
        await bootRuntime(secret, user)
      } catch (err) {
        sessionStorage.removeItem(SESSION_SECRET_KEY)
        console.error('[options] session reconnect failed', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
        setDerivationStep(null)
      }
    })()

    return () => teardownRuntime()
  }, [enabled, ready, chain, bootRuntime, teardownRuntime, deriveUserAddress])

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(SESSION_SECRET_KEY)
    teardownRuntime()
    setAddress(null)
    setIsConnected(false)
    setUsdcBalance(0)
    setError(null)
  }, [teardownRuntime])

  const setChain = useCallback((next: OptionsChainKind) => {
    if (next === chainRef.current) return
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
  }, [teardownRuntime])

  const connect = useCallback(async (password: string) => {
    if (!enabled) return
    // Test-only override: a configured `VITE_OPTIONS_SEED` makes connect derive from a fixed
    // seed (e.g. "1234") so the operator wallet is reproducible across E2E runs. Derivation is
    // byte-identical to the CLI's deriveSeedFromPassword (sha256(STEALTH_DOMAIN + seed)). When the
    // env var is unset this is undefined and the typed password is used exactly as before.
    const effectiveSeed = testOptionsSeed() ?? password
    if (!effectiveSeed.trim()) {
      setError('Password required')
      return
    }
    if (chainRef.current === 'evm' && !walletInitRef.current) {
      setError('Options config not ready — is host running?')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const secret = toBytes(sha256(toBytes(STEALTH_DOMAIN + effectiveSeed)))
      sessionStorage.setItem(SESSION_SECRET_KEY, bytesToHex(secret))

      setDerivationStep('Preparing wallet…')
      const chainConfig = buildChainConfig(chainRef.current, secret, walletInitRef.current)
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
    } finally {
      setIsLoading(false)
      setDerivationStep(null)
    }
  }, [enabled, bootRuntime, teardownRuntime, deriveUserAddress])

  // Point the runtime at a (newly-viewed) market. We REBOOT the runtime rather than just refreshing
  // once, because the 3s poll targets the market baked into the runtime config at boot
  // (config.defaultMarketId) — a one-off refresh would be overwritten by the next poll on the old
  // market. Rebooting from the cached secret re-pins board + poll to the new market together.
  const setActiveMarketId = useCallback((marketId: string | undefined) => {
    if (marketId === activeMarketIdRef.current) return
    activeMarketIdRef.current = marketId
    const user = address as UserAddress | null
    const cached = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_SECRET_KEY) : null
    if (isConnected && user && cached) {
      void bootRuntime(hexToBytes(cached as `0x${string}`), user)
    }
  }, [address, isConnected, bootRuntime])

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

  const resolveTokenId = useCallback((vaultId: string): bigint => {
    const panel = requirePanel()
    const tokenId = findTokenIdForVault(panel, vaultId)
    if (!tokenId) throw new Error('No NFT for this market')
    return BigInt(tokenId)
  }, [requirePanel])

  /** True when the connected user already holds a position NFT covering this vault's market (D). */
  const hasNftForVault = useCallback((vaultId: string): boolean => {
    if (!board) return false
    return findTokenIdForVault(board.panel, vaultId) !== undefined
  }, [board])

  // D: ONE coherent "back this vault" path — ensure the market's position NFT exists (mint it if the
  // user hasn't entered the market yet), then return its tokenId. Reads the board straight from the
  // bridge after minting so we don't depend on async React state to settle first. This is the root
  // fix that lets fundStream below work without a pre-existing board panel / manual mint step.
  const ensureTokenId = useCallback(async (vaultId: string): Promise<bigint> => {
    const panel = requirePanel()
    const existing = findTokenIdForVault(panel, vaultId)
    if (existing) return BigInt(existing)

    const market = panel.markets.find(m => m.vaults.some(v => v.vaultId === vaultId))
    if (!market) throw new Error('No market for this vault')

    const bridge = requireBridge()
    await bridge.callAction(APP_CALLER, {
      scope: bridgeActionScope,
      action: 'mint',
      args: { marketId: asMarketId(market.marketId), to: requireUser() },
    })
    const fresh = await bridge.readBoard(APP_CALLER)
    applyBoard(fresh)
    const minted = findTokenIdForVault(fresh.panel, vaultId)
    if (!minted) throw new Error('Mint did not produce an NFT for this market')
    return BigInt(minted)
  }, [requirePanel, requireBridge, requireUser, applyBoard])

  const afterWrite = useCallback(async () => {
    const user = address as UserAddress | null
    if (user) await refreshConnected(user, activeMarketIdRef.current)
  }, [address, refreshConnected])

  const callBridgeAction = useCallback(async (action: string, args: unknown): Promise<TxId> => {
    setClaiming(true)
    try {
      const result = await requireBridge().callAction(APP_CALLER, {
        scope: bridgeActionScope,
        action,
        args,
      })
      await afterWrite()
      return typeof result === 'string' ? result : result.txId
    } finally {
      setClaiming(false)
    }
  }, [requireBridge, afterWrite])

  const findFunction = useCallback((
    name: string,
    match?: (fn: OptionsFunctionView) => boolean,
  ) => findOptionsFunction(controls, name, match), [controls])

  const findFundFunctionForVault = useCallback((
    vaultId: string,
    side: 'yes' | 'no',
  ) => findFundFunction(controls, vaultId, side), [controls])

  const findStopFundingFunctionForVault = useCallback((
    vaultId: string,
  ) => findStopFundingFunction(controls, vaultId), [controls])

  const fundStream = useCallback(async (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
    durationMinutes = DEFAULT_FUND_DURATION_MIN,
  ): Promise<TxId> => {
    const chainRate = usdPerMinToChainRate(rateUsdPerMin)
    // D: mint the position NFT first if the user hasn't entered this market yet, then fund — one call.
    const tokenId = await ensureTokenId(vaultId)
    return callBridgeAction('fund', {
      tokenId: asTokenId(tokenId),
      vaultId: asVaultId(vaultId),
      side,
      rate: chainRate,
      deposit: fundDepositForDuration(chainRate, durationMinutes),
    })
  }, [callBridgeAction, ensureTokenId])

  // Top up a position NFT's shared Drips balance: re-assert its CURRENT lanes (so none are removed or
  // re-rated) with addDeposit > 0. setLanes diffs desired-vs-current, so passing the existing lanes
  // back is a pure deposit. Extends the runway for every lane the NFT funds.
  const topUpNft = useCallback(async (
    tokenId: string,
    lanes: readonly { vaultId: string; side: 'yes' | 'no'; rate: string }[],
    depositUsd: number,
  ): Promise<TxId> => {
    const fundable = lanes.filter((lane) => {
      try { return BigInt(lane.rate) > 0n } catch { return false }
    })
    if (fundable.length === 0) throw new Error('No active lane to top up — open a position first')
    const addDeposit = BigInt(Math.round(depositUsd * 1_000_000))
    if (addDeposit <= 0n) throw new Error('Enter an amount greater than 0')
    return callBridgeAction('setLanes', {
      tokenId: asTokenId(BigInt(tokenId)),
      lanes: fundable.map((lane) => ({
        vaultId: asVaultId(lane.vaultId),
        side: lane.side,
        rate: BigInt(lane.rate),
      })),
      addDeposit,
    })
  }, [callBridgeAction])

  const stopFunding = useCallback(async (vaultId: string, side: 'yes' | 'no'): Promise<TxId> => {
    return callBridgeAction('stopFunding', {
      tokenId: asTokenId(resolveTokenId(vaultId)),
      vaultId: asVaultId(vaultId),
      side,
    })
  }, [callBridgeAction, resolveTokenId])

  const previewAccrual = useCallback(async (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
    horizonSec?: number,
  ): Promise<OptionsAccrualPreview> => {
    const chainRate = usdPerMinToChainRate(rateUsdPerMin)
    return requireBridge().previewAccrual(APP_CALLER, {
      vaultId: asVaultId(vaultId),
      side,
      rate: chainRate,
      ...(horizonSec !== undefined ? { horizonSec } : {}),
    })
  }, [requireBridge])

  const claimWin = useCallback(async (vaultId: string): Promise<TxId> => {
    const user = requireUser()
    return callBridgeAction('withdraw', {
      tokenId: asTokenId(resolveTokenId(vaultId)),
      vaultId: asVaultId(vaultId),
      to: user,
    })
  }, [callBridgeAction, requireUser, resolveTokenId])

  const mint = useCallback(async (marketId: string): Promise<TxId> => {
    const user = requireUser()
    return callBridgeAction('mint', {
      marketId: asMarketId(marketId),
      to: user,
    })
  }, [callBridgeAction, requireUser])

  const claimLoss = useCallback(async (vaultId: string, side: 'yes' | 'no'): Promise<TxId> => {
    const user = requireUser()
    return callBridgeAction('claimLossLvst', {
      tokenId: asTokenId(resolveTokenId(vaultId)),
      vaultId: asVaultId(vaultId),
      side,
      to: user,
    })
  }, [callBridgeAction, requireUser, resolveTokenId])

  const stake = useCallback(async (amountLvst: number): Promise<TxId> => {
    return callBridgeAction('stakeLvst', {
      amount: parseUnits(String(amountLvst), 18),
    })
  }, [callBridgeAction])

  const unstake = useCallback(async (amountLvst: number): Promise<TxId> => {
    return callBridgeAction('unstakeLvst', {
      amount: parseUnits(String(amountLvst), 18),
    })
  }, [callBridgeAction])

  const claimDividends = useCallback(async (): Promise<TxId> => {
    return callBridgeAction('claimDividends', {})
  }, [callBridgeAction])

  const transferNft = useCallback(async (tokenId: string, to: string): Promise<TxId> => {
    const user = requireUser()
    if (!isValidRecipientAddress(chainRef.current, to)) {
      throw new Error('Invalid recipient address')
    }
    return callBridgeAction('transferNft', {
      from: user,
      to: asUserAddress(to),
      tokenId: asTokenId(BigInt(tokenId)),
    })
  }, [callBridgeAction, requireUser])

  const approveNft = useCallback(async (tokenId: string, operator: string): Promise<TxId> => {
    if (!isAddress(operator)) throw new Error('Invalid operator address')
    return callBridgeAction('approveNft', {
      operator: asUserAddress(operator),
      tokenId: asTokenId(BigInt(tokenId)),
    })
  }, [callBridgeAction])

  const setApprovalForAll = useCallback(async (operator: string, approved: boolean): Promise<TxId> => {
    if (!isAddress(operator)) throw new Error('Invalid operator address')
    return callBridgeAction('setApprovalForAll', {
      operator: asUserAddress(operator),
      approved,
    })
  }, [callBridgeAction])

  const value = useMemo<OptionsContextValue>(() => ({
    enabled,
    ready,
    chain,
    setChain,
    isConnected,
    isLoading,
    derivationStep,
    claiming,
    error,
    address,
    usdcBalance,
    board,
    controls,
    bridge: bridgeRef.current,
    connect,
    disconnect,
    refresh: afterWrite,
    setActiveMarketId,
    findFunction,
    findFundFunction: findFundFunctionForVault,
    findStopFundingFunction: findStopFundingFunctionForVault,
    fundStream,
    stopFunding,
    topUpNft,
    previewAccrual,
    claimWin,
    hasNftForVault,
    mint,
    claimLoss,
    stake,
    unstake,
    claimDividends,
    transferNft,
    approveNft,
    setApprovalForAll,
  }), [
    enabled, ready, chain, setChain, isConnected, isLoading, derivationStep, claiming, error, address, usdcBalance, board, controls,
    connect, disconnect, afterWrite, setActiveMarketId, findFunction, findFundFunctionForVault,
    findStopFundingFunctionForVault, fundStream, stopFunding, topUpNft, previewAccrual, claimWin, hasNftForVault, mint, claimLoss,
    stake, unstake, claimDividends, transferNft, approveNft, setApprovalForAll,
  ])

  return (
    <OptionsContext.Provider value={value}>
      {children}
    </OptionsContext.Provider>
  )
}

export function useOptionsContext(): OptionsContextValue {
  const ctx = useContext(OptionsContext)
  if (!ctx) throw new Error('useOptionsContext must be used within <OptionsProvider>')
  return ctx
}
