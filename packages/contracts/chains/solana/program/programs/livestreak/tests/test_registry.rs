//! Phase 1 integration tests over litesvm: registry init, market registration with
//! enumeration, stream lifecycle (go_live / set_ended / evidence lock), creator gate.
//! Mirrors the Move market_registry test semantics.

use {
    anchor_lang::{
        prelude::Pubkey, solana_program::system_program, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    anchor_lang::solana_program::instruction::Instruction,
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SCHEME_IPFS: u8 = 2;

struct Harness {
    svm: LiteSVM,
    payer: Keypair,
    program_id: Pubkey,
}

impl Harness {
    fn new() -> Self {
        let program_id = livestreak::id();
        let payer = Keypair::new();
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/livestreak.so"
        ));
        svm.add_program(program_id, bytes).unwrap();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        Self { svm, payer, program_id }
    }

    fn send(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<(), String> {
        // Failed txs enter the dedup cache too — a fresh blockhash keeps deliberate
        // retry sequences (fail -> fix -> retry) from tripping AlreadyProcessed.
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&self.payer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
            .map_err(|e| e.to_string())?;
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}", e.err))
    }

    fn registry_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[b"registry"], &self.program_id).0
    }

    fn market_pda(&self, market_id: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"market", market_id], &self.program_id).0
    }

    fn index_pda(&self, index: u64) -> Pubkey {
        Pubkey::find_program_address(&[b"market_idx", &index.to_le_bytes()], &self.program_id).0
    }

    fn initialize(&mut self, default_steward: Pubkey) {
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &livestreak::instruction::Initialize { default_steward }.data(),
            livestreak::accounts::Initialize {
                payer: self.payer.pubkey(),
                registry: self.registry_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let payer = self.payer.insecure_clone();
        self.send(ix, &[&payer]).unwrap();
    }

    fn register(&mut self, title: &[u8], stream_id: &[u8], index: u64) -> Result<[u8; 32], String> {
        let market_id = livestreak::instructions::register_market::compute_market_id(
            &self.payer.pubkey(),
            stream_id,
        );
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &livestreak::instruction::RegisterMarket {
                title: title.to_vec(),
                stream_id: stream_id.to_vec(),
            }
            .data(),
            livestreak::accounts::RegisterMarket {
                creator: self.payer.pubkey(),
                registry: self.registry_pda(),
                market: self.market_pda(&market_id),
                market_index: self.index_pda(index),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let payer = self.payer.insecure_clone();
        self.send(ix, &[&payer]).map(|_| market_id)
    }

    fn lifecycle(
        &mut self,
        market_id: &[u8; 32],
        creator: &Keypair,
        go_live: bool,
        pointer: &[u8],
    ) -> Result<(), String> {
        let data = if go_live {
            livestreak::instruction::GoLive { scheme: SCHEME_IPFS, pointer: pointer.to_vec() }.data()
        } else {
            livestreak::instruction::SetEnded { scheme: SCHEME_IPFS, pointer: pointer.to_vec() }
                .data()
        };
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &data,
            livestreak::accounts::StreamLifecycle {
                creator: creator.pubkey(),
                market: self.market_pda(market_id),
            }
            .to_account_metas(None),
        );
        let payer = self.payer.insecure_clone();
        if creator.pubkey() == payer.pubkey() {
            self.send(ix, &[&payer])
        } else {
            self.send(ix, &[&payer, creator])
        }
    }

    fn market(&self, market_id: &[u8; 32]) -> livestreak::state::Market {
        let account = self.svm.get_account(&self.market_pda(market_id)).unwrap();
        livestreak::state::Market::try_deserialize(&mut account.data.as_slice()).unwrap()
    }
}

#[test]
fn registers_market_with_enumeration() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());

    let id_a = h.register(b"Keynote A", b"stream-a", 0).unwrap();
    let id_b = h.register(b"Keynote B", b"stream-b", 1).unwrap();
    assert_ne!(id_a, id_b);

    let market = h.market(&id_a);
    assert_eq!(market.title, b"Keynote A");
    assert_eq!(market.creator, h.payer.pubkey());
    assert_eq!(market.stream_status, 0);

    // Enumeration ledger: registry count + index PDAs mirror marketCount/marketIdAt.
    let registry_account = h.svm.get_account(&h.registry_pda()).unwrap();
    let registry =
        livestreak::state::Registry::try_deserialize(&mut registry_account.data.as_slice())
            .unwrap();
    assert_eq!(registry.market_count, 2);
    let idx1 = h.svm.get_account(&h.index_pda(1)).unwrap();
    let idx1 = livestreak::state::MarketIndex::try_deserialize(&mut idx1.data.as_slice()).unwrap();
    assert_eq!(idx1.market_id, id_b);
}

#[test]
fn duplicate_registration_fails_structurally() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());
    h.register(b"Once", b"stream-x", 0).unwrap();
    // Same creator + stream_id → same market PDA → init fails (E_MARKET_EXISTS analog).
    assert!(h.register(b"Twice", b"stream-x", 1).is_err());
}

#[test]
fn rejects_empty_inputs() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());
    assert!(h.register(b"", b"stream-x", 0).is_err());
    assert!(h.register(b"Title", b"", 0).is_err());
}

#[test]
fn stream_lifecycle_and_evidence_lock() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());
    let id = h.register(b"Live show", b"stream-live", 0).unwrap();
    let creator = h.payer.insecure_clone();

    // set_ended before ever live → NotLive.
    assert!(h.lifecycle(&id, &creator, false, b"vod-blob").is_err());

    h.lifecycle(&id, &creator, true, b"live-manifest").unwrap();
    assert_eq!(h.market(&id).stream_status, 1);

    h.lifecycle(&id, &creator, false, b"vod-blob").unwrap();
    let m = h.market(&id);
    assert_eq!(m.stream_status, 2);
    assert_eq!(m.stream_pointer, b"vod-blob");

    // go_live after ended → StreamEnded.
    assert!(h.lifecycle(&id, &creator, true, b"live-again").is_err());

    // Within grace: pointer may still be corrected.
    h.lifecycle(&id, &creator, false, b"vod-blob-fixed").unwrap();
    assert_eq!(h.market(&id).stream_pointer, b"vod-blob-fixed");

    // Warp past the 86400s grace → locked.
    let mut clock = h.svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp += 100_000;
    h.svm.set_sysvar(&clock);
    assert!(h.lifecycle(&id, &creator, false, b"vod-tamper").is_err());
}

#[test]
fn only_creator_drives_lifecycle() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());
    let id = h.register(b"Mine", b"stream-mine", 0).unwrap();

    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(h.lifecycle(&id, &stranger, true, b"hijack").is_err());
}

#[test]
fn default_steward_handover() {
    let mut h = Harness::new();
    h.initialize(h.payer.pubkey());

    let set_default = |h: &mut Harness, authority: &Keypair, steward: Pubkey| {
        let ix = Instruction::new_with_bytes(
            h.program_id,
            &livestreak::instruction::SetDefaultSteward { steward }.data(),
            livestreak::accounts::SetDefaultSteward {
                authority: authority.pubkey(),
                registry: h.registry_pda(),
            }
            .to_account_metas(None),
        );
        let payer = h.payer.insecure_clone();
        if authority.pubkey() == payer.pubkey() {
            h.send(ix, &[&payer])
        } else {
            h.send(ix, &[&payer, authority])
        }
    };
    let default_steward = |h: &Harness| {
        let account = h.svm.get_account(&h.registry_pda()).unwrap();
        livestreak::state::Registry::try_deserialize(&mut account.data.as_slice())
            .unwrap()
            .default_steward
    };

    // A stranger cannot take the registry.
    let stranger = Keypair::new();
    h.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(set_default(&mut h, &stranger, stranger.pubkey()).is_err());
    assert_eq!(default_steward(&h), h.payer.pubkey());

    // The current default steward hands over (the wire-time deployer -> steward-role flow) ...
    let steward_role = Keypair::new();
    let payer = h.payer.insecure_clone();
    set_default(&mut h, &payer, steward_role.pubkey()).unwrap();
    assert_eq!(default_steward(&h), steward_role.pubkey());

    // ... after which the OLD steward is locked out and the new one holds the gate.
    assert!(set_default(&mut h, &payer, payer.pubkey()).is_err());
    h.svm.airdrop(&steward_role.pubkey(), 1_000_000_000).unwrap();
    set_default(&mut h, &steward_role, payer.pubkey()).unwrap();
    assert_eq!(default_steward(&h), payer.pubkey());
}
