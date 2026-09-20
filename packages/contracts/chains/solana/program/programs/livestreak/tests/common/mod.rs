//! Shared litesvm harness for the on-chain integration tests: real SPL mint, CU budget
//! like real clients, clock warping, PDA/balance helpers.

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::solana_program::instruction::Instruction,
    litesvm::LiteSVM,
    litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const USD: u64 = 1_000_000;
pub const SIDE_YES: u8 = 0;
pub const SIDE_NO: u8 = 1;

pub struct Harness {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub program_id: Pubkey,
    pub usdc: Pubkey,
}

impl Harness {
    pub fn new() -> Self {
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

    pub fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
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
        // 256KB heap frame — the program's freeing allocator spans the full frame (see lib.rs).
        let heap_frame = Instruction::new_with_bytes(
            "ComputeBudget111111111111111111111111111111".parse().unwrap(),
            &{
                let mut data = vec![1u8];
                data.extend_from_slice(&262_144u32.to_le_bytes());
                data
            },
            vec![],
        );
        let msg = Message::new_with_blockhash(&[compute_budget, heap_frame, ix], Some(&self.payer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
            .map_err(|e| e.to_string())?;
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}\nlogs: {:#?}", e.err, e.meta.logs))
    }

    pub fn pda(&self, seeds: &[&[u8]]) -> Pubkey {
        Pubkey::find_program_address(seeds, &self.program_id).0
    }

    pub fn warp(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).unwrap().data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    pub fn ata(&mut self, owner: &Keypair, fund: u64) -> Pubkey {
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

    pub fn protocol(&self, market_id: &[u8; 32]) -> livestreak_engine::Protocol {
        use anchor_lang::AccountDeserialize;
        let state_pda = self.pda(&[b"protocol", market_id]);
        let account = self.svm.get_account(&state_pda).unwrap();
        let state =
            livestreak::state::ProtocolState::try_deserialize(&mut account.data.as_slice())
                .unwrap();
        livestreak_engine::Protocol::from_bytes(&state.data).unwrap()
    }
}
