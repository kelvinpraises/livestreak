use anchor_lang::prelude::*;
use livestreak_engine::{
    drips::DripsError, drivers::DriverError, state::StreamsError, treasury::TreasuryError,
    vault::VaultError,
};

// Mirrors the Move abort codes in meaning; Anchor gives each a distinct error code.
// Engine variants are prefixed by module (Streams/Vault/Driver/Drips/Treasury) so the
// SDK can decode every failure to a typed error, like the EVM revert decoding.
#[error_code]
pub enum LivestreakError {
    #[msg("title must be non-empty")]
    EmptyTitle,
    #[msg("stream id must be non-empty")]
    ZeroStreamId,
    #[msg("input exceeds maximum length")]
    InputTooLong,
    #[msg("caller is not the market creator")]
    NotCreator,
    #[msg("stream already ended")]
    StreamEnded,
    #[msg("stream was never live")]
    NotLive,
    #[msg("stream pointer is locked (evidence grace elapsed)")]
    StreamLocked,
    #[msg("unknown storage pointer scheme")]
    BadScheme,
    #[msg("protocol state failed to decode")]
    EngineState,
    #[msg("protocol state account is full")]
    StateFull,
    #[msg("engine operation failed (see logs)")]
    EngineOp,
    #[msg("caller is not the effective steward")]
    NotSteward,
    #[msg("escrow balance diverged from engine ledgers")]
    ConservationViolated,

    // ── streams ──
    #[msg("too many stream receivers")]
    StreamsTooManyReceivers,
    #[msg("stream receivers not sorted")]
    StreamsReceiversNotSorted,
    #[msg("stream rate below minimum")]
    StreamsAmtPerSecTooLow,
    #[msg("cycle seconds below minimum")]
    StreamsCycleSecsTooLow,
    #[msg("invalid streams receivers")]
    StreamsInvalidReceivers,
    #[msg("invalid streams history")]
    StreamsInvalidHistory,
    #[msg("history entry has both hash and receivers")]
    StreamsEntryWithHashAndReceivers,
    #[msg("timestamp before last update")]
    StreamsTimestampBeforeUpdate,
    #[msg("streams balance too high")]
    StreamsBalanceTooHigh,

    // ── vault ──
    #[msg("vault question must be non-empty")]
    VaultEmptyQuestion,
    #[msg("vault creator must be non-zero")]
    VaultZeroCreator,
    #[msg("unknown vault")]
    VaultUnknown,
    #[msg("vault is not open")]
    VaultNotOpen,
    #[msg("vault rate must be non-zero")]
    VaultZeroRate,
    #[msg("position already funding this vault")]
    VaultAlreadyFunding,
    #[msg("vault input length mismatch")]
    VaultLengthMismatch,
    #[msg("vault is not resolvable")]
    VaultNotResolvable,
    #[msg("vault is not resolved")]
    VaultNotResolved,
    #[msg("board is behind; advance before settling")]
    VaultBoardBehind,
    #[msg("division by zero in vault math")]
    VaultDivZero,
    #[msg("insufficient USDC in vault ledger")]
    VaultInsufficientUsdc,

    // ── driver ──
    #[msg("mint salt already used")]
    DriverSaltUsed,
    #[msg("unknown market")]
    DriverUnknownMarket,
    #[msg("lane rate must be non-zero")]
    DriverZeroRate,
    #[msg("bad deposit amount")]
    DriverBadDeposit,
    #[msg("vault belongs to a different market")]
    DriverWrongMarket,
    #[msg("position already has a lane on this vault")]
    DriverVaultHasLane,
    #[msg("too many lanes on this position")]
    DriverTooManyLanes,
    #[msg("no lane on this vault")]
    DriverNoLane,
    #[msg("duplicate vault in lane set")]
    DriverDuplicateVault,
    #[msg("driver input length mismatch")]
    DriverLengthMismatch,
    #[msg("seed lane already exists")]
    DriverSeedExists,
    #[msg("no seed lane")]
    DriverNoSeed,

    // ── drips ──
    #[msg("total streamed balance too high")]
    DripsTotalBalanceTooHigh,
    #[msg("token balance too low")]
    DripsTokenBalanceTooLow,
    #[msg("withdrawal amount too high")]
    DripsWithdrawalAmountTooHigh,

    // ── treasury ──
    #[msg("loss already claimed")]
    TreasuryAlreadyClaimed,
    #[msg("nothing lost to claim")]
    TreasuryNothingLost,
    #[msg("stake must be non-zero")]
    TreasuryZeroStake,
    #[msg("invalid unstake amount")]
    TreasuryInvalidUnstake,
}

impl From<StreamsError> for LivestreakError {
    fn from(e: StreamsError) -> Self {
        match e {
            StreamsError::TooManyReceivers => Self::StreamsTooManyReceivers,
            StreamsError::ReceiversNotSorted => Self::StreamsReceiversNotSorted,
            StreamsError::AmtPerSecTooLow => Self::StreamsAmtPerSecTooLow,
            StreamsError::CycleSecsTooLow => Self::StreamsCycleSecsTooLow,
            StreamsError::InvalidStreamsReceivers => Self::StreamsInvalidReceivers,
            StreamsError::InvalidStreamsHistory => Self::StreamsInvalidHistory,
            StreamsError::EntryWithHashAndReceivers => Self::StreamsEntryWithHashAndReceivers,
            StreamsError::TimestampBeforeUpdate => Self::StreamsTimestampBeforeUpdate,
            StreamsError::BalanceTooHigh => Self::StreamsBalanceTooHigh,
        }
    }
}

impl From<VaultError> for LivestreakError {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::EmptyQuestion => Self::VaultEmptyQuestion,
            VaultError::ZeroCreator => Self::VaultZeroCreator,
            VaultError::UnknownVault => Self::VaultUnknown,
            VaultError::NotOpen => Self::VaultNotOpen,
            VaultError::ZeroRate => Self::VaultZeroRate,
            VaultError::AlreadyFunding => Self::VaultAlreadyFunding,
            VaultError::LengthMismatch => Self::VaultLengthMismatch,
            VaultError::NotResolvable => Self::VaultNotResolvable,
            VaultError::NotResolved => Self::VaultNotResolved,
            VaultError::BoardBehind => Self::VaultBoardBehind,
            VaultError::DivZero => Self::VaultDivZero,
            VaultError::InsufficientUsdc => Self::VaultInsufficientUsdc,
        }
    }
}

impl From<DripsError> for LivestreakError {
    fn from(e: DripsError) -> Self {
        match e {
            DripsError::TotalBalanceTooHigh => Self::DripsTotalBalanceTooHigh,
            DripsError::TokenBalanceTooLow => Self::DripsTokenBalanceTooLow,
            DripsError::WithdrawalAmountTooHigh => Self::DripsWithdrawalAmountTooHigh,
            DripsError::Streams(s) => s.into(),
        }
    }
}

impl From<DriverError> for LivestreakError {
    fn from(e: DriverError) -> Self {
        match e {
            DriverError::SaltUsed => Self::DriverSaltUsed,
            DriverError::UnknownMarket => Self::DriverUnknownMarket,
            DriverError::ZeroRate => Self::DriverZeroRate,
            DriverError::BadDeposit => Self::DriverBadDeposit,
            DriverError::WrongMarket => Self::DriverWrongMarket,
            DriverError::VaultHasLane => Self::DriverVaultHasLane,
            DriverError::TooManyLanes => Self::DriverTooManyLanes,
            DriverError::NoLane => Self::DriverNoLane,
            DriverError::DuplicateVault => Self::DriverDuplicateVault,
            DriverError::LengthMismatch => Self::DriverLengthMismatch,
            DriverError::SeedExists => Self::DriverSeedExists,
            DriverError::NoSeed => Self::DriverNoSeed,
            DriverError::Vault(v) => v.into(),
            DriverError::Drips(d) => d.into(),
        }
    }
}

impl From<TreasuryError> for LivestreakError {
    fn from(e: TreasuryError) -> Self {
        match e {
            TreasuryError::AlreadyClaimed => Self::TreasuryAlreadyClaimed,
            TreasuryError::NothingLost => Self::TreasuryNothingLost,
            TreasuryError::ZeroStake => Self::TreasuryZeroStake,
            TreasuryError::InvalidUnstake => Self::TreasuryInvalidUnstake,
        }
    }
}
