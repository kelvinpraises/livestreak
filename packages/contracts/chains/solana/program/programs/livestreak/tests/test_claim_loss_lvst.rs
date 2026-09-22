//! Loss-mint over litesvm with a REAL SPL LVST mint: register market -> init protocol
//! -> creator seeds YES -> bettor mints a position + funds NO -> steward resolves YES
//! (the bettor LOSES) -> the bettor mints LVST against its frozen loss basis. Asserts
//! the minted amount equals the engine's own expectation, that a SECOND claim is
//! refused (double-claim guard), and that a WINNING-side claim is refused (zero basis).

mod common;

use {
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    anchor_lang::solana_program::instruction::Instruction,
    common::{Harness, SIDE_NO, SIDE_YES, USD},
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint},
    ruint::aliases::U256,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const LVST_AUTHORITY_SEED: &[u8] = b"lvst_authority";
const USDC_ONE: u128 = 1_000_000;
const SALT: u64 = 7;

#[test]
fn loser_mints_lvst_and_guards_hold() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the default steward
    let bettor = Keypair::new();
    h.svm.airdrop(&bettor.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let bettor_ata = h.ata(&bettor, 1_000 * USD);

    // ── Protocol-wide LVST mint: authority = lvst_authority PDA, 9 decimals (Sui parity).
    let lvst_authority = h.pda(&[LVST_AUTHORITY_SEED]);
    let payer = h.payer.insecure_clone();
    let lvst_mint = CreateMint::new(&mut h.svm, &payer)
        .authority(&lvst_authority)
        .decimals(9)
        .send()
        .expect("create LVST mint");
    // The bettor's LVST ATA must already exist (require-exists convention).
    let bettor_lvst = CreateAssociatedTokenAccount::new(&mut h.svm, &payer, &lvst_mint)
        .owner(&bettor.pubkey())
        .send()
        .expect("create bettor LVST ATA");

    // ── registry + market ─────────────────────────────────────────────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Initialize {
            default_steward: creator.pubkey(),
            lvst_mint,
        }
        .data(),
        livestreak::accounts::Initialize {
            payer: creator.pubkey(),
            registry,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let market_id = livestreak::instructions::register_market::compute_market_id(
        &creator.pubkey(),
        b"stream-loss",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Loss".to_vec(),
            stream_id: b"stream-loss".to_vec(),
        }
        .data(),
        livestreak::accounts::RegisterMarket {
            creator: creator.pubkey(),
            registry,
            market,
            market_index: h.pda(&[b"market_idx", &0u64.to_le_bytes()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    // ── init_protocol + escrow ────────────────────────────────────────────────
    let protocol_state = h.pda(&[b"protocol", &market_id]);
    let escrow = h.pda(&[b"escrow", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::InitProtocol { capacity: 9_000 }.data(),
        livestreak::accounts::InitProtocol {
            payer: creator.pubkey(),
            market,
            protocol_state,
            usdc_mint: h.usdc,
            escrow,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    // ── creator seeds YES at $5/s with $500 ───────────────────────────────────
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::CreateVaultSeeded {
            question: b"goal scored?".to_vec(),
            seed_side: SIDE_YES,
            rate: 5 * USD,
            deposit: 500 * USD,
        }
        .data(),
        livestreak::accounts::UserEngineOp {
            user: creator.pubkey(),
            protocol_state,
            escrow,
            user_usdc: creator_ata,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let p = h.protocol(&market_id);
    let vault_id = *p.vault.vaults.keys().next().unwrap();

    // ── bettor mints a position + funds NO at $7/s with $700 (the losing side) ─
    let token_u256 = p.calc_token_id_with_salt(&bettor.pubkey().to_bytes(), SALT);
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(token_u256);
    let position = h.pda(&[b"position", &token_id_bytes]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::MintPosition { salt: SALT }.data(),
        livestreak::accounts::MintPosition {
            payer: bettor.pubkey(),
            minter: bettor.pubkey(),
            protocol_state,
            market,
            position,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();

    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Fund {
            vault_id,
            side: SIDE_NO,
            rate: 7 * USD,
            deposit: 700 * USD,
        }
        .data(),
        livestreak::accounts::PositionEngineOp {
            user: bettor.pubkey(),
            protocol_state,
            position,
            escrow,
            user_usdc: bettor_ata,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();

    // ── 60s live, steward resolves YES → the bettor's NO side loses ────────────
    h.warp(60);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Resolve { vault_id, winning_side: SIDE_YES }.data(),
        livestreak::accounts::Resolve {
            steward: creator.pubkey(),
            protocol_state,
            registry,
            market_steward: None,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    // Warp past the drips cycle boundary — the loss basis froze at resolve, so this must
    // not change the mintable amount (LVST minting is orthogonal to USDC settlement).
    h.warp(120);

    // The engine's own expectation, read BEFORE the claim mutates loss_claimed.
    let p = h.protocol(&market_id);
    let lost = p.vault.loss_claimable(token_u256, &vault_id, SIDE_NO);
    assert!(lost > U256::ZERO, "the losing NO side must have a non-zero loss basis");
    let expected =
        livestreak_math::wide::narrow(lost * p.treasury.mint_rate() / U256::from(USDC_ONE), "expected")
            as u64;
    assert!(expected > 0, "a non-zero basis must mint a non-zero LVST amount");

    // ── the losing bettor mints LVST ──────────────────────────────────────────
    let program_id = h.program_id;
    let claim_ix = |side: u8| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::ClaimLossLvst { vault_id, side }.data(),
            livestreak::accounts::ClaimLossLvst {
                claimer: bettor.pubkey(),
                protocol_state,
                position,
                lvst_authority,
                lvst_mint,
                claimer_lvst: bettor_lvst,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };

    assert_eq!(h.token_balance(&bettor_lvst), 0);
    h.send(claim_ix(SIDE_NO), &[&h.payer.insecure_clone(), &bettor]).unwrap();
    assert_eq!(
        h.token_balance(&bettor_lvst),
        expected,
        "minted LVST must equal the engine's loss-basis * mint_rate expectation",
    );

    // ── double-claim guard: a SECOND NO claim is refused (AlreadyClaimed) ──────
    assert!(
        h.send(claim_ix(SIDE_NO), &[&h.payer.insecure_clone(), &bettor]).is_err(),
        "a second claim on the same (position, vault, side) must fail",
    );
    assert_eq!(h.token_balance(&bettor_lvst), expected, "the refused re-claim must mint nothing");

    // ── winning-side claim is refused (zero loss basis → NothingLost) ──────────
    assert!(
        h.send(claim_ix(SIDE_YES), &[&h.payer.insecure_clone(), &bettor]).is_err(),
        "a claim on the winning side has zero loss basis and must fail",
    );
    assert_eq!(h.token_balance(&bettor_lvst), expected, "the refused winning-side claim must mint nothing");
}
