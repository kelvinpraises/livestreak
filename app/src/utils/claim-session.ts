export interface ClaimStep {
  id: string
  action: string
  args: unknown
}
export interface ClaimOperation {
  owner: string
  chain: string
  vaultId: string
  status: 'working' | 'unknown' | 'continue' | 'confirmed' | 'failed'
  step?: ClaimStep
  txId?: string
  transactionAction?: string
  message?: string
  receipts: string[]
}
export interface ClaimPorts {
  next(): Promise<ClaimStep | null>
  execute(step: ClaimStep): Promise<string>
  receipt(hash: string): Promise<boolean | undefined>
}
const key = (chain: string, owner: string) => `livestreak.claim.v1:${chain}:${owner}`
export const loadClaim = (
  storage: Storage,
  chain: string,
  owner: string,
): ClaimOperation | null => {
  const text = storage.getItem(key(chain, owner))
  if (!text) return null
  const op = JSON.parse(text) as ClaimOperation
  if (
    op.owner !== owner ||
    op.chain !== chain ||
    typeof op.vaultId !== 'string' ||
    !op.vaultId ||
    !['working', 'unknown', 'continue', 'confirmed', 'failed'].includes(op.status) ||
    !Array.isArray(op.receipts) ||
    op.receipts.some((h) => typeof h !== 'string' || !h) ||
    (op.txId !== undefined && (typeof op.txId !== 'string' || !op.txId)) ||
    (op.step !== undefined &&
      (typeof op.step.id !== 'string' || typeof op.step.action !== 'string'))
  )
    throw new Error('Claim recovery record is unreadable. Keep this wallet for recovery.')
  return op.status === 'working' ? { ...op, status: 'unknown' } : op
}
export class ClaimSession {
  operation: ClaimOperation | null
  private running = false
  constructor(
    private storage: Storage,
    private chain: string,
    private owner: string,
    private changed: (op: ClaimOperation) => void,
  ) {
    this.operation = loadClaim(storage, chain, owner)
  }
  private save(op: ClaimOperation) {
    this.storage.setItem(
      key(this.chain, this.owner),
      JSON.stringify(op, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    )
    this.operation = op
    this.changed(op)
  }
  submitting(action?: string) {
    if (this.running && this.operation)
      this.save({
        ...this.operation,
        txId: undefined,
        transactionAction: action,
        status: 'unknown',
      })
  }
  submitted(txId: string, action?: string) {
    if (this.running && this.operation)
      this.save({ ...this.operation, txId, transactionAction: action })
  }
  async run(vaultId: string, ports: ClaimPorts): Promise<string> {
    if (this.running) throw new Error('A cash-out is already running.')
    const old = loadClaim(this.storage, this.chain, this.owner)
    if (old && !['confirmed', 'failed', 'continue'].includes(old.status))
      throw new Error('Check the pending cash-out before trying again.')
    if (old?.status === 'continue' && old.vaultId !== vaultId)
      throw new Error('Finish the current question’s cash-out first.')
    this.running = true
    try {
      let op: ClaimOperation =
        old?.status === 'continue'
          ? { ...old, status: 'working' }
          : {
              owner: this.owner,
              chain: this.chain,
              vaultId,
              status: 'working',
              receipts: [],
            }
      this.save(op)
      let count = 0
      for (;;) {
        const step = await ports.next()
        if (!step) {
          if (op.receipts.length === 0)
            throw new Error('Nothing is currently claimable for this question.')
          this.save({ ...op, status: 'confirmed', step: undefined, message: undefined })
          return op.receipts.at(-1)!
        }
        if (op.txId && op.step?.id === step.id) {
          this.save({ ...op, status: 'unknown' })
          throw new Error(
            'The confirmed cash-out is not reflected in the position yet. Check confirmation; nothing was submitted again.',
          )
        }
        if (++count > 6)
          throw new Error(
            'Cash-out state did not advance. Check confirmation before continuing.',
          )
        op = {
          ...op,
          step,
          txId: undefined,
          transactionAction: undefined,
          status: 'working',
        }
        this.save(op)
        // Mark uncertainty before calling a writer; its per-transaction callback clears stale setup hashes.
        this.save({ ...op, status: 'unknown' })
        const txId = await ports.execute(step)
        op = {
          ...this.operation!,
          status: 'working',
          txId,
          receipts: [...op.receipts, txId],
        }
        this.save(op)
      }
    } catch (error) {
      const op = this.operation
      if (op && !['confirmed', 'failed'].includes(op.status))
        this.save({
          ...op,
          status: op.status === 'working' ? 'continue' : 'unknown',
          message: error instanceof Error ? error.message : 'Cash-out needs confirmation.',
        })
      throw error
    } finally {
      this.running = false
    }
  }
  async recover(ports: ClaimPorts): Promise<void> {
    if (this.running) return
    const op = loadClaim(this.storage, this.chain, this.owner)
    if (!op || ['confirmed', 'failed', 'continue'].includes(op.status)) return
    this.running = true
    try {
      if (!op.txId) {
        const next = await ports.next()
        if (op.step && next?.id !== op.step.id) {
          this.save({
            ...op,
            status: next ? 'continue' : 'confirmed',
            message: next
              ? 'The position confirms the earlier step is complete. Continue the remaining entitlement; no transaction was resubmitted.'
              : 'The position confirms no entitlement remains. The interrupted transaction identity is unavailable.',
          })
          return
        }
        this.save({
          ...op,
          status: 'unknown',
          message:
            'Submission status is unknown. Locate the transaction before another cash-out.',
        })
        return
      }
      const success = await ports.receipt(op.txId)
      if (success === undefined) {
        this.save({
          ...op,
          status: 'unknown',
          message: 'Still waiting for chain confirmation; nothing was submitted again.',
        })
        return
      }
      if (!success) {
        this.save({
          ...op,
          status: 'failed',
          message: 'The transaction failed on-chain. Retry the remaining entitlement.',
        })
        return
      }
      const next = await ports.next()
      const unchanged = next?.id === op.step?.id
      this.save({
        ...op,
        receipts: [...new Set([...op.receipts, op.txId])],
        status: unchanged ? 'unknown' : next ? 'continue' : 'confirmed',
        message: unchanged
          ? 'The receipt is confirmed; waiting for the position to reflect it. Nothing was submitted again.'
          : next
            ? 'Confirmed. Continue the remaining cash-out steps.'
            : undefined,
      })
    } finally {
      this.running = false
    }
  }
}
