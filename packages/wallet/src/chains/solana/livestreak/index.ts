// The shared livestreak program layer: PDA derivation + typed instruction builders +
// account decoders that every Solana handler leg (options/observe/bookmaker/steward)
// consumes. @livestreak/wallet is the single @solana/* owner, so consumers import these
// (plus the re-exported kit primitives below) instead of any @solana/* package directly.

export * from './ids.js'
export * from './pdas.js'
export * from './instructions.js'
export * from './accounts.js'
export * from './spl.js'
export { buildLivestreakTransaction } from './transaction.js'

// Kit primitives consumers need to address ids, type instructions, and send. ProtocolState
// decoding is NOT re-exported — decode it via @livestreak/contracts/solana's EngineView.
export { address } from '@solana/kit'
export type { Address, Instruction } from '@solana/kit'
