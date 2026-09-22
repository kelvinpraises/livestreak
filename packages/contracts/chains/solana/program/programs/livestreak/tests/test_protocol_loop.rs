//! On-chain keynote loop over litesvm with REAL SPL tokens: register market ->
//! init protocol + escrow -> seeded vault (creator pays USDC) -> mint position ->
//! fund YES (bettor pays) -> resolve (steward-gated) -> stop legs (refunds paid) ->
//! collect -> withdraw (winnings paid) -> escrow == engine ledgers, conservation
//! across real token balances.

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::system_program, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    anchor_lang::solana_program::instruction::Instruction,
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USD: u64 = 1_000_000;
const SIDE_YES: u8 = 0;
const SIDE_NO: u8 = 1;

struct Harness {
    svm: LiteSVM,
    payer: Keypair,
    program_id: Pubkey,
    usdc: Pubkey,
}

impl Harness {
    fn new() -> Self {
        let program_id = livestreak::id();
        let payer = Keypair::new();
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/livestreak.so"));
        svm.add_program(program_id, bytes).unwrap();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        // litesvm's clock starts at 0; the engine (like the Move source) uses
        // last_advance == 0 as its never-advanced sentinel, so run at a real epoch.
        let mut clock = svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp = 1_752_700_000;
        svm.set_sysvar(&clock);
        let usdc = CreateMint::new(&mut svm, &payer).decimals(6).send().unwrap();
        Self { svm, payer, program_id, usdc }
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        // Engine ops are CU-heavy (U256 software math; hot-path narrowing is a
        // later, test-gated optimization). Request the max budget like real clients.
        let compute_budget = Instruction::new_with_bytes(
            "ComputeBudget111111111111111111111111111111".parse().unwrap(),
            &{
                let mut data = vec![2u8];
                data.extend_from_slice(&1_400_000u32.to_le_bytes());
                data
            },
            vec![],
        );
        let msg = Message::new_with_blockhash(&[compute_budget, ix], Some(&self.payer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
            .map_err(|e| e.to_string())?;
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}\nlogs: {:#?}", e.err, e.meta.logs))
    }

    fn pda(&self, seeds: &[&[u8]]) -> Pubkey {
        Pubkey::find_program_address(seeds, &self.program_id).0
    }

    fn warp(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    fn token_balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).unwrap().data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    fn ata(&mut self, owner: &Keypair, fund: u64) -> Pubkey {
        let payer = self.payer.insecure_clone();
        let usdc = self.usdc;
        let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &payer, &usdc)
            .owner(&owner.pubkey())
            .send()
            .unwrap();
        if fund > 0 {
            MintTo::new(&mut self.svm, &payer, &usdc, &ata, fund).send().unwrap();
        }
        ata
    }

    fn protocol(&self, market_id: &[u8; 32]) -> livestreak_engine::Protocol {
        let state_pda = self.pda(&[b"protocol", market_id]);
        let account = self.svm.get_account(&state_pda).unwrap();
        let state =
            livestreak::state::ProtocolState::try_deserialize(&mut account.data.as_slice())
                .unwrap();
        livestreak_engine::Protocol::from_bytes(&state.data).unwrap()
    }
}

#[test]
fn onchain_keynote_loop_with_real_tokens() {
    let mut h = Harness::new();
    let creator = h.payer.insecure_clone(); // also default steward
    let bettor = Keypair::new();
    h.svm.airdrop(&bettor.pubkey(), 10_000_000_000).unwrap();

    let creator_ata = h.ata(&creator, 1_000 * USD);
    let bettor_ata = h.ata(&bettor, 1_000 * USD);

    // ── Phase-1 registry + market ─────────────────────────────────────────────
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
        b"stream-keynote",
    );
    let market = h.pda(&[b"market", &market_id]);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::RegisterMarket {
            title: b"Keynote".to_vec(),
            stream_id: b"stream-keynote".to_vec(),
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

    // ── init_protocol + escrow ────────────────────────────────────────────────
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

    // ── Bookmaker seeds NO at $5/s with $500 ──────────────────────────────────
    let seed_deposit = 500 * USD;
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
            question: b"goal scored?".to_vec(),
            seed_side: SIDE_NO,
            rate: 5 * USD,
            deposit: seed_deposit,
        }
        .data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();
    assert_eq!(h.token_balance(&escrow), seed_deposit);

    let p = h.protocol(&market_id);
    let vault_id = *p.vault.vaults.keys().next().unwrap();

    // ── Bettor mints a position + funds YES at $7/s with $700 ─────────────────
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
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();

    let bet_deposit = 700 * USD;
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
        &livestreak::instruction::Fund {
            vault_id,
            side: SIDE_YES,
            rate: 7 * USD,
            deposit: bet_deposit,
        }
        .data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    assert_eq!(h.token_balance(&escrow), seed_deposit + bet_deposit);

    // ── 60s live, steward resolves YES; stranger is refused ───────────────────
    h.warp(60);
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let program_id = h.program_id;
    let resolve_ix = move |signer: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &livestreak::instruction::Resolve { vault_id, winning_side: SIDE_YES }.data(),
            livestreak::accounts::Resolve {
                steward: signer,
                protocol_state,
                registry,
                market_steward: None,
            }
            .to_account_metas(None),
        )
    };
    assert!(h.send(resolve_ix(stranger.pubkey()), &[&h.payer.insecure_clone(), &stranger]).is_err());
    h.send(resolve_ix(creator.pubkey()), &[&creator]).unwrap();

    // ── Stop both legs 20s later: refunds land in real wallets ────────────────
    h.warp(20);
    let bettor_before = h.token_balance(&bettor_ata);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopAll {}.data(),
        position_op(bettor.pubkey(), bettor_ata).to_account_metas(None),
    );
    h.send(ix, &[&h.payer.insecure_clone(), &bettor]).unwrap();
    let bettor_refund = h.token_balance(&bettor_ata) - bettor_before;
    assert_eq!(bettor_refund, bet_deposit - 7 * USD * 80); // 80s streamed

    let creator_before = h.token_balance(&creator_ata);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::StopSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();
    let creator_refund = h.token_balance(&creator_ata) - creator_before;
    assert_eq!(creator_refund, seed_deposit - 5 * USD * 80);

    // ── Collect (permissionless), then payouts ────────────────────────────────
    h.warp(40);
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
    let yes_pool = 7 * USD * 60;
    let no_pool = 5 * USD * 60;
    let skim = no_pool * 200 / 10_000;
    let overage = 7 * USD * 20;
    assert_eq!(paid_bettor, yes_pool + no_pool - skim + overage);

    let creator_before = h.token_balance(&creator_ata);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &livestreak::instruction::WithdrawSeed { vault_id }.data(),
        user_op(creator.pubkey(), creator_ata).to_account_metas(None),
    );
    h.send(ix, &[&creator]).unwrap();
    let paid_creator = h.token_balance(&creator_ata) - creator_before;
    assert_eq!(paid_creator, 5 * USD * 20); // loser's post-resolve overage

    // ── The escrow token account EXACTLY matches the engine's ledgers ─────────
    let p = h.protocol(&market_id);
    let ledger_sum = p.drips.held + p.vault.usdc_held + p.treasury.usdc_held;
    assert_eq!(h.token_balance(&escrow) as u128, ledger_sum);
    // And real-token conservation closes end to end.
    let total_wallets = h.token_balance(&creator_ata) + h.token_balance(&bettor_ata);
    assert_eq!(total_wallets as u128 + ledger_sum, (2_000 * USD) as u128);
}
