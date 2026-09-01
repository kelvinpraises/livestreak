import type { BookmakerContractsSurface, BookmakerWriteIntent, BookmakerWritePlan } from "../model/write-plan.js";

// --- exports ---

export type BookmakerExecutableWriteIntent = Extract<BookmakerWriteIntent, { readonly action: "createVault" }>;

export type BookmakerIntentOnlyWriteIntent = Extract<
  BookmakerWriteIntent,
  { readonly action: "joinExistingVault" }
>;

export type BookmakerContractMarketIdBytes = `0x${string}`;

export interface BookmakerContractMarketRef {
  readonly marketIdBytes: BookmakerContractMarketIdBytes;
}

export interface BookmakerContractWriteDescriptor {
  readonly kind: "write";
  readonly contract: "VaultFactory";
  readonly functionName: "createVault";
  readonly args: {
    readonly marketIdBytes: BookmakerContractMarketIdBytes;
    readonly question: string;
  };
}

export const contractsWriteSurfaceAvailable = (): boolean => false;

export const hasContractsWriteSurface = (
  contracts: unknown
): contracts is BookmakerContractsSurface =>
  typeof contracts === "object" &&
  contracts !== null &&
  typeof (contracts as BookmakerContractsSurface).vaultAddress === "string" &&
  (contracts as BookmakerContractsSurface).vaultAddress.length > 0;

export const partitionWriteIntents = (plan: BookmakerWritePlan) => ({
  executable: plan.intents.filter(
    (intent): intent is BookmakerExecutableWriteIntent => intent.action === "createVault"
  ),
  intentOnly: plan.intents.filter(
    (intent): intent is BookmakerIntentOnlyWriteIntent => intent.action === "joinExistingVault"
  )
});

export const mapCreateVaultIntentToDescriptor = (
  intent: BookmakerExecutableWriteIntent,
  marketRef: BookmakerContractMarketRef
): BookmakerContractWriteDescriptor => ({
  kind: "write",
  contract: "VaultFactory",
  functionName: "createVault",
  args: {
    marketIdBytes: marketRef.marketIdBytes,
    question: intent.draft.question
  }
});

export const mapExecutableIntentsToDescriptors = (
  plan: BookmakerWritePlan,
  marketRef: BookmakerContractMarketRef
): readonly BookmakerContractWriteDescriptor[] =>
  partitionWriteIntents(plan).executable.map((intent) =>
    mapCreateVaultIntentToDescriptor(intent, marketRef)
  );
