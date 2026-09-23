//! ProtocolState blob reader for the TS SDK. Wraps `livestreak-engine` views behind
//! wasm-bindgen — the SAME code the chain runs, so client reads can never drift from
//! on-chain semantics. Wire format: amounts are decimal strings, ids are 0x-hex
//! 32-byte strings, JSON out (TS wrapper converts to bigint).

use livestreak_engine::{Protocol, VaultId};
use ruint::aliases::U256;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn parse_id(hex: &str) -> Result<[u8; 32], JsError> {
    let s = hex.strip_prefix("0x").unwrap_or(hex);
    if s.len() != 64 {
        return Err(JsError::new("id must be 32 bytes of hex"));
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
            .map_err(|_| JsError::new("invalid hex id"))?;
    }
    Ok(out)
}

fn id_hex(id: &[u8; 32]) -> String {
    let mut s = String::with_capacity(66);
    s.push_str("0x");
    for b in id {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn account(hex: &str) -> Result<U256, JsError> {
    Ok(U256::from_be_bytes(parse_id(hex)?))
}

fn account_hex(id: U256) -> String {
    id_hex(&id.to_be_bytes())
}

fn s(v: impl ToString) -> Value {
    Value::String(v.to_string())
}

#[wasm_bindgen]
pub struct ProtocolView {
    p: Protocol,
}

#[wasm_bindgen]
impl ProtocolView {
    /// Decode a ProtocolState `data` payload (the postcard blob, header already stripped).
    pub fn decode(bytes: &[u8]) -> Result<ProtocolView, JsError> {
        let p = Protocol::from_bytes(bytes)
            .ok_or_else(|| JsError::new("protocol state failed to decode"))?;
        Ok(ProtocolView { p })
    }

    /// Every vault id in the registry (hex array JSON).
    pub fn list_vault_ids(&self) -> String {
        let ids: Vec<Value> = self.p.vault.vaults.keys().map(|k| s(id_hex(k))).collect();
        Value::Array(ids).to_string()
    }

    /// Vault ids belonging to one market (hex array JSON).
    pub fn market_vaults(&self, market_id: &str) -> Result<String, JsError> {
        let mid = parse_id(market_id)?;
        let ids: Vec<Value> = self
            .p
            .vault
            .vaults
            .values()
            .filter(|v| v.market_id == mid)
            .map(|v| s(id_hex(&v.id)))
            .collect();
        Ok(Value::Array(ids).to_string())
    }

    pub fn vault(&self, vault_id: &str) -> Result<String, JsError> {
        let vid: VaultId = parse_id(vault_id)?;
        let v = self
            .p
            .vault
            .get_vault(&vid)
            .map_err(|e| JsError::new(&format!("{e:?}")))?;
        Ok(json!({
            "id": id_hex(&v.id),
            "marketId": id_hex(&v.market_id),
            "question": String::from_utf8_lossy(&v.question),
            "creator": id_hex(&v.creator),
            "status": v.status,
            "outcome": v.outcome,
            "resolvedAt": v.resolved_at,
            "exists": v.exists,
        })
        .to_string())
    }

    pub fn board(&self, vault_id: &str, side: u8) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        let b = self
            .p
            .vault
            .boards
            .get(&(vid, side))
            .copied()
            .unwrap_or_default();
        Ok(json!({
            "pool": s(b.pool),
            "sideRate": s(b.side_rate),
            "g": s(b.g),
            "lastAdvance": b.last_advance,
            "sideShares": s(b.side_shares),
        })
        .to_string())
    }

    /// (yesPool, noPool, yesShares, noShares) — shares WAD-descaled like the on-chain view.
    pub fn vault_pools(&self, vault_id: &str) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        let (yp, np, ys, ns) = self
            .p
            .vault
            .get_vault_pools(&vid)
            .map_err(|e| JsError::new(&format!("{e:?}")))?;
        Ok(json!({
            "yesPool": s(yp), "noPool": s(np),
            "yesShares": s(ys), "noShares": s(ns),
        })
        .to_string())
    }

    pub fn share_price(&self, vault_id: &str, side: u8) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        let pool = self
            .p
            .vault
            .boards
            .get(&(vid, side))
            .map(|b| b.pool)
            .unwrap_or_default();
        let pool_n = livestreak_math::wide::narrow(pool, "share_price pool");
        Ok(livestreak_math::bonding::price(pool_n).to_string())
    }

    pub fn pot(&self, vault_id: &str) -> Result<String, JsError> {
        Ok(self.p.vault.pot(&parse_id(vault_id)?).to_string())
    }

    pub fn collected(&self, vault_id: &str) -> Result<bool, JsError> {
        let vid = parse_id(vault_id)?;
        Ok(self.p.vault.collected.get(&vid).copied().unwrap_or(false))
    }

    /// `[maxEnds, rates]` — the canonical unsettled funder depletion schedule.
    pub fn boundaries(&self, vault_id: &str, side: u8) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        let (ends, rates) = self.p.vault.get_boundaries(&vid, side);
        let entries: Vec<Value> = ends
            .iter()
            .zip(rates.iter())
            .map(|(e, r)| json!({ "maxEnd": e, "rate": s(r) }))
            .collect();
        Ok(Value::Array(entries).to_string())
    }

    pub fn pending_boundaries(&self, vault_id: &str, side: u8) -> Result<u64, JsError> {
        Ok(self.p.vault.pending_boundaries(&parse_id(vault_id)?, side))
    }

    pub fn pending_shares(
        &self,
        vault_id: &str,
        side: u8,
        token_id: &str,
        now: u64,
    ) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        Ok(self
            .p
            .vault
            .pending_shares(&vid, side, account(token_id)?, now)
            .to_string())
    }

    pub fn claimable(&self, token_id: &str, vault_id: &str, side: u8) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        Ok(self.p.vault.claimable(account(token_id)?, &vid, side).to_string())
    }

    pub fn loss_claimable(
        &self,
        token_id: &str,
        vault_id: &str,
        side: u8,
    ) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        Ok(self
            .p
            .vault
            .loss_claimable(account(token_id)?, &vid, side)
            .to_string())
    }

    /// EVM-parity view (Treasury.lossLvstClaimable): the LVST a loss would mint right now, 0 once
    /// claimed. Claimed-aware so the panel's loss preview both equals the mint AND clears after Cash out.
    pub fn loss_lvst_claimable(
        &self,
        token_id: &str,
        vault_id: &str,
        side: u8,
    ) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        Ok(self
            .p
            .treasury
            .loss_lvst_claimable(&self.p.vault, account(token_id)?, &vid, side)
            .to_string())
    }

    pub fn account_vault_ids(&self, token_id: &str) -> Result<String, JsError> {
        let ids = self.p.vault.get_account_vault_ids(account(token_id)?);
        let out: Vec<Value> = ids.iter().map(|v| s(id_hex(v))).collect();
        Ok(Value::Array(out).to_string())
    }

    pub fn position(&self, vault_id: &str, side: u8, token_id: &str) -> Result<String, JsError> {
        let vid = parse_id(vault_id)?;
        let (rate, g_paid, shares, max_end, depleted, fund_start, lost) =
            self.p.vault.get_position(&vid, side, account(token_id)?);
        Ok(json!({
            "rate": s(rate), "gPaid": s(g_paid), "sharesAccrued": s(shares),
            "maxEnd": max_end, "depleted": depleted, "fundStart": fund_start,
            "lostUsdc": s(lost),
        })
        .to_string())
    }

    pub fn lane_count(&self, token_id: &str) -> Result<u32, JsError> {
        Ok(self.p.lane_count(account(token_id)?) as u32)
    }

    /// Stored shared streaming balance for a position token (the budget its lanes stream from).
    /// Matches EVM readNftBalance (streamsState.balance). 0 if the token was never funded.
    pub fn nft_balance(&self, token_id: &str) -> Result<String, JsError> {
        Ok(self.p.streams.state_balance(account(token_id)?).to_string())
    }

    /// The deterministic per-(creator, vault) seed account id.
    pub fn seed_account(&self, creator: &str, vault_id: &str) -> Result<String, JsError> {
        let c = parse_id(creator)?;
        let vid = parse_id(vault_id)?;
        Ok(account_hex(self.p.vault_driver.seed_account(&c, &vid)))
    }

    pub fn calc_token_id_with_salt(&self, minter: &str, salt: u64) -> Result<String, JsError> {
        let m = parse_id(minter)?;
        Ok(account_hex(self.p.calc_token_id_with_salt(&m, salt)))
    }

    // ── treasury / LVST ──
    pub fn lvst_staked(&self, user: &str) -> Result<String, JsError> {
        Ok(self.p.treasury.lvst_staked(&parse_id(user)?).to_string())
    }

    pub fn pending_dividends(&self, user: &str) -> Result<String, JsError> {
        Ok(self.p.treasury.pending_dividends(&parse_id(user)?).to_string())
    }

    pub fn mint_rate(&self) -> String {
        self.p.treasury.mint_rate().to_string()
    }

    /// The three-ledger partition + the conservation sum the escrow must equal.
    pub fn summary(&self) -> String {
        let drips = self.p.drips.held;
        let vault = self.p.vault.usdc_held;
        let treasury = self.p.treasury.usdc_held;
        json!({
            "vaultCount": self.p.vault.vaults.len(),
            "dripsHeld": s(drips),
            "vaultHeld": s(vault),
            "treasuryHeld": s(treasury),
            "escrowExpected": s(drips + vault + treasury),
            "totalStaked": s(self.p.treasury.total_staked),
        })
        .to_string()
    }
}
