//! Single-lane `stop_funding` over litesvm. Register market -> init protocol -> creator
//! seeds TWO vaults (both YES) on ONE market -> user A mints a position and funds a NO lane
//! on EACH vault (two lanes on the one shared stream budget). Then A stops the lane on
//! vault #1 and we assert the full single-lane semantics:
//!  (a) the engine's lane_count for the position dropped by exactly 1, and the stopped
//!      (vault1, NO) lane is gone from the driver while (vault2, NO) remains,
//!  (b) the stopped vault's NO board no longer accrues (side_rate -> 0) while the OTHER
//!      vault's NO board keeps streaming (side_rate unchanged, non-zero),
//!  (c) NO cash moved — a single-lane stop only RESHUFFLES the shared deposit across the
//!      remaining lanes (engine `stop`: set_streams_and_transfer with amt=0, balance_delta=0
//!      -> real=0, nothing withdrawn), so A's USDC balance is unchanged,
//!  (d) stopping the SAME lane again is typed NoLane (DriverNoLane),
//!  (e) stopping the still-live vault2 lane with the WRONG side is typed NoLane,
//!  (f) a non-owner signer is refused typed NotCreator at the owner gate.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    common::{Harness, SIDE_NO, SIDE_YES, USD},
    ruint::aliases::U256,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const SALT: u64 = 21;

#[test]
fn stop_funding_drops_one_lane_and_moves_no_cash() {
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
        b"stream-stop",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Stop".to_vec(),
            stream_id: b"stream-stop".to_vec(),
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
    let vault1 = *p.vault.vaults.keys().next().unwrap(); // only vault so far

    h.send(seed(b"goal in second half?"), &[&creator]).unwrap();
    let p = h.protocol(&market_id);
    let vault2 = *p
        .vault
        .vaults
        .keys()
        .find(|k| **k != vault1)
        .expect("a second distinct vault must exist");

    // ── user A mints a position + funds a NO lane on EACH vault ────────────────
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

    let rate1 = 7 * USD;
    let rate2 = 3 * USD;
    let fund = |vault_id: [u8; 32], rate: u64, deposit: u64| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::Fund { vault_id, side: SIDE_NO, rate, deposit }.data(),
            livestreak::accounts::PositionEngineOp {
                user: user_a.pubkey(),
                protocol_state,
                position,
                escrow,
                user_usdc: a_ata,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };
    h.send(fund(vault1, rate1, 700 * USD), &[&h.payer.insecure_clone(), &user_a]).unwrap();
    h.send(fund(vault2, rate2, 300 * USD), &[&h.payer.insecure_clone(), &user_a]).unwrap();

    // ── pre-stop: two lanes live, both NO boards accrue at the funded rates ─────
    let p = h.protocol(&market_id);
    assert_eq!(p.lane_count(token_u256), 2, "position must hold both funded lanes");
    assert!(p.market_driver.lanes.contains_key(&(token_u256, vault1)), "vault1 lane must exist");
    assert!(p.market_driver.lanes.contains_key(&(token_u256, vault2)), "vault2 lane must exist");
    assert_eq!(
        p.vault.boards.get(&(vault1, SIDE_NO)).unwrap().side_rate,
        U256::from(rate1),
        "vault1 NO board must accrue at the funded rate before the stop",
    );
    assert_eq!(
        p.vault.boards.get(&(vault2, SIDE_NO)).unwrap().side_rate,
        U256::from(rate2),
        "vault2 NO board must accrue at the funded rate before the stop",
    );

    // ── stop ONE lane (vault1, NO), parameterized by signer for the owner-gate cases ──
    let stop_ix = |signer: Pubkey, vault_id: [u8; 32], side: u8| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::StopFunding { vault_id, side }.data(),
            livestreak::accounts::PositionStateOp { user: signer, protocol_state, position }
                .to_account_metas(None),
        )
    };

    let a_before = h.token_balance(&a_ata);
    h.send(stop_ix(user_a.pubkey(), vault1, SIDE_NO), &[&h.payer.insecure_clone(), &user_a])
        .expect("owner A must be able to stop the vault1 lane");
    let a_after = h.token_balance(&a_ata);

    // (c) NO cash moved — a single-lane stop reshuffles the shared budget, refunds nothing.
    assert_eq!(a_before, a_after, "a single-lane stop must not refund USDC to the owner");

    // (a) exactly one lane dropped; (b) the stopped board stops accruing, the other keeps going.
    let p = h.protocol(&market_id);
    assert_eq!(p.lane_count(token_u256), 1, "the stop must drop the position's lane_count by 1");
    assert!(
        !p.market_driver.lanes.contains_key(&(token_u256, vault1)),
        "the stopped vault1 lane must be gone",
    );
    assert!(
        p.market_driver.lanes.contains_key(&(token_u256, vault2)),
        "the untouched vault2 lane must remain",
    );
    assert_eq!(
        p.vault.boards.get(&(vault1, SIDE_NO)).unwrap().side_rate,
        U256::ZERO,
        "the stopped vault1 NO board must no longer accrue from the position",
    );
    assert_eq!(
        p.vault.boards.get(&(vault2, SIDE_NO)).unwrap().side_rate,
        U256::from(rate2),
        "the still-funded vault2 NO board must keep streaming at its rate",
    );

    // (d) stopping the SAME lane again is typed NoLane.
    let err = h
        .send(stop_ix(user_a.pubkey(), vault1, SIDE_NO), &[&h.payer.insecure_clone(), &user_a])
        .expect_err("re-stopping a gone lane must fail");
    assert!(err.contains("DriverNoLane"), "re-stop must be typed DriverNoLane, got: {err}");

    // (e) stopping the live vault2 lane with the WRONG side is typed NoLane.
    let err = h
        .send(stop_ix(user_a.pubkey(), vault2, SIDE_YES), &[&h.payer.insecure_clone(), &user_a])
        .expect_err("stopping with the wrong side must fail");
    assert!(err.contains("DriverNoLane"), "wrong-side stop must be typed DriverNoLane, got: {err}");

    // (f) a non-owner signer is refused typed NotCreator at the owner gate.
    let err = h
        .send(stop_ix(user_b.pubkey(), vault2, SIDE_NO), &[&h.payer.insecure_clone(), &user_b])
        .expect_err("a non-owner stop must fail");
    assert!(err.contains("NotCreator"), "non-owner stop must be typed NotCreator, got: {err}");
}
