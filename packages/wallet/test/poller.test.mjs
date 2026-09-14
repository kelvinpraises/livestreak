import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  pollUntilUserOperationIncluded,
  readUserOperationSuccess,
  assertUserOperationSucceeded,
  UserOperationPollTimeoutError,
} from '@livestreak/wallet'

const readerFrom = (sequence) => {
  let i = 0
  return {
    async getUserOperationReceipt() {
      const v = sequence[Math.min(i, sequence.length - 1)]
      i += 1
      return v
    },
  }
}

const fast = { timeoutMs: 5_000, intervalMs: 1, maxIntervalMs: 1 }

describe('pollUntilUserOperationIncluded', () => {
  it('polls past null/undefined and resolves with the included receipt', async () => {
    const receipt = { success: true, transactionHash: '0xabc' }
    const out = await pollUntilUserOperationIncluded(readerFrom([null, undefined, receipt]), '0xh', fast)
    assert.equal(out, receipt)
  })

  it('throws on a reverted receipt', async () => {
    await assert.rejects(
      () => pollUntilUserOperationIncluded(readerFrom([{ success: false }]), '0xh', fast),
      /reverted/,
    )
  })

  it('accepts hex/number/textual success forms', async () => {
    for (const success of ['0x1', 1, 'true', '0x01']) {
      const r = { success }
      assert.equal(await pollUntilUserOperationIncluded(readerFrom([r]), '0xh', fast), r)
    }
  })

  it('throws on zero hex/number success forms', async () => {
    for (const success of ['0x0', 0, 'false']) {
      await assert.rejects(
        () => pollUntilUserOperationIncluded(readerFrom([{ success }]), '0xh', fast),
        /reverted/,
      )
    }
  })

  it('throws when success is missing', async () => {
    await assert.rejects(
      () => pollUntilUserOperationIncluded(readerFrom([{ foo: 1 }]), '0xh', fast),
      /missing success/,
    )
  })

  it('times out when the receipt never arrives', async () => {
    await assert.rejects(
      () => pollUntilUserOperationIncluded(readerFrom([null]), '0xh', { timeoutMs: 30, intervalMs: 5, maxIntervalMs: 5 }),
      /Timed out/,
    )
  })

  // Callers (bookmaker) key their pending-recovery path off the error TYPE, not the message text.
  it('throws a typed UserOperationPollTimeoutError carrying the hash on timeout', async () => {
    await assert.rejects(
      () => pollUntilUserOperationIncluded(readerFrom([null]), '0xhash', { timeoutMs: 30, intervalMs: 5, maxIntervalMs: 5 }),
      (error) => {
        assert.ok(error instanceof UserOperationPollTimeoutError)
        assert.equal(error.userOpHash, '0xhash')
        return true
      },
    )
  })

  // Regression: the first userOp (Safe deploy + mint) used to hang forever because a single stalled
  // getUserOperationReceipt blocked the loop and the overall deadline was never reached. The
  // per-attempt timeout must bound that stall and let a later attempt pick up the now-available receipt.
  it('does not hang when one attempt stalls — bounds it and retries', async () => {
    const receipt = { success: true, transactionHash: '0xabc' }
    let calls = 0
    const reader = {
      async getUserOperationReceipt() {
        calls += 1
        if (calls === 1) return new Promise(() => {}) // never settles — the stalled first attempt
        return receipt
      },
    }
    const out = await pollUntilUserOperationIncluded(reader, '0xh', {
      timeoutMs: 5_000,
      intervalMs: 1,
      maxIntervalMs: 1,
      attemptTimeoutMs: 20,
    })
    assert.equal(out, receipt)
    assert.ok(calls >= 2)
  })

  it('retries a transient fetch error and resolves on a later attempt', async () => {
    const receipt = { success: true }
    let calls = 0
    const reader = {
      async getUserOperationReceipt() {
        calls += 1
        if (calls === 1) throw new Error('socket hang up')
        return receipt
      },
    }
    assert.equal(await pollUntilUserOperationIncluded(reader, '0xh', fast), receipt)
  })

  it('surfaces the last transport error when it never recovers', async () => {
    const reader = {
      async getUserOperationReceipt() {
        throw new Error('bundler down')
      },
    }
    await assert.rejects(
      () => pollUntilUserOperationIncluded(reader, '0xh', { timeoutMs: 30, intervalMs: 5, maxIntervalMs: 5 }),
      /last error: bundler down/,
    )
  })
})

describe('readUserOperationSuccess / assertUserOperationSucceeded', () => {
  it('parses every accepted success form', () => {
    assert.equal(readUserOperationSuccess({ success: true }), true)
    assert.equal(readUserOperationSuccess({ success: false }), false)
    assert.equal(readUserOperationSuccess({ success: 1 }), true)
    assert.equal(readUserOperationSuccess({ success: 0 }), false)
    assert.equal(readUserOperationSuccess({ success: '0x1' }), true)
    assert.equal(readUserOperationSuccess({ success: '0x0' }), false)
    assert.equal(readUserOperationSuccess({ success: 'true' }), true)
    assert.equal(readUserOperationSuccess({}), undefined)
    assert.equal(readUserOperationSuccess(null), undefined)
  })

  it('assert throws on missing/reverted', () => {
    assert.throws(() => assertUserOperationSucceeded({}), /missing success/)
    assert.throws(() => assertUserOperationSucceeded({ success: false }), /reverted/)
    assert.doesNotThrow(() => assertUserOperationSucceeded({ success: true }))
  })
})
