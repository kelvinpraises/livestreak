//! Declarative full-set `set_lanes` over litesvm. Register market -> init protocol ->
//! creator seeds TWO vaults (both YES) on ONE market -> user A mints a position and funds a
//! single NO lane on vault #1. Then A drives `set_lanes` (the Move-parity full-set
//! reconfiguration) and we assert:
//!  (a) RESHAPE: set_lanes([vault1 NO at a NEW rate, vault2 NO as a NEW lane], add_deposit>0)
//!      grows the position to 2 lanes, both NO boards accrue at the DESIRED rates, and the
//!      escrow grew by exactly add_deposit (conservation holds in-handler).
//!  (b) STRAND FIX: stop the vault1 lane (side_rate -> 0, a run-dry / dead lane), then
//!      set_lanes re-declaring that same vault1 lane WITH add_deposit re-funds it — the
//!      board's side_rate is RESTORED (the added-lane on_fund on diff_added that closes the
//!      idle-chain TOCTOU).
//!  (c) typed guards: duplicate vault -> DriverDuplicateVault; zero rate -> DriverZeroRate;
//!      more than MAX_LANES entries -> DriverTooManyLanes; a non-owner signer -> NotCreator.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    common::{Harness, SIDE_NO, SIDE_YES, USD},
    livestreak::instructions::protocol::LaneArg,
    ruint::aliases::U256,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const SALT: u64 = 21;

#[test]
fn set_lanes_reshape_strand_and_guards() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the default steward
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    h.svm.airdrop(&user_a.pubkey(), 10_000_000_000).unwrap();
    h.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 2_000 * USD);
    let a_ata = h.ata(&user_a, 2_000 * USD);

    // ── registry + market ──────────────────────────────────────────────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Initialize {
            default_steward: creator.pubkey(),
            lvst_mint: Pubkey::new_unique(),
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
        b"stream-set",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Set".to_vec(),
            stream_id: b"stream-set".to_vec(),
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

    // ── creator seeds TWO vaults (both YES) on the one market ──────────────────
    let program_id = h.program_id;
    let seed = |question: &[u8]| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::CreateVaultSeeded {
                question: question.to_vec(),
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
        )
    };
    h.send(seed(b"goal in first half?"), &[&creator]).unwrap();
    let p = h.protocol(&market_id);
    let vault1 = *p.vault.vaults.keys().next().unwrap();

    h.send(seed(b"goal in second half?"), &[&creator]).unwrap();
    let p = h.protocol(&market_id);
    let vault2 = *p
        .vault
        .vaults
        .keys()
        .find(|k| **k != vault1)
        .expect("a second distinct vault must exist");

    // ── user A mints a position + funds a single NO lane on vault1 ─────────────
    let token_u256 = p.calc_token_id_with_salt(&user_a.pubkey().to_bytes(), SALT);
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(token_u256);
    let position = h.pda(&[b"position", &token_id_bytes]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::MintPosition { salt: SALT }.data(),
        livestreak::accounts::MintPosition {
            payer: user_a.pubkey(),
            minter: user_a.pubkey(),
            protocol_state,
            market,
            position,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &user_a]).unwrap();

    let fund_ix = Instruction::new_with_bytes(
        program_id,
        &livestreak::instruction::Fund {
            vault_id: vault1,
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
    h.send(fund_ix, &[&h.payer.insecure_clone(), &user_a]).unwrap();

    let p = h.protocol(&market_id);
    assert_eq!(p.lane_count(token_u256), 1, "position starts with one funded lane");

    // helper: build a set_lanes instruction for a given signer + desired set + top-up.
    let set_lanes_ix = |signer: Pubkey, lanes: Vec<LaneArg>, add_deposit: u64| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::SetLanes { lanes, add_deposit }.data(),
            livestreak::accounts::PositionEngineOp {
                user: signer,
                protocol_state,
                position,
                escrow,
                user_usdc: a_ata,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };

    // ── (a) RESHAPE: vault1 to a NEW rate + vault2 as a NEW lane, with a top-up ─
    let v1_new_rate = 4 * USD;
    let v2_rate = 6 * USD;
    let add_a = 400 * USD;
    let escrow_before = h.token_balance(&escrow);
    h.send(
        set_lanes_ix(
            user_a.pubkey(),
            vec![
                LaneArg { vault_id: vault1, side: SIDE_NO, rate: v1_new_rate },
                LaneArg { vault_id: vault2, side: SIDE_NO, rate: v2_rate },
            ],
            add_a,
        ),
        &[&h.payer.insecure_clone(), &user_a],
    )
    .expect("owner A must be able to reshape lanes");
    let escrow_after = h.token_balance(&escrow);

    let p = h.protocol(&market_id);
    assert_eq!(p.lane_count(token_u256), 2, "reshape grows the position to two lanes");
    assert!(p.market_driver.lanes.contains_key(&(token_u256, vault1)), "vault1 lane present");
    assert!(p.market_driver.lanes.contains_key(&(token_u256, vault2)), "vault2 lane present");
    assert_eq!(
        p.vault.boards.get(&(vault1, SIDE_NO)).unwrap().side_rate,
        U256::from(v1_new_rate),
        "vault1 NO board reflects the reshaped rate",
    );
    assert_eq!(
        p.vault.boards.get(&(vault2, SIDE_NO)).unwrap().side_rate,
        U256::from(v2_rate),
        "vault2 NO board reflects its new-lane rate",
    );
    assert_eq!(
        escrow_after - escrow_before,
        add_a,
        "the escrow grew by exactly the add_deposit top-up",
    );

    // ── (b) STRAND FIX: stop vault1 (side_rate -> 0), then re-declare it with a top-up ──
    let stop_ix = Instruction::new_with_bytes(
        program_id,
        &livestreak::instruction::StopFunding { vault_id: vault1, side: SIDE_NO }.data(),
        livestreak::accounts::PositionStateOp { user: user_a.pubkey(), protocol_state, position }
            .to_account_metas(None),
    );
    h.send(stop_ix, &[&h.payer.insecure_clone(), &user_a])
        .expect("owner A stops the vault1 lane");

    let p = h.protocol(&market_id);
    assert_eq!(
        p.vault.boards.get(&(vault1, SIDE_NO)).unwrap().side_rate,
        U256::ZERO,
        "the stopped vault1 lane is dead — side_rate is 0 before the re-fund",
    );
    assert_eq!(p.lane_count(token_u256), 1, "only the vault2 lane remains after the stop");

    // Re-declare BOTH lanes (vault2 unchanged, vault1 re-added) with a top-up: the engine's
    // diff_added sees vault1 as freshly added and re-funds it — the strand fix.
    let add_b = 200 * USD;
    h.send(
        set_lanes_ix(
            user_a.pubkey(),
            vec![
                LaneArg { vault_id: vault1, side: SIDE_NO, rate: v1_new_rate },
                LaneArg { vault_id: vault2, side: SIDE_NO, rate: v2_rate },
            ],
            add_b,
        ),
        &[&h.payer.insecure_clone(), &user_a],
    )
    .expect("re-declaring the dead vault1 lane with a top-up must re-fund it");

    let p = h.protocol(&market_id);
    assert_eq!(p.lane_count(token_u256), 2, "the re-fund restores the vault1 lane (2 lanes)");
    assert_eq!(
        p.vault.boards.get(&(vault1, SIDE_NO)).unwrap().side_rate,
        U256::from(v1_new_rate),
        "STRAND FIX: the re-added vault1 lane is live again — side_rate restored",
    );

    // ── (c) typed guards (add_deposit=0; the engine reverts the whole op, top-up included) ──
    // duplicate vault in the desired set.
    let err = h
        .send(
            set_lanes_ix(
                user_a.pubkey(),
                vec![
                    LaneArg { vault_id: vault1, side: SIDE_NO, rate: v1_new_rate },
                    LaneArg { vault_id: vault1, side: SIDE_NO, rate: v2_rate },
                ],
                0,
            ),
            &[&h.payer.insecure_clone(), &user_a],
        )
        .expect_err("a duplicate vault must fail");
    assert!(err.contains("DriverDuplicateVault"), "expected DriverDuplicateVault, got: {err}");

    // zero rate.
    let err = h
        .send(
            set_lanes_ix(
                user_a.pubkey(),
                vec![LaneArg { vault_id: vault1, side: SIDE_NO, rate: 0 }],
                0,
            ),
            &[&h.payer.insecure_clone(), &user_a],
        )
        .expect_err("a zero rate must fail");
    assert!(err.contains("DriverZeroRate"), "expected DriverZeroRate, got: {err}");

    // more than MAX_LANES entries.
    let too_many: Vec<LaneArg> = (0..=livestreak_engine::MAX_LANES)
        .map(|_| LaneArg { vault_id: vault1, side: SIDE_NO, rate: v1_new_rate })
        .collect();
    assert!(too_many.len() > livestreak_engine::MAX_LANES);
    let err = h
        .send(
            set_lanes_ix(user_a.pubkey(), too_many, 0),
            &[&h.payer.insecure_clone(), &user_a],
        )
        .expect_err("more than MAX_LANES entries must fail");
    assert!(err.contains("DriverTooManyLanes"), "expected DriverTooManyLanes, got: {err}");

    // non-owner signer.
    let err = h
        .send(
            set_lanes_ix(
                user_b.pubkey(),
                vec![LaneArg { vault_id: vault1, side: SIDE_NO, rate: v1_new_rate }],
                0,
            ),
            &[&h.payer.insecure_clone(), &user_b],
        )
        .expect_err("a non-owner set_lanes must fail");
    assert!(err.contains("NotCreator"), "expected NotCreator, got: {err}");
}
