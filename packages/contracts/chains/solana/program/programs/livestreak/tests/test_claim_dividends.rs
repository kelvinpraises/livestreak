//! Dividend claim over litesvm with REAL SPL tokens — the full economic loop end to end:
//! record a canonical LVST mint at initialize -> a staker stakes LVST -> a seeded vault +
//! opposing bet stream, resolve, collect (2% skim lands in the treasury ledger, inside the
//! shared USDC escrow) -> the staker claims their USDC dividends. Asserts the staker's USDC
//! rises by exactly the pre-claim `pending_dividends`, the treasury ledger drains to zero,
//! conservation still holds across real balances, and a second claim fails typed NoDividends.
//! Also asserts the fake-mint guard: staking a NON-registry mint fails typed WrongLvstMint.
//!
//! How the staker ACQUIRES LVST: the canonical LVST mint is created with a HARNESS-controlled
//! authority and that pubkey is passed to `initialize` as the registry's canonical lvst_mint.
//! The staking constraint checks KEY equality against the registry — NOT the mint authority —
//! so a harness-owned mint is valid and lets the test MintTo the staker directly (much simpler
//! than running a loss-mint sub-loop, and it exercises the exact constraint under test).

mod common;

use {
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    anchor_lang::solana_program::instruction::Instruction,
    common::{Harness, SIDE_NO, SIDE_YES, USD},
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const LVST: u64 = 1_000_000_000; // 9 decimals (Sui parity)

#[test]
fn staker_claims_usdc_dividends_and_guards_hold() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the default steward
    let bettor = Keypair::new();
    let staker = Keypair::new();
    h.svm.airdrop(&bettor.pubkey(), 10_000_000_000).unwrap();
    h.svm.airdrop(&staker.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let bettor_ata = h.ata(&bettor, 1_000 * USD);
    // The staker's USDC ATA must already exist to receive the dividend (require-exists).
    let staker_usdc = h.ata(&staker, 0);

    // ── Canonical LVST mint (harness authority) + fund the staker ──────────────
    let payer = h.payer.insecure_clone();
    let lvst_mint = CreateMint::new(&mut h.svm, &payer)
        .decimals(9)
        .send()
        .expect("create canonical LVST mint");
    let staker_lvst = CreateAssociatedTokenAccount::new(&mut h.svm, &payer, &lvst_mint)
        .owner(&staker.pubkey())
        .send()
        .expect("create staker LVST ATA");
    MintTo::new(&mut h.svm, &payer, &lvst_mint, &staker_lvst, 100 * LVST)
        .send()
        .expect("mint 100 LVST to staker");

    // ── initialize: record the canonical LVST mint in the registry ─────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Initialize { default_steward: creator.pubkey(), lvst_mint }
            .data(),
        livestreak::accounts::Initialize {
            payer: creator.pubkey(),
            registry,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    // ── register market + init protocol (USDC escrow) ──────────────────────────
    let market_id = livestreak::instructions::register_market::compute_market_id(
        &creator.pubkey(),
        b"stream-div",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Dividends".to_vec(),
            stream_id: b"stream-div".to_vec(),
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

    // ── staker stakes 100 LVST BEFORE any skim (so notify_skim distributes to it) ─
    let lvst_escrow = h.pda(&[b"lvst_escrow", &market_id]);
    let staker_key = staker.pubkey().to_bytes();
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StakeLvst { amount: 100 * LVST }.data(),
        livestreak::accounts::StakeLvst {
            staker: staker.pubkey(),
            protocol_state,
            registry,
            lvst_mint,
            lvst_escrow,
            staker_lvst,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&payer, &staker]).unwrap();
    assert_eq!(h.protocol(&market_id).treasury.lvst_staked(&staker_key), (100 * LVST) as u128);

    // ── produce skim: creator seeds NO $5/s $500, bettor funds YES $7/s $700 ────
    let seed_deposit = 500 * USD;
    let user_op = |user, user_usdc| livestreak::accounts::UserEngineOp {
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
        }
        .data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let p = h.protocol(&market_id);
    let vault_id = *p.vault.vaults.keys().next().unwrap();

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
    h.send(ix, &[&payer, &bettor]).unwrap();

    let bet_deposit = 700 * USD;
    let position_op = |user, user_usdc| livestreak::accounts::PositionEngineOp {
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
    h.send(ix, &[&payer, &bettor]).unwrap();

    // ── 60s live, steward resolves YES (the seeded NO side loses) ──────────────
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

    // ── stop both legs, then collect: the 2% skim on the losing pool lands in the
    //    treasury ledger (inside the shared escrow) and, with a staker present, the
    //    collect's notify_skim distributes it pro-rata to the stake ledger. ──────
    h.warp(20);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopAll {}.data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&payer, &bettor]).unwrap();
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    h.warp(40);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::Collect { vault_id }.data(),
        livestreak::accounts::EngineOp { protocol_state, escrow }.to_account_metas(None),
    );
    h.send(ix, &[&payer]).unwrap();

    // ── the skim is now owed to the sole staker as USDC dividends ──────────────
    let p = h.protocol(&market_id);
    let pending = p.treasury.pending_dividends(&staker_key);
    assert!(pending > 0, "collected skim must accrue as dividends to the sole staker");
    // Single staker who staked before any skim ⇒ they own the entire held skim.
    assert_eq!(
        p.treasury.usdc_held, pending,
        "the whole treasury USDC balance is owed to the one staker",
    );
    let staker_usdc_before = h.token_balance(&staker_usdc);

    // ── claim: USDC escrow -> staker, exactly `pending` ────────────────────────
    let program_id = h.program_id;
    let claim_ix = || {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::ClaimDividends {}.data(),
            livestreak::accounts::ClaimDividends {
                staker: staker.pubkey(),
                protocol_state,
                escrow,
                staker_usdc,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };
    h.send(claim_ix(), &[&payer, &staker]).unwrap();

    assert_eq!(
        h.token_balance(&staker_usdc) as u128,
        staker_usdc_before as u128 + pending,
        "staker's USDC must rise by exactly the pre-claim pending dividends",
    );

    let p = h.protocol(&market_id);
    assert_eq!(p.treasury.usdc_held, 0, "treasury dividend ledger drains to zero");
    assert_eq!(p.treasury.pending_dividends(&staker_key), 0, "nothing left pending after the claim");

    // Real-token conservation still closes: escrow == the three engine ledgers.
    let ledger_sum = p.drips.held + p.vault.usdc_held + p.treasury.usdc_held;
    assert_eq!(h.token_balance(&escrow) as u128, ledger_sum, "escrow == engine ledgers post-claim");

    // ── a SECOND claim yields nothing → typed NoDividends ──────────────────────
    let err = h.send(claim_ix(), &[&payer, &staker]).unwrap_err();
    assert!(err.contains("NoDividends"), "a re-claim with zero accrued must be typed NoDividends, got: {err}");
    assert_eq!(h.token_balance(&staker_usdc) as u128, staker_usdc_before as u128 + pending, "the refused re-claim paid nothing");

    // ── fake-mint guard: staking a NON-registry mint on a fresh market fails typed ─
    let fake_mint = CreateMint::new(&mut h.svm, &payer)
        .decimals(9)
        .send()
        .expect("create a non-canonical LVST mint");
    assert_ne!(fake_mint, lvst_mint, "the fake mint must be a different key");
    let fake_lvst = CreateAssociatedTokenAccount::new(&mut h.svm, &payer, &fake_mint)
        .owner(&staker.pubkey())
        .send()
        .expect("create staker fake-LVST ATA");
    MintTo::new(&mut h.svm, &payer, &fake_mint, &fake_lvst, 100 * LVST)
        .send()
        .expect("mint 100 fake LVST to staker");

    // A second market so the stake escrow does not yet exist — the registry mint
    // constraint is the sole failure point (not the escrow's token::mint binding).
    let market2_id = livestreak::instructions::register_market::compute_market_id(
        &creator.pubkey(),
        b"stream-fake",
    );
    let market2 = h.pda(&[b"market", &market2_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Fake".to_vec(),
            stream_id: b"stream-fake".to_vec(),
        }
        .data(),
        livestreak::accounts::RegisterMarket {
            creator: creator.pubkey(),
            registry,
            market: market2,
            market_index: h.pda(&[b"market_idx", &1u64.to_le_bytes()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let protocol_state2 = h.pda(&[b"protocol", &market2_id]);
    let escrow2 = h.pda(&[b"escrow", &market2_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::InitProtocol { capacity: 9_000 }.data(),
        livestreak::accounts::InitProtocol {
            payer: creator.pubkey(),
            market: market2,
            protocol_state: protocol_state2,
            usdc_mint: h.usdc,
            escrow: escrow2,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    let lvst_escrow2 = h.pda(&[b"lvst_escrow", &market2_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StakeLvst { amount: 100 * LVST }.data(),
        livestreak::accounts::StakeLvst {
            staker: staker.pubkey(),
            protocol_state: protocol_state2,
            registry,
            lvst_mint: fake_mint,
            lvst_escrow: lvst_escrow2,
            staker_lvst: fake_lvst,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let err = h.send(ix, &[&payer, &staker]).unwrap_err();
    assert!(err.contains("WrongLvstMint"), "staking a non-registry mint must be typed WrongLvstMint, got: {err}");
    // The fake tokens never moved.
    assert_eq!(h.token_balance(&fake_lvst), 100 * LVST, "the rejected stake moved no fake LVST");
}
