//! LVST staking custody + ledger over litesvm with a REAL SPL LVST mint: register
//! market -> init protocol -> a staker stakes 100 LVST -> unstakes 60. Asserts the
//! physical escrow balance and the engine's TreasuryRegistry ledger stay in lockstep,
//! and that the treasury's typed guards hold — over-unstaking (50 > the 40 remaining)
//! and a zero-amount stake both fail (they must NOT saturate / silently succeed).
//!
//! The LVST mint here is created with a HARNESS-controlled authority so the test can
//! MintTo the staker directly: stake/unstake only MOVE existing tokens, they never mint,
//! so the canonical lvst_authority PDA is irrelevant to this path. `initialize` records
//! THIS mint as the registry's canonical LVST mint, so the stake constraint (which checks
//! KEY equality against the registry, not the mint authority) is satisfied.

mod common;

use {
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    anchor_lang::solana_program::instruction::Instruction,
    common::Harness,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const LVST: u64 = 1_000_000_000; // 9 decimals (Sui parity)

#[test]
fn stake_unstake_custody_and_typed_guards() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the default steward
    let staker = Keypair::new();
    h.svm.airdrop(&staker.pubkey(), 10_000_000_000).unwrap();

    // ── Protocol-wide LVST mint with a harness-controlled authority (default = payer),
    //    so the test mints straight to the staker. Staking never mints, so this is fine.
    let payer = h.payer.insecure_clone();
    let lvst_mint = CreateMint::new(&mut h.svm, &payer)
        .decimals(9)
        .send()
        .expect("create LVST mint");
    let staker_lvst = CreateAssociatedTokenAccount::new(&mut h.svm, &payer, &lvst_mint)
        .owner(&staker.pubkey())
        .send()
        .expect("create staker LVST ATA");
    MintTo::new(&mut h.svm, &payer, &lvst_mint, &staker_lvst, 100 * LVST)
        .send()
        .expect("mint 100 LVST to staker");

    // ── registry + market ─────────────────────────────────────────────────────
    let registry = h.pda(&[b"registry"]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        // Record the harness LVST mint as canonical so the stake constraint passes (the
        // constraint checks KEY equality, not the mint authority — see the test doc header).
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

    let market_id = livestreak::instructions::register_market::compute_market_id(
        &creator.pubkey(),
        b"stream-stake",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Stake".to_vec(),
            stream_id: b"stream-stake".to_vec(),
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

    // ── init_protocol (creates protocol_state + the USDC escrow) ───────────────
    let protocol_state = h.pda(&[b"protocol", &market_id]);
    let usdc_escrow = h.pda(&[b"escrow", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::InitProtocol { capacity: 9_000 }.data(),
        livestreak::accounts::InitProtocol {
            payer: creator.pubkey(),
            market,
            protocol_state,
            usdc_mint: h.usdc,
            escrow: usdc_escrow,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();

    // The per-market LVST staking escrow (created lazily on the first stake).
    let lvst_escrow = h.pda(&[b"lvst_escrow", &market_id]);
    let staker_key = staker.pubkey().to_bytes();

    let program_id = h.program_id;
    let stake_ix = |amount: u64| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::StakeLvst { amount }.data(),
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
        )
    };
    let unstake_ix = |amount: u64| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::UnstakeLvst { amount }.data(),
            livestreak::accounts::UnstakeLvst {
                staker: staker.pubkey(),
                protocol_state,
                lvst_mint,
                lvst_escrow,
                staker_lvst,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };

    // ── stake 100: escrow holds 100, staker holds 0, engine ledger reflects 100 ─
    h.send(stake_ix(100 * LVST), &[&payer, &staker]).unwrap();
    assert_eq!(h.token_balance(&lvst_escrow), 100 * LVST, "escrow custody = 100 LVST");
    assert_eq!(h.token_balance(&staker_lvst), 0, "staker's wallet drained into the escrow");
    let p = h.protocol(&market_id);
    assert_eq!(p.treasury.lvst_staked(&staker_key), (100 * LVST) as u128, "ledger stake = 100");
    assert_eq!(p.treasury.staked_lvst_held as u64, 100 * LVST, "ledger custody total = 100");

    // ── unstake 60: balances 40 / 60, ledger tracks the remaining 40 ───────────
    h.send(unstake_ix(60 * LVST), &[&payer, &staker]).unwrap();
    assert_eq!(h.token_balance(&lvst_escrow), 40 * LVST, "escrow retains the still-staked 40");
    assert_eq!(h.token_balance(&staker_lvst), 60 * LVST, "staker got 60 LVST back");
    let p = h.protocol(&market_id);
    assert_eq!(p.treasury.lvst_staked(&staker_key), (40 * LVST) as u128, "ledger stake = 40");
    assert_eq!(p.treasury.staked_lvst_held as u64, 40 * LVST, "ledger custody total = 40");

    // ── over-unstake: 50 > the 40 remaining must fail TYPED (never saturate) ───
    let err = h.send(unstake_ix(50 * LVST), &[&payer, &staker]).unwrap_err();
    assert!(err.contains("InvalidUnstake"), "over-unstake must be the typed InvalidUnstake, got: {err}");
    // State untouched by the reverted tx.
    assert_eq!(h.token_balance(&lvst_escrow), 40 * LVST, "failed unstake moved nothing");
    assert_eq!(h.token_balance(&staker_lvst), 60 * LVST, "failed unstake paid out nothing");
    assert_eq!(h.protocol(&market_id).treasury.lvst_staked(&staker_key), (40 * LVST) as u128);

    // ── zero-amount stake must fail TYPED (ZeroStake) ──────────────────────────
    let err = h.send(stake_ix(0), &[&payer, &staker]).unwrap_err();
    assert!(err.contains("ZeroStake"), "zero stake must be the typed ZeroStake, got: {err}");
    assert_eq!(h.token_balance(&lvst_escrow), 40 * LVST, "failed zero-stake changed no custody");
    assert_eq!(h.protocol(&market_id).treasury.lvst_staked(&staker_key), (40 * LVST) as u128);
}
