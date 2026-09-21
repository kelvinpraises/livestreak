//! LVST reward-token mint foundation: proves the wiring later chunks (loss-mint /
//! staking dividends) depend on. The LVST mint is protocol-wide (one token across all
//! markets), so its mint authority is the program's lvst_authority PDA — derived from a
//! single seed and the program id, with no market_id in the seeds. Here we assert that
//! derivation is deterministic and that an SPL mint created with that PDA as authority
//! carries exactly the configured authority, 9 decimals (Sui parity), and no freeze
//! authority.

mod common;

use {
    common::Harness,
    litesvm_token::{spl_token::state::Mint, get_spl_account, CreateMint},
};

// Must mirror programs/livestreak/src/constants.rs::LVST_AUTHORITY_SEED and
// chains/solana/deploy/main.ts's PublicKey.findProgramAddressSync([LVST_AUTHORITY_SEED]).
const LVST_AUTHORITY_SEED: &[u8] = b"lvst_authority";

#[test]
fn lvst_authority_pda_is_deterministic() {
    let h = Harness::new();
    let a = h.pda(&[LVST_AUTHORITY_SEED]);
    let b = h.pda(&[LVST_AUTHORITY_SEED]);
    assert_eq!(a, b, "lvst_authority PDA derivation must be deterministic");
}

#[test]
fn lvst_mint_has_pda_authority_and_9_decimals() {
    let mut h = Harness::new();

    // Protocol-wide authority — no market_id in the seeds (one LVST for the whole protocol).
    let authority = h.pda(&[LVST_AUTHORITY_SEED]);

    // Create the LVST SPL mint with the PDA as mint authority, 9 decimals (Sui coin parity;
    // EVM's ERC20 is 18, but SPL caps at 9), and no freeze authority.
    let payer = h.payer.insecure_clone();
    let lvst_mint = CreateMint::new(&mut h.svm, &payer)
        .authority(&authority)
        .decimals(9)
        .send()
        .expect("create LVST mint");

    let mint: Mint = get_spl_account(&h.svm, &lvst_mint).expect("read LVST mint account");

    assert!(mint.mint_authority.is_some(), "LVST mint must have a mint authority");
    assert_eq!(
        mint.mint_authority.unwrap().to_bytes(),
        authority.to_bytes(),
        "LVST mint authority must be the lvst_authority PDA",
    );
    assert_eq!(mint.decimals, 9, "LVST mint must use 9 decimals (Sui parity)");
    assert!(mint.freeze_authority.is_none(), "LVST mint must have no freeze authority");
}
