/** A pending write is durable intent, not permission to submit it again. No signing material is stored. */
export type FundingPhase = 'mint' | 'fund' | 'verify'
export type FundingStatus = 'working' | 'unknown' | 'continue' | 'confirmed' | 'failed'
export interface FundingIntent {
  vaultId: string
  marketId: string
  side: 'yes' | 'no'
  rate: number
}
export interface FundingOperation extends FundingIntent {
  id: string
  owner: string
  chain: string
  phase: FundingPhase
  status: FundingStatus
  txId?: string
  receiptStep?: 'mint' | 'fund' | 'approve'
  message?: string
}
export interface FundingPorts {
  preflight: (intent: FundingIntent) => Promise<void>
  hasPosition: () => Promise<boolean>
  mint: () => Promise<void>
  fund: () => Promise<string>
  verify: (intent: FundingIntent) => Promise<boolean>
  receipt: (txId: string) => Promise<boolean | undefined>
}
const key = (chain: string, owner: string) => `livestreak.funding.v1:${chain}:${owner}`
export function loadFunding(
  storage: Storage,
  chain: string,
  owner: string,
): FundingOperation | null {
  const text = storage.getItem(key(chain, owner))
  if (!text) return null
  const v = JSON.parse(text) as FundingOperation
  if (
    v.owner !== owner ||
    v.chain !== chain ||
    typeof v.id !== 'string' ||
    !v.id ||
    (v.txId !== undefined && (typeof v.txId !== 'string' || !v.txId)) ||
    (v.receiptStep !== undefined && !['mint', 'fund', 'approve'].includes(v.receiptStep)) ||
    typeof v.vaultId !== 'string' ||
    typeof v.marketId !== 'string' ||
    !['yes', 'no'].includes(v.side) ||
    !Number.isFinite(v.rate) ||
    v.rate <= 0 ||
    !['mint', 'fund', 'verify'].includes(v.phase) ||
    !['working', 'unknown', 'continue', 'confirmed', 'failed'].includes(v.status)
  ) {
    throw new Error(
      'Pending funding record could not be read. Keep this wallet connected for recovery.',
    )
  }
  // A reload cannot know whether a working submission completed.
  return v.status === 'working' ? { ...v, status: 'unknown' } : v
}
export class FundingSession {
  operation: FundingOperation | null
  private running = false
  constructor(
    private storage: Storage,
    private chain: string,
    private owner: string,
    private changed: (op: FundingOperation) => void,
  ) {
    this.operation = loadFunding(storage, chain, owner)
  }
  private save(op: FundingOperation) {
    this.operation = op
    this.storage.setItem(key(this.chain, this.owner), JSON.stringify(op))
    this.changed(op)
  }
  submitting() {
    if (this.running && this.operation)
      this.save({ ...this.operation, txId: undefined, receiptStep: undefined })
  }
  submitted(txId: string, action?: string) {
    const op = this.operation
    if (!this.running || !op) return
    this.save({
      ...op,
      txId,
      receiptStep: ['approve', 'setApprovalForAll', 'approveNft'].includes(action ?? '')
        ? 'approve'
        : op.phase === 'mint'
          ? 'mint'
          : 'fund',
    })
  }
  async run(intent: FundingIntent, ports: FundingPorts): Promise<string> {
    if (this.running)
      throw new Error('This wallet already has a funding action in progress.')
    const prior = loadFunding(this.storage, this.chain, this.owner)
    if (prior && !['confirmed', 'failed', 'continue'].includes(prior.status)) {
      this.operation = prior
      this.changed(prior)
      throw new Error('Check the pending transaction before funding again.')
    }
    if (
      prior?.status === 'continue' &&
      JSON.stringify(intent) !==
        JSON.stringify({
          vaultId: prior.vaultId,
          marketId: prior.marketId,
          side: prior.side,
          rate: prior.rate,
        })
    ) {
      throw new Error('Finish the pending funding intent before changing its side or rate.')
    }
    this.running = true
    let sending = false
    try {
      // Fail before any position/approval write on missing rules, wrong chain, or insufficient balance.
      await ports.preflight(intent)
      const hasPosition = await ports.hasPosition()
      const op: FundingOperation = {
        ...intent,
        id: prior?.status === 'continue' ? prior.id : crypto.randomUUID(),
        chain: this.chain,
        owner: this.owner,
        phase: hasPosition ? 'fund' : 'mint',
        status: 'working',
      }
      this.save(op) // Storage failure is fatal BEFORE signing.
      if (!hasPosition) {
        sending = true
        await ports.mint()
        if (!(await ports.hasPosition()))
          throw new Error(
            'Position creation is confirmed; waiting for the position to load.',
          )
      }
      this.save({
        ...this.operation!,
        phase: 'fund',
        status: 'working',
        txId: undefined,
        receiptStep: undefined,
      })
      sending = false
      await ports.preflight(intent) // Recheck cutoff/balance after position setup, before funds move.
      sending = true
      const txId = await ports.fund()
      this.save({ ...this.operation!, phase: 'verify', txId, receiptStep: 'fund' })
      if (!(await ports.verify(intent)))
        throw new Error('Transaction confirmed; waiting for your on-chain position.')
      this.save({ ...this.operation!, status: 'confirmed', message: undefined })
      return txId
    } catch (error) {
      if (this.operation?.status === 'working') {
        this.save({
          ...this.operation,
          status: sending ? 'unknown' : 'failed',
          message:
            error instanceof Error ? error.message : 'Funding could not be completed.',
        })
      }
      throw error
    } finally {
      this.running = false
    }
  }
  async recover(ports: FundingPorts): Promise<void> {
    if (this.running) return
    const op = loadFunding(this.storage, this.chain, this.owner)
    if (!op || ['confirmed', 'failed'].includes(op.status)) return
    this.running = true
    try {
      if (!op.txId) {
        // No trustworthy submission identity: never blind-resubmit, including an interrupted mint.
        this.save({
          ...op,
          status: 'unknown',
          message:
            'Submission status is unknown. Do not fund again until the transaction is located.',
        })
        return
      }
      const success = await ports.receipt(op.txId)
      if (success === undefined) {
        this.save({
          ...op,
          status: 'unknown',
          message:
            'Still waiting for confirmation. Your funding has not been submitted again.',
        })
        return
      }
      if (!success) {
        this.save({
          ...op,
          status: 'failed',
          message: 'The transaction failed on-chain. You can safely retry.',
        })
        return
      }
      if (op.receiptStep === 'fund') {
        const verified = await ports.verify(op)
        this.save({
          ...op,
          status: verified ? 'confirmed' : 'unknown',
          phase: 'verify',
          message: verified ? undefined : 'Confirmed on-chain; refreshing your position.',
        })
      } else {
        if (op.receiptStep === 'mint' && !(await ports.hasPosition())) {
          this.save({
            ...op,
            status: 'unknown',
            message: 'Position creation confirmed; waiting for the position to load.',
          })
          return
        }
        this.save({
          ...op,
          status: 'continue',
          phase: 'fund',
          message: 'Wallet setup confirmed. Continue to fund your chosen side.',
        })
      }
    } finally {
      this.running = false
    }
  }
}
