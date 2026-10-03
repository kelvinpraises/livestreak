import { expect, it, vi } from 'vitest'
import { ClaimSession, loadClaim, type ClaimPorts } from '../src/utils/claim-session'
const storage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
  } as unknown as Storage
}
const step = {
  id: 'withdraw:1',
  action: 'withdraw',
  args: { tokenId: '1', vaultId: 'vault' },
}
it('runs fresh entitlement steps and confirms only after final readback', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  let phase = 0
  const ports: ClaimPorts = {
    next: async () =>
      phase === 0
        ? { ...step, id: 'loss:1', action: 'claimLossLvst' }
        : phase === 1
          ? step
          : null,
    execute: async () => {
      c.submitting()
      c.submitted('tx-' + phase)
      phase++
      return 'tx-' + (phase - 1)
    },
    receipt: async () => true,
  }
  expect(await c.run('vault', ports)).toBe('tx-1')
  expect(c.operation?.status).toBe('confirmed')
  expect(c.operation?.receipts).toEqual(['tx-0', 'tx-1'])
})
it('recovers an included but dropped final response without a second payment', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  let paid = false
  const execute = vi.fn(async () => {
    c.submitting()
    c.submitted('known')
    paid = true
    throw Error('lost')
  })
  const ports = {
    next: async () => (paid ? null : step),
    execute,
    receipt: async () => true,
  }
  await expect(c.run('vault', ports)).rejects.toThrow('lost')
  const reloaded = new ClaimSession(s, 'evm', 'viewer', () => {})
  await reloaded.recover(ports)
  expect(reloaded.operation?.status).toBe('confirmed')
  expect(execute).toHaveBeenCalledTimes(1)
})
it('successful intermediate receipt resumes only remaining eligible legs', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  let lossClaimed = false
  const execute = vi.fn(async () => {
    c.submitting()
    c.submitted('loss')
    lossClaimed = true
    throw Error('response lost')
  })
  const ports = {
    next: async () =>
      lossClaimed ? step : { ...step, id: 'loss:1', action: 'claimLossLvst' },
    execute,
    receipt: async () => true,
  }
  await expect(c.run('vault', ports)).rejects.toThrow()
  await c.recover(ports)
  expect(c.operation?.status).toBe('continue')
  await expect(c.run('another-vault', ports)).rejects.toThrow('current question')
})
it('clears a prior setup hash before a later unidentifiable submission', async () => {
  const c = new ClaimSession(storage(), 'evm', 'viewer', () => {})
  const ports = {
    next: async () => step,
    execute: async () => {
      c.submitting('collect')
      c.submitted('setup')
      c.submitting('withdraw')
      throw Error('send lost')
    },
    receipt: vi.fn(async () => true),
  }
  await expect(c.run('vault', ports)).rejects.toThrow()
  expect(c.operation?.txId).toBeUndefined()
  await c.recover(ports)
  expect(c.operation?.status).toBe('unknown')
  expect(ports.receipt).not.toHaveBeenCalled()
  await expect(c.run('vault', ports)).rejects.toThrow('pending')
})
it('pending receipt stays unknown; definite revert permits fresh entitlement retry', async () => {
  const c = new ClaimSession(storage(), 'evm', 'viewer', () => {})
  let receipt: boolean | undefined = undefined
  const ports = {
    next: async () => step,
    execute: async () => {
      c.submitted('failed')
      throw Error('poll lost')
    },
    receipt: async () => receipt,
  }
  await expect(c.run('vault', ports)).rejects.toThrow()
  await c.recover(ports)
  expect(c.operation?.status).toBe('unknown')
  receipt = false
  await c.recover(ports)
  expect(c.operation?.status).toBe('failed')
})
it('blocks synchronous duplicate clicks and quota failure before a writer', async () => {
  const c = new ClaimSession(storage(), 'evm', 'viewer', () => {})
  let release!: () => void
  const wait = new Promise<void>((r) => {
    release = r
  })
  const ports = {
    next: async () => {
      await wait
      return null
    },
    execute: vi.fn(async () => ''),
    receipt: async () => true,
  }
  const first = c.run('vault', ports)
  await expect(c.run('vault', ports)).rejects.toThrow('already')
  release()
  await expect(first).rejects.toThrow('Nothing')
  const bad = {
    getItem: () => null,
    setItem: () => {
      throw Error('quota')
    },
  } as unknown as Storage
  await expect(
    new ClaimSession(bad, 'evm', 'viewer', () => {}).run('vault', ports),
  ).rejects.toThrow('quota')
  expect(ports.execute).not.toHaveBeenCalled()
})
it('isolates recovery by connected chain and wallet', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  await expect(
    c.run('vault', {
      next: async () => step,
      execute: async () => {
        throw Error('lost')
      },
      receipt: async () => undefined,
    }),
  ).rejects.toThrow()
  expect(loadClaim(s, 'sui', 'viewer')).toBeNull()
  expect(loadClaim(s, 'evm', 'other')).toBeNull()
  expect(loadClaim(s, 'evm', 'viewer')?.status).toBe('unknown')
})

it('does not repeat an included step while a stale position reader still returns it', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  let stale = true
  const execute = vi.fn(async () => 'included')
  const ports = {
    next: async () => (stale ? step : null),
    execute,
    receipt: async () => true,
  }
  await expect(c.run('vault', ports)).rejects.toThrow('not reflected')
  await c.recover(ports)
  expect(c.operation?.status).toBe('unknown')
  await expect(c.run('vault', ports)).rejects.toThrow('pending')
  stale = false
  await c.recover(ports)
  expect(c.operation?.status).toBe('confirmed')
  expect(execute).toHaveBeenCalledTimes(1)
})
it('persists bigint writer arguments so a reload can recover the actual receipt', async () => {
  const s = storage(),
    c = new ClaimSession(s, 'evm', 'viewer', () => {})
  await expect(
    c.run('vault', {
      next: async () => ({ ...step, args: { tokenId: 1n } }),
      execute: async () => {
        c.submitted('included')
        throw Error('lost')
      },
      receipt: async () => true,
    }),
  ).rejects.toThrow('lost')
  expect(loadClaim(s, 'evm', 'viewer')?.step?.args).toEqual({ tokenId: '1' })
  const reloaded = new ClaimSession(s, 'evm', 'viewer', () => {})
  await reloaded.recover({
    next: async () => null,
    execute: vi.fn(),
    receipt: async () => true,
  })
  expect(reloaded.operation?.status).toBe('confirmed')
})

it('reconciles an unknown hash only when actual position state proves the prior step completed', async () => {
  const c = new ClaimSession(storage(), 'evm', 'viewer', () => {})
  let completed = false
  const ports = {
    next: async () => (completed ? step : { ...step, id: 'stop:1', action: 'stopFunding' }),
    execute: vi.fn(async () => {
      throw Error('lost before hash')
    }),
    receipt: vi.fn(async () => true),
  }
  await expect(c.run('vault', ports)).rejects.toThrow()
  await c.recover(ports)
  expect(c.operation?.status).toBe('unknown')
  completed = true
  await c.recover(ports)
  expect(c.operation?.status).toBe('continue')
  expect(ports.execute).toHaveBeenCalledTimes(1)
  expect(ports.receipt).not.toHaveBeenCalled()
})
