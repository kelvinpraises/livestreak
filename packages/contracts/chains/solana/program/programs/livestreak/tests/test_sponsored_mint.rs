//! Sponsored mint: a bettor with ZERO SOL gets a position NFT because a separate `payer` (the
//! sponsor / tx fee payer) funds the PositionOwner rent. This is the account-abstraction property
//! that lets an end user hold only USDC — never SOL — and still open a position. `minter` stays the
//! identity (tokenId + owner keyed on it); `payer` funds the account. Mirrors the on-chain sponsored
//! flow where Kora's fee payer is also the rent payer.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    common::Harness,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const SALT: u64 = 99;

#[test]
fn zero_sol_bettor_mints_when_sponsor_pays_rent() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also the sponsor (tx fee payer + rent payer)
    // The bettor is NEVER airdropped: it holds zero SOL and owns no account.
    let bettor = Keypair::new();
    assert_eq!(h.svm.get_balance(&bettor.pubkey()).unwrap_or(0), 0, "bettor must start with zero SOL");

    // ── registry + market + init_protocol (creator/sponsor pays) ────────────────
    let registry = h.pda(&[b"registry"]);
    h.send(
        Instruction::new_with_bytes(
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
        ),
        &[&creator],
    )
    .unwrap();

    let market_id =
        livestreak::instructions::register_market::compute_market_id(&creator.pubkey(), b"stream-spon");
    let market = h.pda(&[b"market", &market_id]);
    h.send(
        Instruction::new_with_bytes(
            h.program_id,
            &livestreak::instruction::RegisterMarket {
                title: b"Spon".to_vec(),
                stream_id: b"stream-spon".to_vec(),
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
        ),
        &[&creator],
    )
    .unwrap();

    let protocol_state = h.pda(&[b"protocol", &market_id]);
    let escrow = h.pda(&[b"escrow", &market_id]);
    h.send(
        Instruction::new_with_bytes(
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
        ),
        &[&creator],
    )
    .unwrap();

    // ── the zero-SOL bettor mints: payer = sponsor, minter = bettor ─────────────
    let p = h.protocol(&market_id);
    let token_u256 = p.calc_token_id_with_salt(&bettor.pubkey().to_bytes(), SALT);
    let token_id_bytes = livestreak::instructions::protocol::token_id_bytes(token_u256);
    let position = h.pda(&[b"position", &token_id_bytes]);
    h.send(
        Instruction::new_with_bytes(
            h.program_id,
            &livestreak::instruction::MintPosition { salt: SALT }.data(),
            livestreak::accounts::MintPosition {
                payer: creator.pubkey(), // the sponsor funds the PositionOwner rent
                minter: bettor.pubkey(), // the zero-SOL bettor is the owner/identity
                protocol_state,
                market,
                position,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        // Both sign: the sponsor as payer, the bettor as minter. The tx fee payer is the harness
        // payer (= the sponsor), so the bettor is charged for NOTHING.
        &[&creator, &bettor],
    )
    .expect("a zero-SOL bettor must mint when the sponsor pays rent");

    // The bettor still holds zero SOL — the sponsor paid the rent, not the bettor.
    assert_eq!(
        h.svm.get_balance(&bettor.pubkey()).unwrap_or(0),
        0,
        "the bettor must have paid no SOL — the sponsor covered the PositionOwner rent",
    );

    // Ownership is the bettor's: PositionOwner.owner (offset 8 disc + 32 token_id = 40) == bettor.
    let data = h.svm.get_account(&position).expect("position account must exist").data;
    assert_eq!(&data[40..72], &bettor.pubkey().to_bytes(), "position owner must be the bettor");
    // The position records its market (offset 40 owner + 32 = 72): a laneless mint is still
    // attributable to its market, which is what enables first-bet controls in the UI.
    assert_eq!(&data[72..104], &market_id, "position must record the market it was minted for");
}
