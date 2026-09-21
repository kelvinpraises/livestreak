//! Position-NFT ownership transfer over litesvm (ERC-721 parity). Register market ->
//! init protocol -> creator seeds YES -> user A mints a position + funds NO. Then A
//! transfers the position to B and we assert the whole owner-gate surface moved with it:
//!  (a) B can now drive a position-gated op (stop_all) and the refund lands in B's OWN USDC,
//!  (b) A can no longer act (typed owner-gate failure),
//!  (c) a transfer signed by a non-owner is refused typed,
//!  (d) a transfer to the zero pubkey is refused typed.
//! Ownership lives SOLELY in the PositionOwner PDA — the engine ledger never records it —
//! so the transfer is a pure account-level owner reassignment (no engine call, no tokens).

mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    common::{Harness, SIDE_NO, SIDE_YES, USD},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const SALT: u64 = 11;

#[test]
fn transfer_moves_the_owner_gate() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the default steward
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    h.svm.airdrop(&user_a.pubkey(), 10_000_000_000).unwrap();
    h.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let a_ata = h.ata(&user_a, 1_000 * USD);
    let b_ata = h.ata(&user_b, 0); // B funds nothing; it only receives the refund.

    // ── registry + market ──────────────────────────────────────────────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Initialize {
            default_steward: creator.pubkey(),
            lvst_mint: Pubkey::new_unique(), // unused by this flow; just recorded.
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
        b"stream-xfer",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Xfer".to_vec(),
            stream_id: b"stream-xfer".to_vec(),
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

    // ── init_protocol + escrow ─────────────────────────────────────────────────
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

    // ── creator seeds YES at $5/s with $500 ────────────────────────────────────
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

    // ── user A mints a position + funds NO at $7/s with $700 ───────────────────
    let token_u256 = p.calc_token_id_with_salt(&user_a.pubkey().to_bytes(), SALT);
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(token_u256);
    let position = h.pda(&[b"position", &token_id_bytes]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::MintPosition { salt: SALT }.data(),
        livestreak::accounts::MintPosition {
            minter: user_a.pubkey(),
            protocol_state,
            market,
            position,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &user_a]).unwrap();

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
            user: user_a.pubkey(),
            protocol_state,
            position,
            escrow,
            user_usdc: a_ata,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &user_a]).unwrap();

    // ── the transfer instruction, parameterized by (signer, new_owner) ─────────
    let program_id = h.program_id;
    let transfer_ix = |signer: Pubkey, new_owner: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::TransferPosition { new_owner }.data(),
            livestreak::accounts::TransferPosition { owner: signer, position }
                .to_account_metas(None),
        )
    };

    // (c) a NON-OWNER cannot transfer — the owner gate is checked at account validation.
    let err = h
        .send(transfer_ix(user_b.pubkey(), user_b.pubkey()), &[&h.payer.insecure_clone(), &user_b])
        .expect_err("a non-owner transfer must fail");
    assert!(err.contains("NotCreator"), "non-owner transfer must be typed NotCreator, got: {err}");

    // (d) the true owner cannot transfer to the zero pubkey.
    let err = h
        .send(transfer_ix(user_a.pubkey(), Pubkey::default()), &[&h.payer.insecure_clone(), &user_a])
        .expect_err("a zero-owner transfer must fail");
    assert!(err.contains("ZeroNewOwner"), "zero-owner transfer must be typed ZeroNewOwner, got: {err}");

    // ── A transfers the position to B ──────────────────────────────────────────
    h.send(transfer_ix(user_a.pubkey(), user_b.pubkey()), &[&h.payer.insecure_clone(), &user_a])
        .expect("owner A must be able to transfer to B");

    // ── stop_all, parameterized by (signer, their own usdc ata) ────────────────
    let stop_ix = |signer: Pubkey, usdc: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::StopAll {}.data(),
            livestreak::accounts::PositionEngineOp {
                user: signer,
                protocol_state,
                position,
                escrow,
                user_usdc: usdc,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };

    // (b) A can no longer act — the owner gate now rejects the former owner.
    let err = h
        .send(stop_ix(user_a.pubkey(), a_ata), &[&h.payer.insecure_clone(), &user_a])
        .expect_err("the former owner A must no longer be able to act");
    assert!(err.contains("NotCreator"), "former owner op must be typed NotCreator, got: {err}");

    // (a) B can now drive the position-gated op and the refund lands in B's OWN usdc.
    let b_before = h.token_balance(&b_ata);
    h.send(stop_ix(user_b.pubkey(), b_ata), &[&h.payer.insecure_clone(), &user_b])
        .expect("new owner B must be able to stop_all");
    let b_after = h.token_balance(&b_ata);
    assert!(
        b_after > b_before,
        "the stop_all refund must land in B's own usdc (before={b_before}, after={b_after})",
    );
}
