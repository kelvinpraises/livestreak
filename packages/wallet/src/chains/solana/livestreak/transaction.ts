// Compose built instructions into a transaction message that WalletAccountSolana(.Gasless)
// .sendTransaction consumes directly: the account detects `.instructions`, fills in the
// recent-blockhash lifetime, and sets the fee-payer signer. Pass feePayer to pin it (the
// account asserts it matches the wallet); omit it to let the account attach its own.
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getU32Encoder,
  pipe,
  setTransactionMessageFeePayer,
  address,
  type Address,
  type Instruction,
} from '@solana/kit'

const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111')

// Engine ops decode the whole per-market Protocol blob into heap maps and replay streamed cycles
// since their last update, so their cost GROWS with state size and wall-clock idle time — the
// default 200k CU / 32KB heap pass fresh-state ops and then fail the same op minutes later
// ("memory allocation failed, out of memory"). Request the ceilings like the litesvm harness does
// (headroom is priced by use, not by request).
const COMPUTE_UNIT_LIMIT = 1_400_000
const HEAP_FRAME_BYTES = 262_144

const setComputeUnitLimitIx = (): Instruction => ({
  programAddress: COMPUTE_BUDGET_PROGRAM,
  accounts: [] as never[],
  // SetComputeUnitLimit = variant 2, u32-LE units.
  data: new Uint8Array([2, ...new Uint8Array(getU32Encoder().encode(COMPUTE_UNIT_LIMIT))]),
})

const requestHeapFrameIx = (): Instruction => ({
  programAddress: COMPUTE_BUDGET_PROGRAM,
  accounts: [] as never[],
  // RequestHeapFrame = variant 1, u32-LE bytes (multiple of 1024, max 256KB).
  data: new Uint8Array([1, ...new Uint8Array(getU32Encoder().encode(HEAP_FRAME_BYTES))]),
})

export function buildLivestreakTransaction(instructions: Instruction[], feePayer?: Address) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => (feePayer ? setTransactionMessageFeePayer(feePayer, tx) : tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [setComputeUnitLimitIx(), requestHeapFrameIx(), ...instructions],
        tx,
      ),
  )
}
