import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FundingSession, loadFunding, type FundingPorts } from '../src/utils/funding-session'
const intent = { vaultId: 'vault', marketId: 'market', side: 'yes' as const, rate: 1 }
let storage: Storage
let session: FundingSession
let ports: FundingPorts
beforeEach(() => {
  const entries = new Map<string, string>()
  storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) } as unknown as Storage
  session = new FundingSession(storage, 'evm', 'viewer', () => {})
  ports = { preflight: vi.fn(async () => {}), hasPosition: vi.fn(async () => true), mint: vi.fn(async () => {}),
    fund: vi.fn(async () => { session.submitted('fund-tx'); return 'fund-tx' }), verify: vi.fn(async () => true), receipt: vi.fn(async () => true) }
})
describe('durable viewer funding', () => {
  it('checks rules and balance before moving funds and confirms an actual position', async () => {
    await expect(session.run(intent, ports)).resolves.toBe('fund-tx')
    expect(ports.preflight).toHaveBeenCalledTimes(2)
    expect(ports.verify).toHaveBeenCalledWith(intent)
    expect(loadFunding(storage, 'evm', 'viewer')?.status).toBe('confirmed')
    expect(ports.mint).not.toHaveBeenCalled()
  })
  it.each(['missing rules', 'closed funding', 'wrong network', 'insufficient USDC'])('rejects %s without signing', async error => {
    ports.preflight = vi.fn(async () => { throw Error(error) })
    await expect(session.run(intent, ports)).rejects.toThrow(error)
    expect(ports.mint).not.toHaveBeenCalled(); expect(ports.fund).not.toHaveBeenCalled()
    expect(session.operation).toBeNull()
  })
  it('creates one position, then rechecks the deadline before funding', async () => {
    ports.hasPosition = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    ports.mint = vi.fn(async () => { session.submitted('mint-tx') })
    ports.preflight = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Funding closed'))
    await expect(session.run(intent, ports)).rejects.toThrow('Funding closed')
    expect(ports.mint).toHaveBeenCalledTimes(1); expect(ports.fund).not.toHaveBeenCalled()
    expect(session.operation?.status).toBe('failed')
  })
  it('persists the hash before receipt polling and reconciles after reload without resubmitting', async () => {
    ports.fund = vi.fn(async () => { session.submitted('fund-tx'); throw Error('Connection lost') })
    await expect(session.run(intent, ports)).rejects.toThrow('Connection lost')
    session = new FundingSession(storage, 'evm', 'viewer', () => {})
    expect(session.operation?.txId).toBe('fund-tx')
    await expect(session.run(intent, ports)).rejects.toThrow('pending')
    await session.recover(ports)
    expect(session.operation?.status).toBe('confirmed'); expect(ports.fund).toHaveBeenCalledTimes(1)
  })
  it('keeps a successful receipt pending until the owned position is visible', async () => {
    ports.verify = vi.fn(async () => false)
    await expect(session.run(intent, ports)).rejects.toThrow('waiting')
    await session.recover(ports)
    expect(session.operation?.status).toBe('unknown')
    ports.verify = vi.fn(async () => true)
    await session.recover(ports)
    expect(session.operation?.status).toBe('confirmed'); expect(ports.fund).toHaveBeenCalledTimes(1)
  })
  it.each(['mint', 'approve'] as const)('recovers %s separately from the funding transaction', async step => {
    if (step === 'mint') {
      ports.hasPosition = vi.fn(async () => false)
      ports.mint = vi.fn(async () => { session.submitted('setup-tx'); throw Error('lost') })
    } else {
      ports.fund = vi.fn(async () => { session.submitted('setup-tx', 'approve'); throw Error('lost') })
    }
    await expect(session.run(intent, ports)).rejects.toThrow('lost')
    ports.hasPosition = vi.fn(async () => true)
    await session.recover(ports)
    expect(session.operation?.status).toBe('continue')
    await expect(session.run({ ...intent, side: 'no' }, ports)).rejects.toThrow('changing')
    ports.fund = vi.fn(async () => { session.submitted('fund-tx'); return 'fund-tx' })
    await session.run(intent, ports)
    expect(session.operation?.status).toBe('confirmed')
    expect(ports.mint).toHaveBeenCalledTimes(step === 'mint' ? 1 : 0)
  })
  it('does not blindly retry an interrupted write without a transaction identity', async () => {
    ports.fund = vi.fn(async () => { throw Error('lost') })
    await expect(session.run(intent, ports)).rejects.toThrow('lost')
    await session.recover(ports)
    await expect(session.run(intent, ports)).rejects.toThrow('pending')
    expect(ports.receipt).not.toHaveBeenCalled(); expect(ports.fund).toHaveBeenCalledTimes(1)
  })
  it('allows retry only after a known failed receipt', async () => {
    ports.fund = vi.fn(async () => { session.submitted('failed-tx'); throw Error('lost') })
    await expect(session.run(intent, ports)).rejects.toThrow('lost')
    ports.receipt = vi.fn(async () => false)
    await session.recover(ports)
    expect(session.operation?.status).toBe('failed')
    ports.fund = vi.fn(async () => 'retry-tx')
    await session.run(intent, ports)
    expect(session.operation?.txId).toBe('retry-tx')
  })
  it('serializes double clicks before the first asynchronous check finishes', async () => {
    let release!: () => void
    ports.preflight = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve })).mockResolvedValue(undefined)
    const first = session.run(intent, ports)
    await expect(session.run(intent, ports)).rejects.toThrow('in progress')
    release(); await first; expect(ports.fund).toHaveBeenCalledTimes(1)
  })
  it('fails before signing when durable storage is unavailable', async () => {
    const storage = { getItem: () => null, setItem: () => { throw Error('Storage blocked') } } as unknown as Storage
    session = new FundingSession(storage, 'evm', 'viewer', () => {})
    await expect(session.run(intent, ports)).rejects.toThrow('Storage blocked')
    expect(ports.mint).not.toHaveBeenCalled(); expect(ports.fund).not.toHaveBeenCalled()
  })
  it('isolates wallet and chain recovery records', async () => {
    await session.run(intent, ports)
    expect(loadFunding(storage, 'solana', 'viewer')).toBeNull()
    expect(loadFunding(storage, 'evm', 'other')).toBeNull()
  })
})
