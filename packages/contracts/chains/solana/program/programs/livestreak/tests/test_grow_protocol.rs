//! ProtocolState realloc ladder over litesvm. A market is inited with a DELIBERATELY small
//! capacity (2_000 bytes) so the blob hits the wall fast: the first seeded vault fits, the
//! second overflows and `store()` fails typed StateFull. We then:
//!  (a) GROW: `grow_protocol` reallocs the account up by exactly MAX_PERMITTED_DATA_INCREASE
//!      (10_240 bytes), tops up rent-exemption from the payer, and the account stays rent-exempt.
//!  (b) RETRY: the previously-failing seed now succeeds against the grown account.
//!  (c) CAP: repeatedly grow to the PROTOCOL_HEADER + MAX_PROTOCOL_BYTES ceiling (each rung
//!      grows by min(10_240, remaining), the last is a partial rung), and the grow past the
//!      ceiling fails typed StateAtCapacity.

mod common;

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    anchor_lang::{solana_program::system_program, InstructionData, ToAccountMetas},
    common::{Harness, SIDE_NO, USD},
    livestreak::instructions::protocol::PROTOCOL_HEADER,
    livestreak::MAX_PROTOCOL_BYTES,
    solana_signer::Signer,
};

const MAX_PERMITTED_DATA_INCREASE: usize = 10_240;

fn account_len(h: &Harness, pda: &Pubkey) -> usize {
    h.svm.get_account(pda).unwrap().data.len()
}

fn account_lamports(h: &Harness, pda: &Pubkey) -> u64 {
    h.svm.get_account(pda).unwrap().lamports
}

fn assert_rent_exempt(h: &Harness, pda: &Pubkey) {
    let len = account_len(h, pda);
    let min = h.svm.minimum_balance_for_rent_exemption(len);
    assert!(
        account_lamports(h, pda) >= min,
        "protocol_state must stay rent-exempt: have {} need {} for {} bytes",
        account_lamports(h, pda),
        min,
        len
    );
}

#[test]
fn grow_protocol_ladder_retry_and_cap() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also default steward and the rent-top-up payer
    let creator_ata = h.ata(&creator, 20_000 * USD);

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
        b"stream-grow",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Grow".to_vec(),
            stream_id: b"stream-grow".to_vec(),
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

    // ── init_protocol with a SMALL capacity to hit the wall fast ───────────────
    let capacity: u16 = 2_000;
    let protocol_state = h.pda(&[b"protocol", &market_id]);
    let escrow = h.pda(&[b"escrow", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::InitProtocol { capacity }.data(),
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
    assert_eq!(
        account_len(&h, &protocol_state),
        PROTOCOL_HEADER + capacity as usize,
        "init sizes the account to header + capacity"
    );

    // ── seed vaults until the blob overflows the account (typed StateFull) ──────
    let program_id = h.program_id;
    let seed = |question: Vec<u8>| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::CreateVaultSeeded {
                question,
                seed_side: SIDE_NO,
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

    let mut created = 0u32;
    let mut failed_question: Vec<u8> = Vec::new();
    let mut hit_wall = false;
    for i in 0..64u32 {
        let q = format!("goal scored in period {i}?").into_bytes();
        match h.send(seed(q.clone()), &[&creator]) {
            Ok(()) => created += 1,
            Err(e) => {
                assert!(e.contains("StateFull"), "wall must be typed StateFull, got: {e}");
                failed_question = q;
                hit_wall = true;
                break;
            }
        }
    }
    assert!(hit_wall, "a 2_000-byte account must overflow within 64 vaults");
    assert!(created >= 1, "at least one vault must fit before the wall");
    assert_eq!(
        h.protocol(&market_id).vault.vaults.len() as u32,
        created,
        "only the fitting vaults are committed; the overflowing one reverted"
    );

    // ── (a) GROW one rung: +10_240 bytes, still rent-exempt ─────────────────────
    let grow_ix = || {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::GrowProtocol {}.data(),
            livestreak::accounts::GrowProtocol {
                payer: creator.pubkey(),
                protocol_state,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    };

    let len_before = account_len(&h, &protocol_state);
    h.send(grow_ix(), &[&creator]).expect("first grow must succeed");
    let len_after = account_len(&h, &protocol_state);
    assert_eq!(
        len_after,
        len_before + MAX_PERMITTED_DATA_INCREASE,
        "one grow rung adds exactly MAX_PERMITTED_DATA_INCREASE bytes"
    );
    assert_rent_exempt(&h, &protocol_state);

    // ── (b) RETRY: the previously-failing seed now commits against the grown blob ─
    h.send(seed(failed_question), &[&creator])
        .expect("the overflowing seed must succeed after the grow");
    assert_eq!(
        h.protocol(&market_id).vault.vaults.len() as u32,
        created + 1,
        "the retried vault is now committed"
    );

    // ── (c) CAP: grow to the ceiling; the grow past it fails typed StateAtCapacity ─
    let cap_len = PROTOCOL_HEADER + MAX_PROTOCOL_BYTES;
    loop {
        let before = account_len(&h, &protocol_state);
        if before >= cap_len {
            let e = h
                .send(grow_ix(), &[&creator])
                .expect_err("grow at the ceiling must fail");
            assert!(
                e.contains("StateAtCapacity"),
                "grow past the ceiling must be typed StateAtCapacity, got: {e}"
            );
            break;
        }
        h.send(grow_ix(), &[&creator]).expect("grow below the ceiling must succeed");
        let after = account_len(&h, &protocol_state);
        let expected = core::cmp::min(before + MAX_PERMITTED_DATA_INCREASE, cap_len);
        assert_eq!(after, expected, "each rung grows by min(10_240, remaining)");
        assert_rent_exempt(&h, &protocol_state);
    }
    assert_eq!(
        account_len(&h, &protocol_state),
        cap_len,
        "the account tops out at exactly PROTOCOL_HEADER + MAX_PROTOCOL_BYTES"
    );
}
