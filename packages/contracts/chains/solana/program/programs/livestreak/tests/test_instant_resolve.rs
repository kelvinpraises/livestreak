//! Regression: the e2e drive's exact shape — creator seeds YES, bettor funds YES (SAME side),
//! steward resolves YES ~1s later. All stake is on the winning side and almost nothing has
//! streamed. collect -> withdraw -> withdraw_seed must pay out cleanly (live localnet run
//! failed withdraw with VaultInsufficientUsdc on this shape; the 60s two-sided loop never hits it).

mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_program, InstructionData, ToAccountMetas},
    anchor_lang::solana_program::instruction::Instruction,
    common::{Harness, SIDE_YES, USD},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn instant_same_side_resolve_pays_out() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also default steward
    let bettor = Keypair::new();
    h.svm.airdrop(&bettor.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let bettor_ata = h.ata(&bettor, 1_000 * USD);

    // Registry + market + protocol (keynote-loop preamble).
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
        b"stream-instant",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Instant".to_vec(),
            stream_id: b"stream-instant".to_vec(),
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

    // Creator seeds YES $5/s with $5 (drive shape: creatorSide yes).
    let seed_deposit = 5 * USD;
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
            question: b"same side?".to_vec(),
            seed_side: SIDE_YES,
            rate: 1_000,
            deposit: seed_deposit,
        }
        .data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let p = h.protocol(&market_id);
    let vault_id = *p.vault.vaults.keys().next().unwrap();

    // Bettor mints + funds YES too — everyone on the winning side.
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(
        p.calc_token_id_with_salt(&bettor.pubkey().to_bytes(), 7),
    );
    let position = h.pda(&[b"position", &token_id_bytes]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::MintPosition { salt: 7 }.data(),
        livestreak::accounts::MintPosition {
            minter: bettor.pubkey(),
            protocol_state,
            market,
            position,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();

    let bet_deposit = USD; // $1 at 1000 units/s — the drive's numbers
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
        &livestreak::instruction::Fund { vault_id, side: SIDE_YES, rate: 1_000, deposit: bet_deposit }
            .data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    assert_eq!(h.token_balance(&escrow), seed_deposit + bet_deposit);

    // ~1s later the steward resolves YES.
    h.warp(1);
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

    // Resolved at t (mid-cycle), but the winnings cash only lands in the vault ledger when the
    // next drips cycle boundary (cycle_secs=10) completes. A withdraw before ready_at must fail
    // with the legible SettlementPending gate — not the confusing VaultInsufficientUsdc from
    // deep in the pay path.
    let early = h.send(
        Instruction::new_with_bytes(
            h.program_id,
            &livestreak::instruction::Withdraw { vault_id }.data(),
            position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
        ),
        &[&h.payer.insecure_clone(), &bettor],
    );
    let err = early.expect_err("withdraw before the cycle boundary must be gated");
    assert!(
        err.contains("settlement pending"),
        "expected SettlementPending gate before the boundary, got: {err}"
    );

    // Stop both legs, then cross a drips cycle boundary (cycle_secs=10) so the streamed cash
    // is DELIVERED before payout — the engine's documented settlement granularity: the pot is
    // board-truth at resolvedAt; the cash arrives with the next completed cycle.
    h.warp(1);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopAll {}.data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();
    h.warp(12);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Collect { vault_id }.data(),
        livestreak::accounts::EngineOp { protocol_state, escrow }.to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone()]).unwrap();

    let bettor_before = h.token_balance(&bettor_ata);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Withdraw { vault_id }.data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    let paid_bettor = h.token_balance(&bettor_ata) - bettor_before;

    let creator_before = h.token_balance(&creator_ata);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::WithdrawSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();
    let paid_creator = h.token_balance(&creator_ata) - creator_before;

    // Same-side resolve: no losing pot to split — both walk away with (close to) their stakes;
    // exact split is the engine's affair, conservation is the invariant that matters here.
    let p = h.protocol(&market_id);
    let escrow_left = h.token_balance(&escrow);
    assert_eq!(
        u128::from(escrow_left),
        p.drips.held + p.vault.usdc_held + p.treasury.usdc_held,
        "conservation after same-side instant resolve"
    );
    assert!(paid_bettor > 0, "winner payout must be nonzero (got {paid_bettor})");
    assert!(paid_creator > 0, "seed payout must be nonzero (got {paid_creator})");
}
