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
import { EvmWalletInitConfig, solanaWalletInitFromDescriptor, type WalletInit } from '@livestreak/schema'
import { localnetDeployment } from '@livestreak/contracts/sui'
import { localnetDeployment as solanaLocalnetDeployment } from '@livestreak/contracts/solana/deployments/localnet'
import {
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

import { HOST_BASE_URL, LOCAL_CHAIN_ID, isOptionsModeEnabled, testOptionsSeed } from '#/utils/env'
import {
  buildOptionsContractAddresses,
  initialChain,
  isChainDeployed,
  LOCALHOST_AA_CONTRACTS,
  LOCALHOST_RPC_URL,
} from '#/utils/deployments'
import {
  chainLabel,
  isValidRecipientAddress,
  SESSION_CHAIN_KEY,
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
  /** Open / switch / re-rate a vault's stream (balance-first). The SDK runtime decides starter-deposit vs.
   *  pure re-rate and preserves every other lane. Backs both the vault-card "stream" and active-card "adjust". */
  fundStream: (vaultId: string, side: 'yes' | 'no', rateUsdPerMin: number) => Promise<TxId>
  stopFunding: (vaultId: string, side: 'yes' | 'no') => Promise<TxId>
  /** Re-rate an existing stream in place (the active-card "adjust rate"). Same SDK operation as fundStream. */
  updateLaneRate: (vaultId: string, side: 'yes' | 'no', rateUsdPerMin: number) => Promise<TxId>
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

type StoredPausedLane = { tokenId: string; vaultId: string; side: 'yes' | 'no'; rate: string }

function loadPausedLanes(): OptionsPausedLane[] {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(PAUSED_LANES_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as StoredPausedLane[]).map(p => ({
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
    const stored: StoredPausedLane[] = lanes.map(p => ({
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
    return createOptionsSuiConfig({
      deployment: localnetDeployment,
      seed: secret,
    })
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
    }
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
      setUsdcBalance(usdc)
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
    // Never boot a chain this build has no valid deployment for — fail with a clear message instead of the
    // cryptic "Invalid contract address" throw that used to wedge the whole board.
    if (!isChainDeployed(selectedChain)) {
      throw new Error(`${chainLabel(selectedChain)} isn't deployed in this environment — pick a deployed chain.`)
    }
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
      // Paused-lane registry is owned by the runtime; this port persists it across reloads.
      pausedLanes: { initial: loadPausedLanes(), onChange: savePausedLanes },
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
    }
  }, [bootRuntime])

  // S12/A8: derive the Safe address with visible progress, hitting the localStorage cache first so a
  // reconnect after reload is instant instead of a silent ~1-min "Deriving…" that looks like a hang.
  const deriveUserAddress = useCallback(async (
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
  }, [])

  // Load the host AA descriptor and build the walletInit for the given chain (EVM Safe/4337 apparatus
  // vs. Solana Kora-paymaster triple). Sui needs no descriptor and skips this path entirely.
  const loadDescriptor = useCallback(async (
    chainKind: OptionsChainKind,
    cancelled: () => boolean,
  ) => {
    try {
      const res = await fetch(`${HOST_BASE_URL}/aa/descriptor`)
      if (!res.ok) throw new Error(`AA descriptor HTTP ${res.status}`)
      const descriptor = (await res.json()) as AaCapabilityDescriptor
      walletInitRef.current =
        chainKind === 'solana' ? buildSolanaWalletInit(descriptor) : buildWalletInit(descriptor)
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
  }, [enabled, ready, chain, bootRuntime, teardownRuntime, deriveUserAddress, bootAnonymous])

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(SESSION_SECRET_KEY)
    teardownRuntime()
    setAddress(null)
    setIsConnected(false)
    setUsdcBalance(0)
    setError(null)
    void bootAnonymous() // fall back to the read-only board for the current market
  }, [teardownRuntime, bootAnonymous])

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
    // EVM (Safe/4337) and Solana (Kora/self-pay) both need a loaded walletInit before we can derive
    // or write; Sui signs natively with no descriptor, so it is exempt.
    if (chainRef.current !== 'sui' && !walletInitRef.current) {
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
    } else if (marketId) {
      void bootAnonymous()
    } else {
      teardownRuntime()
    }
  }, [address, isConnected, bootRuntime, bootAnonymous, teardownRuntime])

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

  // Balance-first top-up: hand the SDK `addFunds` action only the deposit — it re-asserts the NFT's existing
  // lanes itself (extending/reviving every stream, or parking the funds when there are none), so the UI
  // never reconstructs the lane set. Works with zero active lanes (parks as budget).
  const addFundsNft = useCallback(async (tokenId: string, depositUsd: number): Promise<TxId> => {
    const deposit = usdcToRaw(depositUsd)
    if (deposit <= 0n) throw new Error('Enter an amount greater than 0')
    return callBridgeAction('addFunds', {
      tokenId: asTokenId(BigInt(tokenId)),
      deposit,
    })
  }, [callBridgeAction])

  // Sweep to wallet: stopAll halts every lane (banking shares) and withdraws the remaining shared Drips
  // balance back to the owner's wallet.
  const sweepNft = useCallback(async (tokenId: string): Promise<TxId> =>
    callBridgeAction('stopAllFunding', { tokenId: asTokenId(BigInt(tokenId)) }),
  [callBridgeAction])

  // Withdraw all winnings: collect from every resolved winning lane on the NFT in one withdrawMany call.
  // The winning vaults are derived from the panel here (provider-side), so the UI just calls withdrawAllNft.
  const withdrawAllNft = useCallback(async (tokenId: string): Promise<TxId> => {
    const panel = requirePanel()
    const nft = panel.nfts.find(n => n.tokenId === tokenId)
    const vaultIds = (nft?.lanes ?? []).filter(l => l.settlement?.canClaimWin === true).map(l => l.vaultId)
    if (vaultIds.length === 0) throw new Error('No winnings to withdraw')
    return callBridgeAction('withdrawMany', {
      tokenId: asTokenId(BigInt(tokenId)),
      vaultIds: vaultIds.map(v => asVaultId(v)),
      to: requireUser(),
    })
  }, [callBridgeAction, requirePanel, requireUser])

  // --- Active-stream lane controls (stream / adjust / pause / resume) ---
  // The SDK runtime owns ALL lane orchestration now: it reads its own snapshot to build the setLanes set,
  // preserves every other lane, applies the balance-first starter deposit, and owns the paused registry.
  // The app just names the gesture and forwards the high-level args — no lane reconstruction here.

  // Open / switch / re-rate a vault's stream (balance-first). One operation behind both the vault-card
  // "stream" gesture and the active-card "adjust rate" — the runtime decides deposit vs. pure re-rate.
  const streamLane = useCallback((
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
  ): Promise<TxId> =>
    callBridgeAction('streamLane', { vaultId: asVaultId(vaultId), side, ratePerMin: rateUsdPerMin }),
  [callBridgeAction])

  const pauseLane = useCallback((vaultId: string, side: 'yes' | 'no'): Promise<TxId> =>
    callBridgeAction('pauseLane', { vaultId: asVaultId(vaultId), side }), [callBridgeAction])

  const resumeLane = useCallback((vaultId: string, side: 'yes' | 'no'): Promise<TxId> =>
    callBridgeAction('resumeLane', { vaultId: asVaultId(vaultId), side }), [callBridgeAction])

  const previewAccrual = useCallback(async (
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

  // Cash out ONE resolved vault — strictly per-vault, never NFT-wide (leaves your other vaults + the
  // shared balance alone). Runs the settlement legs in order: (1) stop this vault's still-streaming lanes
  // so overstream stops growing, (2) mint LVST on the losing side if you lost, (3) withdraw — which runs
  // the permissionless `collect` (pot finalize) then pays winnings AND overstream for BOTH sides. Withdraw
  // is last so the now-frozen overstream is fully paid. Each leg is a separate sponsored tx (Solana can't
  // batch engine ops); only the legs you actually hold run (1–4). `onStep` streams live progress: each
  // leg's KNOWN amount (from the collect-projected board) is reported as its tx confirms. Chain-agnostic.
  const settleVault = useCallback(async (vaultId: string): Promise<TxId> => {
    const user = requireUser()
    const tokenId = asTokenId(resolveTokenId(vaultId))
    const vid = asVaultId(vaultId)
    const panel = requirePanel()
    const nft = panel.nfts.find(n => n.lanes.some(l => l.vaultId === vaultId))
    const lanes = nft?.lanes.filter(l => l.vaultId === vaultId) ?? []
    const lost = lanes.find(l => l.settlement?.won === false && l.settlement.canClaimLoss === true)
    const won = lanes.find(l => l.settlement?.won === true && (l.settlement.claimableUSDC ?? 0) > 0)
    const overstreamTotal = lanes.reduce((s, l) => s + (l.settlement?.overstreamClaimableUSDC ?? 0), 0)
    // 1. stop this vault's still-streaming lanes so overstream stops growing (per-lane stopFunding).
    for (const lane of lanes) {
      if (lane.status === 'streaming') {
        await callBridgeAction('stopFunding', { tokenId, vaultId: vid, side: lane.side })
      }
    }
    // 2. mint the losing side's LVST, if you held one and haven't claimed it yet.
    let lossTx: TxId | undefined
    if (lost) lossTx = await callBridgeAction('claimLossLvst', { tokenId, vaultId: vid, side: lost.side, to: user })
    // 3. withdraw — runs collect (pot finalize) then pays winnings + both sides' overstream. Skipped when
    // there's neither, so a pure-loss vault doesn't fire a no-op tx.
    let winTx: TxId | undefined
    if (won || overstreamTotal > 0) winTx = await callBridgeAction('withdraw', { tokenId, vaultId: vid, to: user })
    const tx = winTx ?? lossTx
    if (!tx) throw new Error('Nothing to cash out')
    return tx
  }, [requirePanel, callBridgeAction, resolveTokenId, requireUser])

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
  }), [
    enabled, ready, chain, setChain, isConnected, isLoading, derivationStep, claiming, error, address, usdcBalance, board, controls,
    connect, disconnect, afterWrite, setActiveMarketId, findFunction, findFundFunctionForVault,
    findStopFundingFunctionForVault, streamLane, pauseLane, resumeLane,
    addFundsNft, sweepNft, withdrawAllNft, previewAccrual, claimWin, hasNftForVault, mint, claimLoss, settleVault,
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
