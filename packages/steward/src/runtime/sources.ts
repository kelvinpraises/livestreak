import type { StewardSubject } from "../model/subject.js";

// --- exports ---

export interface ContractFactSource {
  readonly readFacts: (subject: StewardSubject) => Promise<readonly unknown[]>;
}

export interface HostFactSource {
  readonly readFacts: (subject: StewardSubject) => Promise<readonly unknown[]>;
}

export interface ObserveFactSource {
  readonly readFacts: (subject: StewardSubject) => Promise<readonly unknown[]>;
}

export interface MemoryFactSource {
  readonly readFacts: (subject: StewardSubject) => Promise<readonly unknown[]>;
}

export interface StewardFactSources {
  readonly contract: ContractFactSource;
  readonly host: HostFactSource;
  readonly observe: ObserveFactSource;
  readonly memory: MemoryFactSource;
}
