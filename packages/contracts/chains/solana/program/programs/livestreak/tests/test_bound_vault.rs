//! Actual SBF program: immutable rules, atomic idempotency, cutoff delivery and SPL refunds.
mod common;
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    InstructionData, ToAccountMetas,
};
use common::Harness;
use ruint::aliases::U256;
use solana_keypair::Keypair;
use solana_signer::Signer;
const USD: u64 = 1_000_000;
const SIDE_YES: u8 = 0;
const SIDE_NO: u8 = 1;
#[test]
fn bound_creation_cutoff_and_recovery_use_real_sbf_and_tokens() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also default steward
    let bettor = Keypair::new();
    h.svm.airdrop(&bettor.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let bettor_ata = h.ata(&bettor, 1_000 * USD);

    // ── Phase-1 registry + market ─────────────────────────────────────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Initialize {
            default_steward: creator.pubkey(),
            lvst_mint: Pubkey::default(),
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
        b"stream-keynote",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Keynote".to_vec(),
            stream_id: b"stream-keynote".to_vec(),
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

    // ── Bookmaker seeds NO at $5/s with $500 ──────────────────────────────────
    let seed_deposit = 500 * USD;
    let user_op = |user: Pubkey, user_usdc: Pubkey| livestreak::accounts::UserEngineOp {
        user,
        protocol_state,
        escrow,
        user_usdc,
        token_program: anchor_spl::token::ID,
    };
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::CreateVaultSeeded {
            question: b"goal scored?".to_vec(),
            seed_side: SIDE_NO,
            rate: 5 * USD,
            deposit: seed_deposit,
            commitment: [1; 32],
            funding_close: 1_752_700_020,
            operation_id: solana_keccak_hasher::hash(&(b"goal scored?".to_vec())).to_bytes(),
        }
        .data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    let creation_ix = ix.clone();
    h.send(ix, &[&creator]).unwrap();
    assert_eq!(h.token_balance(&escrow), seed_deposit);

    let p = h.protocol(&market_id);
    let vault_id = *p.vault.vaults.keys().next().unwrap();

    // ── Bettor mints a position + funds YES at $7/s with $700 ─────────────────
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(
        p.calc_token_id_with_salt(&bettor.pubkey().to_bytes(), 42),
    );
    let position = h.pda(&[b"position", &token_id_bytes]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::MintPosition { salt: 42 }.data(),
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

    let bet_deposit = 700 * USD;
    let position_op = |user: Pubkey, user_usdc: Pubkey| livestreak::accounts::PositionEngineOp {
        user,
        protocol_state,
        position,
        escrow,
        user_usdc,
        token_program: anchor_spl::token::ID,
    };
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Fund {
            vault_id,
            side: SIDE_YES,
            rate: 7 * USD,
            deposit: bet_deposit,
        }
        .data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    assert_eq!(h.token_balance(&escrow), seed_deposit + bet_deposit);

    h.warp(40);
    let before = h.protocol(&market_id).to_bytes();
    let escrow_before = h.token_balance(&escrow);
    h.send(creation_ix, &[&creator]).unwrap();
    assert_eq!(h.protocol(&market_id).to_bytes(), before);
    assert_eq!(h.token_balance(&escrow), escrow_before);
    let conflict = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::CreateVaultSeeded {
            question: b"goal scored?".to_vec(),
            seed_side: SIDE_NO,
            rate: 5 * USD,
            deposit: seed_deposit + 1,
            commitment: [1; 32],
            funding_close: 1_752_700_020,
            operation_id: solana_keccak_hasher::hash(b"goal scored?").to_bytes(),
        }
        .data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    assert!(h
        .send(conflict, &[&creator])
        .unwrap_err()
        .contains("CreationConflict"));
    assert_eq!(h.protocol(&market_id).to_bytes(), before);
    let topup = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::SetLanes {
            lanes: vec![livestreak::instructions::protocol::LaneArg {
                vault_id,
                side: SIDE_YES,
                rate: 7 * USD,
            }],
            add_deposit: 1,
        }
        .data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    assert!(h
        .send(topup, &[&h.payer.insecure_clone(), &bettor])
        .unwrap_err()
        .contains("FundingClosed"));
    assert_eq!(h.token_balance(&escrow), escrow_before);
    let stop_seed = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(stop_seed, &[&creator]).unwrap();
    let stop_all = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopAll {}.data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(stop_all, &[&h.payer.insecure_clone(), &bettor])
        .unwrap();
    let p = h.protocol(&market_id);
    assert_eq!(
        p.vault.get_board(&vault_id, SIDE_NO).0,
        U256::from(100 * USD)
    );
    assert_eq!(
        p.vault.get_board(&vault_id, SIDE_YES).0,
        U256::from(140 * USD)
    );
    assert_eq!(h.token_balance(&creator_ata), 900 * USD);
    assert_eq!(h.token_balance(&bettor_ata), 860 * USD);
    assert_eq!(h.token_balance(&escrow), 240 * USD);
    assert_eq!(p.vault.vaults.len(), 1);
    let token = U256::from_be_bytes(token_id_bytes);
    assert_eq!(p.vault.get_account_vault_ids(token), vec![vault_id]);
}
