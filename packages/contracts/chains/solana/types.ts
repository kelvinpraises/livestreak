export type SolanaDeploymentName = "localnet" | "devnet" | "mainnet";

/** Committed deploy snapshot — the Solana analog of EvmDeployOutput / SuiDeployment. */
export interface SolanaDeployment {
  chain: SolanaDeploymentName;
  rpc: string;
  deployedAt: string;
  /** Deployer/upgrade-authority pubkey (base58). */
  deployer: string;
  /** The livestreak program id (base58). */
  programId: string;
  accounts: {
    /** Mock/mainnet USDC SPL mint (base58). */
    usdcMint: string;
    /** LVST reward-token SPL mint (base58) — mint authority is the lvst_authority PDA. */
    lvstMint: string;
    /** Registry PDA (base58) — derived, recorded for convenience. */
    registry: string;
    /** The default steward pubkey the registry was initialized with. */
    defaultSteward: string;
  };
}
