use livestreak_engine::{DriverError, Protocol, SIDE_NO, SIDE_YES};
use ruint::aliases::U256;
const CREATOR: [u8; 32] = [2; 32];
const MARKET: [u8; 32] = [3; 32];
fn create(p: &mut Protocol, op: u8, close: u64) -> [u8; 32] {
    p.create_bound_vault_seeded(
        MARKET,
        b"Generic question?".to_vec(),
        CREATOR,
        SIDE_YES,
        U256::from(10),
        10000,
        100,
        [1; 32],
        close,
        [op; 32],
    )
    .unwrap()
}
#[test]
fn creation_retry_recovers_after_close_and_conflict_does_not_seed() {
    let mut p = Protocol::default();
    let id = create(&mut p, 1, 120);
    let state = p.to_bytes();
    assert_eq!(
        p.create_bound_vault_seeded(
            MARKET,
            b"Generic question?".to_vec(),
            CREATOR,
            SIDE_YES,
            U256::from(10),
            10000,
            150,
            [1; 32],
            120,
            [1; 32]
        )
        .unwrap(),
        id
    );
    assert_eq!(p.to_bytes(), state);
    assert_eq!(
        p.create_bound_vault_seeded(
            MARKET,
            b"changed".to_vec(),
            CREATOR,
            SIDE_YES,
            U256::from(10),
            10000,
            150,
            [1; 32],
            120,
            [1; 32]
        ),
        Err(DriverError::CreationConflict)
    );
    assert_eq!(p.to_bytes(), state);
    assert_ne!(create(&mut p, 2, 120), id);
    let mut restarted = Protocol::from_bytes(&p.to_bytes()).unwrap();
    assert_eq!(
        restarted
            .create_bound_vault_seeded(
                MARKET,
                b"Generic question?".to_vec(),
                CREATOR,
                SIDE_YES,
                U256::from(10),
                10000,
                150,
                [1; 32],
                120,
                [1; 32]
            )
            .unwrap(),
        id
    );
}
#[test]
fn cutoff_caps_seed_and_viewer_delivery_board_and_refunds() {
    let mut p = Protocol::default();
    let id = create(&mut p, 1, 120);
    let token = p.mint_with_salt(MARKET, true, [4; 32], 1).unwrap();
    p.fund(token, &id, SIDE_NO, U256::from(20), 10000, 100)
        .unwrap();
    p.vault.advance(&id, SIDE_YES, 64, 160).unwrap();
    p.vault.advance(&id, SIDE_NO, 64, 160).unwrap();
    assert_eq!(p.vault.get_board(&id, SIDE_YES).0, U256::from(200));
    assert_eq!(p.vault.get_board(&id, SIDE_NO).0, U256::from(400));
    assert_eq!(p.harvest(&id, SIDE_YES, 160), 200);
    assert_eq!(p.harvest(&id, SIDE_NO, 160), 400);
    assert_eq!(p.stop_seed(&id, CREATOR, 160).unwrap(), 9800);
    assert_eq!(p.stop_all(token, 160).unwrap(), 9600);
    assert_eq!(p.drips.held + p.vault.usdc_held + p.treasury.usdc_held, 600);
}
#[test]
fn exact_cutoff_rejects_new_funding_and_topups_but_allows_cleanup() {
    let mut p = Protocol::default();
    let a = create(&mut p, 1, 120);
    let b = create(&mut p, 2, 140);
    let token = p.mint_with_salt(MARKET, true, [4; 32], 1).unwrap();
    p.fund(token, &a, SIDE_NO, U256::from(10), 10000, 119)
        .unwrap();
    assert_eq!(
        p.set_lanes(token, &[(a, SIDE_NO, U256::from(10))], 1, 120),
        Err(DriverError::FundingClosed)
    );
    assert_eq!(
        p.fund(token, &a, SIDE_YES, U256::from(10), 10, 120),
        Err(DriverError::FundingClosed)
    );
    p.set_lanes(
        token,
        &[(a, SIDE_NO, U256::from(10)), (b, SIDE_NO, U256::from(10))],
        0,
        120,
    )
    .unwrap();
    p.vault.advance(&a, SIDE_NO, 64, 160).unwrap();
    p.vault.advance(&b, SIDE_NO, 64, 160).unwrap();
    assert_eq!(p.vault.get_board(&a, SIDE_NO).0, U256::from(10));
    assert_eq!(p.vault.get_board(&b, SIDE_NO).0, U256::from(200));
    assert_eq!(p.harvest(&a, SIDE_NO, 160), 10);
    assert_eq!(p.harvest(&b, SIDE_NO, 160), 200);
    p.set_lanes(token, &[(b, SIDE_NO, U256::from(10))], 0, 160)
        .unwrap();
    p.stop_all(token, 160).unwrap();
}
#[test]
fn zero_commitment_unbound_funding_and_old_state_fail_explicitly() {
    let mut p = Protocol::default();
    assert_eq!(
        p.create_bound_vault_seeded(
            MARKET,
            b"Q".to_vec(),
            CREATOR,
            SIDE_YES,
            U256::from(10),
            100,
            100,
            [0; 32],
            120,
            [1; 32]
        ),
        Err(DriverError::UnboundVault)
    );
    let id = p
        .vault
        .create_vault(MARKET, b"unbound".to_vec(), CREATOR, 100)
        .unwrap();
    let token = p.mint_with_salt(MARKET, true, [4; 32], 1).unwrap();
    assert_eq!(
        p.fund(token, &id, SIDE_NO, U256::from(10), 100, 100),
        Err(DriverError::UnboundVault)
    );
    assert!(Protocol::from_bytes(&p.to_bytes()[5..]).is_none());
}
