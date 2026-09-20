//! Generates the wasm round-trip fixture: a Protocol blob after a real betting flow,
//! plus expected view values computed host-side by the SAME engine. The node test
//! (chains/solana/scripts/test-wasm.mjs) decodes the blob through the wasm build and
//! must reproduce these values exactly.
//!
//!   cargo run -p livestreak-wasm --example gen-fixture -- <out-dir>

use livestreak_engine::{Protocol, SIDE_NO, SIDE_YES};
use ruint::aliases::U256;
use std::fs;

fn hex32(id: &[u8; 32]) -> String {
    let mut s = String::from("0x");
    for b in id {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn main() {
    let out = std::env::args().nth(1).expect("usage: gen-fixture <out-dir>");
    fs::create_dir_all(&out).unwrap();

    let mut p = Protocol::default();
    let market_id = [7u8; 32];
    let creator = [1u8; 32];
    let bettor = [2u8; 32];
    let t0 = 1_700_000_000u64;

    // Seed NO $500 @ $5/s, bettor YES $700 @ $7/s, resolve YES at t0+100.
    let vault_id = p
        .create_vault_seeded(
            market_id,
            b"fixture: does the keeper save?".to_vec(),
            creator,
            SIDE_NO,
            U256::from(5_000_000u64),
            500_000_000,
            t0,
        )
        .unwrap();
    let token_id = p.mint_with_salt(market_id, true, bettor, 42).unwrap();
    p.fund(token_id, &vault_id, SIDE_YES, U256::from(7_000_000u64), 700_000_000, t0)
        .unwrap();
    p.vault.resolve(&vault_id, SIDE_YES, t0 + 100).unwrap();

    let blob = p.to_bytes();
    fs::write(format!("{out}/protocol-blob.bin"), &blob).unwrap();

    let now = t0 + 100;
    let board_yes = p.vault.boards.get(&(vault_id, SIDE_YES)).copied().unwrap();
    let (ends, rates) = p.vault.get_boundaries(&vault_id, SIDE_YES);
    let token_hex = hex32(&token_id.to_be_bytes());

    let expected = serde_json::json!({
        "now": now,
        "vaultId": hex32(&vault_id),
        "marketId": hex32(&market_id),
        "tokenId": token_hex,
        "vaultOutcome": p.vault.get_vault(&vault_id).unwrap().outcome,
        "pot": p.vault.pot(&vault_id).to_string(),
        "boardYes": {
            "pool": board_yes.pool.to_string(),
            "sideRate": board_yes.side_rate.to_string(),
            "g": board_yes.g.to_string(),
            "lastAdvance": board_yes.last_advance,
            "sideShares": board_yes.side_shares.to_string(),
        },
        "boundariesYes": ends.iter().zip(rates.iter())
            .map(|(e, r)| serde_json::json!({"maxEnd": e, "rate": r.to_string()}))
            .collect::<Vec<_>>(),
        "pendingSharesYes": p.vault.pending_shares(&vault_id, SIDE_YES, token_id, now).to_string(),
        "claimableYes": p.vault.claimable(token_id, &vault_id, SIDE_YES).to_string(),
        "accountVaults": p.vault.get_account_vault_ids(token_id).iter().map(hex32).collect::<Vec<_>>(),
        "laneCount": p.lane_count(token_id),
        "escrowExpected": (p.drips.held + p.vault.usdc_held + p.treasury.usdc_held).to_string(),
    });
    fs::write(
        format!("{out}/expected.json"),
        serde_json::to_string_pretty(&expected).unwrap(),
    )
    .unwrap();
    println!("wrote {out}/protocol-blob.bin ({} bytes) + expected.json", blob.len());
}
