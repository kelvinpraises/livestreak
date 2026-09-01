export interface Vault {
  id: string
  option: string
  type: 'momentum' | 'player' | 'threshold' | 'timing' | 'swing'
  creator: string
  noTotal: number
  yesTotal: number
  status: 'open' | 'hot' | 'locked' | 'resolved' | 'disputed'
  hotUntil: number | null
  createdAt: number
  expiresAt: number
  outcome: 'pending' | 'yes' | 'no'
  multiplier: number
  userPosition?: { side: 'yes' | 'no'; streamed: number; shares: number; currentValue: number }
  userWon?: boolean
  payout?: number
  flowReceived?: number
  exitBurn?: number
  createdMinute?: number
}

export interface WSFrame {
  frame: number; ts: number; events: WSEvent[]; min: number
}

export interface WSEvent {
  id: string
  t: 'alert' | 'vault_created' | 'stream_surge' | 'hot_period' | 'resolved' | 'milestone' | 'system'
  min: number
  desc: string
}

export interface FlowState {
  balance: number; staked: number; pendingDividends: number; totalEarned: number; apy: number
}

export interface WalletState {
  address: string; usdcBalance: number; connected: boolean; sessionKeySigned: boolean
}

export interface Position {
  vaultId: string; option: string; side: 'yes' | 'no'; streamed: number
  streamRate: number; shares: number; currentValue: number; pnl: number
  resolved: boolean; won?: boolean; payout?: number; minute: number
}

export const mockVaults: Vault[] = [
  {
    id: '0x1a2b', option: 'Speaker addresses regulation next', type: 'momentum', creator: '0xsteward',
    noTotal: 185, yesTotal: 94, status: 'open', hotUntil: null,
    createdAt: Date.now() - 240000, expiresAt: Date.now() + 180000,
    outcome: 'pending', multiplier: 2.31, createdMinute: 38,
    userPosition: { side: 'yes', streamed: 25, shares: 34, currentValue: 28.50 },
  },
  {
    id: '0x3c4d', option: 'Audience question within 5 minutes', type: 'timing', creator: '0xsteward',
    noTotal: 210, yesTotal: 128, status: 'hot', hotUntil: Date.now() + 42000,
    createdAt: Date.now() - 600000, expiresAt: Date.now() + 480000,
    outcome: 'pending', multiplier: 1.83, exitBurn: 20, createdMinute: 32,
  },
  {
    id: '0x5e6f', option: 'Panel reaches consensus on AI safety', type: 'threshold', creator: '0xsteward',
    noTotal: 88, yesTotal: 192, status: 'resolved', hotUntil: null,
    createdAt: Date.now() - 1800000, expiresAt: Date.now() - 300000,
    outcome: 'yes', multiplier: 1.00, createdMinute: 15,
    userPosition: { side: 'yes', streamed: 22, shares: 30, currentValue: 26.98 },
    userWon: true, payout: 26.98,
  },
  {
    id: '0x7a8b', option: 'Surprise guest appearance before end', type: 'swing', creator: '0xsteward',
    noTotal: 320, yesTotal: 65, status: 'resolved', hotUntil: null,
    createdAt: Date.now() - 2400000, expiresAt: Date.now() - 900000,
    outcome: 'no', multiplier: 1.00, createdMinute: 8,
    userPosition: { side: 'yes', streamed: 30, shares: 38, currentValue: 0 },
    userWon: false, flowReceived: 152,
  },
  {
    id: '0x9c0d', option: 'Viewer count exceeds 20k', type: 'timing', creator: '0xsteward',
    noTotal: 72, yesTotal: 48, status: 'open', hotUntil: null,
    createdAt: Date.now() - 60000, expiresAt: Date.now() + 240000,
    outcome: 'pending', multiplier: 2.67, createdMinute: 43,
  },
]

export const mockEvents: WSEvent[] = [
  { id: 'e1', t: 'alert', min: 45, desc: 'AI detected key moment — speaker tone shifted significantly' },
  { id: 'e2', t: 'vault_created', min: 43, desc: 'New vault: "Viewer count exceeds 20k"' },
  { id: 'e3', t: 'stream_surge', min: 40, desc: 'YES volume surged 3x on "Speaker addresses regulation" vault' },
  { id: 'e4', t: 'hot_period', min: 38, desc: '"Audience question within 5 minutes" entered hot period' },
  { id: 'e5', t: 'alert', min: 35, desc: 'Significant audience reaction — sentiment shift detected' },
  { id: 'e6', t: 'resolved', min: 32, desc: '"Opening remarks exceed 10 min" resolved YES' },
  { id: 'e7', t: 'milestone', min: 30, desc: 'Stream crossed 15,000 concurrent viewers' },
  { id: 'e8', t: 'vault_created', min: 28, desc: 'New vault: "Speaker addresses regulation next"' },
  { id: 'e9', t: 'stream_surge', min: 25, desc: 'Total pooled crossed $3,000 — volume milestone' },
  { id: 'e10', t: 'system', min: 22, desc: 'Observer batch #1240 submitted to IPFS' },
  { id: 'e11', t: 'alert', min: 18, desc: 'AI confidence spike — strong prediction signal' },
  { id: 'e12', t: 'resolved', min: 15, desc: '"Panel reaches consensus" resolved YES — $280 distributed' },
]

export const mockFlow: FlowState = { balance: 1250, staked: 800, pendingDividends: 12.48, totalEarned: 87.20, apy: 14.2 }
export const mockWallet: WalletState = { address: '0x4a7f...93be', usdcBalance: 3820.30, connected: false, sessionKeySigned: false }

export const mockPositions: Position[] = [
  { vaultId: '0x1a2b', option: 'Speaker addresses regulation next', side: 'yes', streamed: 25, streamRate: 0.8, shares: 34, currentValue: 28.50, pnl: 3.50, resolved: false, minute: 38 },
  { vaultId: '0x5e6f', option: 'Panel reaches consensus on AI safety', side: 'yes', streamed: 22, streamRate: 0, shares: 30, currentValue: 26.98, pnl: 4.98, resolved: true, won: true, payout: 26.98, minute: 15 },
  { vaultId: '0x7a8b', option: 'Surprise guest appearance before end', side: 'yes', streamed: 30, streamRate: 0, shares: 38, currentValue: 0, pnl: -30, resolved: true, won: false, minute: 8 },
]

export const mockFrame: WSFrame = { frame: 7430, ts: Date.now(), events: [], min: 45 }

/* ─── Stream types & mock data ─── */

export interface StreamMeta {
  id: string
  title: string
  category: string
  thumbnail?: string
  viewers: number
  activeVaults: number
  totalPooled: number
  elapsed: string
  isLive: boolean
}

export const mockStreams: StreamMeta[] = [
  {
    id: 'tech-1',
    title: 'AI & Prediction Markets — Live Panel',
    category: 'Tech',
    viewers: 14_820,
    activeVaults: 5,
    totalPooled: 3_820.30,
    elapsed: '45m',
    isLive: true,
  },
  {
    id: 'esports-1',
    title: 'LCS Finals — Game 3',
    category: 'Esports',
    viewers: 8_340,
    activeVaults: 4,
    totalPooled: 2_100.00,
    elapsed: '32m',
    isLive: true,
  },
  {
    id: 'politics-1',
    title: 'Town Hall Debate: Climate Policy',
    category: 'Politics',
    viewers: 22_510,
    activeVaults: 3,
    totalPooled: 1_500.00,
    elapsed: '1h 15m',
    isLive: true,
  },
  {
    id: 'entertainment-1',
    title: 'MasterChef Live Semi-Finals',
    category: 'Entertainment',
    viewers: 5_670,
    activeVaults: 2,
    totalPooled: 890.00,
    elapsed: '25m',
    isLive: true,
  },
]

/* Live vaults across all streams */
export interface LiveVault {
  id: string
  streamId: string
  streamTitle: string
  option: string
  multiplier: number
  totalPool: number
  status: 'open' | 'hot'
  expiresIn: number
}

export const mockLiveVaults: LiveVault[] = [
  { id: 'lv-1', streamId: 'tech-1', streamTitle: 'AI & Prediction Markets', option: 'Speaker addresses regulation next', multiplier: 2.31, totalPool: 279, status: 'open', expiresIn: 180 },
  { id: 'lv-2', streamId: 'esports-1', streamTitle: 'LCS Finals', option: 'Team Alpha wins Game 3', multiplier: 1.92, totalPool: 485, status: 'hot', expiresIn: 45 },
  { id: 'lv-3', streamId: 'politics-1', streamTitle: 'Town Hall Debate', option: 'Candidate X gets more applause next', multiplier: 3.10, totalPool: 312, status: 'open', expiresIn: 300 },
  { id: 'lv-4', streamId: 'tech-1', streamTitle: 'AI & Prediction Markets', option: 'Audience question within 5 minutes', multiplier: 1.83, totalPool: 338, status: 'hot', expiresIn: 42 },
  { id: 'lv-5', streamId: 'entertainment-1', streamTitle: 'MasterChef Live', option: 'Chef Rivera survives elimination', multiplier: 1.45, totalPool: 210, status: 'open', expiresIn: 600 },
]

/* Lifetime / resolved vaults */
export interface LifetimeVault {
  id: string
  option: string
  streamTitle: string
  outcome: 'yes' | 'no'
  totalPool: number
  resolvedAt: number
  yesTotal: number
  noTotal: number
}

export const mockLifetimeVaults: LifetimeVault[] = [
  { id: 'lt-1', option: 'Panel reaches consensus on AI safety', streamTitle: 'AI & Prediction Markets', outcome: 'yes', totalPool: 280, resolvedAt: Date.now() - 3600000, yesTotal: 192, noTotal: 88 },
  { id: 'lt-2', option: 'Speaker endorses open-source approach', streamTitle: 'AI & Prediction Markets', outcome: 'no', totalPool: 385, resolvedAt: Date.now() - 7200000, yesTotal: 65, noTotal: 320 },
  { id: 'lt-3', option: 'Chef Rivera survives first round', streamTitle: 'MasterChef Live', outcome: 'yes', totalPool: 210, resolvedAt: Date.now() - 10800000, yesTotal: 155, noTotal: 55 },
  { id: 'lt-4', option: 'Candidate X gets standing ovation', streamTitle: 'Town Hall Debate', outcome: 'no', totalPool: 440, resolvedAt: Date.now() - 14400000, yesTotal: 180, noTotal: 260 },
  { id: 'lt-5', option: 'Team Alpha takes first blood in Game 2', streamTitle: 'LCS Finals', outcome: 'yes', totalPool: 520, resolvedAt: Date.now() - 18000000, yesTotal: 340, noTotal: 180 },
]

/* ─── Protocol stats ─── */

export const mockProtocolStats = {
  totalVaults: 142,
  totalVolume: 284_390,
  activeStreams: 4,
  activeAgents: 12,
}

/* ─── Agent types & mock data ─── */

export type AgentRole = 'bookmaker' | 'steward' | 'observer'

export interface Agent {
  id: string
  name: string
  address: string
  role: AgentRole
  accuracy: number
  winRate: number
  vaultsCreated: number
  vaultsMonitored: number
  totalVolume: number
  batchesSubmitted?: number
  resolutionsConfirmed?: number
  proposals?: number
  vetosUsed?: number
  uptime?: number
  reputation: number
  successRate?: number
}

export const mockAgents: Agent[] = [
  { id: 'a1', name: 'MomentumBot', address: '0x3f8c...a21d', role: 'bookmaker', accuracy: 78, winRate: 78, vaultsCreated: 42, vaultsMonitored: 42, totalVolume: 12_400, reputation: 88 },
  { id: 'a2', name: 'Guardian1', address: '0x7b2e...f84c', role: 'steward', accuracy: 92, winRate: 92, vaultsCreated: 0, vaultsMonitored: 15, totalVolume: 0, resolutionsConfirmed: 15, proposals: 3, vetosUsed: 0, reputation: 95, successRate: 92 },
  { id: 'a3', name: 'SharpEye', address: '0x1a9d...c7e3', role: 'observer', accuracy: 99, winRate: 99, vaultsCreated: 0, vaultsMonitored: 8, totalVolume: 0, batchesSubmitted: 1_240, uptime: 99.2, reputation: 97 },
  { id: 'a4', name: 'PatternHunter', address: '0x5e6f...b92a', role: 'bookmaker', accuracy: 65, winRate: 65, vaultsCreated: 28, vaultsMonitored: 28, totalVolume: 8_700, reputation: 72 },
  { id: 'a5', name: 'ProtocolWatch', address: '0x8d4a...e15f', role: 'steward', accuracy: 100, winRate: 100, vaultsCreated: 0, vaultsMonitored: 8, totalVolume: 0, resolutionsConfirmed: 8, proposals: 1, vetosUsed: 1, reputation: 91, successRate: 100 },
  { id: 'a6', name: 'QuickDraw', address: '0x2c7b...d43e', role: 'bookmaker', accuracy: 71, winRate: 71, vaultsCreated: 35, vaultsMonitored: 35, totalVolume: 9_850, reputation: 80 },
  { id: 'a7', name: 'SentinelV2', address: '0x6f3a...18bc', role: 'observer', accuracy: 98, winRate: 98, vaultsCreated: 0, vaultsMonitored: 12, totalVolume: 0, batchesSubmitted: 2_810, uptime: 98.7, reputation: 94 },
  { id: 'a8', name: 'ArbiterDAO', address: '0x9e1c...72af', role: 'steward', accuracy: 87, winRate: 87, vaultsCreated: 0, vaultsMonitored: 6, totalVolume: 0, resolutionsConfirmed: 6, proposals: 2, vetosUsed: 0, reputation: 82, successRate: 87 },
]
