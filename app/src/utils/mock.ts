import { defaultHostEdgeFixture } from '#/utils/demo'
import { parseFixture } from '#/utils/parse-fixture'

export type {
  Agent,
  AgentRole,
  FlowState,
  Position,
  StreamMeta,
  VaultView,
  WalletState,
  WSFrame,
  WSEvent,
} from '#/types/demo'

const defaults = parseFixture(defaultHostEdgeFixture)

/** Static defaults from bundled fixture — prefer `useParsedFixture()` in hooks. */
export const mockVaults = defaults.vaults
export const mockVaultViews = defaults.vaultViews
export const mockEvents = defaults.events
export const mockFlow = defaults.flow
export const mockWallet = defaults.wallet
export const mockPositions = defaults.positions
export const mockFrame = defaults.frame
export const mockStreams = defaults.streams
export const mockAgents = defaults.agents
export const mockLiveVaults = defaultHostEdgeFixture.homepage.liveVaults
export const mockLifetimeVaults = defaults.homepage.lifetimeVaults
export const mockProtocolStats = defaults.homepage.protocolStats
