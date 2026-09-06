import type { WalletChain } from "@livestreak/wallet";
import type { StewardSubject } from "../../model/subject.js";
import type { ContractFactSource } from "../sources.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import { buildStewardFact } from "./fact.js";

// --- Contract fact source (WAVE 5 BUILD) ---
//
// Reads on-chain vault/market state into `source:"contract"` facts. The reads use the `@livestreak/contracts`
// ABIs/addresses and go through `@livestreak/wallet` for ANY Sui touch (wallet is the sole SDK owner —
// we never pin `@mysten/sui`). The host/executor injects a per-chain `ContractVaultReader`; this adapter
// only translates the reader's domain values into canonical facts.
//
// MULTICHAIN: the reader carries its `chain` (EVM/Sui) and resolves addresses per chain — the fact `key`
// is chain-agnostic SHAPE, the VALUES are resolved per chain by the reader.

export interface ContractVaultFact {
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly observedAtMs?: number;
}

export interface ContractVaultReader {
  readonly chain: WalletChain;
  readonly readVaultFacts: (subject: StewardSubject) => Promise<readonly ContractVaultFact[]>;
}

export const createContractFactSource = (reader: ContractVaultReader): ContractFactSource => ({
  readFacts: async (subject: StewardSubject): Promise<readonly StewardFact[]> => {
    const facts = await reader.readVaultFacts(subject);
    return facts.map((fact) =>
      buildStewardFact("contract", {
        subject,
        key: fact.key,
        value: fact.value,
        ...(fact.evidenceRefs === undefined ? {} : { evidenceRefs: fact.evidenceRefs }),
        ...(fact.observedAtMs === undefined ? {} : { observedAtMs: fact.observedAtMs })
      })
    );
  }
});
